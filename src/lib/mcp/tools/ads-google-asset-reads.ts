// MCP read tool for Google Ads ad assets (sitelinks, callouts, structured
// snippets, call) currently linked to a campaign or ad group — the ids
// google.asset.unlink needs, and a general listing an agent can check before
// proposing a google.asset.add_* command. Same shape as ads-google-reads.ts:
// resolve the ad account, wrap the call with withConnectionHealth so an auth
// failure marks the connection for reconnect, and return a structured
// { error, detail } on failure instead of throwing.
//
// Not registered in registry.ts here — this tool is wired up alongside the
// rest of the ads MCP surface.

import { z } from 'zod'

import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import {
  assetContent,
  queryAdGroupAssetLinks,
  queryCampaignAssetLinks,
  type AssetFieldType,
} from '@/lib/ads/providers/google/assets'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { McpToolDef } from '../tool-types'

const NumericId = () => z.string().regex(/^\d+$/, 'Must be a numeric id')
const FieldType = () => z.enum(['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL'])

type AssetListingRow = {
  level: 'campaign' | 'ad_group'
  parent_id: string
  parent_name: string | null
  asset_id: string
  field_type: AssetFieldType
  status: string
  content: Record<string, unknown>
}

export const adsGoogleAssetReadTools: McpToolDef[] = [
  {
    name: 'ads_google_list_assets',
    title: 'List linked Google Ads assets (sitelinks, callouts, structured snippets, call)',
    description:
      'Ad assets (sitelinks, callouts, structured snippets, call) currently linked to a campaign or ad group, with asset_id, field_type, content and status — the ids google.asset.unlink needs, and what to check against before proposing google.asset.add_*. Pass campaign_id for campaign-level links, ad_group_id for ad-group-level links, or neither to list account-wide.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        customer_id: z.string().optional(),
        campaign_id: NumericId().optional(),
        ad_group_id: NumericId().optional(),
        field_type: FieldType().optional(),
      })
      .strict(),
    handler: async ({ customer_id, campaign_id, ad_group_id, field_type }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const ctx: AdapterContext = { orgId: auth.orgId, adAccountId: conn.accountId, credential: conn.token }
        const rows = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, async () => {
          const results: AssetListingRow[] = []
          // campaign_id alone -> campaign-level only; ad_group_id alone -> ad-group-level
          // only; neither -> both, account-wide; both -> both, each filtered by its id.
          const includeCampaignLevel = !ad_group_id || Boolean(campaign_id)
          const includeAdGroupLevel = !campaign_id || Boolean(ad_group_id)

          if (includeCampaignLevel) {
            const links = await queryCampaignAssetLinks(ctx, { campaignId: campaign_id, fieldType: field_type })
            for (const l of links) {
              const fieldTypeResolved = (l.campaignAsset.fieldType ?? field_type) as AssetFieldType | undefined
              if (!fieldTypeResolved) continue
              results.push({
                level: 'campaign',
                parent_id: l.campaign.id,
                parent_name: l.campaign.name ?? null,
                asset_id: l.asset.id,
                field_type: fieldTypeResolved,
                status: l.campaignAsset.status,
                content: assetContent(fieldTypeResolved, l.asset),
              })
            }
          }

          if (includeAdGroupLevel) {
            const links = await queryAdGroupAssetLinks(ctx, { adGroupId: ad_group_id, fieldType: field_type })
            for (const l of links) {
              const fieldTypeResolved = (l.adGroupAsset.fieldType ?? field_type) as AssetFieldType | undefined
              if (!fieldTypeResolved) continue
              results.push({
                level: 'ad_group',
                parent_id: l.adGroup.id,
                parent_name: l.adGroup.name ?? null,
                asset_id: l.asset.id,
                field_type: fieldTypeResolved,
                status: l.adGroupAsset.status,
                content: assetContent(fieldTypeResolved, l.asset),
              })
            }
          }

          return results
        })
        return { customer_id: conn.accountId, assets: rows, count: rows.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
]
