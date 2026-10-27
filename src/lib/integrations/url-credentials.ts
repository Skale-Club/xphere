// src/lib/integrations/url-credentials.ts
// The shape shared by integrations that pair a base URL with a secret token
// (Xkedule, Xpot): location_id holds the URL, encrypted_api_key the token.
// Returns null unless the org's integration is active and has both.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'

export async function getUrlCredentials(
  orgId: string,
  provider: 'xkedule' | 'xpot',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id')
    .eq('organization_id', orgId)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data || !data.location_id || !data.encrypted_api_key) return null

  const apiKey = await decrypt(data.encrypted_api_key as string)
  return { baseUrl: data.location_id as string, apiKey }
}
