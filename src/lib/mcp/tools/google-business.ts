import { z } from 'zod'

import { resolveAdAccount, listActiveAdAccounts } from '@/lib/ads/ai-accounts'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { COMMAND_CATALOG } from '@/lib/ads/commands/catalog'
import { loadEffectivePolicy } from '@/lib/ads/commands/policies'
import {
  getGoogleBusinessAttributes,
  getGoogleBusinessLocation,
  listGoogleBusinessLocalPosts,
  listGoogleBusinessMedia,
  listGoogleBusinessReviews,
} from '@/lib/google-business/api'
import type { McpToolDef } from '../tool-types'

async function connection(orgId: string, locationId?: string) {
  return resolveAdAccount(orgId, 'google_business', locationId)
}

export const googleBusinessTools: McpToolDef[] = [
  {
    name: 'google_business_get_capabilities',
    title: 'Get Google Business Profile capabilities',
    description:
      'List the complete Google Business Profile write surface supported by Xphere, the active locations, risk levels and approval mode. Call this before proposing a profile edit. Writes are never performed by this tool; use ads_preview_change with platform google_business, show the diff, then ads_approve_change only after explicit confirmation.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_, { auth }) => {
      const locations = []
      for (const row of await listActiveAdAccounts(auth.orgId, 'google_business')) {
        const policy = await loadEffectivePolicy(auth.orgId, 'google_business', row.ad_account_id)
        locations.push({ location_id: row.ad_account_id, name: row.ad_account_name, ai_mode: policy.aiMode, approval_min_risk: policy.requireApprovalMinRisk })
      }
      return {
        commands: Object.entries(COMMAND_CATALOG)
          .filter(([, entry]) => entry.platform === 'google_business')
          .map(([type, entry]) => ({ type, resource: entry.resourceType, risk: entry.risk, label: entry.label })),
        locations,
        workflow: 'Inspect → ads_preview_change → show exact diff/warnings → explicit operator confirmation → ads_approve_change → ads_get_change_status.',
      }
    },
  },
  {
    name: 'google_business_list_locations',
    title: 'List active Google Business Profile locations',
    description:
      'List locations connected and activated for this organization. Use the returned location_id verbatim as command.ad_account_id for platform google_business; never invent or shorten it.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_, { auth }) => ({ locations: (await listActiveAdAccounts(auth.orgId, 'google_business')).map((row) => ({ location_id: row.ad_account_id, name: row.ad_account_name })) }),
  },
  {
    name: 'google_business_get_location',
    title: 'Get Google Business Profile location',
    description:
      'Read the current public profile configuration and its attributes before recommending edits: name, description, phones, website, categories, address, service area, services, regular/special hours and open status. Omit location_id only when exactly one active location exists.',
    area: 'general_xphere',
    inputSchema: z.object({ location_id: z.string().optional() }).strict(),
    handler: async ({ location_id }, { auth }) => {
      const conn = await connection(auth.orgId, location_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_locations: conn.available }
      const [location, attributes] = await withConnectionHealth(
        { orgId: auth.orgId, platform: 'google_business', adAccountId: conn.accountId },
        () => Promise.all([getGoogleBusinessLocation(conn.accountId, conn.token), getGoogleBusinessAttributes(conn.accountId, conn.token)]),
      )
      return { location_id: conn.accountId, name: conn.accountName, location, attributes }
    },
  },
  {
    name: 'google_business_list_reviews',
    title: 'List Google Business Profile reviews',
    description:
      'List recent first-party Google reviews and existing owner replies. Use review.name or reviewId from this result for google_business.review.reply; do not use a local database UUID.',
    area: 'general_xphere',
    inputSchema: z.object({ location_id: z.string().optional() }).strict(),
    handler: async ({ location_id }, { auth }) => {
      const conn = await connection(auth.orgId, location_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_locations: conn.available }
      const reviews = await withConnectionHealth({ orgId: auth.orgId, platform: 'google_business', adAccountId: conn.accountId }, () => listGoogleBusinessReviews(conn.accountId, conn.token))
      return { location_id: conn.accountId, reviews, count: reviews.length }
    },
  },
  {
    name: 'google_business_list_posts',
    title: 'List Google Business Profile posts',
    description:
      'List current local posts with ids, summaries, media and calls to action. Use the resource name or trailing post id for google_business.local_post.update.',
    area: 'general_xphere',
    inputSchema: z.object({ location_id: z.string().optional() }).strict(),
    handler: async ({ location_id }, { auth }) => {
      const conn = await connection(auth.orgId, location_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_locations: conn.available }
      const posts = await withConnectionHealth({ orgId: auth.orgId, platform: 'google_business', adAccountId: conn.accountId }, () => listGoogleBusinessLocalPosts(conn.accountId, conn.token))
      return { location_id: conn.accountId, posts, count: posts.length }
    },
  },
  {
    name: 'google_business_list_media',
    title: 'List Google Business Profile media',
    description:
      'List photos already attached to the selected profile, including categories and resource ids. Use before uploading to avoid duplicate or conflicting cover/profile photos.',
    area: 'general_xphere',
    inputSchema: z.object({ location_id: z.string().optional() }).strict(),
    handler: async ({ location_id }, { auth }) => {
      const conn = await connection(auth.orgId, location_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_locations: conn.available }
      const media = await withConnectionHealth({ orgId: auth.orgId, platform: 'google_business', adAccountId: conn.accountId }, () => listGoogleBusinessMedia(conn.accountId, conn.token))
      return { location_id: conn.accountId, media, count: media.length }
    },
  },
]
