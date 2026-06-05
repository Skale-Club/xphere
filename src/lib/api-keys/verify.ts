import { createHash } from 'node:crypto'
import type { createServiceRoleClient } from '@/lib/supabase/admin'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
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
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null

  const { data } = await supabase
    .from('api_keys')
    .select('org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!data) return null
  return { orgId: data.org_id, scopes: data.scopes ?? [] }
}
