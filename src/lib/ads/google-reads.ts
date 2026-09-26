// Read-side Google Ads queries the command engine's callers need to decide
// what to change: search terms, keywords, negatives and ads. Same safety rules
// as google-api.ts — ids are asserted numeric before reaching GAQL, dates go
// through buildGaqlDateCondition, and no free text is ever interpolated.

import { buildGaqlDateCondition, runGaqlQuery } from './google-api'
import { assertNumericId } from './validation'

const MICROS = 1_000_000
const money = (micros: string | undefined) => Number(micros ?? 0) / MICROS
const scope = (campaignId?: string, adGroupId?: string) =>
  [
    campaignId ? `campaign.id = ${assertNumericId(campaignId, 'campaign_id')}` : null,
    adGroupId ? `ad_group.id = ${assertNumericId(adGroupId, 'ad_group_id')}` : null,
  ]
    .filter(Boolean)
    .map((c) => ` AND ${c}`)
    .join('')

type Metrics = { impressions?: string; clicks?: string; costMicros?: string; conversions?: number | string }

function metrics(m: Metrics | undefined) {
  const cost = money(m?.costMicros)
  const conversions = Number(m?.conversions ?? 0)
  const clicks = Number(m?.clicks ?? 0)
  return {
    impressions: Number(m?.impressions ?? 0),
    clicks,
    cost,
    conversions,
    cpc: clicks > 0 ? cost / clicks : null,
    cpa: conversions > 0 ? cost / conversions : null,
  }
}

export async function listSearchTerms(params: {
  customerId: string
  refreshToken: string
  datePreset?: string
  since?: string
  until?: string
  campaignId?: string
  adGroupId?: string
  limit?: number
}) {
  type Row = {
    searchTermView: { searchTerm: string; status?: string }
    segments?: { keyword?: { info?: { text?: string; matchType?: string } } }
    campaign: { id: string; name: string }
    adGroup: { id: string; name: string }
    metrics?: Metrics
  }
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 1000)
  const rows = await runGaqlQuery<Row>(
    params.customerId,
    params.refreshToken,
    `SELECT search_term_view.search_term, search_term_view.status,
            segments.keyword.info.text, segments.keyword.info.match_type,
            campaign.id, campaign.name, ad_group.id, ad_group.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
     FROM search_term_view
     WHERE ${buildGaqlDateCondition(params.datePreset ?? 'last_30d', params.since, params.until)}${scope(params.campaignId, params.adGroupId)}
     ORDER BY metrics.cost_micros DESC
     LIMIT ${limit}`,
  )
  return rows.map((r) => ({
    search_term: r.searchTermView.searchTerm,
    // ADDED / EXCLUDED / ADDED_EXCLUDED / NONE — whether it is already a keyword or negative.
    status: r.searchTermView.status ?? null,
    matched_keyword: r.segments?.keyword?.info?.text ?? null,
    matched_match_type: r.segments?.keyword?.info?.matchType ?? null,
    campaign_id: r.campaign.id,
    campaign_name: r.campaign.name,
    ad_group_id: r.adGroup.id,
    ad_group_name: r.adGroup.name,
    ...metrics(r.metrics),
  }))
}

