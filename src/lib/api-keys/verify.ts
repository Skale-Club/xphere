import { createHash } from 'node:crypto'
import type { createServiceRoleClient } from '@/lib/supabase/admin'
import { hasScope, type ApiKeyScope } from '@/lib/api-keys/scopes'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type VerifiedApiKey = {
  keyId: string
  orgId: string
  scopes: string[]
}

export type ApiKeyVerification =
  | { ok: true; key: VerifiedApiKey }
  | { ok: false; status: 401 | 403; error: string; code: 'invalid_api_key' | 'insufficient_scope' }

export async function verifyApiKey(
  request: Request,
  supabase: ServiceClient,
  requiredScope?: ApiKeyScope,
): Promise<ApiKeyVerification> {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing Bearer token', code: 'invalid_api_key' }
  }

  const token = auth.slice(7).trim()
  if (!token) {
    return { ok: false, status: 401, error: 'Missing Bearer token', code: 'invalid_api_key' }
  }

  const { data } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!data) {
    return { ok: false, status: 401, error: 'Invalid or revoked API key', code: 'invalid_api_key' }
  }

  const scopes = data.scopes ?? []
  if (requiredScope && !hasScope(scopes, requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: `API key is missing the ${requiredScope} scope`,
      code: 'insufficient_scope',
    }
  }

  return { ok: true, key: { keyId: data.id, orgId: data.org_id, scopes } }
}

/**
 * Resolve the org behind a Bearer API key on an inbound request. Used by the
 * integration webhook receivers so an external system (Xmail, Xpot) authenticates
 * as a specific Xphere workspace by configuring that workspace's API key.
 */
export async function resolveApiKey(
  request: Request,
  supabase: ServiceClient,
): Promise<{ orgId: string; scopes: string[] } | null> {
  const result = await verifyApiKey(request, supabase)
  if (!result.ok) return null
  return { orgId: result.key.orgId, scopes: result.key.scopes }
}
