// Meta Marketing API implementation of the command-engine adapter contract.
//
// Every snapshot also checks that the object belongs to the ad account the
// command names: one Meta user token usually reaches many ad accounts, so
// without this check a command scoped to account A could edit a campaign in
// account B that the same token happens to see.

import { isAuthError } from '../connection-health'
import { COMMAND_CATALOG, type AdsCommand } from '../commands/catalog'
import type { DiffEntry, PlanResult, PolicyFacts, ResourceSnapshot } from '../commands/types'
import { minorUnitsPerMajor, toMetaMinorUnits } from '../currency'
import { getAdAccountInfo, getObject, MetaAdsError, updateObject } from '../meta-api'
import { AdsValidationError } from '../validation'
import { compareFields, diffField, diffMoney, effective } from './diff'
import type { AdapterContext, AdsProviderAdapter, Capability, ErrorClass, ExecuteResult, VerifyResult } from './types'

type MetaCommand = Extract<AdsCommand, { platform: 'meta' }>

function isMeta(cmd: AdsCommand): cmd is MetaCommand {
  return cmd.platform === 'meta'
}

function fromMinor(value: string | number | null | undefined, currency: string): number | null {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return null
  return Number(value) / minorUnitsPerMajor(currency)
}

function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(ms) ? value : new Date(ms).toISOString()
}

/** "act_123" and "123" name the same account. */
function sameAccount(accountId: string | undefined, ctxAccount: string): boolean {
  return !!accountId && accountId.replace(/^act_/, '') === ctxAccount.replace(/^act_/, '')
}

type MetaCampaignNode = {
  id: string
  name: string
  status: string
  account_id?: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
  spend_cap?: string
  bid_strategy?: string
}

type Targeting = Record<string, unknown> & {
  age_min?: number
  age_max?: number
  genders?: number[]
  geo_locations?: Record<string, unknown> & { countries?: string[] }
  publisher_platforms?: string[]
  targeting_automation?: { advantage_audience?: number }
}

type MetaAdSetNode = {
  id: string
  name: string
  status: string
  account_id?: string
  campaign_id?: string
  daily_budget?: string
  lifetime_budget?: string
  bid_amount?: string | number
  bid_strategy?: string
  end_time?: string
  targeting?: Targeting
  campaign?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string; bid_strategy?: string }
}

type MetaAdNode = { id: string; name: string; status: string; account_id?: string; adset_id?: string; campaign_id?: string }

const CAMPAIGN_FIELDS = 'id,name,status,account_id,objective,daily_budget,lifetime_budget,spend_cap,bid_strategy'
const ADSET_FIELDS =
  'id,name,status,account_id,campaign_id,daily_budget,lifetime_budget,bid_amount,bid_strategy,end_time,targeting,campaign{id,name,daily_budget,lifetime_budget,bid_strategy}'
const AD_FIELDS = 'id,name,status,account_id,adset_id,campaign_id'

async function currencyOf(ctx: AdapterContext): Promise<string> {
  const info = await getAdAccountInfo(ctx.adAccountId, ctx.credential)
  return info.currency ?? 'USD'
}

/** A Graph 100/33 ("does not exist or no permission") is "not found", not a failure. */
function isNotFound(error: unknown): boolean {
  return error instanceof MetaAdsError && error.code === 100 && (error.subcode === 33 || /does not exist/i.test(error.message))
}

