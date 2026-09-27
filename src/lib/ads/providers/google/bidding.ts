// Bidding strategy, CPC ceiling, total budget, proximity targeting, keyword removal, Display campaign creation.
//
// Implemented as a CommandHandler (see ../handlers.ts): this module owns its
// command types end to end — snapshot, plan, validate, execute, verify,
// rollback — and is composed over the base google adapter in ../index.ts.
//
// Same safety rules as google-adapter.ts: every id interpolated into GAQL is
// already asserted numeric by the command schema (GId()), and no free text is
// ever interpolated into a query. Money is major units in/out; toMicros()
// (imported from google-adapter.ts, the single conversion authority) rounds to
// whole cents before converting so a value like 12.345 can't become a
// rejected amount.

import type { AdsCommand, CommandOf } from '../../commands/catalog'
import type { DiffEntry, PlanResult, ResourceSnapshot } from '../../commands/types'
import { formatCurrency } from '../../currency'
import { googleAdsMutate, mutateResources, parseTokens, runGaqlQuery, type GAdsMutateService } from '../../google-api'
import { AdsValidationError } from '../../validation'
import { compareFields, diffField, diffMoney, effective } from '../diff'
import { criterionIdFromResourceName, toMicros } from '../google-adapter'
import { noOp, type CommandHandler } from '../handlers'
import type { AdapterContext, ExecuteResult, VerifyResult } from '../types'

const MICROS = 1_000_000
const MICRO_DEGREES = 1_000_000

function fromMicros(micros: string | number | null | undefined): number | null {
  if (micros === null || micros === undefined || micros === '') return null
  return Number(micros) / MICROS
}

/** Google's double fields (target ROAS) come back as numbers already; this just tolerates a stringified one. */
function numOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  return Number(value)
}

function microDegrees(deg: number): number {
  return Math.round(deg * MICRO_DEGREES)
}

function refreshToken(ctx: AdapterContext): string {
  return parseTokens(ctx.credential).refresh_token
}

/** Case/whitespace-insensitive name match, used only in code — never interpolated into GAQL. */
function sameName(a: string | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
}

/** "customers/1/campaigns/456" → "456" */
function campaignIdFromResourceName(resourceName: string | null): string | null {
  return resourceName?.match(/\/campaigns\/(\d+)$/)?.[1] ?? null
}

/** "customers/1/adGroups/456" → "456" */
function adGroupIdFromResourceName(resourceName: string | null): string | null {
  return resourceName?.match(/\/adGroups\/(\d+)$/)?.[1] ?? null
}

/** `google.campaign.set_bidding_strategy`'s catalog enum, mapped to the biddingStrategyType Google actually reports for it. */
function expectedBiddingType(strategy: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE'): string {
  return strategy === 'MAXIMIZE_CLICKS' ? 'TARGET_SPEND' : strategy
}

/** Rough day count between two 'yyyy-MM-dd HH:mm:ss' account-time strings, treated as UTC — approximate, like nowAsGoogleDateTime() elsewhere in this module family. */
function daysBetween(startStr: string | undefined, endStr: string): number | null {
  const end = Date.parse(`${endStr.replace(' ', 'T')}Z`)
  if (Number.isNaN(end)) return null
  const start = startStr ? Date.parse(`${startStr.replace(' ', 'T')}Z`) : Date.now()
  if (Number.isNaN(start)) return null
  const days = Math.round((end - start) / 86_400_000)
  return days > 0 ? days : null
}

// ─── Readers ────────────────────────────────────────────────────────────────

type CampaignBasicRow = { campaign: { id: string; name: string; status: string }; customer?: { currencyCode?: string } }

