// MCP read tools for Google Ads targeting, conversion actions and conversion
// goals — the lookups an agent needs before proposing the R2 Google commands
// (add_location, add_language, add_ad_schedule, conversion_action.set_primary,
// campaign.set_conversion_goal_biddable). Same shape as ads-control.ts: resolve
// the ad account, parse the stored refresh token, wrap the call with
// withConnectionHealth so an auth failure marks the connection for reconnect,
// and return a structured { error, detail } on failure instead of throwing.
//
// Not registered in registry.ts here — these tools are wired up alongside the
// rest of the ads MCP surface.

import { z } from 'zod'

import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { parseTokens, suggestGeoTargetConstants } from '@/lib/ads/google-api'
import { listCampaignConversionGoals, listCampaignTargeting, listConversionActions } from '@/lib/ads/google-reads'
import type { McpToolDef } from '../tool-types'

export const adsGoogleReadTools: McpToolDef[] = [
  {
    name: 'ads_google_suggest_locations',
    title: 'Suggest Google Ads geo target constants',
    description:
      'Resolve place names (cities, regions, countries) to the numeric geo_target_constant_id values google.campaign.add_location needs. Not scoped to a customer — this is a global Google lookup, not an account read.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        names: z.array(z.string().trim().min(1)).min(1).max(25),
        country_code: z.string().regex(/^[A-Z]{2}$/).optional(),
        locale: z.string().min(2).max(5).default('en'),
        customer_id: z.string().optional(),
      })
      .strict(),
    handler: async ({ names, country_code, locale, customer_id }, { auth }) => {
      // Google resolves this globally, but we still need a connected account's
      // refresh token to call the API — any connected Google Ads account works.
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const suggestions = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          suggestGeoTargetConstants(parseTokens(conn.token).refresh_token, {
            locale,
            countryCode: country_code,
            locationNames: names,
          }),
        )
        return {
          suggestions: suggestions.map((s) => ({
            geo_target_constant_id: s.geoTargetConstant.id ?? null,
            name: s.geoTargetConstant.name ?? null,
            country_code: s.geoTargetConstant.countryCode ?? null,
            target_type: s.geoTargetConstant.targetType ?? null,
            canonical_name: s.geoTargetConstant.canonicalName ?? null,
            status: s.geoTargetConstant.status ?? null,
          })),
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_google_list_campaign_targeting',
    title: 'List Google Ads campaign targeting (locations, languages, ad schedules)',
    description:
      'Locations (incl. excluded), languages and ad schedules on a campaign, with the criterion_id each google.campaign.remove_* command needs.',
    area: 'general_xphere',
    inputSchema: z.object({ customer_id: z.string().optional(), campaign_id: z.string() }).strict(),
    handler: async ({ customer_id, campaign_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const targeting = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          listCampaignTargeting({ customerId: conn.accountId, refreshToken: parseTokens(conn.token).refresh_token, campaignId: campaign_id }),
        )
        return { customer_id: conn.accountId, campaign_id, ...targeting }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_google_list_conversion_actions',
    title: 'List Google Ads conversion actions',
    description:
      'Conversion actions in the account with their conversion_action_id, category, type and whether they are primary for goal — the id google.conversion_action.set_primary needs.',
    area: 'general_xphere',
    inputSchema: z.object({ customer_id: z.string().optional() }).strict(),
    handler: async ({ customer_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const conversionActions = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          listConversionActions({ customerId: conn.accountId, refreshToken: parseTokens(conn.token).refresh_token }),
        )
        return { customer_id: conn.accountId, conversion_actions: conversionActions, count: conversionActions.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_google_list_conversion_goals',
    title: 'List Google Ads campaign conversion goals',
    description:
      'Per-campaign conversion goals (category, origin, biddable) — the category/origin pair google.campaign.set_conversion_goal_biddable needs, and whether each is currently counted for bidding.',
    area: 'general_xphere',
    inputSchema: z.object({ customer_id: z.string().optional(), campaign_id: z.string() }).strict(),
    handler: async ({ customer_id, campaign_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const goals = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          listCampaignConversionGoals({ customerId: conn.accountId, refreshToken: parseTokens(conn.token).refresh_token, campaignId: campaign_id }),
        )
        return { customer_id: conn.accountId, campaign_id, conversion_goals: goals, count: goals.length }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },
]
