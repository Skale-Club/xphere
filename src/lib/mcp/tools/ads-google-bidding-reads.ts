// MCP read tool for Google Ads radius (PROXIMITY) campaign targeting — the
// lookup an agent needs before proposing google.campaign.remove_proximity.
// Same shape as ads-google-reads.ts: resolve the ad account, parse the stored
// refresh token, wrap the call with withConnectionHealth so an auth failure
// marks the connection for reconnect, and return a structured
// { error, detail } on failure instead of throwing.
//
// PROXIMITY criteria aren't covered by ads_google_list_campaign_targeting
// (which only lists LOCATION / LANGUAGE / AD_SCHEDULE) — this reuses the same
// listCampaignProximities() the bidding CommandHandler snapshots with,
// instead of duplicating the GAQL query.
//
// Not registered in registry.ts here — this tool is wired up alongside the
// rest of the ads MCP surface.

import { z } from 'zod'

import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { listCampaignProximities } from '@/lib/ads/providers/google/bidding'
import type { McpToolDef } from '../tool-types'

export const adsGoogleBiddingReadTools: McpToolDef[] = [
  {
    name: 'ads_google_list_campaign_proximities',
    title: 'List Google Ads campaign radius (proximity) targeting',
    description:
      'Radius (PROXIMITY) targeting on a campaign, with the criterion_id google.campaign.remove_proximity needs. Latitude/longitude are returned in degrees (converted from Google\'s micro-degrees).',
    area: 'general_xphere',
    inputSchema: z.object({ customer_id: z.string().optional(), campaign_id: z.string() }).strict(),
    handler: async ({ customer_id, campaign_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const proximities = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          listCampaignProximities({ orgId: auth.orgId, adAccountId: conn.accountId, credential: conn.token }, campaign_id),
        )
        return {
          customer_id: conn.accountId,
          campaign_id,
          proximities: proximities.map((p) => ({
            criterion_id: p.criterion_id,
            latitude: p.latitude_micro !== null ? p.latitude_micro / 1_000_000 : null,
            longitude: p.longitude_micro !== null ? p.longitude_micro / 1_000_000 : null,
            radius: p.radius,
            radius_units: p.radius_units,
          })),
          count: proximities.length,
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
]
