// MCP read tools for Meta Ads objects the Ads Control Plane commands need but
// ads-control.ts's reads don't cover yet: custom/lookalike audiences (for
// meta.adset.update_targeting's custom_audience_ids / excluded_custom_audience_ids)
// and ad creatives (for meta.ad.set_creative). Read-only — no writes, no
// ledger rows, nothing goes through the command engine.
//
// Not registered in registry.ts; the coordinator wires that up alongside the
// rest of the Meta command work in commands/*.

import { z } from 'zod'

import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { withMetaConnection } from '@/lib/ads/connection-health'
import { listCreatives, listCustomAudiences } from '@/lib/ads/meta-api'
import type { McpToolDef } from '../tool-types'

export const adsMetaReadTools: McpToolDef[] = [
  {
    name: 'ads_meta_list_custom_audiences',
    title: 'List Meta custom/lookalike audiences',
    description:
      'Custom and lookalike audiences in this Meta ad account, with approximate size and readiness. Use to find custom_audience_ids / excluded_custom_audience_ids for meta.adset.update_targeting — preview rejects an id that is not in this list (unknown or belonging to a different ad account).',
    area: 'general_xphere',
    inputSchema: z.object({ ad_account_id: z.string().optional() }).strict(),
    handler: async ({ ad_account_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'meta', ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const audiences = await withMetaConnection(auth.orgId, conn.accountId, () => listCustomAudiences(conn.accountId, conn.token))
        return {
          ad_account_id: conn.accountId,
          audiences: audiences.map((a) => ({
            id: a.id,
            name: a.name ?? null,
            approximate_size: a.approximate_count_lower_bound ?? null,
            ready: a.operation_status ? a.operation_status.code === 200 : null,
            operation_status: a.operation_status?.description ?? null,
          })),
          count: audiences.length,
        }
      } catch (e) {
        return { error: 'meta_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
  {
    name: 'ads_meta_list_creatives',
    title: 'List Meta ad creatives',
    description:
      'Ad creatives available in this Meta ad account: id, name, title/body, thumbnail, and a summary of the linked page/link/video. Use to find a creative_id for meta.ad.set_creative — preview rejects a creative_id that does not exist or belongs to a different ad account.',
    area: 'general_xphere',
    inputSchema: z.object({ ad_account_id: z.string().optional() }).strict(),
    handler: async ({ ad_account_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'meta', ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const creatives = await withMetaConnection(auth.orgId, conn.accountId, () => listCreatives(conn.accountId, conn.token))
        return {
          ad_account_id: conn.accountId,
          creatives: creatives.map((c) => {
            const spec = (c.object_story_spec ?? {}) as {
              page_id?: string
              link_data?: { link?: string; message?: string }
              video_data?: { title?: string; video_id?: string }
            }
            return {
              creative_id: c.id,
              name: c.name ?? null,
              title: c.title ?? null,
              body: c.body ?? null,
              thumbnail_url: c.thumbnail_url ?? null,
              object_story_spec_summary: {
                page_id: spec.page_id ?? null,
                link: spec.link_data?.link ?? null,
                message: spec.link_data?.message ?? null,
                video_title: spec.video_data?.title ?? null,
              },
            }
          }),
          count: creatives.length,
        }
      } catch (e) {
        return { error: 'meta_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
]
