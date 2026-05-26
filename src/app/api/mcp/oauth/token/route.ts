// OAuth 2.0 Token endpoint.
// Accepts:
//   grant_type=authorization_code | exchanges a code + PKCE verifier for tokens
//   grant_type=refresh_token      | rotates an existing access_token
//
// Client authentication:
//   - Confidential clients (those issued a client_secret at registration) must
//     present client_id + client_secret either in the form body or via HTTP
//     Basic Authorization.
//   - Public clients (registered with token_endpoint_auth_method=none) skip
//     the secret check | the PKCE verifier is the auth.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { computeS256Challenge, randomOpaqueToken, sha256Hex } from '@/lib/mcp/crypto'

const ACCESS_TTL_SECONDS = 60 * 60          // 1h
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60 // 30d

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonErr(error: string, description: string, status = 400) {
  return new Response(
    JSON.stringify({ error, error_description: description }),
    {
      status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    },
  })
}

async function parseForm(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get('content-type') ?? ''
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await request.text()
    return Object.fromEntries(new URLSearchParams(text).entries())
  }
  if (ct.includes('application/json')) {
    const body = await request.json().catch(() => ({}))
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
    )
  }
  // Best effort: try urlencoded anyway.
  const text = await request.text()
  return Object.fromEntries(new URLSearchParams(text).entries())
}

function parseBasicAuth(header: string | null): { clientId: string; clientSecret: string } | null {
  if (!header?.toLowerCase().startsWith('basic ')) return null
  try {
    const decoded = atob(header.slice(6).trim())
    const idx = decoded.indexOf(':')
    if (idx === -1) return null
    return { clientId: decoded.slice(0, idx), clientSecret: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const form = await parseForm(request)
  const basic = parseBasicAuth(request.headers.get('authorization'))

  const grantType = form.grant_type
  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(form, basic)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshToken(form, basic)
  }
  return jsonErr('unsupported_grant_type', `grant_type "${grantType ?? ''}" not supported`)
}

interface ClientRow {
  client_id: string
  client_secret_hash: string | null
  redirect_uris: string[]
  scope: string
}

async function loadAndAuthenticateClient(
  clientId: string,
  providedSecret: string | undefined,
): Promise<{ client: ClientRow } | { error: Response }> {
  if (!clientId) {
    return { error: jsonErr('invalid_client', 'client_id is required') }
  }
  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('mcp_oauth_clients')
    .select('client_id, client_secret_hash, redirect_uris, scope')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!data) {
    return { error: jsonErr('invalid_client', 'unknown client_id', 401) }
  }
  const client = data as ClientRow

  if (client.client_secret_hash) {
    if (!providedSecret) {
      return { error: jsonErr('invalid_client', 'client_secret required', 401) }
    }
    const hash = await sha256Hex(providedSecret)
    if (hash !== client.client_secret_hash) {
      return { error: jsonErr('invalid_client', 'client_secret mismatch', 401) }
    }
  }
  return { client }
}

