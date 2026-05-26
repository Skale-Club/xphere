// RFC 7591 — OAuth 2.0 Dynamic Client Registration.
// Lets Claude/ChatGPT register themselves as OAuth clients on the fly so the
// user doesn't have to manually create an app in Xphere settings before
// connecting.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { randomClientId, randomOpaqueToken, sha256Hex } from '@/lib/mcp/crypto'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function err(message: string, status = 400) {
  return new Response(
    JSON.stringify({ error: 'invalid_client_metadata', error_description: message }),
    { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  let body: {
    client_name?: string
    redirect_uris?: string[]
    token_endpoint_auth_method?: string
    grant_types?: string[]
    response_types?: string[]
    scope?: string
  }
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body')
  }

  const name = (body.client_name ?? '').trim() || 'MCP Client'
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  if (redirectUris.length === 0) {
    return err('At least one redirect_uri is required')
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !/^https?:\/\//.test(uri)) {
      return err(`Invalid redirect_uri: ${uri}`)
    }
  }

  const authMethod = body.token_endpoint_auth_method ?? 'client_secret_post'
  const isPublic = authMethod === 'none'

  const clientId = randomClientId()
  const clientSecret = isPublic ? null : randomOpaqueToken(32)
  const clientSecretHash = clientSecret ? await sha256Hex(clientSecret) : null

  const supabase = createServiceRoleClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    name,
    redirect_uris: redirectUris,
    scope: body.scope ?? 'mcp:all',
    created_via: 'dcr',
  })
  if (error) {
    return err(`Failed to register client: ${error.message}`, 500)
  }

  // Audit | DCR isn't tied to an org yet, so we skip orgId-scoped logging.
  // Future: a dedicated dcr_log table could capture cross-org registrations.

  return new Response(
    JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,            // null for public/PKCE-only clients
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      grant_types: body.grant_types ?? ['authorization_code', 'refresh_token'],
      response_types: body.response_types ?? ['code'],
      scope: body.scope ?? 'mcp:all',
    }),
    {
      status: 201,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  )
}

