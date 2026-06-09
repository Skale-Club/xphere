// src/lib/xkedule/credentials.ts
// Loads the Xkedule integration credentials for an org.
// The encrypted_api_key stores the tenant base URL (public, but encrypted for consistency).

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import type { XkeduleCredentials } from './client'

export async function getXkeduleCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<XkeduleCredentials | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', orgId)
    .eq('provider', 'xkedule')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data || !data.encrypted_api_key) return null

  const tenantBaseUrl = await decrypt(data.encrypted_api_key as string)
  return { tenantBaseUrl }
}
