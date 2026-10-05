// Google Ads implementation of the command-engine adapter contract.
//
// All reads are GAQL (runGaqlQuery), all writes go through mutateResources —
// the same operation object is built once and sent twice: first with
// validateOnly at preview time, then for real at execution. Nothing here
// interpolates free text into GAQL: ids are asserted numeric by the command
// schema and keyword text is matched in code, never in a WHERE clause.

import { isAuthError } from '../connection-health'
import { COMMAND_CATALOG, type AdsCommand, type CommandOf } from '../commands/catalog'
import type { DiffEntry, PlanResult, PolicyFacts, ResourceSnapshot } from '../commands/types'
import {
  GoogleAdsError,
  googleAdsMutate,
  mutateResources,
  parseTokens,
  runGaqlQuery,
  type GAdsMutateService,
} from '../google-api'
import { listCampaignConversionGoals, listCampaignTargeting, listConversionActions } from '../google-reads'
import { AdsValidationError } from '../validation'
import { compareFields, diffField, diffMoney, effective } from './diff'
import type { AdapterContext, AdsProviderAdapter, Capability, ErrorClass, ExecuteResult, VerifyResult } from './types'

type GoogleCommand = Extract<AdsCommand, { platform: 'google' }>

const MICROS = 1_000_000

/** Google wants whole cents in micros; round so 12.345 doesn't become a rejected amount. */
export function toMicros(major: number): string {
  return String(Math.round(major * 100) * 10_000)
}

function fromMicros(micros: string | number | null | undefined): number | null {
  if (micros === null || micros === undefined || micros === '') return null
  return Number(micros) / MICROS
}

/** Google's double fields (target ROAS) come back as numbers already; this just tolerates a stringified one. */
function numOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  return Number(value)
}

function refreshToken(ctx: AdapterContext): string {
  return parseTokens(ctx.credential).refresh_token
}

function isGoogle(cmd: AdsCommand): cmd is GoogleCommand {
  return cmd.platform === 'google'
}

const MANUAL_BIDDING = new Set(['MANUAL_CPC', 'ENHANCED_CPC', 'MANUAL_CPM', 'MANUAL_CPV'])

const AD_SCHEDULE_MINUTES = { ZERO: 0, FIFTEEN: 15, THIRTY: 30, FORTY_FIVE: 45 } as const

/** "SUNDAY 03:00–04:00" instead of Google's raw enum ("SUNDAY 3:ZERO - 4:ZERO"). */
export function formatAdSchedule(s: Record<string, unknown>): string {
  const hhmm = (hour: unknown, minute: unknown) =>
    `${String(hour).padStart(2, '0')}:${String(AD_SCHEDULE_MINUTES[minute as keyof typeof AD_SCHEDULE_MINUTES] ?? 0).padStart(2, '0')}`
  return `${s.day_of_week} ${hhmm(s.start_hour, s.start_minute)}–${hhmm(s.end_hour, s.end_minute)}`
}