async function handleAuthorizationCode(
  form: Record<string, string>,
  basic: { clientId: string; clientSecret: string } | null,
) {
  const clientId = form.client_id || basic?.clientId || ''
  const clientSecret = form.client_secret || basic?.clientSecret || undefined

  const auth = await loadAndAuthenticateClient(clientId, clientSecret)
  if ('error' in auth) return auth.error

  const { code, redirect_uri: redirectUri, code_verifier: codeVerifier } = form
  if (!code) return jsonErr('invalid_request', 'code is required')
  if (!redirectUri) return jsonErr('invalid_request', 'redirect_uri is required')
  if (!codeVerifier) return jsonErr('invalid_request', 'code_verifier is required')

  const supabase = createServiceRoleClient()
  const codeHash = await sha256Hex(code)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: codeRow } = await (supabase as any)
    .from('mcp_oauth_codes')
    .select('client_id, org_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used')
    .eq('code_hash', codeHash)
    .maybeSingle()

  if (!codeRow) return jsonErr('invalid_grant', 'code not found')
  if (codeRow.used) return jsonErr('invalid_grant', 'code already used')
  if (new Date(codeRow.expires_at as string).getTime() < Date.now()) {
    return jsonErr('invalid_grant', 'code expired')
  }
  if (codeRow.client_id !== auth.client.client_id) {
    return jsonErr('invalid_grant', 'code belongs to a different client')
  }
  if (codeRow.redirect_uri !== redirectUri) {
    return jsonErr('invalid_grant', 'redirect_uri mismatch')
  }
  const challenge = await computeS256Challenge(codeVerifier)
  if (challenge !== codeRow.code_challenge) {
    return jsonErr('invalid_grant', 'code_verifier mismatch')
  }

  // Mark the code as consumed BEFORE issuing tokens (idempotency guard).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: markErr } = await (supabase as any)
    .from('mcp_oauth_codes')
    .update({ used: true })
    .eq('code_hash', codeHash)
    .eq('used', false) // optimistic: prevents race condition double-consumption
  if (markErr) return jsonErr('server_error', 'failed to consume code', 500)

  const accessToken = randomOpaqueToken(32)
  const refreshToken = randomOpaqueToken(32)
  const accessHash = await sha256Hex(accessToken)
  const refreshHash = await sha256Hex(refreshToken)
  const now = Date.now()
  const expiresAt = new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString()
  const refreshExpiresAt = new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await (supabase as any).from('mcp_oauth_tokens').insert({
    access_token_hash: accessHash,
    refresh_token_hash: refreshHash,
    client_id: auth.client.client_id,
    org_id: codeRow.org_id,
    user_id: codeRow.user_id,
    scope: codeRow.scope,
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
  })
  if (insertErr) return jsonErr('server_error', 'failed to issue token', 500)

  // Touch client.last_used_at | best effort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void (supabase as any)
    .from('mcp_oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('client_id', auth.client.client_id)
    .then(() => undefined, () => undefined)

  return jsonOk({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: codeRow.scope,
  })
}

async function handleRefreshToken(
  form: Record<string, string>,
  basic: { clientId: string; clientSecret: string } | null,
) {
  const clientId = form.client_id || basic?.clientId || ''
  const clientSecret = form.client_secret || basic?.clientSecret || undefined

  const auth = await loadAndAuthenticateClient(clientId, clientSecret)
  if ('error' in auth) return auth.error

  const provided = form.refresh_token
  if (!provided) return jsonErr('invalid_request', 'refresh_token is required')
  const refreshHash = await sha256Hex(provided)

  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tokenRow } = await (supabase as any)
    .from('mcp_oauth_tokens')
    .select('id, client_id, org_id, user_id, scope, refresh_expires_at, revoked')
    .eq('refresh_token_hash', refreshHash)
    .maybeSingle()

  if (!tokenRow || tokenRow.revoked) {
    return jsonErr('invalid_grant', 'refresh_token invalid')
  }
  if (tokenRow.client_id !== auth.client.client_id) {
    return jsonErr('invalid_grant', 'refresh_token belongs to another client')
  }
  if (tokenRow.refresh_expires_at && new Date(tokenRow.refresh_expires_at as string).getTime() < Date.now()) {
    return jsonErr('invalid_grant', 'refresh_token expired')
  }

  // Refresh rotation: issue a new pair, revoke the old one.
  const newAccess = randomOpaqueToken(32)
  const newRefresh = randomOpaqueToken(32)
  const newAccessHash = await sha256Hex(newAccess)
  const newRefreshHash = await sha256Hex(newRefresh)
  const now = Date.now()
  const expiresAt = new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString()
  const refreshExpiresAt = new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('mcp_oauth_tokens')
    .update({ revoked: true })
    .eq('id', tokenRow.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await (supabase as any).from('mcp_oauth_tokens').insert({
    access_token_hash: newAccessHash,
    refresh_token_hash: newRefreshHash,
    client_id: auth.client.client_id,
    org_id: tokenRow.org_id,
    user_id: tokenRow.user_id,
    scope: tokenRow.scope,
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
  })
  if (insertErr) return jsonErr('server_error', 'failed to rotate token', 500)

  return jsonOk({
    access_token: newAccess,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: newRefresh,
    scope: tokenRow.scope,
  })
}
