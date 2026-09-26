// Google Ads implementation of the command-engine adapter contract.
//
// All reads are GAQL (runGaqlQuery), all writes go through mutateResources —
// the same operation object is built once and sent twice: first with
// validateOnly at preview time, then for real at execution. Nothing here
// interpolates free text into GAQL: ids are asserted numeric by the command
// schema and keyword text is matched in code, never in a WHERE clause.

import { isAuthError } from '../connection-health'
import { COMMAND_CATALOG, type AdsCommand } from '../commands/catalog'
import type { DiffEntry, PlanResult, PolicyFacts, ResourceSnapshot } from '../commands/types'
import { GoogleAdsError, mutateResources, parseTokens, runGaqlQuery, type GAdsMutateService } from '../google-api'
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

function refreshToken(ctx: AdapterContext): string {
  return parseTokens(ctx.credential).refresh_token
}

function isGoogle(cmd: AdsCommand): cmd is GoogleCommand {
  return cmd.platform === 'google'
}

const MANUAL_BIDDING = new Set(['MANUAL_CPC', 'ENHANCED_CPC', 'MANUAL_CPM', 'MANUAL_CPV'])

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
  adGroupAd: { status: string; ad: { id: string; name?: string } }
  adGroup: { id: string; name?: string }
  campaign: { id: string }
  customer?: { currencyCode?: string }
}

async function readAd(ctx: AdapterContext, adGroupId: string, adId: string): Promise<AdRow | null> {
  const rows = await runGaqlQuery<AdRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, ad_group.name,
            campaign.id, customer.currency_code
     FROM ad_group_ad WHERE ad_group.id = ${adGroupId} AND ad_group_ad.ad.id = ${adId} LIMIT 1`,
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
  }
}

// ─── Operations ───────────────────────────────────────────────────────────────

function buildOperation(cmd: GoogleCommand, before: ResourceSnapshot, customerId: string): { service: GAdsMutateService; operation: unknown } {
  const c = `customers/${customerId}`
  const update = (service: GAdsMutateService, resourceName: string, fields: Record<string, unknown>) => ({
    service,
    operation: { update: { resourceName, ...fields }, updateMask: Object.keys(fields).join(',') },
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
  }
}

/** "customers/1/adGroupCriteria/22~33" → "33" */
export function criterionIdFromResourceName(resourceName: string | null): string | null {
  const match = resourceName?.match(/~(\d+)$/)
  return match ? match[1] : null
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const googleAdapter: AdsProviderAdapter = {
  platform: 'google',

  capabilities(): Capability[] {
    return (Object.entries(COMMAND_CATALOG) as Array<[AdsCommand['type'], (typeof COMMAND_CATALOG)[AdsCommand['type']]]>)
      .filter(([, entry]) => entry.platform === 'google')
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
    // A remove has nothing to validate beyond existence, which snapshot proved.
    if (command.type === 'google.negative_keyword.remove') return
    const { service, operation } = buildOperation(command, before, ctx.adAccountId)
    await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation], { validateOnly: true })
  },

  async execute(ctx, command, before): Promise<ExecuteResult> {
    if (!isGoogle(command)) throw new AdsValidationError('Not a Google Ads command')
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