/** 'yyyy-MM-dd HH:mm:ss' in UTC — approximate stand-in for "now" in the account's time zone (see set_dates plan). */
function nowAsGoogleDateTime(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

// ─── GAQL readers ─────────────────────────────────────────────────────────────

type CampaignRow = {
  campaign: { id: string; name: string; status: string; biddingStrategyType?: string }
  campaignBudget?: { id?: string; amountMicros?: string; explicitlyShared?: boolean; referenceCount?: string }
  customer?: { currencyCode?: string }
}

async function readCampaign(ctx: AdapterContext, campaignId: string): Promise<CampaignRow | null> {
  const rows = await runGaqlQuery<CampaignRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type,
            campaign_budget.id, campaign_budget.amount_micros, campaign_budget.explicitly_shared,
            campaign_budget.reference_count, customer.currency_code
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type AdGroupRow = {
  adGroup: { id: string; name: string; status: string; cpcBidMicros?: string }
  campaign: { id: string; name?: string; biddingStrategyType?: string }
  customer?: { currencyCode?: string }
}

async function readAdGroup(ctx: AdapterContext, adGroupId: string): Promise<AdGroupRow | null> {
  const rows = await runGaqlQuery<AdGroupRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros,
            campaign.id, campaign.name, campaign.bidding_strategy_type, customer.currency_code
     FROM ad_group WHERE ad_group.id = ${adGroupId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type AdRow = {
  adGroupAd: { status: string; ad: { id: string; name?: string; finalUrls?: string[] } }
  adGroup: { id: string; name?: string }
  campaign: { id: string }
  customer?: { currencyCode?: string }
}

async function readAd(ctx: AdapterContext, adGroupId: string, adId: string): Promise<AdRow | null> {
  const rows = await runGaqlQuery<AdRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls, ad_group_ad.status,
            ad_group.id, ad_group.name, campaign.id, customer.currency_code
     FROM ad_group_ad WHERE ad_group.id = ${adGroupId} AND ad_group_ad.ad.id = ${adId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type CampaignExtendedRow = {
  campaign: {
    id: string
    name: string
    status: string
    biddingStrategyType?: string
    /** Non-empty only when the campaign uses a portfolio (shared) bidding strategy resource. */
    biddingStrategy?: string
    startDateTime?: string
    endDateTime?: string
    trackingUrlTemplate?: string
    finalUrlSuffix?: string
    targetCpa?: { targetCpaMicros?: string }
    maximizeConversions?: { targetCpaMicros?: string }
    targetRoas?: { targetRoas?: number | string }
    maximizeConversionValue?: { targetRoas?: number | string }
  }
  customer?: { currencyCode?: string }
}

/** Shared reader for dates / tracking / target CPA / target ROAS — all live on the `campaign` resource. */
async function readCampaignExtended(ctx: AdapterContext, campaignId: string): Promise<CampaignExtendedRow | null> {
  const rows = await runGaqlQuery<CampaignExtendedRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, campaign.bidding_strategy,
            campaign.start_date_time, campaign.end_date_time, campaign.tracking_url_template, campaign.final_url_suffix,
            campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros,
            campaign.target_roas.target_roas, campaign.maximize_conversion_value.target_roas,
            customer.currency_code
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type CriterionRow = {
  adGroupCriterion: {
    criterionId: string
    status: string
    negative?: boolean
    cpcBidMicros?: string
    keyword?: { text?: string; matchType?: string }
  }
  adGroup: { id: string; name?: string }
  campaign: { id: string; biddingStrategyType?: string }
  customer?: { currencyCode?: string }
}

async function readAdGroupCriterion(ctx: AdapterContext, adGroupId: string, criterionId: string): Promise<CriterionRow | null> {
  const rows = await runGaqlQuery<CriterionRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.negative,
            ad_group_criterion.cpc_bid_micros, ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, campaign.id,
            campaign.bidding_strategy_type, customer.currency_code
     FROM ad_group_criterion
     WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.criterion_id = ${criterionId} LIMIT 1`,
  )
  return rows[0] ?? null
}

async function listAdGroupKeywords(ctx: AdapterContext, adGroupId: string, negative: boolean): Promise<CriterionRow[]> {
  return runGaqlQuery<CriterionRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.negative,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, campaign.id
     FROM ad_group_criterion
     WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'KEYWORD'
       AND ad_group_criterion.negative = ${negative ? 'TRUE' : 'FALSE'}
       AND ad_group_criterion.status != 'REMOVED'`,
  )
}

type CampaignCriterionRow = {
  campaignCriterion: { criterionId: string; negative?: boolean; keyword?: { text?: string; matchType?: string } }
  campaign: { id: string; name?: string }
}

async function listCampaignNegatives(ctx: AdapterContext, campaignId: string): Promise<CampaignCriterionRow[]> {
  return runGaqlQuery<CampaignCriterionRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign_criterion.criterion_id, campaign_criterion.negative, campaign_criterion.keyword.text,
            campaign_criterion.keyword.match_type, campaign.id, campaign.name
     FROM campaign_criterion
     WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'KEYWORD'
       AND campaign_criterion.negative = TRUE`,
  )
}

function sameKeyword(a: { text?: string; matchType?: string } | undefined, text: string, matchType: string): boolean {
  return (a?.text ?? '').trim().toLowerCase() === text.trim().toLowerCase() && a?.matchType === matchType
}

/** Case/whitespace-insensitive name match, used only in code — never interpolated into GAQL. */
function sameName(a: string | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
}

// ─── Structural create readers ──────────────────────────────────────────────────
// Google Ads has no bound-parameter form (see validation.ts), so a candidate
// name can never be interpolated into a GAQL WHERE clause — these list the
// non-removed rows and match the name in code instead, same pattern as the
// keyword/negative "already exists" checks above.

type CustomerCurrencyRow = { customer?: { currencyCode?: string } }

async function readCustomerCurrency(ctx: AdapterContext): Promise<CustomerCurrencyRow | null> {
  const rows = await runGaqlQuery<CustomerCurrencyRow>(ctx.adAccountId, refreshToken(ctx), `SELECT customer.currency_code FROM customer LIMIT 1`)
  return rows[0] ?? null
}

type CampaignNameRow = { campaign: { id: string; name: string } }

async function listNonRemovedCampaignNames(ctx: AdapterContext): Promise<CampaignNameRow[]> {
  return runGaqlQuery<CampaignNameRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status != 'REMOVED'`,
  )
}

type CampaignForAdGroupCreateRow = {
  campaign: { id: string; name: string; status: string; advertisingChannelType?: string }
  customer?: { currencyCode?: string }
}

async function readCampaignForAdGroupCreate(ctx: AdapterContext, campaignId: string): Promise<CampaignForAdGroupCreateRow | null> {
  const rows = await runGaqlQuery<CampaignForAdGroupCreateRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, customer.currency_code
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type AdGroupNameRow = { adGroup: { id: string; name: string } }

async function listAdGroupNamesInCampaign(ctx: AdapterContext, campaignId: string): Promise<AdGroupNameRow[]> {
  return runGaqlQuery<AdGroupNameRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.status != 'REMOVED'`,
  )
}

type AdGroupAdTypeRow = { adGroupAd: { status: string; ad: { type?: string } } }

/** Enabled + paused responsive search ads already in the ad group (Google recommends at most 3). */
async function countResponsiveSearchAds(ctx: AdapterContext, adGroupId: string): Promise<number> {
  const rows = await runGaqlQuery<AdGroupAdTypeRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_ad.status, ad_group_ad.ad.type FROM ad_group_ad
     WHERE ad_group.id = ${adGroupId} AND ad_group_ad.status != 'REMOVED'`,
  )
  return rows.filter((r) => r.adGroupAd.ad.type === 'RESPONSIVE_SEARCH_AD').length
}

type ResponsiveSearchAdRow = {
  adGroupAd: {
    status: string
    ad: {
      id: string
      finalUrls?: string[]
      responsiveSearchAd?: { headlines?: Array<{ text?: string }>; descriptions?: Array<{ text?: string }> }
    }
  }
}

async function readResponsiveSearchAd(ctx: AdapterContext, adGroupId: string, adId: string): Promise<ResponsiveSearchAdRow | null> {
  const rows = await runGaqlQuery<ResponsiveSearchAdRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
            ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions
     FROM ad_group_ad WHERE ad_group.id = ${adGroupId} AND ad_group_ad.ad.id = ${adId} LIMIT 1`,
  )
  return rows[0] ?? null
}

/** "customers/1/campaigns/456" or ".../adGroups/789" → the trailing numeric id. */
function idFromResourceName(resourceName: string | null): string | null {
  const match = resourceName?.match(/\/(\d+)$/)
  return match ? match[1] : null
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshotGoogle(ctx: AdapterContext, cmd: GoogleCommand): Promise<ResourceSnapshot | null> {
  switch (cmd.type) {
    case 'google.campaign.set_status':
    case 'google.campaign.rename':
    case 'google.campaign.set_daily_budget': {
      const row = await readCampaign(ctx, cmd.campaign_id)
      if (!row) return null
      const base = {
        resourceType: 'campaign' as const,
        resourceId: row.campaign.id,
        resourceName: row.campaign.name,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
      }
      if (cmd.type === 'google.campaign.set_status') return { ...base, fields: { status: row.campaign.status } }
      if (cmd.type === 'google.campaign.rename') return { ...base, fields: { name: row.campaign.name } }
      return {
        ...base,
        fields: {
          daily_budget: fromMicros(row.campaignBudget?.amountMicros),
          budget_id: row.campaignBudget?.id ?? null,
          budget_shared: Boolean(row.campaignBudget?.explicitlyShared),
          budget_reference_count: Number(row.campaignBudget?.referenceCount ?? 1),
        },
      }
    }

    case 'google.ad_group.set_status':
    case 'google.ad_group.rename':
    case 'google.ad_group.set_cpc_bid': {
      const row = await readAdGroup(ctx, cmd.ad_group_id)
      if (!row) return null
      const base = {
        resourceType: 'ad_group' as const,
        resourceId: row.adGroup.id,
        resourceName: row.adGroup.name,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
      }
      if (cmd.type === 'google.ad_group.set_status') return { ...base, fields: { status: row.adGroup.status } }
      if (cmd.type === 'google.ad_group.rename') return { ...base, fields: { name: row.adGroup.name } }
      return {
        ...base,
        fields: {
          cpc_bid: fromMicros(row.adGroup.cpcBidMicros),
          bidding_strategy: row.campaign.biddingStrategyType ?? null,
        },
      }
    }

    case 'google.ad.set_status': {
      const row = await readAd(ctx, cmd.ad_group_id, cmd.ad_id)
      if (!row) return null
      return {
        resourceType: 'ad',
        resourceId: `${row.adGroup.id}~${row.adGroupAd.ad.id}`,
        resourceName: row.adGroupAd.ad.name || `Ad ${row.adGroupAd.ad.id} (${row.adGroup.name ?? row.adGroup.id})`,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: { status: row.adGroupAd.status },
      }
    }

    case 'google.keyword.set_status':
    case 'google.keyword.set_cpc_bid': {
      const row = await readAdGroupCriterion(ctx, cmd.ad_group_id, cmd.criterion_id)
      if (!row || row.adGroupCriterion.negative) return null
      const base = {
        resourceType: 'keyword' as const,
        resourceId: row.adGroupCriterion.criterionId,
        resourceName: `[${row.adGroupCriterion.keyword?.matchType ?? '?'}] ${row.adGroupCriterion.keyword?.text ?? ''}`,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
      }
      if (cmd.type === 'google.keyword.set_status') return { ...base, fields: { status: row.adGroupCriterion.status } }
      return {
        ...base,
        fields: {
          cpc_bid: fromMicros(row.adGroupCriterion.cpcBidMicros),
          bidding_strategy: row.campaign.biddingStrategyType ?? null,
        },
      }
    }

    case 'google.keyword.add': {
      const group = await readAdGroup(ctx, cmd.ad_group_id)
      if (!group) return null
      const existing = (await listAdGroupKeywords(ctx, cmd.ad_group_id, false)).find((k) =>
        sameKeyword(k.adGroupCriterion.keyword, cmd.text, cmd.match_type),
      )
      return {
        resourceType: 'keyword',
        resourceId: null,
        resourceName: `[${cmd.match_type}] ${cmd.text} → ${group.adGroup.name}`,
        campaignId: group.campaign.id,
        currency: group.customer?.currencyCode ?? 'USD',
        fields: {
          existing_criterion_id: existing?.adGroupCriterion.criterionId ?? null,
          existing_status: existing?.adGroupCriterion.status ?? null,
          bidding_strategy: group.campaign.biddingStrategyType ?? null,
        },
      }
    }

    case 'google.negative_keyword.add': {
      if (cmd.level === 'campaign') {
        const campaign = await readCampaign(ctx, cmd.campaign_id as string)
        if (!campaign) return null
        const existing = (await listCampaignNegatives(ctx, cmd.campaign_id as string)).find((n) =>
          sameKeyword(n.campaignCriterion.keyword, cmd.text, cmd.match_type),
        )
        return {
          resourceType: 'negative_keyword',
          resourceId: null,
          resourceName: `-[${cmd.match_type}] ${cmd.text} → ${campaign.campaign.name}`,
          campaignId: campaign.campaign.id,
          currency: campaign.customer?.currencyCode ?? 'USD',
          fields: { existing_criterion_id: existing?.campaignCriterion.criterionId ?? null },
        }
      }
      const group = await readAdGroup(ctx, cmd.ad_group_id as string)
      if (!group) return null
      const existing = (await listAdGroupKeywords(ctx, cmd.ad_group_id as string, true)).find((k) =>
        sameKeyword(k.adGroupCriterion.keyword, cmd.text, cmd.match_type),
      )
      return {
        resourceType: 'negative_keyword',
        resourceId: null,
        resourceName: `-[${cmd.match_type}] ${cmd.text} → ${group.adGroup.name}`,
        campaignId: group.campaign.id,
        currency: group.customer?.currencyCode ?? 'USD',
        fields: { existing_criterion_id: existing?.adGroupCriterion.criterionId ?? null },
      }
    }

    case 'google.negative_keyword.remove': {
      if (cmd.level === 'campaign') {
        const found = (await listCampaignNegatives(ctx, cmd.campaign_id as string)).find(
          (n) => n.campaignCriterion.criterionId === cmd.criterion_id,
        )
        if (!found) return null
        return {
          resourceType: 'negative_keyword',
          resourceId: cmd.criterion_id,
          resourceName: `-[${found.campaignCriterion.keyword?.matchType}] ${found.campaignCriterion.keyword?.text} (${found.campaign.name ?? found.campaign.id})`,
          campaignId: found.campaign.id,
          currency: 'USD',
          fields: {
            exists: true,
            text: found.campaignCriterion.keyword?.text ?? '',
            match_type: found.campaignCriterion.keyword?.matchType ?? 'EXACT',
          },
        }
      }
      const row = await readAdGroupCriterion(ctx, cmd.ad_group_id as string, cmd.criterion_id)
      if (!row || !row.adGroupCriterion.negative) return null
      return {
        resourceType: 'negative_keyword',
        resourceId: cmd.criterion_id,
        resourceName: `-[${row.adGroupCriterion.keyword?.matchType}] ${row.adGroupCriterion.keyword?.text} (${row.adGroup.name ?? row.adGroup.id})`,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: {
          exists: true,
          text: row.adGroupCriterion.keyword?.text ?? '',
          match_type: row.adGroupCriterion.keyword?.matchType ?? 'EXACT',
        },
      }
    }

    case 'google.campaign.set_dates':
    case 'google.campaign.set_tracking':
    case 'google.campaign.set_target_cpa':
    case 'google.campaign.set_target_roas': {
      const row = await readCampaignExtended(ctx, cmd.campaign_id)
      if (!row) return null
      const base = {
        resourceType: 'campaign' as const,
        resourceId: row.campaign.id,
        resourceName: row.campaign.name,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
      }
      if (cmd.type === 'google.campaign.set_dates') {
        return { ...base, fields: { start_date_time: row.campaign.startDateTime ?? null, end_date_time: row.campaign.endDateTime ?? null } }
      }
      if (cmd.type === 'google.campaign.set_tracking') {
        return { ...base, fields: { tracking_url_template: row.campaign.trackingUrlTemplate ?? null, final_url_suffix: row.campaign.finalUrlSuffix ?? null } }
      }
      const strategy = row.campaign.biddingStrategyType ?? null
      const isPortfolio = Boolean(row.campaign.biddingStrategy)
      if (cmd.type === 'google.campaign.set_target_cpa') {
        const current =
          strategy === 'TARGET_CPA'
            ? fromMicros(row.campaign.targetCpa?.targetCpaMicros)
            : strategy === 'MAXIMIZE_CONVERSIONS'
              ? fromMicros(row.campaign.maximizeConversions?.targetCpaMicros)
              : null
        return { ...base, fields: { bidding_strategy_type: strategy, bidding_strategy_resource: row.campaign.biddingStrategy ?? null, is_portfolio: isPortfolio, target_cpa: current } }
      }
      const currentRoas =
        strategy === 'TARGET_ROAS'
          ? numOrNull(row.campaign.targetRoas?.targetRoas)
          : strategy === 'MAXIMIZE_CONVERSION_VALUE'
            ? numOrNull(row.campaign.maximizeConversionValue?.targetRoas)
            : null
      return { ...base, fields: { bidding_strategy_type: strategy, bidding_strategy_resource: row.campaign.biddingStrategy ?? null, is_portfolio: isPortfolio, target_roas: currentRoas } }
    }

    case 'google.campaign.add_location':
    case 'google.campaign.add_language': {
      const campaign = await readCampaign(ctx, cmd.campaign_id)
      if (!campaign) return null
      const targeting = await listCampaignTargeting({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: cmd.campaign_id })
      const base = {
        campaignId: campaign.campaign.id,
        currency: campaign.customer?.currencyCode ?? 'USD',
      }
      if (cmd.type === 'google.campaign.add_location') {
        const existing = targeting.locations.find((l) => l.geo_target_constant_id === cmd.geo_target_constant_id && l.negative === cmd.negative)
        return {
          ...base,
          resourceType: 'campaign_criterion',
          resourceId: null,
          resourceName: `${cmd.negative ? 'Exclude location' : 'Location'} ${cmd.geo_target_constant_id} → ${campaign.campaign.name}`,
          fields: { existing_criterion_id: existing?.criterion_id ?? null, existing_bid_modifier: existing?.bid_modifier ?? null },
        }
      }
      const existing = targeting.languages.find((l) => l.language_constant_id === cmd.language_constant_id)
      return {
        ...base,
        resourceType: 'campaign_criterion',
        resourceId: null,
        resourceName: `Language ${cmd.language_constant_id} → ${campaign.campaign.name}`,
        fields: { existing_criterion_id: existing?.criterion_id ?? null },
      }
    }

    case 'google.campaign.remove_location':
    case 'google.campaign.remove_language': {
      const targeting = await listCampaignTargeting({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: cmd.campaign_id })
      if (cmd.type === 'google.campaign.remove_location') {
        const found = targeting.locations.find((l) => l.criterion_id === cmd.criterion_id)
        if (!found) return null
        return {
          resourceType: 'campaign_criterion',
          resourceId: found.criterion_id,
          resourceName: `${found.negative ? 'Excluded location' : 'Location'} ${found.geo_target_constant_id}`,
          campaignId: cmd.campaign_id,
          currency: 'USD',
          fields: { geo_target_constant_id: found.geo_target_constant_id, negative: found.negative, bid_modifier: found.bid_modifier },
        }
      }
      const found = targeting.languages.find((l) => l.criterion_id === cmd.criterion_id)
      if (!found) return null
      return {
        resourceType: 'campaign_criterion',
        resourceId: found.criterion_id,
        resourceName: `Language ${found.language_constant_id}`,
        campaignId: cmd.campaign_id,
        currency: 'USD',
        fields: { language_constant_id: found.language_constant_id },
      }
    }

    case 'google.campaign.add_ad_schedule': {
      const campaign = await readCampaign(ctx, cmd.campaign_id)
      if (!campaign) return null
      const targeting = await listCampaignTargeting({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: cmd.campaign_id })
      const sameDay = targeting.adSchedules.filter((s) => s.day_of_week === cmd.day_of_week)
      const newStart = cmd.start_hour * 60 + AD_SCHEDULE_MINUTES[cmd.start_minute]
      const newEnd = cmd.end_hour * 60 + AD_SCHEDULE_MINUTES[cmd.end_minute]
      const identical = sameDay.find(
        (s) => s.start_hour === cmd.start_hour && s.start_minute === cmd.start_minute && s.end_hour === cmd.end_hour && s.end_minute === cmd.end_minute,
      )
      const overlapping = identical
        ? undefined
        : sameDay.find((s) => {
            const existingStart = s.start_hour * 60 + AD_SCHEDULE_MINUTES[s.start_minute as keyof typeof AD_SCHEDULE_MINUTES]
            const existingEnd = s.end_hour * 60 + AD_SCHEDULE_MINUTES[s.end_minute as keyof typeof AD_SCHEDULE_MINUTES]
            return newStart < existingEnd && existingStart < newEnd
          })
      return {
        resourceType: 'campaign_criterion',
        resourceId: null,
        resourceName: `Ad schedule ${cmd.day_of_week} ${cmd.start_hour}:00-${cmd.end_hour}:00 → ${campaign.campaign.name}`,
        campaignId: campaign.campaign.id,
        currency: campaign.customer?.currencyCode ?? 'USD',
        fields: {
          existing_criterion_id: identical?.criterion_id ?? null,
          overlap_with: overlapping ? `${overlapping.day_of_week} ${overlapping.start_hour}:00-${overlapping.end_hour}:00 (criterion ${overlapping.criterion_id})` : null,
        },
      }
    }

    case 'google.campaign.remove_ad_schedule': {
      const targeting = await listCampaignTargeting({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: cmd.campaign_id })
      const found = targeting.adSchedules.find((s) => s.criterion_id === cmd.criterion_id)
      if (!found) return null
      return {
        resourceType: 'campaign_criterion',
        resourceId: found.criterion_id,
        resourceName: `Ad schedule ${found.day_of_week} ${found.start_hour}:00-${found.end_hour}:00`,
        campaignId: cmd.campaign_id,
        currency: 'USD',
        fields: {
          day_of_week: found.day_of_week,
          start_hour: found.start_hour,
          start_minute: found.start_minute,
          end_hour: found.end_hour,
          end_minute: found.end_minute,
          ...(found.bid_modifier != null ? { bid_modifier: found.bid_modifier } : {}),
        },
      }
    }

    case 'google.ad.set_final_url': {
      const row = await readAd(ctx, cmd.ad_group_id, cmd.ad_id)
      if (!row) return null
      return {
        resourceType: 'ad',
        resourceId: `${row.adGroup.id}~${row.adGroupAd.ad.id}`,
        resourceName: row.adGroupAd.ad.name || `Ad ${row.adGroupAd.ad.id} (${row.adGroup.name ?? row.adGroup.id})`,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: { final_urls: row.adGroupAd.ad.finalUrls ?? [] },
      }
    }

    case 'google.conversion_action.set_primary': {
      const [row] = await listConversionActions({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), conversionActionId: cmd.conversion_action_id })
      if (!row) return null
      return {
        resourceType: 'conversion_action',
        resourceId: row.conversion_action_id,
        resourceName: row.name,
        campaignId: null,
        currency: 'USD',
        fields: { status: row.status, primary_for_goal: row.primary_for_goal, category: row.category },
      }
    }

    case 'google.campaign.set_conversion_goal_biddable': {
      const campaign = await readCampaign(ctx, cmd.campaign_id)
      if (!campaign) return null
      const goals = await listCampaignConversionGoals({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: cmd.campaign_id })
      const goal = goals.find((g) => g.category === cmd.category && g.origin === cmd.origin)
      if (!goal) return null
      return {
        resourceType: 'campaign',
        resourceId: cmd.campaign_id,
        resourceName: `${cmd.category} / ${cmd.origin} → ${campaign.campaign.name}`,
        campaignId: campaign.campaign.id,
        currency: campaign.customer?.currencyCode ?? 'USD',
        fields: { biddable: goal.biddable },
      }
    }

    // ─── Structural creates (risk 4) — everything is created PAUSED ───────────

    case 'google.campaign.create_search': {
      const [customerRow, campaigns] = await Promise.all([readCustomerCurrency(ctx), listNonRemovedCampaignNames(ctx)])
      const existing = campaigns.find((c) => sameName(c.campaign.name, cmd.name))
      // Only the existence fact is hashed — the full campaign list isn't part
      // of what this command reads or writes.
      return {
        resourceType: 'campaign',
        resourceId: null,
        resourceName: cmd.name,
        campaignId: null,
        currency: customerRow?.customer?.currencyCode ?? 'USD',
        fields: { existing_campaign_id: existing?.campaign.id ?? null },
      }
    }

    case 'google.ad_group.create': {
      const campaign = await readCampaignForAdGroupCreate(ctx, cmd.campaign_id)
      if (!campaign) return null
      const adGroups = await listAdGroupNamesInCampaign(ctx, cmd.campaign_id)
      const existing = adGroups.find((a) => sameName(a.adGroup.name, cmd.name))
      return {
        resourceType: 'ad_group',
        resourceId: null,
        resourceName: `${cmd.name} → ${campaign.campaign.name}`,
        campaignId: campaign.campaign.id,
        currency: campaign.customer?.currencyCode ?? 'USD',
        fields: {
          campaign_status: campaign.campaign.status,
          campaign_channel_type: campaign.campaign.advertisingChannelType ?? null,
          existing_ad_group_id: existing?.adGroup.id ?? null,
        },
      }
    }

    case 'google.ad.create_responsive_search': {
      const group = await readAdGroup(ctx, cmd.ad_group_id)
      if (!group) return null
      const existingRsaCount = await countResponsiveSearchAds(ctx, cmd.ad_group_id)
      return {
        resourceType: 'ad',
        resourceId: null,
        resourceName: `Responsive search ad → ${group.adGroup.name}`,
        campaignId: group.campaign.id,
        currency: group.customer?.currencyCode ?? 'USD',
        fields: {
          ad_group_status: group.adGroup.status,
          existing_rsa_count: existingRsaCount,
        },
      }
    }

    default:
      return null
  }
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

function planGoogle(cmd: GoogleCommand, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  const warnings: string[] = []

  const done = (intended: Record<string, unknown>, diff: DiffEntry[], facts: PolicyFacts = {}): PlanResult => {
    const changes = effective(diff)
    if (changes.length === 0) return { ok: false, code: 'no_op', message: 'The resource already has this value — nothing to change.' }
    return { ok: true, intended, diff: changes, warnings, facts }
  }

  switch (cmd.type) {
    case 'google.campaign.set_status':
    case 'google.ad_group.set_status':
    case 'google.ad.set_status':
    case 'google.keyword.set_status': {
      if (f.status === 'REMOVED') return { ok: false, code: 'resource_removed', message: 'This resource was removed in Google Ads and cannot be changed.' }
      return done({ status: cmd.status }, [diffField('status', 'Status', f.status, cmd.status)], {
        enables: cmd.status === 'ENABLED' && f.status !== 'ENABLED',
      })
    }

    case 'google.campaign.rename':
    case 'google.ad_group.rename':
      return done({ name: cmd.name }, [diffField('name', 'Name', f.name, cmd.name)])

    case 'google.campaign.set_daily_budget': {
      if (!f.budget_id) return { ok: false, code: 'no_budget', message: 'This campaign has no campaign budget to change.' }
      const refs = Number(f.budget_reference_count ?? 1)
      if (f.budget_shared || refs > 1) {
        warnings.push(`This budget is shared by ${refs} campaigns — changing it changes the daily budget of all of them.`)
      }
      const beforeBudget = f.daily_budget as number | null
      const after = Number(toMicros(cmd.daily_budget)) / MICROS
      return done({ daily_budget: after }, [diffMoney('daily_budget', 'Daily budget', beforeBudget, after, before.currency)], {
        budgetBefore: beforeBudget,
        budgetAfter: after,
      })
    }

    case 'google.ad_group.set_cpc_bid':
    case 'google.keyword.set_cpc_bid': {
      const strategy = f.bidding_strategy as string | null
      if (strategy && !MANUAL_BIDDING.has(strategy)) {
        warnings.push(`The campaign uses ${strategy} — Google ignores manual CPC bids under automated bidding.`)
      }
      const after = Number(toMicros(cmd.cpc_bid)) / MICROS
      return done({ cpc_bid: after }, [diffMoney('cpc_bid', 'Max CPC', f.cpc_bid as number | null, after, before.currency)], {
        biddingChange: true,
      })
    }

    case 'google.keyword.add': {
      if (f.existing_criterion_id) {
        return {
          ok: false,
          code: 'already_exists',
          message: `This keyword already exists in the ad group (criterion ${f.existing_criterion_id}, status ${f.existing_status}). Use google.keyword.set_status to change it.`,
        }
      }
      const intended: Record<string, unknown> = { text: cmd.text, match_type: cmd.match_type, status: 'ENABLED' }
      const diff = [diffField('keyword', 'Keyword', null, `[${cmd.match_type}] ${cmd.text}`)]
      if (cmd.cpc_bid !== undefined) {
        const bid = Number(toMicros(cmd.cpc_bid)) / MICROS
        intended.cpc_bid = bid
        diff.push(diffMoney('cpc_bid', 'Max CPC', null, bid, before.currency))
        const strategy = f.bidding_strategy as string | null
        if (strategy && !MANUAL_BIDDING.has(strategy)) {
          warnings.push(`The campaign uses ${strategy} — the keyword CPC bid will be ignored.`)
        }
      }
      if (cmd.match_type === 'BROAD') {
        warnings.push('Broad match can spend on loosely related searches; review search terms after it runs.')
      }
      return done(intended, diff, { biddingChange: cmd.cpc_bid !== undefined })
    }

    case 'google.negative_keyword.add': {
      if (f.existing_criterion_id) {
        return { ok: false, code: 'already_exists', message: `This negative keyword already exists (criterion ${f.existing_criterion_id}).` }
      }
      return done(
        { text: cmd.text, match_type: cmd.match_type, negative: true },
        [diffField('negative_keyword', `Negative keyword (${cmd.level === 'campaign' ? 'campaign' : 'ad group'})`, null, `-[${cmd.match_type}] ${cmd.text}`)],
      )
    }

    case 'google.negative_keyword.remove':
      return done(
        { exists: false },
        [diffField('negative_keyword', 'Negative keyword', `-[${f.match_type}] ${f.text}`, null)],
      )

    case 'google.campaign.set_dates': {
      const currentStart = f.start_date_time as string | null
      const currentEnd = f.end_date_time as string | null
      if (cmd.start_date_time !== undefined && cmd.start_date_time !== currentStart && currentStart && currentStart <= nowAsGoogleDateTime()) {
        return {
          ok: false,
          code: 'campaign_already_started',
          message: `This campaign already started (start date ${currentStart}) — the start date can't be changed once a campaign has started.`,
        }
      }
      warnings.push("Campaign dates are set in the account's time zone; this check compares against UTC and is approximate.")
      const intended: Record<string, unknown> = {}
      const diff: DiffEntry[] = []
      if (cmd.start_date_time !== undefined) {
        intended.start_date_time = cmd.start_date_time
        diff.push(diffField('start_date_time', 'Start date', currentStart, cmd.start_date_time))
      }
      if (cmd.end_date_time !== undefined) {
        intended.end_date_time = cmd.end_date_time
        diff.push(diffField('end_date_time', 'End date', currentEnd, cmd.end_date_time))
      }
      return done(intended, diff)
    }

    case 'google.campaign.set_target_cpa': {
      if (f.is_portfolio) {
        return {
          ok: false,
          code: 'portfolio_bidding_strategy',
          message: `This campaign uses a shared (portfolio) bidding strategy (${f.bidding_strategy_resource}) — change the target CPA on the shared strategy, not the campaign.`,
        }
      }
      const strategy = f.bidding_strategy_type as string | null
      if (strategy !== 'TARGET_CPA' && strategy !== 'MAXIMIZE_CONVERSIONS') {
        return { ok: false, code: 'incompatible_bidding_strategy', message: `This campaign uses ${strategy ?? 'an unknown'} bidding, which does not support a target CPA.` }
      }
      const beforeCpa = f.target_cpa as number | null
      const after = Number(toMicros(cmd.target_cpa)) / MICROS
      return done({ target_cpa: after }, [diffMoney('target_cpa', 'Target CPA', beforeCpa, after, before.currency)], { biddingChange: true })
    }

    case 'google.campaign.set_target_roas': {
      if (f.is_portfolio) {
        return {
          ok: false,
          code: 'portfolio_bidding_strategy',
          message: `This campaign uses a shared (portfolio) bidding strategy (${f.bidding_strategy_resource}) — change the target ROAS on the shared strategy, not the campaign.`,
        }
      }
      const strategy = f.bidding_strategy_type as string | null
      if (strategy !== 'TARGET_ROAS' && strategy !== 'MAXIMIZE_CONVERSION_VALUE') {
        return { ok: false, code: 'incompatible_bidding_strategy', message: `This campaign uses ${strategy ?? 'an unknown'} bidding, which does not support a target ROAS.` }
      }
      const beforeRoas = f.target_roas as number | null
      return done({ target_roas: cmd.target_roas }, [diffField('target_roas', 'Target ROAS', beforeRoas, cmd.target_roas)], { biddingChange: true })
    }

    case 'google.campaign.set_tracking': {
      const intended: Record<string, unknown> = {}
      const diff: DiffEntry[] = []
      if (cmd.tracking_url_template !== undefined) {
        intended.tracking_url_template = cmd.tracking_url_template
        diff.push(diffField('tracking_url_template', 'Tracking template', f.tracking_url_template, cmd.tracking_url_template))
      }
      if (cmd.final_url_suffix !== undefined) {
        intended.final_url_suffix = cmd.final_url_suffix
        diff.push(diffField('final_url_suffix', 'Final URL suffix', f.final_url_suffix, cmd.final_url_suffix))
      }
      return done(intended, diff)
    }

    case 'google.campaign.add_location': {
      if (f.existing_criterion_id) {
        return { ok: false, code: 'already_exists', message: `This location is already targeted the same way (criterion ${f.existing_criterion_id}).` }
      }
      const intended: Record<string, unknown> = { geo_target_constant_id: cmd.geo_target_constant_id, negative: cmd.negative }
      const diff = [diffField('location', cmd.negative ? 'Excluded location' : 'Location', null, cmd.geo_target_constant_id)]
      if (cmd.bid_modifier !== undefined) {
        intended.bid_modifier = cmd.bid_modifier
        diff.push(diffField('bid_modifier', 'Location bid modifier', null, cmd.bid_modifier))
      }
      return done(intended, diff)
    }

    case 'google.campaign.remove_location':
      return done({ exists: false }, [diffField('location', f.negative ? 'Excluded location' : 'Location', f.geo_target_constant_id, null)])

    case 'google.campaign.add_language': {
      if (f.existing_criterion_id) {
        return { ok: false, code: 'already_exists', message: `This language is already targeted (criterion ${f.existing_criterion_id}).` }
      }
      return done({ language_constant_id: cmd.language_constant_id }, [diffField('language', 'Language', null, cmd.language_constant_id)])
    }

    case 'google.campaign.remove_language':
      return done({ exists: false }, [diffField('language', 'Language', f.language_constant_id, null)])

    case 'google.campaign.add_ad_schedule': {
      if (f.overlap_with) {
        return { ok: false, code: 'schedule_overlap', message: `This time overlaps an existing ad schedule: ${f.overlap_with}.` }
      }
      if (f.existing_criterion_id) {
        return { ok: false, code: 'already_exists', message: `An identical ad schedule already exists (criterion ${f.existing_criterion_id}).` }
      }
      const label = formatAdSchedule(cmd)
      const intended: Record<string, unknown> = {
        day_of_week: cmd.day_of_week,
        start_hour: cmd.start_hour,
        start_minute: cmd.start_minute,
        end_hour: cmd.end_hour,
        end_minute: cmd.end_minute,
      }
      if (cmd.bid_modifier !== undefined) intended.bid_modifier = cmd.bid_modifier
      return done(intended, [diffField('ad_schedule', 'Ad schedule', null, label)])
    }

    case 'google.campaign.remove_ad_schedule': {
      const label = formatAdSchedule(f)
      return done({ exists: false }, [diffField('ad_schedule', 'Ad schedule', label, null)])
    }

    case 'google.ad.set_final_url': {
      const beforeUrls = (f.final_urls as string[] | undefined) ?? []
      const afterUrls = [cmd.final_url]
      return done({ final_urls: afterUrls }, [diffField('final_url', 'Final URL', beforeUrls[0] ?? null, cmd.final_url)])
    }

    case 'google.conversion_action.set_primary': {
      if (f.status === 'REMOVED') return { ok: false, code: 'resource_removed', message: 'This conversion action was removed in Google Ads.' }
      return done({ primary_for_goal: cmd.primary }, [diffField('primary_for_goal', 'Primary for goal', f.primary_for_goal, cmd.primary)])
    }

    case 'google.campaign.set_conversion_goal_biddable':
      return done({ biddable: cmd.biddable }, [diffField('biddable', 'Biddable for this campaign', f.biddable, cmd.biddable)], { biddingChange: true })

    // ─── Structural creates (risk 4) — everything is created PAUSED ───────────

    case 'google.campaign.create_search': {
      if (f.existing_campaign_id) {
        return { ok: false, code: 'already_exists', message: `A campaign named "${cmd.name}" already exists (campaign ${f.existing_campaign_id}).` }
      }
      const afterBudget = Number(toMicros(cmd.daily_budget)) / MICROS
      const diff: DiffEntry[] = [
        diffField('name', 'Campaign name', null, cmd.name),
        diffMoney('daily_budget', 'Daily budget', null, afterBudget, before.currency),
        diffField('bidding', 'Bidding strategy', null, cmd.bidding),
      ]
      if (cmd.target_cpa !== undefined) diff.push(diffMoney('target_cpa', 'Target CPA', null, cmd.target_cpa, before.currency))
      diff.push(diffField('search_partners', 'Show on search partners', null, cmd.search_partners))
      diff.push(diffField('locations', 'Locations', null, cmd.location_ids.length))
      if (cmd.language_ids.length > 0) diff.push(diffField('languages', 'Languages', null, cmd.language_ids.length))
      return done(
        { name: cmd.name, daily_budget: afterBudget, status: 'PAUSED' },
        diff,
        { budgetAfter: afterBudget, biddingChange: cmd.target_cpa !== undefined },
      )
    }

    case 'google.ad_group.create': {
      if (f.campaign_status === 'REMOVED') {
        return { ok: false, code: 'campaign_removed', message: 'The parent campaign was removed in Google Ads.' }
      }
      if (f.campaign_channel_type !== 'SEARCH') {
        return {
          ok: false,
          code: 'campaign_not_search',
          message: `The parent campaign is a ${f.campaign_channel_type ?? 'non-Search'} campaign — ad groups can only be created this way under Search campaigns.`,
        }
      }
      if (f.existing_ad_group_id) {
        return { ok: false, code: 'already_exists', message: `An ad group named "${cmd.name}" already exists in this campaign (ad group ${f.existing_ad_group_id}).` }
      }
      const intended: Record<string, unknown> = { name: cmd.name, status: 'PAUSED' }
      const diff: DiffEntry[] = [diffField('name', 'Ad group name', null, cmd.name), diffField('status', 'Status', null, 'PAUSED')]
      if (cmd.cpc_bid !== undefined) {
        intended.cpc_bid = cmd.cpc_bid
        diff.push(diffMoney('cpc_bid', 'Max CPC', null, cmd.cpc_bid, before.currency))
      }
      return done(intended, diff, { biddingChange: cmd.cpc_bid !== undefined })
    }

    case 'google.ad.create_responsive_search': {
      if (f.ad_group_status === 'REMOVED') {
        return { ok: false, code: 'ad_group_removed', message: 'The parent ad group was removed in Google Ads.' }
      }
      const existingRsaCount = Number(f.existing_rsa_count ?? 0)
      if (existingRsaCount >= 3) {
        warnings.push(`This ad group already has ${existingRsaCount} responsive search ad(s) — Google recommends at most 3 per ad group.`)
      }
      const diff: DiffEntry[] = [
        diffField('final_url', 'Final URL', null, cmd.final_url),
        diffField('headlines', `Headlines (${cmd.headlines.length})`, null, cmd.headlines.join(' | ')),
        diffField('descriptions', `Descriptions (${cmd.descriptions.length})`, null, cmd.descriptions.join(' | ')),
        diffField('status', 'Status', null, 'PAUSED'),
      ]
      return done(
        { final_url: cmd.final_url, status: 'PAUSED', headline_count: cmd.headlines.length, description_count: cmd.descriptions.length },
        diff,
      )
    }

    default:
      return { ok: false, code: 'unsupported_command', message: `${(cmd as { type: string }).type} is not implemented by the Google Ads adapter.` }
  }
}

// ─── Operations ───────────────────────────────────────────────────────────────

function buildOperation(cmd: GoogleCommand, before: ResourceSnapshot, customerId: string): { service: GAdsMutateService; operation: unknown } {
  const c = `customers/${customerId}`
  const update = (service: GAdsMutateService, resourceName: string, fields: Record<string, unknown>) => ({
    service,
    operation: { update: { resourceName, ...fields }, updateMask: Object.keys(fields).join(',') },
  })
  // For nested oneof fields (targetCpa.targetCpaMicros, targetRoas.targetRoas) the
  // update mask is the dotted path, not the top-level key `update`'s Object.keys
  // would produce.
  const nestedUpdate = (service: GAdsMutateService, resourceName: string, fields: Record<string, unknown>, maskPaths: string[]) => ({
    service,
    operation: { update: { resourceName, ...fields }, updateMask: maskPaths.join(',') },
  })

  switch (cmd.type) {
    case 'google.campaign.set_status':
      return update('campaigns', `${c}/campaigns/${cmd.campaign_id}`, { status: cmd.status })
    case 'google.campaign.rename':
      return update('campaigns', `${c}/campaigns/${cmd.campaign_id}`, { name: cmd.name })
    case 'google.campaign.set_daily_budget':
      return update('campaignBudgets', `${c}/campaignBudgets/${before.fields.budget_id}`, { amountMicros: toMicros(cmd.daily_budget) })
    case 'google.ad_group.set_status':
      return update('adGroups', `${c}/adGroups/${cmd.ad_group_id}`, { status: cmd.status })
    case 'google.ad_group.rename':
      return update('adGroups', `${c}/adGroups/${cmd.ad_group_id}`, { name: cmd.name })
    case 'google.ad_group.set_cpc_bid':
      return update('adGroups', `${c}/adGroups/${cmd.ad_group_id}`, { cpcBidMicros: toMicros(cmd.cpc_bid) })
    case 'google.ad.set_status':
      return update('adGroupAds', `${c}/adGroupAds/${cmd.ad_group_id}~${cmd.ad_id}`, { status: cmd.status })
    case 'google.keyword.set_status':
      return update('adGroupCriteria', `${c}/adGroupCriteria/${cmd.ad_group_id}~${cmd.criterion_id}`, { status: cmd.status })
    case 'google.keyword.set_cpc_bid':
      return update('adGroupCriteria', `${c}/adGroupCriteria/${cmd.ad_group_id}~${cmd.criterion_id}`, { cpcBidMicros: toMicros(cmd.cpc_bid) })
    case 'google.keyword.add':
      return {
        service: 'adGroupCriteria',
        operation: {
          create: {
            adGroup: `${c}/adGroups/${cmd.ad_group_id}`,
            status: 'ENABLED',
            keyword: { text: cmd.text, matchType: cmd.match_type },
            ...(cmd.cpc_bid !== undefined ? { cpcBidMicros: toMicros(cmd.cpc_bid) } : {}),
          },
        },
      }
    case 'google.negative_keyword.add':
      return cmd.level === 'campaign'
        ? {
            service: 'campaignCriteria',
            operation: {
              create: {
                campaign: `${c}/campaigns/${cmd.campaign_id}`,
                negative: true,
                keyword: { text: cmd.text, matchType: cmd.match_type },
              },
            },
          }
        : {
            service: 'adGroupCriteria',
            operation: {
              create: {
                adGroup: `${c}/adGroups/${cmd.ad_group_id}`,
                negative: true,
                keyword: { text: cmd.text, matchType: cmd.match_type },
              },
            },
          }
    case 'google.negative_keyword.remove':
      return cmd.level === 'campaign'
        ? { service: 'campaignCriteria', operation: { remove: `${c}/campaignCriteria/${cmd.campaign_id}~${cmd.criterion_id}` } }
        : { service: 'adGroupCriteria', operation: { remove: `${c}/adGroupCriteria/${cmd.ad_group_id}~${cmd.criterion_id}` } }

    case 'google.campaign.set_dates': {
      const fields: Record<string, unknown> = {}
      if (cmd.start_date_time !== undefined) fields.startDateTime = cmd.start_date_time
      if (cmd.end_date_time !== undefined) fields.endDateTime = cmd.end_date_time
      return update('campaigns', `${c}/campaigns/${cmd.campaign_id}`, fields)
    }

    case 'google.campaign.set_tracking': {
      const fields: Record<string, unknown> = {}
      if (cmd.tracking_url_template !== undefined) fields.trackingUrlTemplate = cmd.tracking_url_template
      if (cmd.final_url_suffix !== undefined) fields.finalUrlSuffix = cmd.final_url_suffix
      return update('campaigns', `${c}/campaigns/${cmd.campaign_id}`, fields)
    }

    case 'google.campaign.set_target_cpa': {
      const strategy = before.fields.bidding_strategy_type as string | null
      const field = strategy === 'TARGET_CPA' ? 'targetCpa' : 'maximizeConversions'
      return nestedUpdate(
        'campaigns',
        `${c}/campaigns/${cmd.campaign_id}`,
        { [field]: { targetCpaMicros: toMicros(cmd.target_cpa) } },
        [`${field}.targetCpaMicros`],
      )
    }

    case 'google.campaign.set_target_roas': {
      const strategy = before.fields.bidding_strategy_type as string | null
      const field = strategy === 'TARGET_ROAS' ? 'targetRoas' : 'maximizeConversionValue'
      return nestedUpdate(
        'campaigns',
        `${c}/campaigns/${cmd.campaign_id}`,
        { [field]: { targetRoas: cmd.target_roas } },
        [`${field}.targetRoas`],
      )
    }

    case 'google.campaign.add_location':
      return {
        service: 'campaignCriteria',
        operation: {
          create: {
            campaign: `${c}/campaigns/${cmd.campaign_id}`,
            negative: cmd.negative,
            ...(cmd.bid_modifier !== undefined ? { bidModifier: cmd.bid_modifier } : {}),
            location: { geoTargetConstant: `geoTargetConstants/${cmd.geo_target_constant_id}` },
          },
        },
      }

    case 'google.campaign.remove_location':
      return { service: 'campaignCriteria', operation: { remove: `${c}/campaignCriteria/${cmd.campaign_id}~${cmd.criterion_id}` } }

    case 'google.campaign.add_language':
      return {
        service: 'campaignCriteria',
        operation: {
          create: {
            campaign: `${c}/campaigns/${cmd.campaign_id}`,
            language: { languageConstant: `languageConstants/${cmd.language_constant_id}` },
          },
        },
      }

    case 'google.campaign.remove_language':
      return { service: 'campaignCriteria', operation: { remove: `${c}/campaignCriteria/${cmd.campaign_id}~${cmd.criterion_id}` } }

    case 'google.campaign.add_ad_schedule':
      return {
        service: 'campaignCriteria',
        operation: {
          create: {
            campaign: `${c}/campaigns/${cmd.campaign_id}`,
            adSchedule: {
              dayOfWeek: cmd.day_of_week,
              startHour: cmd.start_hour,
              startMinute: cmd.start_minute,
              endHour: cmd.end_hour,
              endMinute: cmd.end_minute,
            },
            ...(cmd.bid_modifier !== undefined ? { bidModifier: cmd.bid_modifier } : {}),
          },
        },
      }

    case 'google.campaign.remove_ad_schedule':
      return { service: 'campaignCriteria', operation: { remove: `${c}/campaignCriteria/${cmd.campaign_id}~${cmd.criterion_id}` } }

    case 'google.ad.set_final_url':
      return update('ads', `${c}/ads/${cmd.ad_id}`, { finalUrls: [cmd.final_url] })

    case 'google.conversion_action.set_primary':
      return update('conversionActions', `${c}/conversionActions/${cmd.conversion_action_id}`, { primaryForGoal: cmd.primary })

    case 'google.campaign.set_conversion_goal_biddable':
      return update('campaignConversionGoals', `${c}/campaignConversionGoals/${cmd.campaign_id}~${cmd.category}~${cmd.origin}`, { biddable: cmd.biddable })

    case 'google.ad_group.create':
      return {
        service: 'adGroups',
        operation: {
          create: {
            campaign: `${c}/campaigns/${cmd.campaign_id}`,
            name: cmd.name,
            status: 'PAUSED',
            type: 'SEARCH_STANDARD',
            ...(cmd.cpc_bid !== undefined ? { cpcBidMicros: toMicros(cmd.cpc_bid) } : {}),
          },
        },
      }

    case 'google.ad.create_responsive_search':
      return {
        service: 'adGroupAds',
        operation: {
          create: {
            adGroup: `${c}/adGroups/${cmd.ad_group_id}`,
            status: 'PAUSED',
            ad: {
              finalUrls: [cmd.final_url],
              responsiveSearchAd: {
                headlines: cmd.headlines.map((text) => ({ text })),
                descriptions: cmd.descriptions.map((text) => ({ text })),
                ...(cmd.path1 ? { path1: cmd.path1 } : {}),
                ...(cmd.path2 ? { path2: cmd.path2 } : {}),
              },
            },
          },
        },
      }

    case 'google.campaign.create_search':
      // Built as a multi-service googleAds:mutate batch (buildCreateSearchOperations),
      // not a single-service :mutate — never reaches this function.
      throw new Error('google.campaign.create_search does not use buildOperation')
    default:
      // Handled by a CommandHandler module (providers/google/*), never by this adapter.
      throw new AdsValidationError(`${cmd.type} is not handled by the base Google adapter`)
  }
}

/**
 * `google.campaign.create_search` is one atomic googleAds:mutate batch: a
 * budget, the campaign referencing it, and one campaignCriterion per location
 * / language — all in a single request using temporary negative resource ids
 * so later operations can reference resources created earlier in the same
 * batch. Built once and sent twice, exactly like buildOperation: validateOnly
 * at preview time, then for real at execution.
 */
function buildCreateSearchOperations(cmd: CommandOf<'google.campaign.create_search'>, customerId: string): unknown[] {
  const c = `customers/${customerId}`
  const budgetResourceName = `${c}/campaignBudgets/-1`
  const campaignResourceName = `${c}/campaigns/-2`

  const bidding: Record<string, unknown> =
    cmd.bidding === 'MAXIMIZE_CONVERSIONS'
      ? { maximizeConversions: cmd.target_cpa !== undefined ? { targetCpaMicros: toMicros(cmd.target_cpa) } : {} }
      : cmd.bidding === 'MAXIMIZE_CLICKS'
        ? { targetSpend: {} }
        : { manualCpc: {} }

  return [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResourceName,
          name: `${cmd.name} budget ${Date.now()}`,
          amountMicros: toMicros(cmd.daily_budget),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignResourceName,
          name: cmd.name,
          status: 'PAUSED',
          advertisingChannelType: 'SEARCH',
          campaignBudget: budgetResourceName,
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: cmd.search_partners,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
          containsEuPoliticalAdvertising: cmd.contains_eu_political_advertising
            ? 'CONTAINS_EU_POLITICAL_ADVERTISING'
            : 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          ...(cmd.start_date_time ? { startDateTime: cmd.start_date_time } : {}),
          ...(cmd.end_date_time ? { endDateTime: cmd.end_date_time } : {}),
          ...bidding,
        },
      },
    },
    ...cmd.location_ids.map((geoTargetConstantId) => ({
      campaignCriterionOperation: {
        create: { campaign: campaignResourceName, location: { geoTargetConstant: `geoTargetConstants/${geoTargetConstantId}` } },
      },
    })),
    ...cmd.language_ids.map((languageConstantId) => ({
      campaignCriterionOperation: {
        create: { campaign: campaignResourceName, language: { languageConstant: `languageConstants/${languageConstantId}` } },
      },
    })),
  ]
}