async function readNode<T>(id: string, fields: string, ctx: AdapterContext): Promise<T | null> {
  try {
    return await getObject<T>(id, fields, ctx.credential)
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

function targetingFields(t: Targeting | undefined): Record<string, unknown> {
  return {
    age_min: t?.age_min ?? null,
    age_max: t?.age_max ?? null,
    genders: t?.genders ?? [],
    countries: t?.geo_locations?.countries ?? [],
    publisher_platforms: t?.publisher_platforms ?? null,
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshotMeta(ctx: AdapterContext, cmd: MetaCommand): Promise<ResourceSnapshot | null> {
  switch (cmd.type) {
    case 'meta.campaign.set_status':
    case 'meta.campaign.rename':
    case 'meta.campaign.set_daily_budget':
    case 'meta.campaign.set_spend_cap': {
      const [node, currency] = await Promise.all([readNode<MetaCampaignNode>(cmd.campaign_id, CAMPAIGN_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      const base = { resourceType: 'campaign' as const, resourceId: node.id, resourceName: node.name, campaignId: node.id, currency }
      switch (cmd.type) {
        case 'meta.campaign.set_status':
          return { ...base, fields: { status: node.status } }
        case 'meta.campaign.rename':
          return { ...base, fields: { name: node.name } }
        case 'meta.campaign.set_daily_budget':
          return {
            ...base,
            fields: {
              daily_budget: fromMinor(node.daily_budget, currency),
              lifetime_budget: fromMinor(node.lifetime_budget, currency),
            },
          }
        case 'meta.campaign.set_spend_cap':
          return { ...base, fields: { spend_cap: fromMinor(node.spend_cap, currency) } }
      }
      break
    }

    case 'meta.adset.set_status':
    case 'meta.adset.rename':
    case 'meta.adset.set_daily_budget':
    case 'meta.adset.set_bid_amount':
    case 'meta.adset.set_end_time':
    case 'meta.adset.update_targeting': {
      const [node, currency] = await Promise.all([readNode<MetaAdSetNode>(cmd.adset_id, ADSET_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      const base = {
        resourceType: 'adset' as const,
        resourceId: node.id,
        resourceName: node.name,
        campaignId: node.campaign_id ?? node.campaign?.id ?? null,
        currency,
      }
      switch (cmd.type) {
        case 'meta.adset.set_status':
          return { ...base, fields: { status: node.status } }
        case 'meta.adset.rename':
          return { ...base, fields: { name: node.name } }
        case 'meta.adset.set_daily_budget':
          return {
            ...base,
            fields: {
              daily_budget: fromMinor(node.daily_budget, currency),
              lifetime_budget: fromMinor(node.lifetime_budget, currency),
              campaign_budget_optimization: Boolean(node.campaign?.daily_budget || node.campaign?.lifetime_budget),
            },
          }
        case 'meta.adset.set_bid_amount':
          return {
            ...base,
            fields: {
              bid_amount: fromMinor(node.bid_amount, currency),
              bid_strategy: node.bid_strategy ?? node.campaign?.bid_strategy ?? null,
            },
          }
        case 'meta.adset.set_end_time':
          return { ...base, fields: { end_time: normalizeTime(node.end_time) } }
        case 'meta.adset.update_targeting':
          // The full targeting spec is part of the hashed state: the write
          // sends the merged object back, so any concurrent edit to it must
          // invalidate an approved change.
          return { ...base, fields: { ...targetingFields(node.targeting), targeting: node.targeting ?? {} } }
      }
      break
    }

    case 'meta.ad.set_status':
    case 'meta.ad.rename': {
      const [node, currency] = await Promise.all([readNode<MetaAdNode>(cmd.ad_id, AD_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      const base = { resourceType: 'ad' as const, resourceId: node.id, resourceName: node.name, campaignId: node.campaign_id ?? null, currency }
      return cmd.type === 'meta.ad.set_status' ? { ...base, fields: { status: node.status } } : { ...base, fields: { name: node.name } }
    }
  }
  return null
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

function mergeTargeting(before: Targeting, cmd: CommandFor<'meta.adset.update_targeting'>): Targeting {
  const next: Targeting = structuredClone(before ?? {})
  if (cmd.age_min !== undefined) next.age_min = cmd.age_min
  if (cmd.age_max !== undefined) next.age_max = cmd.age_max
  if (cmd.genders !== undefined) {
    if (cmd.genders.length === 0) delete next.genders
    else next.genders = [...cmd.genders]
  }
  if (cmd.countries !== undefined) next.geo_locations = { ...(next.geo_locations ?? {}), countries: [...cmd.countries] }
  if (cmd.publisher_platforms !== undefined) next.publisher_platforms = [...cmd.publisher_platforms]
  return next
}

type CommandFor<T extends MetaCommand['type']> = Extract<MetaCommand, { type: T }>

function planMeta(cmd: MetaCommand, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  const warnings: string[] = []
  const done = (intended: Record<string, unknown>, diff: DiffEntry[], facts: PolicyFacts = {}): PlanResult => {
    const changes = effective(diff)
    if (changes.length === 0) return { ok: false, code: 'no_op', message: 'The resource already has this value — nothing to change.' }
    return { ok: true, intended, diff: changes, warnings, facts }
  }
  const locked = f.status === 'DELETED' || f.status === 'ARCHIVED'

  switch (cmd.type) {
    case 'meta.campaign.set_status':
    case 'meta.adset.set_status':
    case 'meta.ad.set_status':
      if (locked) return { ok: false, code: 'resource_archived', message: `This object is ${f.status} in Meta and cannot be reactivated.` }
      return done({ status: cmd.status }, [diffField('status', 'Status', f.status, cmd.status)], {
        enables: cmd.status === 'ACTIVE' && f.status !== 'ACTIVE',
      })

    case 'meta.campaign.rename':
    case 'meta.adset.rename':
    case 'meta.ad.rename':
      return done({ name: cmd.name }, [diffField('name', 'Name', f.name, cmd.name)])

    case 'meta.campaign.set_daily_budget': {
      if (f.lifetime_budget) return { ok: false, code: 'lifetime_budget', message: 'This campaign uses a lifetime budget; a daily budget cannot be set on it.' }
      if (!f.daily_budget) {
        return {
          ok: false,
          code: 'adset_budgets',
          message: 'This campaign uses ad set budgets (no Advantage campaign budget). Change the budget on its ad sets with meta.adset.set_daily_budget.',
        }
      }
      const after = toMetaMinorUnits(cmd.daily_budget, before.currency) / minorUnitsPerMajor(before.currency)
      return done({ daily_budget: after }, [diffMoney('daily_budget', 'Daily budget', f.daily_budget as number, after, before.currency)], {
        budgetBefore: f.daily_budget as number,
        budgetAfter: after,
      })
    }

    case 'meta.adset.set_daily_budget': {
      if (f.campaign_budget_optimization) {
        return {
          ok: false,
          code: 'campaign_budget',
          message: 'The parent campaign uses an Advantage campaign budget (CBO); change the budget on the campaign with meta.campaign.set_daily_budget.',
        }
      }
      if (f.lifetime_budget) return { ok: false, code: 'lifetime_budget', message: 'This ad set uses a lifetime budget; a daily budget cannot be set on it.' }
      const after = toMetaMinorUnits(cmd.daily_budget, before.currency) / minorUnitsPerMajor(before.currency)
      return done({ daily_budget: after }, [diffMoney('daily_budget', 'Daily budget', f.daily_budget as number | null, after, before.currency)], {
        budgetBefore: f.daily_budget as number | null,
        budgetAfter: after,
      })
    }

    case 'meta.campaign.set_spend_cap': {
      const after = toMetaMinorUnits(cmd.spend_cap, before.currency) / minorUnitsPerMajor(before.currency)
      return done({ spend_cap: after }, [diffMoney('spend_cap', 'Spend cap', f.spend_cap as number | null, after, before.currency)])
    }

    case 'meta.adset.set_bid_amount': {
      const strategy = f.bid_strategy as string | null
      if (strategy === 'LOWEST_COST_WITHOUT_CAP' || !strategy) {
        warnings.push('This ad set uses highest-volume (no cap) bidding; Meta requires a bid cap / cost cap strategy for bid_amount to apply.')
      }
      const after = toMetaMinorUnits(cmd.bid_amount, before.currency) / minorUnitsPerMajor(before.currency)
      return done({ bid_amount: after }, [diffMoney('bid_amount', 'Bid amount', f.bid_amount as number | null, after, before.currency)], {
        biddingChange: true,
      })
    }

    case 'meta.adset.set_end_time': {
      const after = new Date(cmd.end_time).toISOString()
      if (Date.parse(after) <= Date.now()) return { ok: false, code: 'end_in_past', message: 'The end time must be in the future.' }
      return done({ end_time: after }, [diffField('end_time', 'End time', f.end_time, after)])
    }

    case 'meta.adset.update_targeting': {
      const targeting = (f.targeting ?? {}) as Targeting
      const next = mergeTargeting(targeting, cmd)
      const intended = targetingFields(next)
      const labels: Record<string, string> = {
        age_min: 'Minimum age',
        age_max: 'Maximum age',
        genders: 'Genders',
        countries: 'Countries',
        publisher_platforms: 'Placements (platforms)',
      }
      const diff = Object.keys(labels).map((k) => diffField(k, labels[k], f[k], intended[k]))
      const geo = targeting.geo_locations ?? {}
      if (cmd.countries && Object.keys(geo).some((k) => k !== 'countries' && k !== 'location_types' && Array.isArray(geo[k]) && (geo[k] as unknown[]).length > 0)) {
        warnings.push('This ad set also targets regions/cities/zips; those are kept alongside the new country list.')
      }
      if (cmd.publisher_platforms && !targeting.publisher_platforms) {
        warnings.push('Setting platforms switches this ad set from Advantage+ placements to manual placements.')
      }
      if (targeting.targeting_automation?.advantage_audience === 1 && (cmd.age_max !== undefined || cmd.genders !== undefined)) {
        warnings.push('Advantage+ audience is on: Meta treats age max and gender as suggestions, not hard limits.')
      }
      const changed = Object.fromEntries(effective(diff).map((d) => [d.field, intended[d.field]]))
      return done(changed, diff)
    }
  }
}

// ─── Writes ───────────────────────────────────────────────────────────────────

function buildUpdate(cmd: MetaCommand, before: ResourceSnapshot): { id: string; fields: Record<string, unknown> } {
  const cur = before.currency
  switch (cmd.type) {
    case 'meta.campaign.set_status':
      return { id: cmd.campaign_id, fields: { status: cmd.status } }
    case 'meta.campaign.rename':
      return { id: cmd.campaign_id, fields: { name: cmd.name } }
    case 'meta.campaign.set_daily_budget':
      return { id: cmd.campaign_id, fields: { daily_budget: String(toMetaMinorUnits(cmd.daily_budget, cur)) } }
    case 'meta.campaign.set_spend_cap':
      return { id: cmd.campaign_id, fields: { spend_cap: String(toMetaMinorUnits(cmd.spend_cap, cur)) } }
    case 'meta.adset.set_status':
      return { id: cmd.adset_id, fields: { status: cmd.status } }
    case 'meta.adset.rename':
      return { id: cmd.adset_id, fields: { name: cmd.name } }
    case 'meta.adset.set_daily_budget':
      return { id: cmd.adset_id, fields: { daily_budget: String(toMetaMinorUnits(cmd.daily_budget, cur)) } }
    case 'meta.adset.set_bid_amount':
      return { id: cmd.adset_id, fields: { bid_amount: toMetaMinorUnits(cmd.bid_amount, cur) } }
    case 'meta.adset.set_end_time':
      return { id: cmd.adset_id, fields: { end_time: new Date(cmd.end_time).toISOString() } }
    case 'meta.adset.update_targeting':
      return { id: cmd.adset_id, fields: { targeting: mergeTargeting((before.fields.targeting ?? {}) as Targeting, cmd) } }
    case 'meta.ad.set_status':
      return { id: cmd.ad_id, fields: { status: cmd.status } }
    case 'meta.ad.rename':
      return { id: cmd.ad_id, fields: { name: cmd.name } }
  }
}

// Rate limiting and transient platform faults (Graph API error reference).
const META_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004, 80014])

export const metaAdapter: AdsProviderAdapter = {
  platform: 'meta',

  capabilities(): Capability[] {
    return (Object.entries(COMMAND_CATALOG) as Array<[AdsCommand['type'], (typeof COMMAND_CATALOG)[AdsCommand['type']]]>)
      .filter(([, entry]) => entry.platform === 'meta')
      .map(([type, entry]) => ({ type, label: entry.label, risk: entry.risk }))
  },

  async snapshot(ctx, command) {
    if (!isMeta(command)) throw new AdsValidationError('Not a Meta Ads command')
    return snapshotMeta(ctx, command)
  },

  plan(command, before) {
    if (!isMeta(command)) return { ok: false, code: 'wrong_platform', message: 'Not a Meta Ads command' }
    return planMeta(command, before)
  },

  async validate(ctx, command, before) {
    if (!isMeta(command)) throw new AdsValidationError('Not a Meta Ads command')
    const { id, fields } = buildUpdate(command, before)
    await updateObject(id, fields, ctx.credential, { validateOnly: true })
  },

  async execute(ctx, command, before): Promise<ExecuteResult> {
    if (!isMeta(command)) throw new AdsValidationError('Not a Meta Ads command')
    const { id, fields } = buildUpdate(command, before)
    const res = await updateObject(id, fields, ctx.credential)
    if (res.success === false) throw new MetaAdsError('Meta reported the update as unsuccessful')
    return { providerRef: id, raw: res }
  },

  async verify(ctx, command, intended): Promise<VerifyResult> {
    if (!isMeta(command)) throw new AdsValidationError('Not a Meta Ads command')
    const snap = await snapshotMeta(ctx, command)
    if (!snap) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
    const mismatches = compareFields(intended, snap.fields)
    return { ok: mismatches.length === 0, mismatches, observed: snap.fields }
  },

  buildRollback(command, before): AdsCommand | null {
    if (!isMeta(command)) return null
    const f = before.fields
    const base = { platform: 'meta' as const, ad_account_id: command.ad_account_id }
    const status = f.status === 'ACTIVE' || f.status === 'PAUSED' ? (f.status as 'ACTIVE' | 'PAUSED') : null
    const money = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)

    switch (command.type) {
      case 'meta.campaign.set_status':
        return status ? { ...base, type: command.type, campaign_id: command.campaign_id, status } : null
      case 'meta.adset.set_status':
        return status ? { ...base, type: command.type, adset_id: command.adset_id, status } : null
      case 'meta.ad.set_status':
        return status ? { ...base, type: command.type, ad_id: command.ad_id, status } : null
      case 'meta.campaign.rename':
        return typeof f.name === 'string' ? { ...base, type: command.type, campaign_id: command.campaign_id, name: f.name } : null
      case 'meta.adset.rename':
        return typeof f.name === 'string' ? { ...base, type: command.type, adset_id: command.adset_id, name: f.name } : null
      case 'meta.ad.rename':
        return typeof f.name === 'string' ? { ...base, type: command.type, ad_id: command.ad_id, name: f.name } : null
      case 'meta.campaign.set_daily_budget': {
        const v = money(f.daily_budget)
        return v ? { ...base, type: command.type, campaign_id: command.campaign_id, daily_budget: v } : null
      }
      case 'meta.adset.set_daily_budget': {
        const v = money(f.daily_budget)
        return v ? { ...base, type: command.type, adset_id: command.adset_id, daily_budget: v } : null
      }
      case 'meta.campaign.set_spend_cap': {
        const v = money(f.spend_cap)
        return v ? { ...base, type: command.type, campaign_id: command.campaign_id, spend_cap: v } : null
      }
      case 'meta.adset.set_bid_amount': {
        const v = money(f.bid_amount)
        return v ? { ...base, type: command.type, adset_id: command.adset_id, bid_amount: v } : null
      }
      case 'meta.adset.set_end_time':
        return typeof f.end_time === 'string' && Date.parse(f.end_time) > Date.now()
          ? { ...base, type: command.type, adset_id: command.adset_id, end_time: f.end_time }
          : null
      case 'meta.adset.update_targeting': {
        // Only reversible when every field this change touched had an explicit
        // value before — "automatic placements" or "all countries" can't be
        // expressed as an update_targeting input.
        const back: Record<string, unknown> = {}
        if (command.age_min !== undefined) { if (f.age_min == null) return null; back.age_min = f.age_min }
        if (command.age_max !== undefined) { if (f.age_max == null) return null; back.age_max = f.age_max }
        if (command.genders !== undefined) back.genders = f.genders ?? []
        if (command.countries !== undefined) {
          if (!Array.isArray(f.countries) || f.countries.length === 0) return null
          back.countries = f.countries
        }
        if (command.publisher_platforms !== undefined) {
          if (!Array.isArray(f.publisher_platforms) || f.publisher_platforms.length === 0) return null
          back.publisher_platforms = f.publisher_platforms
        }
        return { ...base, type: command.type, adset_id: command.adset_id, ...back } as AdsCommand
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
    if (error instanceof MetaAdsError) {
      const transient = (error.code != null && META_TRANSIENT_CODES.has(error.code)) || (error.httpStatus ?? 0) >= 500
      return {
        code: `meta_${error.code ?? 'error'}${error.subcode ? `_${error.subcode}` : ''}`,
        message: error.userMessage ? `${error.userMessage} (${error.message})` : error.message,
        transient,
        auth: false,
      }
    }
    if (error instanceof TypeError) return { code: 'network', message: error.message, transient: true, auth: false }
    return { code: 'unknown', message: error instanceof Error ? error.message : String(error), transient: false, auth: false }
  },
}
