// src/lib/xpot/credentials.ts
// Loads the per-org Xpot integration credentials (Settings → Integrations →
// Xpot). Nothing lives in the environment — only the org that connected Xpot
// sends it prospects and tasks:
//   location_id        = Xpot base URL (https://xpot.place)
//   encrypted_api_key  = the Xpot user's inbound key (xpot_…), shown in Xpot's
//                        Admin → Integrations → Xphere card for that user.
// The other direction (Xpot → Xphere) authenticates with one of this org's
// Xphere API keys (xph_…), which pins Xpot's writes to the same org.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'
import type { XpotCredentials } from './client'

export async function getXpotCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<XpotCredentials | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id')
    .eq('organization_id', orgId)
    .eq('provider', 'xpot')
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data || !data.location_id || !data.encrypted_api_key) return null

  const apiKey = await decrypt(data.encrypted_api_key as string)
  return { baseUrl: (data.location_id as string).replace(/\/$/, ''), apiKey }
}
