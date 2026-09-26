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