export async function listKeywords(params: {
  customerId: string
  refreshToken: string
  datePreset?: string
  campaignId?: string
  adGroupId?: string
}) {
  type Row = {
    adGroupCriterion: {
      criterionId: string
      status: string
      cpcBidMicros?: string
      keyword?: { text?: string; matchType?: string }
      qualityInfo?: { qualityScore?: number }
    }
    adGroup: { id: string; name: string }
    campaign: { id: string; name: string }
    metrics?: Metrics
  }
  const rows = await runGaqlQuery<Row>(
    params.customerId,
    params.refreshToken,
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.quality_info.quality_score,
            ad_group.id, ad_group.name, campaign.id, campaign.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
     FROM keyword_view
     WHERE ${buildGaqlDateCondition(params.datePreset ?? 'last_30d')}
       AND ad_group_criterion.status != 'REMOVED'${scope(params.campaignId, params.adGroupId)}
     ORDER BY metrics.cost_micros DESC`,
  )
  return rows.map((r) => ({
    criterion_id: r.adGroupCriterion.criterionId,
    text: r.adGroupCriterion.keyword?.text ?? '',
    match_type: r.adGroupCriterion.keyword?.matchType ?? null,
    status: r.adGroupCriterion.status,
    cpc_bid: r.adGroupCriterion.cpcBidMicros ? money(r.adGroupCriterion.cpcBidMicros) : null,
    quality_score: r.adGroupCriterion.qualityInfo?.qualityScore ?? null,
    ad_group_id: r.adGroup.id,
    ad_group_name: r.adGroup.name,
    campaign_id: r.campaign.id,
    campaign_name: r.campaign.name,
    ...metrics(r.metrics),
  }))
}

export async function listNegativeKeywords(params: { customerId: string; refreshToken: string; campaignId?: string }) {
  type CampaignRow = {
    campaignCriterion: { criterionId: string; keyword?: { text?: string; matchType?: string } }
    campaign: { id: string; name: string }
  }
  type AdGroupRow = {
    adGroupCriterion: { criterionId: string; keyword?: { text?: string; matchType?: string } }
    adGroup: { id: string; name: string }
    campaign: { id: string; name: string }
  }
  const campaignFilter = params.campaignId ? ` AND campaign.id = ${assertNumericId(params.campaignId, 'campaign_id')}` : ''
  const [campaignLevel, adGroupLevel] = await Promise.all([
    runGaqlQuery<CampaignRow>(
      params.customerId,
      params.refreshToken,
      `SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
              campaign.id, campaign.name
       FROM campaign_criterion
       WHERE campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE
         AND campaign.status != 'REMOVED'${campaignFilter}`,
    ),
    runGaqlQuery<AdGroupRow>(
      params.customerId,
      params.refreshToken,
      `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
              ad_group.id, ad_group.name, campaign.id, campaign.name
       FROM ad_group_criterion
       WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = TRUE
         AND ad_group_criterion.status != 'REMOVED'${campaignFilter}`,
    ),
  ])
  return [
    ...campaignLevel.map((r) => ({
      level: 'campaign' as const,
      criterion_id: r.campaignCriterion.criterionId,
      text: r.campaignCriterion.keyword?.text ?? '',
      match_type: r.campaignCriterion.keyword?.matchType ?? null,
      campaign_id: r.campaign.id,
      campaign_name: r.campaign.name,
      ad_group_id: null,
      ad_group_name: null,
    })),
    ...adGroupLevel.map((r) => ({
      level: 'ad_group' as const,
      criterion_id: r.adGroupCriterion.criterionId,
      text: r.adGroupCriterion.keyword?.text ?? '',
      match_type: r.adGroupCriterion.keyword?.matchType ?? null,
      campaign_id: r.campaign.id,
      campaign_name: r.campaign.name,
      ad_group_id: r.adGroup.id,
      ad_group_name: r.adGroup.name,
    })),
  ]
}

export async function listAds(params: {
  customerId: string
  refreshToken: string
  datePreset?: string
  campaignId?: string
  adGroupId?: string
}) {
  type Row = {
    adGroupAd: {
      status: string
      ad: { id: string; name?: string; type?: string; finalUrls?: string[] }
      policySummary?: { approvalStatus?: string }
    }
    adGroup: { id: string; name: string }
    campaign: { id: string; name: string }
    metrics?: Metrics
  }
  const rows = await runGaqlQuery<Row>(
    params.customerId,
    params.refreshToken,
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
            ad_group_ad.status, ad_group_ad.policy_summary.approval_status,
            ad_group.id, ad_group.name, campaign.id, campaign.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
     FROM ad_group_ad
     WHERE ${buildGaqlDateCondition(params.datePreset ?? 'last_30d')}
       AND ad_group_ad.status != 'REMOVED'${scope(params.campaignId, params.adGroupId)}
     ORDER BY metrics.cost_micros DESC`,
  )
  return rows.map((r) => ({
    ad_id: r.adGroupAd.ad.id,
    name: r.adGroupAd.ad.name ?? null,
    type: r.adGroupAd.ad.type ?? null,
    final_urls: r.adGroupAd.ad.finalUrls ?? [],
    status: r.adGroupAd.status,
    approval_status: r.adGroupAd.policySummary?.approvalStatus ?? null,
    ad_group_id: r.adGroup.id,
    ad_group_name: r.adGroup.name,
    campaign_id: r.campaign.id,
    campaign_name: r.campaign.name,
    ...metrics(r.metrics),
  }))
}

// ─── Campaign targeting (locations, languages, ad schedules) ──────────────────

export type CampaignLocationCriterion = {
  criterion_id: string
  geo_target_constant_id: string
  negative: boolean
  bid_modifier: number | null
}
export type CampaignLanguageCriterion = {
  criterion_id: string
  language_constant_id: string
  bid_modifier: number | null
}
export type CampaignAdScheduleCriterion = {
  criterion_id: string
  day_of_week: string
  start_hour: number
  start_minute: string
  end_hour: number
  end_minute: string
  bid_modifier: number | null
}

/**
 * Every location, language and ad-schedule criterion on a campaign, with the
 * criterion ids `google.campaign.remove_*` needs. `campaign_criterion.location
 * .geo_target_constant` / `.language.language_constant` come back as resource
 * names ("geoTargetConstants/2620") — only the trailing numeric id is kept.
 */