/** "customers/1/adGroupCriteria/22~33" → "33" (also parses campaignCriteria/1~33 the same way) */
export function criterionIdFromResourceName(resourceName: string | null): string | null {
  const match = resourceName?.match(/~(\d+)$/)
  return match ? match[1] : null
}

/**
 * Every Google Ads command type this adapter actually implements. capabilities()
 * filters the catalog through this so a command that's in COMMAND_CATALOG but
 * not yet wired up here is reported as `unsupported_command` at preview time
 * (engine.ts checks capabilities() before ever calling plan/snapshot), instead
 * of reaching the switch statements above and silently falling through.
 */
const IMPLEMENTED: ReadonlySet<GoogleCommand['type']> = new Set<GoogleCommand['type']>([
  'google.campaign.set_status',
  'google.campaign.set_daily_budget',
  'google.campaign.rename',
  'google.ad_group.set_status',
  'google.ad_group.rename',
  'google.ad_group.set_cpc_bid',
  'google.ad.set_status',
  'google.keyword.add',
  'google.keyword.set_status',
  'google.keyword.set_cpc_bid',
  'google.negative_keyword.add',
  'google.negative_keyword.remove',
  'google.campaign.set_dates',
  'google.campaign.set_target_cpa',
  'google.campaign.set_target_roas',
  'google.campaign.set_tracking',
  'google.campaign.add_location',
  'google.campaign.remove_location',
  'google.campaign.add_language',
  'google.campaign.remove_language',
  'google.campaign.add_ad_schedule',
  'google.campaign.remove_ad_schedule',
  'google.ad.set_final_url',
  'google.conversion_action.set_primary',
  'google.campaign.set_conversion_goal_biddable',
  'google.campaign.create_search',
  'google.ad_group.create',
  'google.ad.create_responsive_search',
])

