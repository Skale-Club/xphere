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
import { getUrlCredentials } from '@/lib/integrations/url-credentials'
import type { XpotCredentials } from './client'

export async function getXpotCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<XpotCredentials | null> {
  const creds = await getUrlCredentials(orgId, 'xpot', supabase)
  return creds && { baseUrl: creds.baseUrl.replace(/\/$/, ''), apiKey: creds.apiKey }
}