export async function listCampaignTargeting(params: {
  customerId: string
  refreshToken: string
  campaignId: string
}): Promise<{
  locations: CampaignLocationCriterion[]
  languages: CampaignLanguageCriterion[]
  adSchedules: CampaignAdScheduleCriterion[]
}> {
  type Row = {
    campaignCriterion: {
      criterionId: string
      type?: string
      negative?: boolean
      bidModifier?: number
      location?: { geoTargetConstant?: string }
      language?: { languageConstant?: string }
      adSchedule?: { dayOfWeek?: string; startHour?: number; startMinute?: string; endHour?: number; endMinute?: string }
    }
  }
  const rows = await runGaqlQuery<Row>(
    params.customerId,
    params.refreshToken,
    `SELECT campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative,
            campaign_criterion.bid_modifier, campaign_criterion.location.geo_target_constant,
            campaign_criterion.language.language_constant, campaign_criterion.ad_schedule.day_of_week,
            campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute,
            campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute
     FROM campaign_criterion
     WHERE campaign.id = ${assertNumericId(params.campaignId, 'campaign_id')}
       AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE', 'AD_SCHEDULE')
       AND campaign_criterion.status != 'REMOVED'`,
  )
  const trailingId = (resourceName: string | undefined) => resourceName?.match(/\/(\d+)$/)?.[1] ?? ''
  return {
    locations: rows
      .filter((r) => r.campaignCriterion.type === 'LOCATION')
      .map((r) => ({
        criterion_id: r.campaignCriterion.criterionId,
        geo_target_constant_id: trailingId(r.campaignCriterion.location?.geoTargetConstant),
        negative: Boolean(r.campaignCriterion.negative),
        bid_modifier: r.campaignCriterion.bidModifier ?? null,
      })),
    languages: rows
      .filter((r) => r.campaignCriterion.type === 'LANGUAGE')
      .map((r) => ({
        criterion_id: r.campaignCriterion.criterionId,
        language_constant_id: trailingId(r.campaignCriterion.language?.languageConstant),
        bid_modifier: r.campaignCriterion.bidModifier ?? null,
      })),
    adSchedules: rows
      .filter((r) => r.campaignCriterion.type === 'AD_SCHEDULE')
      .map((r) => ({
        criterion_id: r.campaignCriterion.criterionId,
        day_of_week: r.campaignCriterion.adSchedule?.dayOfWeek ?? '',
        start_hour: r.campaignCriterion.adSchedule?.startHour ?? 0,
        start_minute: r.campaignCriterion.adSchedule?.startMinute ?? 'ZERO',
        end_hour: r.campaignCriterion.adSchedule?.endHour ?? 0,
        end_minute: r.campaignCriterion.adSchedule?.endMinute ?? 'ZERO',
        bid_modifier: r.campaignCriterion.bidModifier ?? null,
      })),
  }
}

// ─── Conversion actions & campaign conversion goals ────────────────────────────

export async function listConversionActions(params: {
  customerId: string
  refreshToken: string
  /** Narrow to one conversion action (the adapter's snapshot read). Omit to list the account. */
  conversionActionId?: string
}) {
  type Row = {
    conversionAction: {
      id: string
      name: string
      status: string
      category?: string
      type?: string
      primaryForGoal?: boolean
    }
  }
  const filter = params.conversionActionId
    ? ` WHERE conversion_action.id = ${assertNumericId(params.conversionActionId, 'conversion_action_id')}`
    : ''
  const rows = await runGaqlQuery<Row>(
    params.customerId,
    params.refreshToken,
    `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category,
            conversion_action.type, conversion_action.primary_for_goal
     FROM conversion_action${filter}
     ORDER BY conversion_action.name`,
  )
  return rows.map((r) => ({
    conversion_action_id: r.conversionAction.id,
    name: r.conversionAction.name,
    status: r.conversionAction.status,
    category: r.conversionAction.category ?? null,
    type: r.conversionAction.type ?? null,
    primary_for_goal: Boolean(r.conversionAction.primaryForGoal),
  }))
}

export async function listCampaignConversionGoals(params: { customerId: string; refreshToken: string; campaignId: string }) {
  type Row = { campaignConversionGoal: { category: string; origin: string; biddable: boolean } }
  const rows = await runGaqlQuery<Row>(
    params.customerId,
    params.refreshToken,
    `SELECT campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable
     FROM campaign_conversion_goal
     WHERE campaign.id = ${assertNumericId(params.campaignId, 'campaign_id')}`,
  )
  return rows.map((r) => ({
    category: r.campaignConversionGoal.category,
    origin: r.campaignConversionGoal.origin,
    biddable: Boolean(r.campaignConversionGoal.biddable),
  }))
}