/** Pure removes: existence (already proven by snapshot) is the only thing to validate. */
const SKIP_VALIDATE: ReadonlySet<GoogleCommand['type']> = new Set<GoogleCommand['type']>([
  'google.negative_keyword.remove',
  'google.campaign.remove_location',
  'google.campaign.remove_language',
  'google.campaign.remove_ad_schedule',
])

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const googleAdapter: AdsProviderAdapter = {
  platform: 'google',

  capabilities(): Capability[] {
    return (Object.entries(COMMAND_CATALOG) as Array<[AdsCommand['type'], (typeof COMMAND_CATALOG)[AdsCommand['type']]]>)
      .filter(([type, entry]) => entry.platform === 'google' && IMPLEMENTED.has(type as GoogleCommand['type']))
      .map(([type, entry]) => ({ type, label: entry.label, risk: entry.risk }))
  },

  async snapshot(ctx, command) {
    if (!isGoogle(command)) throw new AdsValidationError('Not a Google Ads command')
    return snapshotGoogle(ctx, command)
  },

  plan(command, before) {
    if (!isGoogle(command)) return { ok: false, code: 'wrong_platform', message: 'Not a Google Ads command' }
    return planGoogle(command, before)
  },

  async validate(ctx, command, before) {
    if (!isGoogle(command)) throw new AdsValidationError('Not a Google Ads command')
    // A pure remove has nothing to validate beyond existence, which snapshot proved.
    if (SKIP_VALIDATE.has(command.type)) return
    if (command.type === 'google.campaign.create_search') {
      const operations = buildCreateSearchOperations(command, ctx.adAccountId)
      await googleAdsMutate(ctx.adAccountId, refreshToken(ctx), operations, { validateOnly: true })
      return
    }
    const { service, operation } = buildOperation(command, before, ctx.adAccountId)
    await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation], { validateOnly: true })
  },

  async execute(ctx, command, before): Promise<ExecuteResult> {
    if (!isGoogle(command)) throw new AdsValidationError('Not a Google Ads command')
    if (command.type === 'google.campaign.create_search') {
      const operations = buildCreateSearchOperations(command, ctx.adAccountId)
      const res = await googleAdsMutate(ctx.adAccountId, refreshToken(ctx), operations)
      const campaignRef = res.mutateOperationResponses?.find((r) => r.campaignResult?.resourceName)?.campaignResult?.resourceName ?? null
      return { providerRef: campaignRef, raw: res }
    }
    const { service, operation } = buildOperation(command, before, ctx.adAccountId)
    const res = await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation])
    return { providerRef: res.results?.[0]?.resourceName ?? null, raw: res }
  },

  async verify(ctx, command, intended, providerRef): Promise<VerifyResult> {
    if (!isGoogle(command)) throw new AdsValidationError('Not a Google Ads command')

    let observed: Record<string, unknown> | null = null

    if (command.type === 'google.keyword.add' || (command.type === 'google.negative_keyword.add' && command.level === 'ad_group')) {
      const criterionId = criterionIdFromResourceName(providerRef)
      const row = criterionId ? await readAdGroupCriterion(ctx, command.ad_group_id as string, criterionId) : null
      observed = row
        ? {
            text: row.adGroupCriterion.keyword?.text,
            match_type: row.adGroupCriterion.keyword?.matchType,
            status: row.adGroupCriterion.status,
            negative: Boolean(row.adGroupCriterion.negative),
            cpc_bid: fromMicros(row.adGroupCriterion.cpcBidMicros),
          }
        : null
    } else if (command.type === 'google.negative_keyword.add') {
      const criterionId = criterionIdFromResourceName(providerRef)
      const found = (await listCampaignNegatives(ctx, command.campaign_id as string)).find(
        (n) => n.campaignCriterion.criterionId === criterionId,
      )
      observed = found
        ? { text: found.campaignCriterion.keyword?.text, match_type: found.campaignCriterion.keyword?.matchType, negative: true }
        : null
    } else if (command.type === 'google.negative_keyword.remove') {
      const snap = await snapshotGoogle(ctx, command)
      observed = { exists: Boolean(snap) }
    } else if (
      command.type === 'google.campaign.add_location' ||
      command.type === 'google.campaign.add_language' ||
      command.type === 'google.campaign.add_ad_schedule'
    ) {
      const criterionId = criterionIdFromResourceName(providerRef)
      const targeting = criterionId
        ? await listCampaignTargeting({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: command.campaign_id })
        : null
      if (command.type === 'google.campaign.add_location') {
        const found = targeting?.locations.find((l) => l.criterion_id === criterionId)
        observed = found
          ? {
              geo_target_constant_id: found.geo_target_constant_id,
              negative: found.negative,
              ...(command.bid_modifier !== undefined ? { bid_modifier: found.bid_modifier } : {}),
            }
          : null
      } else if (command.type === 'google.campaign.add_language') {
        const found = targeting?.languages.find((l) => l.criterion_id === criterionId)
        observed = found ? { language_constant_id: found.language_constant_id } : null
      } else {
        const found = targeting?.adSchedules.find((s) => s.criterion_id === criterionId)
        observed = found
          ? {
              day_of_week: found.day_of_week,
              start_hour: found.start_hour,
              start_minute: found.start_minute,
              end_hour: found.end_hour,
              end_minute: found.end_minute,
              ...(found.bid_modifier != null ? { bid_modifier: found.bid_modifier } : {}),
            }
          : null
      }
    } else if (
      command.type === 'google.campaign.remove_location' ||
      command.type === 'google.campaign.remove_language' ||
      command.type === 'google.campaign.remove_ad_schedule'
    ) {
      const targeting = await listCampaignTargeting({ customerId: ctx.adAccountId, refreshToken: refreshToken(ctx), campaignId: command.campaign_id })
      const list =
        command.type === 'google.campaign.remove_location'
          ? targeting.locations
          : command.type === 'google.campaign.remove_language'
            ? targeting.languages
            : targeting.adSchedules
      observed = { exists: list.some((item) => item.criterion_id === command.criterion_id) }
    } else if (command.type === 'google.campaign.create_search') {
      const campaignId = idFromResourceName(providerRef)
      const row = campaignId ? await readCampaign(ctx, campaignId) : null
      observed = row
        ? { name: row.campaign.name, status: row.campaign.status, daily_budget: fromMicros(row.campaignBudget?.amountMicros) }
        : null
    } else if (command.type === 'google.ad_group.create') {
      const adGroupId = idFromResourceName(providerRef)
      const row = adGroupId ? await readAdGroup(ctx, adGroupId) : null
      observed = row ? { name: row.adGroup.name, status: row.adGroup.status, cpc_bid: fromMicros(row.adGroup.cpcBidMicros) } : null
    } else if (command.type === 'google.ad.create_responsive_search') {
      // providerRef is an adGroupAd resource name: customers/{c}/adGroupAds/{adGroupId}~{adId}
      const parsed = providerRef?.match(/adGroupAds\/(\d+)~(\d+)$/)
      const row = parsed ? await readResponsiveSearchAd(ctx, parsed[1], parsed[2]) : null
      observed = row
        ? {
            final_url: row.adGroupAd.ad.finalUrls?.[0] ?? null,
            status: row.adGroupAd.status,
            headline_count: row.adGroupAd.ad.responsiveSearchAd?.headlines?.length ?? 0,
            description_count: row.adGroupAd.ad.responsiveSearchAd?.descriptions?.length ?? 0,
          }
        : null
    } else {
      const snap = await snapshotGoogle(ctx, command)
      observed = snap?.fields ?? null
    }

    if (!observed) {
      return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
    }
    // Keyword text comes back normalised (lower-cased, trimmed) by Google.
    const comparable = { ...intended }
    if (typeof comparable.text === 'string' && typeof observed.text === 'string') {
      comparable.text = (comparable.text as string).trim().toLowerCase()
      observed = { ...observed, text: (observed.text as string).trim().toLowerCase() }
    }
    const mismatches = compareFields(comparable, observed)
    return { ok: mismatches.length === 0, mismatches, observed }
  },

  buildRollback(command, before, providerRef): AdsCommand | null {
    if (!isGoogle(command)) return null
    const f = before.fields
    const base = { platform: 'google' as const, ad_account_id: command.ad_account_id }
    const status = f.status as string
    const reversibleStatus = status === 'ENABLED' || status === 'PAUSED' ? (status as 'ENABLED' | 'PAUSED') : null

    switch (command.type) {
      case 'google.campaign.set_status':
        return reversibleStatus ? { ...base, type: command.type, campaign_id: command.campaign_id, status: reversibleStatus } : null
      case 'google.ad_group.set_status':
        return reversibleStatus ? { ...base, type: command.type, ad_group_id: command.ad_group_id, status: reversibleStatus } : null
      case 'google.ad.set_status':
        return reversibleStatus ? { ...base, type: command.type, ad_group_id: command.ad_group_id, ad_id: command.ad_id, status: reversibleStatus } : null
      case 'google.keyword.set_status':
        return reversibleStatus
          ? { ...base, type: command.type, ad_group_id: command.ad_group_id, criterion_id: command.criterion_id, status: reversibleStatus }
          : null
      case 'google.campaign.rename':
        return typeof f.name === 'string' ? { ...base, type: command.type, campaign_id: command.campaign_id, name: f.name } : null
      case 'google.ad_group.rename':
        return typeof f.name === 'string' ? { ...base, type: command.type, ad_group_id: command.ad_group_id, name: f.name } : null
      case 'google.campaign.set_daily_budget':
        return typeof f.daily_budget === 'number' && f.daily_budget > 0
          ? { ...base, type: command.type, campaign_id: command.campaign_id, daily_budget: f.daily_budget }
          : null
      case 'google.ad_group.set_cpc_bid':
        return typeof f.cpc_bid === 'number' && f.cpc_bid > 0
          ? { ...base, type: command.type, ad_group_id: command.ad_group_id, cpc_bid: f.cpc_bid }
          : null
      case 'google.keyword.set_cpc_bid':
        return typeof f.cpc_bid === 'number' && f.cpc_bid > 0
          ? { ...base, type: command.type, ad_group_id: command.ad_group_id, criterion_id: command.criterion_id, cpc_bid: f.cpc_bid }
          : null
      case 'google.keyword.add': {
        // Undo = pause, not remove: removal is irreversible in Google Ads and
        // would also discard the keyword's history.
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId
          ? { ...base, type: 'google.keyword.set_status', ad_group_id: command.ad_group_id, criterion_id: criterionId, status: 'PAUSED' }
          : null
      }
      case 'google.negative_keyword.add': {
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId
          ? {
              ...base,
              type: 'google.negative_keyword.remove',
              level: command.level,
              campaign_id: command.campaign_id,
              ad_group_id: command.ad_group_id,
              criterion_id: criterionId,
            }
          : null
      }
      case 'google.negative_keyword.remove':
        return {
          ...base,
          type: 'google.negative_keyword.add',
          level: command.level,
          campaign_id: command.campaign_id,
          ad_group_id: command.ad_group_id,
          text: String(f.text),
          match_type: (f.match_type as 'EXACT' | 'PHRASE' | 'BROAD') ?? 'EXACT',
        }

      case 'google.campaign.set_dates': {
        const rollback: Record<string, unknown> = {}
        if (command.start_date_time !== undefined && typeof f.start_date_time === 'string') rollback.start_date_time = f.start_date_time
        if (command.end_date_time !== undefined && typeof f.end_date_time === 'string') rollback.end_date_time = f.end_date_time
        return Object.keys(rollback).length > 0 ? { ...base, type: command.type, campaign_id: command.campaign_id, ...rollback } : null
      }

      case 'google.campaign.set_target_cpa':
        return typeof f.target_cpa === 'number' && f.target_cpa > 0
          ? { ...base, type: command.type, campaign_id: command.campaign_id, target_cpa: f.target_cpa }
          : null

      case 'google.campaign.set_target_roas':
        return typeof f.target_roas === 'number' && f.target_roas > 0
          ? { ...base, type: command.type, campaign_id: command.campaign_id, target_roas: f.target_roas }
          : null

      case 'google.campaign.set_tracking': {
        // Restore whatever was there before, including "unset" (cleared with '').
        const rollback: Record<string, unknown> = {}
        if (command.tracking_url_template !== undefined) rollback.tracking_url_template = typeof f.tracking_url_template === 'string' ? f.tracking_url_template : ''
        if (command.final_url_suffix !== undefined) rollback.final_url_suffix = typeof f.final_url_suffix === 'string' ? f.final_url_suffix : ''
        return Object.keys(rollback).length > 0 ? { ...base, type: command.type, campaign_id: command.campaign_id, ...rollback } : null
      }

      case 'google.campaign.add_location': {
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId ? { ...base, type: 'google.campaign.remove_location', campaign_id: command.campaign_id, criterion_id: criterionId } : null
      }

      case 'google.campaign.remove_location':
        return typeof f.geo_target_constant_id === 'string'
          ? {
              ...base,
              type: 'google.campaign.add_location',
              campaign_id: command.campaign_id,
              geo_target_constant_id: f.geo_target_constant_id,
              negative: Boolean(f.negative),
              ...(typeof f.bid_modifier === 'number' ? { bid_modifier: f.bid_modifier } : {}),
            }
          : null

      case 'google.campaign.add_language': {
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId ? { ...base, type: 'google.campaign.remove_language', campaign_id: command.campaign_id, criterion_id: criterionId } : null
      }

      case 'google.campaign.remove_language':
        return typeof f.language_constant_id === 'string'
          ? { ...base, type: 'google.campaign.add_language', campaign_id: command.campaign_id, language_constant_id: f.language_constant_id }
          : null

      case 'google.campaign.add_ad_schedule': {
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId ? { ...base, type: 'google.campaign.remove_ad_schedule', campaign_id: command.campaign_id, criterion_id: criterionId } : null
      }

      case 'google.campaign.remove_ad_schedule': {
        const days = new Set(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])
        const minutes = new Set(['ZERO', 'FIFTEEN', 'THIRTY', 'FORTY_FIVE'])
        if (
          typeof f.day_of_week !== 'string' ||
          !days.has(f.day_of_week) ||
          typeof f.start_hour !== 'number' ||
          typeof f.end_hour !== 'number' ||
          typeof f.start_minute !== 'string' ||
          !minutes.has(f.start_minute) ||
          typeof f.end_minute !== 'string' ||
          !minutes.has(f.end_minute)
        ) {
          return null
        }
        return {
          ...base,
          type: 'google.campaign.add_ad_schedule',
          campaign_id: command.campaign_id,
          day_of_week: f.day_of_week as 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY',
          start_hour: f.start_hour,
          start_minute: f.start_minute as 'ZERO' | 'FIFTEEN' | 'THIRTY' | 'FORTY_FIVE',
          end_hour: f.end_hour,
          end_minute: f.end_minute as 'ZERO' | 'FIFTEEN' | 'THIRTY' | 'FORTY_FIVE',
          ...(typeof f.bid_modifier === 'number' ? { bid_modifier: f.bid_modifier } : {}),
        }
      }

      case 'google.ad.set_final_url': {
        const prevUrl = (f.final_urls as string[] | undefined)?.[0]
        return typeof prevUrl === 'string' && prevUrl.length > 0
          ? { ...base, type: command.type, ad_group_id: command.ad_group_id, ad_id: command.ad_id, final_url: prevUrl }
          : null
      }

      case 'google.conversion_action.set_primary':
        return typeof f.primary_for_goal === 'boolean'
          ? { ...base, type: command.type, conversion_action_id: command.conversion_action_id, primary: f.primary_for_goal }
          : null

      case 'google.campaign.set_conversion_goal_biddable':
        return typeof f.biddable === 'boolean'
          ? { ...base, type: command.type, campaign_id: command.campaign_id, category: command.category, origin: command.origin, biddable: f.biddable }
          : null

      // Structural creates have no rollback: the object is created PAUSED, so
      // nothing was spending before or after, and there is no prior state to
      // restore. Undoing one means pausing (already paused) or deleting it by
      // hand — removal is irreversible in Google Ads, so it's never automatic.
      case 'google.campaign.create_search':
      case 'google.ad_group.create':
      case 'google.ad.create_responsive_search':
        return null
      default:
        // Handled by a CommandHandler module (providers/google/*), never by this adapter.
        return null
    }
  },

  classifyError(error): ErrorClass {
    if (error instanceof AdsValidationError) {
      return { code: 'invalid_input', message: error.message, transient: false, auth: false }
    }
    if (isAuthError(error)) {
      return { code: 'auth', message: error instanceof Error ? error.message : 'Credential rejected', transient: false, auth: true }
    }
    if (error instanceof GoogleAdsError) {
      const status = error.httpStatus ?? 0
      const transient =
        status === 429 || status >= 500 ||
        ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'].includes(error.code ?? '')
      return {
        code: error.detailCode ?? error.code ?? `http_${status}`,
        message: error.message,
        transient,
        auth: false,
      }
    }
    // fetch() network failures surface as TypeError — worth another attempt.
    if (error instanceof TypeError) return { code: 'network', message: error.message, transient: true, auth: false }
    return { code: 'unknown', message: error instanceof Error ? error.message : String(error), transient: false, auth: false }
  },
}

