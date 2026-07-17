// src/lib/medusa/credentials.ts
// Loads the per-org Medusa integration credentials (Settings → Integrations →
// Medusa). Mirrors src/lib/xkedule/credentials.ts, with the addition of
// `config` for the store's publishable_key (and optional storefront_url):
//   location_id        = Medusa Store API base URL, e.g. http://localhost:9000
//   encrypted_api_key  = the connection token (XPHERE_CONNECTION_TOKEN) used
//                        for the privileged /agent/* HMAC surface (Phase 135)
//   config             = { publishable_key, storefront_url? }

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import type { MedusaCredentials } from './client'

export async function getMedusaCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<MedusaCredentials | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id, config')
    .eq('organization_id', orgId)
    .eq('provider', 'medusa')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data?.location_id || !data.encrypted_api_key) return null

  const config = (data.config ?? {}) as Record<string, string>
  if (!config.publishable_key) return null

  const connectionToken = await decrypt(data.encrypted_api_key as string)
  return {
    baseUrl: data.location_id as string,
    connectionToken,
    publishableKey: config.publishable_key,
    storefrontUrl: config.storefront_url,
  }
}
