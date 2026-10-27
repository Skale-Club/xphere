// src/lib/xpot/credentials.ts
// Loads the per-org Xpot integration credentials (Settings → Integrations →
// Xpot). Nothing lives in the environment — only the org that connected Xpot
// sends it prospects and tasks:
//   XPOT_BASE_URL      = the one Xpot deployment; not configurable per org, so
//                        the integration's location_id is ignored.
//   encrypted_api_key  = the Xpot user's inbound key (xpot_…), shown in Xpot's
//                        Admin → Integrations → Xphere card for that user.
// The other direction (Xpot → Xphere) authenticates with one of this org's
// Xphere API keys (xph_…), which pins Xpot's writes to the same org.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUrlCredentials } from '@/lib/integrations/url-credentials'
import type { XpotCredentials } from './client'

export const XPOT_BASE_URL = 'https://xpot.place'

export async function getXpotCredentialsForOrg(
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<XpotCredentials | null> {
  return getUrlCredentials(orgId, 'xpot', supabase, XPOT_BASE_URL)
}