async function readCampaignBasic(ctx: AdapterContext, campaignId: string): Promise<CampaignBasicRow | null> {
  const rows = await runGaqlQuery<CampaignBasicRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, customer.currency_code
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type CampaignBiddingRow = {
  campaign: {
    id: string
    name: string
    status: string
    advertisingChannelType?: string
    biddingStrategyType?: string
    /** Non-empty only when the campaign uses a portfolio (shared) bidding strategy resource. */
    biddingStrategy?: string
    maximizeConversions?: { targetCpaMicros?: string }
    maximizeConversionValue?: { targetRoas?: number | string }
    targetSpend?: { cpcBidCeilingMicros?: string }
    targetCpa?: { targetCpaMicros?: string }
    targetRoas?: { targetRoas?: number | string }
  }
  customer?: { currencyCode?: string }
}

/** Shared reader for set_bidding_strategy and set_cpc_bid_ceiling — both live on the campaign's bidding oneof. */
async function readCampaignBidding(ctx: AdapterContext, campaignId: string): Promise<CampaignBiddingRow | null> {
  const rows = await runGaqlQuery<CampaignBiddingRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign.bidding_strategy_type, campaign.bidding_strategy,
            campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas,
            campaign.target_spend.cpc_bid_ceiling_micros, campaign.target_cpa.target_cpa_micros,
            campaign.target_roas.target_roas, customer.currency_code
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type CampaignBudgetInfoRow = {
  campaign: { id: string; name: string; status: string; startDateTime?: string; endDateTime?: string }
  campaignBudget?: {
    id?: string
    amountMicros?: string
    totalAmountMicros?: string
    period?: string
    explicitlyShared?: boolean
    referenceCount?: string
  }
  customer?: { currencyCode?: string }
}

async function readCampaignBudgetInfo(ctx: AdapterContext, campaignId: string): Promise<CampaignBudgetInfoRow | null> {
  const rows = await runGaqlQuery<CampaignBudgetInfoRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign.start_date_time, campaign.end_date_time,
            campaign_budget.id, campaign_budget.amount_micros, campaign_budget.total_amount_micros,
            campaign_budget.period, campaign_budget.explicitly_shared, campaign_budget.reference_count,
            customer.currency_code
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type ProximityRow = {
  criterion_id: string
  latitude_micro: number | null
  longitude_micro: number | null
  radius: number | null
  radius_units: string | null
}

type RawProximityRow = {
  campaignCriterion: {
    criterionId: string
    proximity?: { geoPoint?: { latitudeInMicroDegrees?: number; longitudeInMicroDegrees?: number }; radius?: number; radiusUnits?: string }
  }
}

/**
 * Radius (PROXIMITY) campaign criteria with the criterion_id `remove_proximity`
 * needs. Not covered by listCampaignTargeting() in ../../google-reads.ts,
 * which only lists LOCATION / LANGUAGE / AD_SCHEDULE — exported so the
 * optional MCP read tool (ads-google-bidding-reads.ts) can reuse it instead
 * of duplicating the query.
 */
export async function listCampaignProximities(ctx: AdapterContext, campaignId: string): Promise<ProximityRow[]> {
  const rows = await runGaqlQuery<RawProximityRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign_criterion.criterion_id, campaign_criterion.proximity.geo_point.latitude_in_micro_degrees,
            campaign_criterion.proximity.geo_point.longitude_in_micro_degrees, campaign_criterion.proximity.radius,
            campaign_criterion.proximity.radius_units
     FROM campaign_criterion
     WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'PROXIMITY' AND campaign_criterion.status != 'REMOVED'`,
  )
  return rows.map((r) => ({
    criterion_id: r.campaignCriterion.criterionId,
    latitude_micro: r.campaignCriterion.proximity?.geoPoint?.latitudeInMicroDegrees ?? null,
    longitude_micro: r.campaignCriterion.proximity?.geoPoint?.longitudeInMicroDegrees ?? null,
    radius: r.campaignCriterion.proximity?.radius ?? null,
    radius_units: r.campaignCriterion.proximity?.radiusUnits ?? null,
  }))
}

type KeywordCriterionRow = {
  adGroupCriterion: {
    criterionId: string
    type?: string
    status: string
    negative?: boolean
    cpcBidMicros?: string
    keyword?: { text?: string; matchType?: string }
  }
  adGroup: { id: string; name?: string }
  campaign: { id: string }
  customer?: { currencyCode?: string }
}

/** No status filter — a just-removed criterion still needs to come back (with status REMOVED) for plan()'s "already removed" check and verify(). */
async function readKeywordCriterion(ctx: AdapterContext, adGroupId: string, criterionId: string): Promise<KeywordCriterionRow | null> {
  const rows = await runGaqlQuery<KeywordCriterionRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.type, ad_group_criterion.status,
            ad_group_criterion.negative, ad_group_criterion.cpc_bid_micros, ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, campaign.id, customer.currency_code
     FROM ad_group_criterion
     WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.criterion_id = ${criterionId} LIMIT 1`,
  )
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

type CustomerCurrencyRow = { customer?: { currencyCode?: string } }

async function readCustomerCurrency(ctx: AdapterContext): Promise<CustomerCurrencyRow | null> {
  const rows = await runGaqlQuery<CustomerCurrencyRow>(ctx.adAccountId, refreshToken(ctx), `SELECT customer.currency_code FROM customer LIMIT 1`)
  return rows[0] ?? null
}

type CampaignForAdGroupRow = {
  campaign: { id: string; name: string; status: string; advertisingChannelType?: string }
  customer?: { currencyCode?: string }
}

async function readCampaignForDisplayAdGroup(ctx: AdapterContext, campaignId: string): Promise<CampaignForAdGroupRow | null> {
  const rows = await runGaqlQuery<CampaignForAdGroupRow>(
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

type CampaignReadBackRow = { campaign: { id: string; name: string; status: string }; campaignBudget?: { amountMicros?: string } }

async function readCampaignReadBack(ctx: AdapterContext, campaignId: string): Promise<CampaignReadBackRow | null> {
  const rows = await runGaqlQuery<CampaignReadBackRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
     FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type AdGroupReadBackRow = { adGroup: { id: string; name: string; status: string; cpcBidMicros?: string } }

async function readAdGroupReadBack(ctx: AdapterContext, adGroupId: string): Promise<AdGroupReadBackRow | null> {
  const rows = await runGaqlQuery<AdGroupReadBackRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros
     FROM ad_group WHERE ad_group.id = ${adGroupId} LIMIT 1`,
  )
  return rows[0] ?? null
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshot(ctx: AdapterContext, command: AdsCommand): Promise<ResourceSnapshot | null> {
  switch (command.type) {
    case 'google.campaign.set_bidding_strategy':
    case 'google.campaign.set_cpc_bid_ceiling': {
      const row = await readCampaignBidding(ctx, command.campaign_id)
      if (!row) return null
      const strategyType = row.campaign.biddingStrategyType ?? null
      return {
        resourceType: 'campaign',
        resourceId: row.campaign.id,
        resourceName: row.campaign.name,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: {
          status: row.campaign.status,
          advertising_channel_type: row.campaign.advertisingChannelType ?? null,
          bidding_strategy_type: strategyType,
          is_portfolio: Boolean(row.campaign.biddingStrategy),
          bidding_strategy_resource: row.campaign.biddingStrategy ?? null,
          target_cpa:
            strategyType === 'MAXIMIZE_CONVERSIONS'
              ? fromMicros(row.campaign.maximizeConversions?.targetCpaMicros)
              : strategyType === 'TARGET_CPA'
                ? fromMicros(row.campaign.targetCpa?.targetCpaMicros)
                : null,
          target_roas:
            strategyType === 'MAXIMIZE_CONVERSION_VALUE'
              ? numOrNull(row.campaign.maximizeConversionValue?.targetRoas)
              : strategyType === 'TARGET_ROAS'
                ? numOrNull(row.campaign.targetRoas?.targetRoas)
                : null,
          cpc_bid_ceiling: strategyType === 'TARGET_SPEND' ? fromMicros(row.campaign.targetSpend?.cpcBidCeilingMicros) : null,
        },
      }
    }

    case 'google.campaign.set_total_budget': {
      const row = await readCampaignBudgetInfo(ctx, command.campaign_id)
      if (!row) return null
      return {
        resourceType: 'campaign',
        resourceId: row.campaign.id,
        resourceName: row.campaign.name,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: {
          status: row.campaign.status,
          start_date_time: row.campaign.startDateTime ?? null,
          end_date_time: row.campaign.endDateTime ?? null,
          budget_id: row.campaignBudget?.id ?? null,
          daily_budget: fromMicros(row.campaignBudget?.amountMicros),
          total_budget: fromMicros(row.campaignBudget?.totalAmountMicros),
          budget_period: row.campaignBudget?.period ?? null,
          budget_shared: Boolean(row.campaignBudget?.explicitlyShared),
          budget_reference_count: Number(row.campaignBudget?.referenceCount ?? 1),
        },
      }
    }

    case 'google.campaign.add_proximity': {
      const campaign = await readCampaignBasic(ctx, command.campaign_id)
      if (!campaign) return null
      const proximities = await listCampaignProximities(ctx, command.campaign_id)
      const latMicro = microDegrees(command.latitude)
      const lngMicro = microDegrees(command.longitude)
      const existing = proximities.find(
        (p) =>
          p.latitude_micro === latMicro &&
          p.longitude_micro === lngMicro &&
          p.radius !== null &&
          Math.abs(p.radius - command.radius) < 1e-6 &&
          p.radius_units === command.radius_units,
      )
      return {
        resourceType: 'campaign_criterion',
        resourceId: null,
        resourceName: `Radius ${command.radius} ${command.radius_units} @ (${command.latitude}, ${command.longitude}) → ${campaign.campaign.name}`,
        campaignId: campaign.campaign.id,
        currency: campaign.customer?.currencyCode ?? 'USD',
        fields: { campaign_status: campaign.campaign.status, existing_criterion_id: existing?.criterion_id ?? null },
      }
    }

    case 'google.campaign.remove_proximity': {
      const proximities = await listCampaignProximities(ctx, command.campaign_id)
      const found = proximities.find((p) => p.criterion_id === command.criterion_id)
      if (!found) return null
      return {
        resourceType: 'campaign_criterion',
        resourceId: found.criterion_id,
        resourceName: `Radius ${found.radius ?? '?'} ${found.radius_units ?? ''}`.trim(),
        campaignId: command.campaign_id,
        currency: 'USD',
        fields: {
          latitude: found.latitude_micro !== null ? found.latitude_micro / MICRO_DEGREES : null,
          longitude: found.longitude_micro !== null ? found.longitude_micro / MICRO_DEGREES : null,
          radius: found.radius,
          radius_units: found.radius_units,
        },
      }
    }

    case 'google.keyword.remove': {
      const row = await readKeywordCriterion(ctx, command.ad_group_id, command.criterion_id)
      if (!row) return null
      return {
        resourceType: 'keyword',
        resourceId: row.adGroupCriterion.criterionId,
        resourceName: `[${row.adGroupCriterion.keyword?.matchType ?? '?'}] ${row.adGroupCriterion.keyword?.text ?? ''} (${row.adGroup.name ?? row.adGroup.id})`,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: {
          type: row.adGroupCriterion.type ?? null,
          status: row.adGroupCriterion.status,
          negative: Boolean(row.adGroupCriterion.negative),
          text: row.adGroupCriterion.keyword?.text ?? '',
          match_type: row.adGroupCriterion.keyword?.matchType ?? 'EXACT',
          cpc_bid: fromMicros(row.adGroupCriterion.cpcBidMicros),
        },
      }
    }

    case 'google.campaign.create_display': {
      const [customerRow, campaigns] = await Promise.all([readCustomerCurrency(ctx), listNonRemovedCampaignNames(ctx)])
      const existing = campaigns.find((c) => sameName(c.campaign.name, command.name))
      return {
        resourceType: 'campaign',
        resourceId: null,
        resourceName: command.name,
        campaignId: null,
        currency: customerRow?.customer?.currencyCode ?? 'USD',
        fields: { existing_campaign_id: existing?.campaign.id ?? null },
      }
    }

    case 'google.ad_group.create_display': {
      const campaign = await readCampaignForDisplayAdGroup(ctx, command.campaign_id)
      if (!campaign) return null
      const adGroups = await listAdGroupNamesInCampaign(ctx, command.campaign_id)
      const existing = adGroups.find((a) => sameName(a.adGroup.name, command.name))
      return {
        resourceType: 'ad_group',
        resourceId: null,
        resourceName: `${command.name} → ${campaign.campaign.name}`,
        campaignId: campaign.campaign.id,
        currency: campaign.customer?.currencyCode ?? 'USD',
        fields: {
          campaign_status: campaign.campaign.status,
          campaign_channel_type: campaign.campaign.advertisingChannelType ?? null,
          existing_ad_group_id: existing?.adGroup.id ?? null,
        },
      }
    }

    default:
      throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the bidding handler`)
  }
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

function plan(command: AdsCommand, before: ResourceSnapshot): PlanResult {
  const f = before.fields

  switch (command.type) {
    case 'google.campaign.set_bidding_strategy': {
      if (f.status === 'REMOVED') return { ok: false, code: 'resource_removed', message: 'This campaign was removed in Google Ads and cannot be changed.' }
      if (f.advertising_channel_type !== 'SEARCH' && f.advertising_channel_type !== 'DISPLAY') {
        return {
          ok: false,
          code: 'unsupported_campaign_type',
          message: `Bidding strategy changes are only supported for Search and Display campaigns (this campaign is ${f.advertising_channel_type ?? 'an unknown type'}).`,
        }
      }
      if (f.is_portfolio) {
        return {
          ok: false,
          code: 'portfolio_bidding_strategy',
          message: `This campaign uses a shared (portfolio) bidding strategy (${f.bidding_strategy_resource}) — change the strategy on the shared resource, not the campaign.`,
        }
      }
      const expected = expectedBiddingType(command.strategy)
      const diff: DiffEntry[] = [diffField('bidding_strategy_type', 'Bidding strategy', f.bidding_strategy_type, expected)]
      const intended: Record<string, unknown> = { bidding_strategy_type: expected }
      if (command.target_cpa !== undefined) {
        intended.target_cpa = command.target_cpa
        diff.push(
          diffMoney('target_cpa', 'Target CPA', f.bidding_strategy_type === 'MAXIMIZE_CONVERSIONS' ? (f.target_cpa as number | null) : null, command.target_cpa, before.currency),
        )
      }
      if (command.target_roas !== undefined) {
        intended.target_roas = command.target_roas
        diff.push(diffField('target_roas', 'Target ROAS', f.bidding_strategy_type === 'MAXIMIZE_CONVERSION_VALUE' ? (f.target_roas as number | null) : null, command.target_roas))
      }
      if (command.cpc_bid_ceiling !== undefined) {
        intended.cpc_bid_ceiling = command.cpc_bid_ceiling
        diff.push(
          diffMoney('cpc_bid_ceiling', 'CPC bid ceiling', f.bidding_strategy_type === 'TARGET_SPEND' ? (f.cpc_bid_ceiling as number | null) : null, command.cpc_bid_ceiling, before.currency),
        )
      }
      const changes = effective(diff)
      if (changes.length === 0) return noOp()
      return {
        ok: true,
        intended,
        diff: changes,
        warnings: ["Changing the bidding strategy resets Google's learning period — expect volatile performance for a few days while it relearns."],
        facts: { biddingChange: true },
      }
    }

    case 'google.campaign.set_cpc_bid_ceiling': {
      if (f.status === 'REMOVED') return { ok: false, code: 'resource_removed', message: 'This campaign was removed in Google Ads and cannot be changed.' }
      if (f.bidding_strategy_type !== 'TARGET_SPEND') {
        return {
          ok: false,
          code: 'incompatible_bidding_strategy',
          message: `This campaign uses ${f.bidding_strategy_type ?? 'an unknown'} bidding — a CPC bid ceiling only applies to Maximize Clicks.`,
        }
      }
      const diff = effective([diffMoney('cpc_bid_ceiling', 'CPC bid ceiling', f.cpc_bid_ceiling as number | null, command.cpc_bid_ceiling, before.currency)])
      if (diff.length === 0) return noOp()
      return { ok: true, intended: { cpc_bid_ceiling: command.cpc_bid_ceiling }, diff, warnings: [], facts: { biddingChange: true } }
    }

    case 'google.campaign.set_total_budget': {
      if (!f.budget_id) return { ok: false, code: 'no_budget', message: 'This campaign has no campaign budget to change.' }
      if (f.status === 'REMOVED') return { ok: false, code: 'resource_removed', message: 'This campaign was removed in Google Ads and cannot be changed.' }
      if (!f.end_date_time) {
        return {
          ok: false,
          code: 'campaign_missing_end_date',
          message: "A total (lifetime) budget requires the campaign to have an end date — set one first with google.campaign.set_dates.",
        }
      }
      const warnings: string[] = []
      const refs = Number(f.budget_reference_count ?? 1)
      if (f.budget_shared || refs > 1) {
        warnings.push(`This budget is shared by ${refs} campaigns — changing it changes the total budget of all of them.`)
      }
      if (f.budget_period && f.budget_period !== 'CUSTOM_PERIOD') {
        warnings.push('This campaign currently uses a daily budget — switching to a total budget changes how Google paces spend for the rest of the campaign.')
      }
      const after = Number(toMicros(command.total_budget)) / MICROS
      const diff = effective([diffMoney('total_budget', 'Total budget', f.total_budget as number | null, after, before.currency)])
      if (diff.length === 0) return noOp()
      const days = daysBetween(f.start_date_time as string | undefined, f.end_date_time as string)
      warnings.push(
        days
          ? `This is a total (lifetime) budget, not a daily one — implied average at the current schedule: ~${formatCurrency(after / days, before.currency)}/day over ${days} day(s).`
          : 'This is a total (lifetime) budget, not a daily one — the actual daily spend will vary.',
      )
      return { ok: true, intended: { total_budget: after }, diff, warnings, facts: {} }
    }

    case 'google.campaign.add_proximity': {
      if (f.campaign_status === 'REMOVED') return { ok: false, code: 'campaign_removed', message: 'The parent campaign was removed in Google Ads.' }
      if (f.existing_criterion_id) {
        return { ok: false, code: 'already_exists', message: `An identical radius target already exists (criterion ${f.existing_criterion_id}).` }
      }
      const roundedLat = microDegrees(command.latitude) / MICRO_DEGREES
      const roundedLng = microDegrees(command.longitude) / MICRO_DEGREES
      return {
        ok: true,
        intended: { latitude: roundedLat, longitude: roundedLng, radius: command.radius, radius_units: command.radius_units },
        diff: [diffField('proximity', 'Radius targeting', null, `${command.radius} ${command.radius_units} @ (${roundedLat}, ${roundedLng})`)],
        warnings: [],
        facts: {},
      }
    }

    case 'google.campaign.remove_proximity':
      return {
        ok: true,
        intended: { exists: false },
        diff: [diffField('proximity', 'Radius targeting', `${f.radius} ${f.radius_units}`, null)],
        warnings: [],
        facts: {},
      }

    case 'google.keyword.remove': {
      if (f.type && f.type !== 'KEYWORD') return { ok: false, code: 'not_a_keyword', message: `This criterion is a ${f.type}, not a keyword.` }
      if (f.negative) return { ok: false, code: 'is_negative_keyword', message: 'This is a negative keyword — use google.negative_keyword.remove instead.' }
      if (f.status === 'REMOVED') return { ok: false, code: 'resource_removed', message: 'This keyword was already removed in Google Ads.' }
      const label = `[${f.match_type}] ${f.text}`
      return {
        ok: true,
        intended: { exists: false },
        diff: [diffField('keyword', 'Keyword', label, null)],
        warnings: [
          'Removing a keyword is permanent in Google Ads — history stays on the removed criterion. Rollback re-adds a new keyword with the same text and match type, not the original criterion.',
        ],
        facts: {},
      }
    }

    case 'google.campaign.create_display': {
      if (f.existing_campaign_id) {
        return { ok: false, code: 'already_exists', message: `A campaign named "${command.name}" already exists (campaign ${f.existing_campaign_id}).` }
      }
      const afterBudget = Number(toMicros(command.daily_budget)) / MICROS
      const diff: DiffEntry[] = [
        diffField('name', 'Campaign name', null, command.name),
        diffMoney('daily_budget', 'Daily budget', null, afterBudget, before.currency),
        diffField('bidding', 'Bidding strategy', null, command.bidding),
      ]
      if (command.target_cpa !== undefined) diff.push(diffMoney('target_cpa', 'Target CPA', null, command.target_cpa, before.currency))
      diff.push(diffField('locations', 'Locations', null, command.location_ids.length))
      if (command.language_ids.length > 0) diff.push(diffField('languages', 'Languages', null, command.language_ids.length))
      return {
        ok: true,
        intended: { name: command.name, daily_budget: afterBudget, status: 'PAUSED' },
        diff,
        warnings: [],
        facts: { budgetAfter: afterBudget, biddingChange: command.target_cpa !== undefined },
      }
    }

    case 'google.ad_group.create_display': {
      if (f.campaign_status === 'REMOVED') return { ok: false, code: 'campaign_removed', message: 'The parent campaign was removed in Google Ads.' }
      if (f.campaign_channel_type !== 'DISPLAY') {
        return {
          ok: false,
          code: 'campaign_not_display',
          message: `The parent campaign is a ${f.campaign_channel_type ?? 'non-Display'} campaign — Display ad groups can only be created under Display campaigns.`,
        }
      }
      if (f.existing_ad_group_id) {
        return { ok: false, code: 'already_exists', message: `An ad group named "${command.name}" already exists in this campaign (ad group ${f.existing_ad_group_id}).` }
      }
      const intended: Record<string, unknown> = { name: command.name, status: 'PAUSED' }
      const diff: DiffEntry[] = [diffField('name', 'Ad group name', null, command.name), diffField('status', 'Status', null, 'PAUSED')]
      if (command.cpc_bid !== undefined) {
        intended.cpc_bid = command.cpc_bid
        diff.push(diffMoney('cpc_bid', 'Max CPC', null, command.cpc_bid, before.currency))
      }
      return { ok: true, intended, diff, warnings: [], facts: { biddingChange: command.cpc_bid !== undefined } }
    }

    default:
      return { ok: false, code: 'unsupported_command', message: `${(command as { type: string }).type} is not implemented by the bidding handler.` }
  }
}

// ─── Operations ───────────────────────────────────────────────────────────────

function buildOperation(
  command: AdsCommand,
  before: ResourceSnapshot,
  customerId: string,
): { service: GAdsMutateService; operation: unknown } {
  const c = `customers/${customerId}`

  switch (command.type) {
    case 'google.campaign.set_bidding_strategy': {
      const resourceName = `${c}/campaigns/${command.campaign_id}`
      if (command.strategy === 'MANUAL_CPC') {
        return { service: 'campaigns', operation: { update: { resourceName, manualCpc: {} }, updateMask: 'manualCpc' } }
      }
      if (command.strategy === 'MAXIMIZE_CLICKS') {
        const hasCeiling = command.cpc_bid_ceiling !== undefined
        return {
          service: 'campaigns',
          operation: {
            update: { resourceName, targetSpend: hasCeiling ? { cpcBidCeilingMicros: toMicros(command.cpc_bid_ceiling as number) } : {} },
            updateMask: hasCeiling ? 'targetSpend.cpcBidCeilingMicros' : 'targetSpend',
          },
        }
      }
      if (command.strategy === 'MAXIMIZE_CONVERSIONS') {
        const hasCpa = command.target_cpa !== undefined
        return {
          service: 'campaigns',
          operation: {
            update: { resourceName, maximizeConversions: hasCpa ? { targetCpaMicros: toMicros(command.target_cpa as number) } : {} },
            updateMask: hasCpa ? 'maximizeConversions.targetCpaMicros' : 'maximizeConversions',
          },
        }
      }
      // MAXIMIZE_CONVERSION_VALUE
      const hasRoas = command.target_roas !== undefined
      return {
        service: 'campaigns',
        operation: {
          update: { resourceName, maximizeConversionValue: hasRoas ? { targetRoas: command.target_roas } : {} },
          updateMask: hasRoas ? 'maximizeConversionValue.targetRoas' : 'maximizeConversionValue',
        },
      }
    }

    case 'google.campaign.set_cpc_bid_ceiling':
      return {
        service: 'campaigns',
        operation: {
          update: { resourceName: `${c}/campaigns/${command.campaign_id}`, targetSpend: { cpcBidCeilingMicros: toMicros(command.cpc_bid_ceiling) } },
          updateMask: 'targetSpend.cpcBidCeilingMicros',
        },
      }

    case 'google.campaign.set_total_budget':
      return {
        service: 'campaignBudgets',
        operation: {
          update: { resourceName: `${c}/campaignBudgets/${before.fields.budget_id}`, totalAmountMicros: toMicros(command.total_budget), period: 'CUSTOM_PERIOD' },
          updateMask: 'totalAmountMicros,period',
        },
      }

    case 'google.campaign.add_proximity':
      return {
        service: 'campaignCriteria',
        operation: {
          create: {
            campaign: `${c}/campaigns/${command.campaign_id}`,
            proximity: {
              geoPoint: { latitudeInMicroDegrees: microDegrees(command.latitude), longitudeInMicroDegrees: microDegrees(command.longitude) },
              radius: command.radius,
              radiusUnits: command.radius_units,
            },
          },
        },
      }

    case 'google.campaign.remove_proximity':
      return { service: 'campaignCriteria', operation: { remove: `${c}/campaignCriteria/${command.campaign_id}~${command.criterion_id}` } }

    case 'google.keyword.remove':
      return { service: 'adGroupCriteria', operation: { remove: `${c}/adGroupCriteria/${command.ad_group_id}~${command.criterion_id}` } }

    case 'google.ad_group.create_display':
      return {
        service: 'adGroups',
        operation: {
          create: {
            campaign: `${c}/campaigns/${command.campaign_id}`,
            name: command.name,
            status: 'PAUSED',
            type: 'DISPLAY_STANDARD',
            ...(command.cpc_bid !== undefined ? { cpcBidMicros: toMicros(command.cpc_bid) } : {}),
          },
        },
      }

    case 'google.campaign.create_display':
      // Built as a multi-service googleAds:mutate batch (buildCreateDisplayOperations), never reaches this function.
      throw new Error('google.campaign.create_display does not use buildOperation')

    default:
      throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the bidding handler's buildOperation`)
  }
}

/**
 * `google.campaign.create_display` is one atomic googleAds:mutate batch: a
 * budget, the campaign referencing it, and one campaignCriterion per location
 * / language — same pattern as google.campaign.create_search in
 * google-adapter.ts, but advertisingChannelType DISPLAY and no
 * networkSettings (Display uses the content network, not search flags).
 */
function buildCreateDisplayOperations(command: CommandOf<'google.campaign.create_display'>, customerId: string): unknown[] {
  const c = `customers/${customerId}`
  const budgetResourceName = `${c}/campaignBudgets/-1`
  const campaignResourceName = `${c}/campaigns/-2`

  const bidding: Record<string, unknown> =
    command.bidding === 'MAXIMIZE_CONVERSIONS'
      ? { maximizeConversions: command.target_cpa !== undefined ? { targetCpaMicros: toMicros(command.target_cpa) } : {} }
      : command.bidding === 'MAXIMIZE_CLICKS'
        ? { targetSpend: {} }
        : { manualCpc: {} }

  return [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResourceName,
          name: `${command.name} budget ${Date.now()}`,
          amountMicros: toMicros(command.daily_budget),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignResourceName,
          name: command.name,
          status: 'PAUSED',
          advertisingChannelType: 'DISPLAY',
          campaignBudget: budgetResourceName,
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          ...(command.start_date_time ? { startDateTime: command.start_date_time } : {}),
          ...(command.end_date_time ? { endDateTime: command.end_date_time } : {}),
          ...bidding,
        },
      },
    },
    ...command.location_ids.map((geoTargetConstantId) => ({
      campaignCriterionOperation: {
        create: { campaign: campaignResourceName, location: { geoTargetConstant: `geoTargetConstants/${geoTargetConstantId}` } },
      },
    })),
    ...command.language_ids.map((languageConstantId) => ({
      campaignCriterionOperation: {
        create: { campaign: campaignResourceName, language: { languageConstant: `languageConstants/${languageConstantId}` } },
      },
    })),
  ]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const biddingHandler: CommandHandler = {
  platform: 'google',
  types: [
    'google.campaign.set_bidding_strategy',
    'google.campaign.set_cpc_bid_ceiling',
    'google.campaign.set_total_budget',
    'google.campaign.add_proximity',
    'google.campaign.remove_proximity',
    'google.keyword.remove',
    'google.campaign.create_display',
    'google.ad_group.create_display',
  ],

  snapshot,
  plan,

  async validate(ctx, command, before) {
    if (command.type === 'google.campaign.create_display') {
      const operations = buildCreateDisplayOperations(command, ctx.adAccountId)
      await googleAdsMutate(ctx.adAccountId, refreshToken(ctx), operations, { validateOnly: true })
      return
    }
    const { service, operation } = buildOperation(command, before, ctx.adAccountId)
    await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation], { validateOnly: true })
  },

  async execute(ctx, command, before): Promise<ExecuteResult> {
    if (command.type === 'google.campaign.create_display') {
      const operations = buildCreateDisplayOperations(command, ctx.adAccountId)
      const res = await googleAdsMutate(ctx.adAccountId, refreshToken(ctx), operations)
      const campaignRef = res.mutateOperationResponses?.find((r) => r.campaignResult?.resourceName)?.campaignResult?.resourceName ?? null
      return { providerRef: campaignRef, raw: res }
    }
    const { service, operation } = buildOperation(command, before, ctx.adAccountId)
    const res = await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation])
    return { providerRef: res.results?.[0]?.resourceName ?? null, raw: res }
  },

  async verify(ctx, command, intended, providerRef): Promise<VerifyResult> {
    let observed: Record<string, unknown> | null = null

    switch (command.type) {
      case 'google.campaign.set_bidding_strategy': {
        const row = await readCampaignBidding(ctx, command.campaign_id)
        if (row) {
          const expected = intended.bidding_strategy_type as string
          const obs: Record<string, unknown> = { bidding_strategy_type: row.campaign.biddingStrategyType ?? null }
          if ('target_cpa' in intended) obs.target_cpa = expected === 'MAXIMIZE_CONVERSIONS' ? fromMicros(row.campaign.maximizeConversions?.targetCpaMicros) : null
          if ('target_roas' in intended) obs.target_roas = expected === 'MAXIMIZE_CONVERSION_VALUE' ? numOrNull(row.campaign.maximizeConversionValue?.targetRoas) : null
          if ('cpc_bid_ceiling' in intended) obs.cpc_bid_ceiling = expected === 'TARGET_SPEND' ? fromMicros(row.campaign.targetSpend?.cpcBidCeilingMicros) : null
          observed = obs
        }
        break
      }

      case 'google.campaign.set_cpc_bid_ceiling': {
        const row = await readCampaignBidding(ctx, command.campaign_id)
        observed = row ? { cpc_bid_ceiling: fromMicros(row.campaign.targetSpend?.cpcBidCeilingMicros) } : null
        break
      }

      case 'google.campaign.set_total_budget': {
        const row = await readCampaignBudgetInfo(ctx, command.campaign_id)
        observed = row ? { total_budget: fromMicros(row.campaignBudget?.totalAmountMicros) } : null
        break
      }

      case 'google.campaign.add_proximity': {
        const criterionId = criterionIdFromResourceName(providerRef)
        const proximities = criterionId ? await listCampaignProximities(ctx, command.campaign_id) : []
        const found = proximities.find((p) => p.criterion_id === criterionId)
        observed = found
          ? { latitude: (found.latitude_micro ?? 0) / MICRO_DEGREES, longitude: (found.longitude_micro ?? 0) / MICRO_DEGREES, radius: found.radius, radius_units: found.radius_units }
          : null
        break
      }

      case 'google.campaign.remove_proximity': {
        const proximities = await listCampaignProximities(ctx, command.campaign_id)
        observed = { exists: proximities.some((p) => p.criterion_id === command.criterion_id) }
        break
      }

      case 'google.keyword.remove': {
        const row = await readKeywordCriterion(ctx, command.ad_group_id, command.criterion_id)
        observed = { exists: Boolean(row && row.adGroupCriterion.status !== 'REMOVED') }
        break
      }

      case 'google.campaign.create_display': {
        const campaignId = campaignIdFromResourceName(providerRef)
        const row = campaignId ? await readCampaignReadBack(ctx, campaignId) : null
        observed = row ? { name: row.campaign.name, status: row.campaign.status, daily_budget: fromMicros(row.campaignBudget?.amountMicros) } : null
        break
      }

      case 'google.ad_group.create_display': {
        const adGroupId = adGroupIdFromResourceName(providerRef)
        const row = adGroupId ? await readAdGroupReadBack(ctx, adGroupId) : null
        observed = row ? { name: row.adGroup.name, status: row.adGroup.status, cpc_bid: fromMicros(row.adGroup.cpcBidMicros) } : null
        break
      }

      default:
        throw new AdsValidationError(`${(command as { type: string }).type} is not handled by the bidding handler's verify`)
    }

    if (!observed) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
    const mismatches = compareFields(intended, observed)
    return { ok: mismatches.length === 0, mismatches, observed }
  },

  buildRollback(command, before, providerRef) {
    const f = before.fields
    const base = { platform: 'google' as const, ad_account_id: command.ad_account_id }

    switch (command.type) {
      case 'google.campaign.set_bidding_strategy': {
        const prevType = f.bidding_strategy_type as string | null
        switch (prevType) {
          case 'MANUAL_CPC':
            return { ...base, type: command.type, campaign_id: command.campaign_id, strategy: 'MANUAL_CPC' }
          case 'TARGET_SPEND':
            return {
              ...base,
              type: command.type,
              campaign_id: command.campaign_id,
              strategy: 'MAXIMIZE_CLICKS',
              ...(typeof f.cpc_bid_ceiling === 'number' && f.cpc_bid_ceiling > 0 ? { cpc_bid_ceiling: f.cpc_bid_ceiling } : {}),
            }
          case 'MAXIMIZE_CONVERSIONS':
          case 'TARGET_CPA':
            return {
              ...base,
              type: command.type,
              campaign_id: command.campaign_id,
              strategy: 'MAXIMIZE_CONVERSIONS',
              ...(typeof f.target_cpa === 'number' && f.target_cpa > 0 ? { target_cpa: f.target_cpa } : {}),
            }
          case 'MAXIMIZE_CONVERSION_VALUE':
          case 'TARGET_ROAS':
            return {
              ...base,
              type: command.type,
              campaign_id: command.campaign_id,
              strategy: 'MAXIMIZE_CONVERSION_VALUE',
              ...(typeof f.target_roas === 'number' && f.target_roas > 0 ? { target_roas: f.target_roas } : {}),
            }
          default:
            // e.g. TARGET_IMPRESSION_SHARE, COMMISSION, PERCENT_CPC — not expressible via this catalog command.
            return null
        }
      }

      case 'google.campaign.set_cpc_bid_ceiling':
        return typeof f.cpc_bid_ceiling === 'number' && f.cpc_bid_ceiling > 0
          ? { ...base, type: command.type, campaign_id: command.campaign_id, cpc_bid_ceiling: f.cpc_bid_ceiling }
          : null

      case 'google.campaign.set_total_budget':
        return f.budget_period === 'CUSTOM_PERIOD' && typeof f.total_budget === 'number' && f.total_budget > 0
          ? { ...base, type: command.type, campaign_id: command.campaign_id, total_budget: f.total_budget }
          : null

      case 'google.campaign.add_proximity': {
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId ? { ...base, type: 'google.campaign.remove_proximity', campaign_id: command.campaign_id, criterion_id: criterionId } : null
      }

      case 'google.campaign.remove_proximity':
        return typeof f.latitude === 'number' && typeof f.longitude === 'number' && typeof f.radius === 'number' && typeof f.radius_units === 'string'
          ? {
              ...base,
              type: 'google.campaign.add_proximity',
              campaign_id: command.campaign_id,
              latitude: f.latitude,
              longitude: f.longitude,
              radius: f.radius,
              radius_units: f.radius_units as 'KILOMETERS' | 'MILES',
            }
          : null

      case 'google.keyword.remove':
        return typeof f.text === 'string' && f.text.length > 0
          ? {
              ...base,
              type: 'google.keyword.add',
              ad_group_id: command.ad_group_id,
              text: f.text,
              match_type: (f.match_type as 'EXACT' | 'PHRASE' | 'BROAD') ?? 'EXACT',
              ...(typeof f.cpc_bid === 'number' && f.cpc_bid > 0 ? { cpc_bid: f.cpc_bid } : {}),
            }
          : null

      // Structural creates have no rollback: the object is created PAUSED, so
      // nothing was spending before or after. Undoing one means pausing
      // (already paused) or deleting it by hand — removal is irreversible in
      // Google Ads, so it's never automatic.
      case 'google.campaign.create_display':
      case 'google.ad_group.create_display':
        return null

      default:
        return null
    }
  },
}
