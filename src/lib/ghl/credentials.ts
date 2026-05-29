// src/lib/ghl/credentials.ts
// Loads + decrypts the active GoHighLevel credentials for an org. Centralises
// the lookup that was previously inlined at every GHL call site, so the
// migration script and any future product feature share one source of truth.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import type { GhlCredentials } from './client'

/**
 * Fetches the org's active `gohighlevel` integration row and decrypts its key.
 * Returns null when no active integration exists or the row is missing a
 * location_id / key (treat as "not connected").
 *
 * Accepts any Supabase client — an authenticated (RLS-scoped) client resolves
 * the caller's own org, while a service-role client (migration script) reads
 * across orgs and must pass the explicit `orgId`.
 */
export async function getGhlCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<GhlCredentials | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('location_id, encrypted_api_key')
    .eq('organization_id', orgId)
    .eq('provider', 'gohighlevel')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) return null
  if (!data.location_id || !data.encrypted_api_key) return null

  const apiKey = await decrypt(data.encrypted_api_key as string)
  return { apiKey, locationId: data.location_id as string }
}
