import { decrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { AdsPlatform } from '../commands/types'
import { googleAdapter } from './google-adapter'
import { assetsHandler } from './google/assets'
import { biddingHandler } from './google/bidding'
import { customerMatchHandler } from './google/customer-match'
import { withHandlers } from './handlers'
import { adsetsHandler } from './meta/adsets'
import { creativesHandler } from './meta/creatives'
import { metaAdapter } from './meta-adapter'
import type { AdapterContext, AdsProviderAdapter } from './types'

// New capabilities are CommandHandler modules composed over the base
// adapters (see handlers.ts); the base adapters keep the original commands.
const ADAPTERS: Record<AdsPlatform, AdsProviderAdapter> = {
  google: withHandlers(googleAdapter, [biddingHandler, assetsHandler, customerMatchHandler]),
  meta: withHandlers(metaAdapter, [adsetsHandler, creativesHandler]),
}

export function getAdapter(platform: AdsPlatform): AdsProviderAdapter {
  return ADAPTERS[platform]
}

export type ConnectionLookup =
  | { ok: true; ctx: AdapterContext; accountName: string | null }
  | { ok: false; code: 'no_connection' | 'connection_error'; message: string }

/**
 * Load and decrypt the credential for one ad account of one org.
 *
 * The org filter is explicit (service-role client, no RLS) because the engine
 * also runs from the MCP server and cron, where there is no user session.
 * Only `usable` rows qualify: an account the admin hid ('available') or whose
 * credential is dead can't be written to.
 */
export async function loadAdapterContext(orgId: string, platform: AdsPlatform, adAccountId: string): Promise<ConnectionLookup> {
  const { data, error } = await createServiceRoleClient()
    .from('ads_connections')
    .select('encrypted_access_token, ad_account_name, usable, health, connection_error')
    .eq('org_id', orgId)
    .eq('platform', platform)
    .eq('ad_account_id', adAccountId)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, code: 'no_connection', message: `No ${platform} ad account ${adAccountId} is connected for this organization.` }
  }
  if (!data.usable) {
    return data.health === 'error'
      ? {
          ok: false,
          code: 'connection_error',
          message: `The ${platform} connection for ${adAccountId} needs to be re-authorized: ${data.connection_error ?? 'the stored token was rejected'}.`,
        }
      : { ok: false, code: 'no_connection', message: `Ad account ${adAccountId} is connected but not enabled for this organization.` }
  }

  return {
    ok: true,
    accountName: data.ad_account_name,
    ctx: { orgId, adAccountId, credential: await decrypt(data.encrypted_access_token) },
  }
}
