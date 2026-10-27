// src/lib/integrations/url-credentials.ts
// The shape shared by integrations that pair a base URL with a secret token
// (Xkedule, Xpot): location_id holds the URL, encrypted_api_key the token.
// A provider with a single fixed host (Xpot) passes `fixedBaseUrl` and its
// location_id is ignored. Returns null unless the org's integration is active
// and has both a URL and a token.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/crypto'

export async function getUrlCredentials(
  orgId: string,
  provider: 'xkedule' | 'xpot',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  fixedBaseUrl?: string,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id')
    .eq('organization_id', orgId)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle()

  const baseUrl = fixedBaseUrl ?? (data?.location_id as string | null | undefined)
  if (error || !data || !baseUrl || !data.encrypted_api_key) return null

  const apiKey = await decrypt(data.encrypted_api_key as string)
  return { baseUrl, apiKey }
}
