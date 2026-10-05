// Ad set creation, lifetime budgets, ad set / campaign settings, full targeting replacement.
//
// Implemented as a CommandHandler (see ../handlers.ts): this module owns its
// command types end to end — snapshot, plan, validate, execute, verify,
// rollback — and is composed over the base meta adapter in ../index.ts.
//
// Same conventions as meta-adapter.ts (its own helpers aren't exported, so
// the small ones — sameAccount / readNode / currencyOf / fromMinor /
// normalizeTime — are re-declared here rather than reached into):
//  - every snapshot checks account_id against ctx.adAccountId (one Meta user
//    token usually reaches several ad accounts);
//  - money is always converted through currency.ts's minor-unit helpers;
//  - validate()/execute() route through meta-api.ts's validateOnly /
//    execution_options plumbing, the same as every other Meta write;
//  - creates are always PAUSED and have no automatic rollback.

import type { AdsCommand, AdsCommandType, CommandOf } from '../../commands/catalog'
import type { DiffEntry, PlanResult, PolicyFacts, ResourceSnapshot } from '../../commands/types'
import { minorUnitsPerMajor, toMetaMinorUnits } from '../../currency'
import { createObject, getAdAccountInfo, getObject, listAdSetsDetailed, MetaAdsError, updateObject } from '../../meta-api'
import { AdsValidationError } from '../../validation'
import { compareFields, diffField, diffMoney, effective } from '../diff'
import type { CommandHandler } from '../handlers'
import { noOp } from '../handlers'
import type { AdapterContext, ExecuteResult, VerifyResult } from '../types'

const ADSETS_COMMAND_TYPES = [
  'meta.adset.create',
  'meta.campaign.set_lifetime_budget',
  'meta.adset.set_lifetime_budget',
  'meta.adset.update_settings',
  'meta.adset.replace_targeting',
  'meta.campaign.update_settings',
] as const satisfies readonly AdsCommandType[]

type AdsetsCommand = CommandOf<(typeof ADSETS_COMMAND_TYPES)[number]>

const ADSETS_TYPE_SET = new Set<AdsCommandType>(ADSETS_COMMAND_TYPES)

function isAdsetsCommand(cmd: AdsCommand): cmd is AdsetsCommand {
  return ADSETS_TYPE_SET.has(cmd.type)
}

// ─── Shared Meta helpers (mirrors meta-adapter.ts; nothing there is exported) ──

/** "act_123" and "123" name the same account. */
function sameAccount(accountId: string | undefined, ctxAccount: string): boolean {
  return !!accountId && accountId.replace(/^act_/, '') === ctxAccount.replace(/^act_/, '')
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

async function currencyOf(ctx: AdapterContext): Promise<string> {
  const info = await getAdAccountInfo(ctx.adAccountId, ctx.credential)
  return info.currency ?? 'USD'
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

// ─── Node shapes ────────────────────────────────────────────────────────────

type MetaCampaignNode = {
  id: string
  name: string
  status: string
  account_id?: string
  daily_budget?: string
  lifetime_budget?: string
  special_ad_categories?: string[]
  bid_strategy?: string
}

type MetaAdSetNode = {
  id: string
  name: string
  status: string
  account_id?: string
  campaign_id?: string
  daily_budget?: string
  lifetime_budget?: string
  end_time?: string
  optimization_goal?: string
  destination_type?: string
  dsa_beneficiary?: string
  dsa_payor?: string
  regional_regulated_categories?: string[]
  regional_regulation_identities?: Record<string, string>
  attribution_spec?: Array<Record<string, unknown>>
  targeting?: Record<string, unknown>
  campaign?: { id?: string; daily_budget?: string; lifetime_budget?: string }
}

const CAMPAIGN_FIELDS = 'id,name,status,account_id,daily_budget,lifetime_budget,special_ad_categories,bid_strategy'
const ADSET_FIELDS =
  'id,name,status,account_id,campaign_id,daily_budget,lifetime_budget,end_time,optimization_goal,destination_type,' +
  'dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities,attribution_spec,targeting,' +
  'campaign{id,daily_budget,lifetime_budget}'

// ─── Targeting warning helpers ──────────────────────────────────────────────

/** EEA/EU member states — ads reaching any of these fall under the DSA. */
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
])

/** Countries where Meta asks for regional_regulated_categories / regional_regulation_identities. */
const REGIONAL_REGULATION_COUNTRIES = new Set(['BR', 'SG', 'TW', 'TH', 'AU', 'IN'])

function hasGeoLocations(targeting: Record<string, unknown>): boolean {
  const geo = targeting.geo_locations as Record<string, unknown> | undefined
  if (!geo || typeof geo !== 'object') return false
  return Object.entries(geo).some(([key, value]) => key !== 'location_types' && Array.isArray(value) && value.length > 0)
}

function extractCountries(targeting: Record<string, unknown>): string[] | null {
  const geo = targeting.geo_locations as Record<string, unknown> | undefined
  const countries = geo?.countries
  return Array.isArray(countries) ? (countries as string[]) : null
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

async function snapshotAdsets(ctx: AdapterContext, cmd: AdsetsCommand): Promise<ResourceSnapshot | null> {
  switch (cmd.type) {
    case 'meta.campaign.set_lifetime_budget':
    case 'meta.campaign.update_settings': {
      const [node, currency] = await Promise.all([readNode<MetaCampaignNode>(cmd.campaign_id, CAMPAIGN_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      const base = { resourceType: 'campaign' as const, resourceId: node.id, resourceName: node.name, campaignId: node.id, currency }
      if (cmd.type === 'meta.campaign.set_lifetime_budget') {
        return {
          ...base,
          fields: { status: node.status, daily_budget: fromMinor(node.daily_budget, currency), lifetime_budget: fromMinor(node.lifetime_budget, currency) },
        }
      }
      return { ...base, fields: { status: node.status, special_ad_categories: node.special_ad_categories ?? [] } }
    }

    case 'meta.adset.set_lifetime_budget':
    case 'meta.adset.update_settings':
    case 'meta.adset.replace_targeting': {
      const advancedKeys = cmd.type === 'meta.adset.update_settings' ? Object.keys(cmd.extra_params ?? {}) : []
      const fields = advancedKeys.length > 0 ? `${ADSET_FIELDS},${advancedKeys.join(',')}` : ADSET_FIELDS
      const [node, currency] = await Promise.all([readNode<MetaAdSetNode & Record<string, unknown>>(cmd.adset_id, fields, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      const base = {
        resourceType: 'adset' as const,
        resourceId: node.id,
        resourceName: node.name,
        campaignId: node.campaign_id ?? node.campaign?.id ?? null,
        currency,
      }
      switch (cmd.type) {
        case 'meta.adset.set_lifetime_budget':
          return {
            ...base,
            fields: {
              status: node.status,
              daily_budget: fromMinor(node.daily_budget, currency),
              lifetime_budget: fromMinor(node.lifetime_budget, currency),
              end_time: normalizeTime(node.end_time),
              campaign_budget_optimization: Boolean(node.campaign?.daily_budget || node.campaign?.lifetime_budget),
            },
          }
        case 'meta.adset.update_settings':
          return {
            ...base,
            fields: {
              status: node.status,
              optimization_goal: node.optimization_goal ?? null,
              destination_type: node.destination_type ?? null,
              dsa_beneficiary: node.dsa_beneficiary ?? null,
              dsa_payor: node.dsa_payor ?? null,
              regional_regulated_categories: node.regional_regulated_categories ?? [],
              regional_regulation_identities: node.regional_regulation_identities ?? {},
              attribution_spec: node.attribution_spec ?? [],
              ...Object.fromEntries(advancedKeys.map((key) => [key, node[key] ?? null])),
            },
          }
        case 'meta.adset.replace_targeting':
          return { ...base, fields: { status: node.status, targeting: node.targeting ?? {} } }
        default:
          return null
      }
    }

    case 'meta.adset.create': {
      const [campaign, currency] = await Promise.all([readNode<MetaCampaignNode>(cmd.campaign_id, CAMPAIGN_FIELDS, ctx), currencyOf(ctx)])
      if (!campaign || !sameAccount(campaign.account_id, ctx.adAccountId)) return null
      const adsets = await listAdSetsDetailed(ctx.adAccountId, ctx.credential, cmd.campaign_id)
      const existing = adsets.find((a) => a.status !== 'DELETED' && a.name === cmd.name)
      return {
        resourceType: 'adset',
        resourceId: null,
        resourceName: cmd.name,
        campaignId: cmd.campaign_id,
        currency,
        fields: {
          campaign_status: campaign.status,
          campaign_uses_cbo: Boolean(campaign.daily_budget || campaign.lifetime_budget),
          already_exists: Boolean(existing),
          existing_adset_id: existing?.id ?? null,
          campaign_bid_strategy: campaign.bid_strategy ?? null,
          // Optimization goals already used by live ad sets of this campaign.
          sibling_optimization_goals: [
            ...new Set(adsets.filter((a) => a.status !== 'DELETED' && a.status !== 'ARCHIVED').map((a) => a.optimization_goal).filter(Boolean)),
          ],
          // A promoted object a sibling already uses for the same goal — the
          // pixel/event or page Meta requires for conversion/lead goals.
          sibling_promoted_object:
            adsets.find((a) => a.status !== 'DELETED' && a.optimization_goal === cmd.optimization_goal && a.promoted_object)
              ?.promoted_object ?? null,
          sibling_promoted_object_adset:
            adsets.find((a) => a.status !== 'DELETED' && a.optimization_goal === cmd.optimization_goal && a.promoted_object)?.id ?? null,
        },
      }
    }

    default:
      return null
  }
}

/** Optimization goals Meta refuses without a promoted_object (pixel/event, page or app). */
const GOALS_NEEDING_PROMOTED_OBJECT = new Set(['OFFSITE_CONVERSIONS', 'VALUE', 'LEAD_GENERATION', 'APP_INSTALLS', 'PAGE_LIKES'])

/**
 * The promoted_object a new ad set will be created with: the caller's, or —
 * for goals that require one — the one a sibling ad set with the same goal
 * already uses (same pixel/event or page). null when neither applies.
 */
function effectivePromotedObject(
  cmd: CommandOf<'meta.adset.create'>,
  before: ResourceSnapshot,
): { value: Record<string, unknown> | null; inheritedFrom: string | null } {
  if (cmd.promoted_object) return { value: cmd.promoted_object, inheritedFrom: null }
  if (!GOALS_NEEDING_PROMOTED_OBJECT.has(cmd.optimization_goal)) return { value: null, inheritedFrom: null }
  const sibling = before.fields.sibling_promoted_object as Record<string, unknown> | null | undefined
  return sibling
    ? { value: sibling, inheritedFrom: (before.fields.sibling_promoted_object_adset as string | null) ?? null }
    : { value: null, inheritedFrom: null }
}

// ─── Plan ───────────────────────────────────────────────────────────────────

function planAdsets(cmd: AdsetsCommand, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  const warnings: string[] = []
  const done = (intended: Record<string, unknown>, diff: DiffEntry[], facts: PolicyFacts = {}): PlanResult => {
    const changes = effective(diff)
    if (changes.length === 0) return noOp()
    return { ok: true, intended, diff: changes, warnings, facts }
  }
  const archived = (kind: string): PlanResult => ({ ok: false, code: 'resource_archived', message: `This ${kind} is ${f.status} in Meta and cannot be edited.` })
  const isLocked = f.status === 'DELETED' || f.status === 'ARCHIVED'

  switch (cmd.type) {
    case 'meta.campaign.set_lifetime_budget': {
      if (isLocked) return archived('campaign')
      const usesCbo = f.daily_budget != null || f.lifetime_budget != null
      if (!usesCbo) {
        return {
          ok: false,
          code: 'not_cbo',
          message: 'This campaign uses ad set budgets (no Advantage campaign budget); set lifetime_budget on its ad sets instead with meta.adset.set_lifetime_budget.',
        }
      }
      if (f.daily_budget != null) warnings.push('Switching from a daily budget to a lifetime budget replaces the daily budget entirely.')
      const after = toMetaMinorUnits(cmd.lifetime_budget, before.currency) / minorUnitsPerMajor(before.currency)
      return done(
        { lifetime_budget: after },
        [diffMoney('lifetime_budget', 'Lifetime budget', f.lifetime_budget as number | null, after, before.currency)],
        { budgetBefore: f.lifetime_budget as number | null, budgetAfter: after },
      )
    }

    case 'meta.adset.set_lifetime_budget': {
      if (isLocked) return archived('ad set')
      if (f.campaign_budget_optimization) {
        return {
          ok: false,
          code: 'campaign_budget',
          message: 'The parent campaign uses a campaign budget (CBO); set lifetime_budget on the campaign with meta.campaign.set_lifetime_budget.',
        }
      }
      const endTime = cmd.end_time ? new Date(cmd.end_time).toISOString() : (f.end_time as string | null)
      if (!endTime) {
        return { ok: false, code: 'end_time_required', message: 'This ad set has no end date; provide end_time when giving it a lifetime budget.' }
      }
      if (cmd.end_time && Date.parse(endTime) <= Date.now()) {
        return { ok: false, code: 'end_in_past', message: 'The end time must be in the future.' }
      }
      if (f.daily_budget != null) warnings.push('Switching from a daily budget to a lifetime budget replaces the daily budget entirely.')
      const after = toMetaMinorUnits(cmd.lifetime_budget, before.currency) / minorUnitsPerMajor(before.currency)
      const diff = [diffMoney('lifetime_budget', 'Lifetime budget', f.lifetime_budget as number | null, after, before.currency)]
      const intended: Record<string, unknown> = { lifetime_budget: after }
      if (cmd.end_time) {
        diff.push(diffField('end_time', 'End time', f.end_time, endTime))
        intended.end_time = endTime
      }
      return done(intended, diff, { budgetBefore: f.lifetime_budget as number | null, budgetAfter: after })
    }

    case 'meta.adset.update_settings': {
      if (isLocked) return archived('ad set')
      const labels: Record<string, string> = {
        optimization_goal: 'Optimization goal',
        destination_type: 'Destination type',
        dsa_beneficiary: 'DSA beneficiary',
        dsa_payor: 'DSA payor',
        regional_regulated_categories: 'Regional regulated categories',
        regional_regulation_identities: 'Regional regulation identities',
        attribution_spec: 'Attribution spec',
      }
      const raw = cmd as unknown as Record<string, unknown>
      const intended: Record<string, unknown> = {}
      const diff: DiffEntry[] = []
      for (const key of Object.keys(labels)) {
        const value = raw[key]
        if (value === undefined) continue
        intended[key] = value
        diff.push(diffField(key, labels[key], f[key], value))
      }
      for (const [key, value] of Object.entries(cmd.extra_params ?? {})) {
        intended[key] = value
        diff.push(diffField(key, `Advanced: ${key}`, f[key], value))
      }
      if (cmd.extra_params && Object.keys(cmd.extra_params).length > 0) {
        warnings.push('Advanced parameters are passed directly to Meta and remain subject to account, objective, and API-version eligibility.')
      }
      if (cmd.optimization_goal !== undefined && f.status === 'ACTIVE') {
        warnings.push('Changing optimization_goal on a delivering (ACTIVE) ad set resets its learning phase; Meta may reject the change for an active ad set.')
      }
      return done(intended, diff, { biddingChange: cmd.optimization_goal !== undefined })
    }

    case 'meta.adset.replace_targeting': {
      if (isLocked) return archived('ad set')
      const beforeTargeting = (f.targeting ?? {}) as Record<string, unknown>
      const afterTargeting = cmd.targeting
      const beforeKeys = Object.keys(beforeTargeting)
      const afterKeys = Object.keys(afterTargeting)
      const added = afterKeys.filter((k) => !beforeKeys.includes(k))
      const removed = beforeKeys.filter((k) => !afterKeys.includes(k))
      const changed = afterKeys.filter((k) => beforeKeys.includes(k) && JSON.stringify(beforeTargeting[k]) !== JSON.stringify(afterTargeting[k]))
      if (added.length === 0 && removed.length === 0 && changed.length === 0) return noOp()
      if (removed.includes('geo_locations')) {
        warnings.push('This replaces the targeting spec and drops geo_locations — the ad set will have no location targeting.')
      }
      const parts: string[] = []
      if (added.length) parts.push(`+${added.join(', ')}`)
      if (removed.length) parts.push(`-${removed.join(', ')}`)
      if (changed.length) parts.push(`~${changed.join(', ')}`)
      const diff: DiffEntry[] = [
        {
          field: 'targeting',
          label: 'Targeting',
          before: beforeTargeting,
          after: afterTargeting,
          beforeDisplay: `${beforeKeys.length} field(s)`,
          afterDisplay: parts.join('; '),
        },
      ]
      return { ok: true, intended: { targeting: afterTargeting }, diff, warnings, facts: {} }
    }

    case 'meta.campaign.update_settings': {
      if (isLocked) return archived('campaign')
      const beforeCategories = (f.special_ad_categories ?? []) as string[]
      const afterCategories = cmd.special_ad_categories
      const added = afterCategories.filter((c) => !beforeCategories.includes(c))
      if (added.some((c) => c === 'HOUSING' || c === 'EMPLOYMENT' || c === 'CREDIT')) {
        warnings.push(
          "Adding HOUSING, EMPLOYMENT, or CREDIT restricts the targeting options (age, gender, zip-code radius, and certain interest/behavior categories) available on this campaign's ad sets.",
        )
      }
      return done(
        { special_ad_categories: afterCategories },
        [diffField('special_ad_categories', 'Special ad categories', beforeCategories.length ? beforeCategories : '(none)', afterCategories.length ? afterCategories : '(none)')],
      )
    }

    case 'meta.adset.create': {
      if (f.campaign_status === 'DELETED' || f.campaign_status === 'ARCHIVED') {
        return { ok: false, code: 'campaign_archived', message: `The campaign is ${f.campaign_status} in Meta and cannot receive new ad sets.` }
      }
      if (f.already_exists) {
        return {
          ok: false,
          code: 'already_exists',
          message: `An ad set named "${cmd.name}" already exists in this campaign (${f.existing_adset_id}). Use meta.adset.rename or pick a different name.`,
        }
      }
      const usesCbo = Boolean(f.campaign_uses_cbo)
      if (usesCbo && (cmd.daily_budget !== undefined || cmd.lifetime_budget !== undefined)) {
        return {
          ok: false,
          code: 'campaign_budget',
          message: 'The campaign uses a campaign budget (CBO); ad sets under it cannot carry their own budget. Omit daily_budget and lifetime_budget.',
        }
      }
      // Meta: under a lowest-cost CBO campaign every ad set must share one
      // optimization goal (found by the live smoke test — Meta only says so
      // after a validate round-trip). Say it up front, with the goal to use.
      const siblingGoals = (f.sibling_optimization_goals ?? []) as string[]
      const lowestCost = !f.campaign_bid_strategy || f.campaign_bid_strategy === 'LOWEST_COST_WITHOUT_CAP'
      if (usesCbo && lowestCost && siblingGoals.length > 0 && !siblingGoals.includes(cmd.optimization_goal)) {
        return {
          ok: false,
          code: 'optimization_goal_mismatch',
          message: `This campaign uses a campaign budget with lowest-cost bidding, so every ad set must optimize for the same goal. Existing ad sets use ${siblingGoals.join(', ')} — use optimization_goal ${siblingGoals[0]}, or duplicate the campaign to change it.`,
        }
      }
      if (!usesCbo && cmd.daily_budget === undefined && cmd.lifetime_budget === undefined) {
        return {
          ok: false,
          code: 'budget_required',
          message: 'This campaign has no campaign budget (CBO); provide daily_budget or lifetime_budget for the new ad set.',
        }
      }

      const intended: Record<string, unknown> = {
        name: cmd.name,
        campaign_id: cmd.campaign_id,
        status: 'PAUSED',
        optimization_goal: cmd.optimization_goal,
        billing_event: cmd.billing_event,
        targeting: cmd.targeting,
      }
      const diff: DiffEntry[] = [
        diffField('name', 'Name', null, cmd.name),
        diffField('status', 'Status', null, 'PAUSED'),
        diffField('optimization_goal', 'Optimization goal', null, cmd.optimization_goal),
        diffField('billing_event', 'Billing event', null, cmd.billing_event),
        diffField('targeting', 'Targeting', null, `${Object.keys(cmd.targeting).length} field(s)`),
      ]

      let budgetAfter: number | null = null
      if (cmd.daily_budget !== undefined) {
        budgetAfter = toMetaMinorUnits(cmd.daily_budget, before.currency) / minorUnitsPerMajor(before.currency)
        intended.daily_budget = budgetAfter
        diff.push(diffMoney('daily_budget', 'Daily budget', null, budgetAfter, before.currency))
      }
      if (cmd.lifetime_budget !== undefined) {
        const lifetimeAfter = toMetaMinorUnits(cmd.lifetime_budget, before.currency) / minorUnitsPerMajor(before.currency)
        intended.lifetime_budget = lifetimeAfter
        diff.push(diffMoney('lifetime_budget', 'Lifetime budget', null, lifetimeAfter, before.currency))
      }
      if (cmd.start_time) {
        const start = new Date(cmd.start_time).toISOString()
        intended.start_time = start
        diff.push(diffField('start_time', 'Start time', null, start))
      }
      if (cmd.end_time) {
        const end = new Date(cmd.end_time).toISOString()
        intended.end_time = end
        diff.push(diffField('end_time', 'End time', null, end))
      }
      if (cmd.bid_strategy) {
        intended.bid_strategy = cmd.bid_strategy
        diff.push(diffField('bid_strategy', 'Bid strategy', null, cmd.bid_strategy))
      }
      if (cmd.bid_amount !== undefined) {
        const bidAfter = toMetaMinorUnits(cmd.bid_amount, before.currency) / minorUnitsPerMajor(before.currency)
        intended.bid_amount = bidAfter
        diff.push(diffMoney('bid_amount', 'Bid amount', null, bidAfter, before.currency))
      }
      const promoted = effectivePromotedObject(cmd, before)
      if (!promoted.value && GOALS_NEEDING_PROMOTED_OBJECT.has(cmd.optimization_goal)) {
        return {
          ok: false,
          code: 'promoted_object_required',
          message: `Meta requires promoted_object for optimization_goal ${cmd.optimization_goal} — e.g. {"pixel_id":"…","custom_event_type":"LEAD"} for conversions or {"page_id":"…"} for leads/page likes. No ad set in this campaign has one to copy.`,
        }
      }
      if (promoted.value) {
        intended.promoted_object = promoted.value
        diff.push(diffField('promoted_object', 'Promoted object', null, promoted.value))
        if (promoted.inheritedFrom) {
          warnings.push(`promoted_object copied from ad set ${promoted.inheritedFrom} (same optimization goal) — pass promoted_object to use a different pixel/event or page.`)
        }
      }
      if (cmd.destination_type) {
        intended.destination_type = cmd.destination_type
        diff.push(diffField('destination_type', 'Destination type', null, cmd.destination_type))
      }
      if (cmd.dsa_beneficiary) {
        intended.dsa_beneficiary = cmd.dsa_beneficiary
        diff.push(diffField('dsa_beneficiary', 'DSA beneficiary', null, cmd.dsa_beneficiary))
      }
      if (cmd.dsa_payor) {
        intended.dsa_payor = cmd.dsa_payor
        diff.push(diffField('dsa_payor', 'DSA payor', null, cmd.dsa_payor))
      }
      if (cmd.regional_regulated_categories) {
        intended.regional_regulated_categories = cmd.regional_regulated_categories
        diff.push(diffField('regional_regulated_categories', 'Regional regulated categories', null, cmd.regional_regulated_categories))
      }
      if (cmd.regional_regulation_identities) {
        intended.regional_regulation_identities = cmd.regional_regulation_identities
        diff.push(diffField('regional_regulation_identities', 'Regional regulation identities', null, cmd.regional_regulation_identities))
      }
      for (const [key, value] of Object.entries(cmd.extra_params ?? {})) {
        intended[key] = value
        diff.push(diffField(key, `Advanced: ${key}`, null, value))
      }
      if (cmd.extra_params && Object.keys(cmd.extra_params).length > 0) {
        warnings.push('Advanced parameters are passed directly to Meta and remain subject to account, objective, and API-version eligibility.')
      }

      const countries = extractCountries(cmd.targeting)
      if (!hasGeoLocations(cmd.targeting)) {
        warnings.push('This ad set has no geo_locations in its targeting; Meta requires at least one location to deliver ads.')
      }
      if (countries?.some((c) => EU_COUNTRIES.has(c)) && (!cmd.dsa_beneficiary || !cmd.dsa_payor)) {
        warnings.push('This targeting reaches the EU; Meta requires dsa_beneficiary and dsa_payor for ads delivered there.')
      }
      const regionalHits = countries?.filter((c) => REGIONAL_REGULATION_COUNTRIES.has(c)) ?? []
      if (regionalHits.length > 0 && !cmd.regional_regulated_categories?.length && !cmd.regional_regulation_identities) {
        warnings.push(
          `This targeting includes ${regionalHits.join(', ')}; set regional_regulated_categories / regional_regulation_identities if this account is subject to local ad regulation there.`,
        )
      }

      return { ok: true, intended, diff, warnings, facts: budgetAfter !== null ? { budgetAfter } : {} }
    }

    default:
      return { ok: false, code: 'unsupported_command', message: `${(cmd as { type: string }).type} is not implemented by the Meta ad sets handler.` }
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** POST body for a plain field update (everything except meta.adset.create, which is a create edge). */
function buildUpdate(cmd: Exclude<AdsetsCommand, CommandOf<'meta.adset.create'>>, before: ResourceSnapshot): { id: string; fields: Record<string, unknown> } {
  const cur = before.currency
  switch (cmd.type) {
    case 'meta.campaign.set_lifetime_budget':
      return { id: cmd.campaign_id, fields: { lifetime_budget: String(toMetaMinorUnits(cmd.lifetime_budget, cur)) } }
    case 'meta.adset.set_lifetime_budget': {
      const fields: Record<string, unknown> = { lifetime_budget: String(toMetaMinorUnits(cmd.lifetime_budget, cur)) }
      if (cmd.end_time) fields.end_time = new Date(cmd.end_time).toISOString()
      return { id: cmd.adset_id, fields }
    }
    case 'meta.adset.update_settings': {
      const fields: Record<string, unknown> = {}
      if (cmd.optimization_goal !== undefined) fields.optimization_goal = cmd.optimization_goal
      if (cmd.destination_type !== undefined) fields.destination_type = cmd.destination_type
      if (cmd.dsa_beneficiary !== undefined) fields.dsa_beneficiary = cmd.dsa_beneficiary
      if (cmd.dsa_payor !== undefined) fields.dsa_payor = cmd.dsa_payor
      if (cmd.regional_regulated_categories !== undefined) fields.regional_regulated_categories = cmd.regional_regulated_categories
      if (cmd.regional_regulation_identities !== undefined) fields.regional_regulation_identities = cmd.regional_regulation_identities
      if (cmd.attribution_spec !== undefined) fields.attribution_spec = cmd.attribution_spec
      Object.assign(fields, cmd.extra_params ?? {})
      return { id: cmd.adset_id, fields }
    }
    case 'meta.adset.replace_targeting':
      return { id: cmd.adset_id, fields: { targeting: cmd.targeting } }
    case 'meta.campaign.update_settings':
      return { id: cmd.campaign_id, fields: { special_ad_categories: cmd.special_ad_categories } }
    default:
      throw new AdsValidationError(`${(cmd as { type: string }).type} is not handled by the ad sets handler`)
  }
}

/** POST body for `act_x/adsets`. Always created PAUSED — see catalog.ts's "Creates are always PAUSED". */
function buildAdsetCreateBody(cmd: CommandOf<'meta.adset.create'>, before: ResourceSnapshot): { edgePath: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    name: cmd.name,
    campaign_id: cmd.campaign_id,
    status: 'PAUSED',
    optimization_goal: cmd.optimization_goal,
    billing_event: cmd.billing_event,
    targeting: cmd.targeting,
  }
  if (cmd.daily_budget !== undefined) body.daily_budget = String(toMetaMinorUnits(cmd.daily_budget, before.currency))
  if (cmd.lifetime_budget !== undefined) body.lifetime_budget = String(toMetaMinorUnits(cmd.lifetime_budget, before.currency))
  if (cmd.start_time) body.start_time = new Date(cmd.start_time).toISOString()
  if (cmd.end_time) body.end_time = new Date(cmd.end_time).toISOString()
  if (cmd.bid_strategy) body.bid_strategy = cmd.bid_strategy
  if (cmd.bid_amount !== undefined) body.bid_amount = toMetaMinorUnits(cmd.bid_amount, before.currency)
  const promoted = effectivePromotedObject(cmd, before)
  if (promoted.value) body.promoted_object = promoted.value
  if (cmd.destination_type) body.destination_type = cmd.destination_type
  if (cmd.dsa_beneficiary) body.dsa_beneficiary = cmd.dsa_beneficiary
  if (cmd.dsa_payor) body.dsa_payor = cmd.dsa_payor
  if (cmd.regional_regulated_categories) body.regional_regulated_categories = cmd.regional_regulated_categories
  if (cmd.regional_regulation_identities) body.regional_regulation_identities = cmd.regional_regulation_identities
  Object.assign(body, cmd.extra_params ?? {})
  return { edgePath: `${cmd.ad_account_id}/adsets`, body }
}

// ─── Rollback ───────────────────────────────────────────────────────────────

function buildAdsetsRollback(command: AdsetsCommand, before: ResourceSnapshot): AdsCommand | null {
  const f = before.fields
  const base = { platform: 'meta' as const, ad_account_id: command.ad_account_id }
  const money = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)

  switch (command.type) {
    case 'meta.adset.create':
      // Created paused; the only "undo" is deleting/archiving the new object,
      // which this handler never does automatically (see catalog.ts).
      return null

    case 'meta.campaign.set_lifetime_budget': {
      const prevDaily = money(f.daily_budget)
      if (prevDaily) return { ...base, type: 'meta.campaign.set_daily_budget', campaign_id: command.campaign_id, daily_budget: prevDaily }
      const prevLifetime = money(f.lifetime_budget)
      if (prevLifetime) return { ...base, type: 'meta.campaign.set_lifetime_budget', campaign_id: command.campaign_id, lifetime_budget: prevLifetime }
      return null
    }

    case 'meta.adset.set_lifetime_budget': {
      const prevDaily = money(f.daily_budget)
      if (prevDaily) return { ...base, type: 'meta.adset.set_daily_budget', adset_id: command.adset_id, daily_budget: prevDaily }
      const prevLifetime = money(f.lifetime_budget)
      if (prevLifetime) {
        const prevEnd = typeof f.end_time === 'string' && Date.parse(f.end_time) > Date.now() ? f.end_time : undefined
        return { ...base, type: 'meta.adset.set_lifetime_budget', adset_id: command.adset_id, lifetime_budget: prevLifetime, ...(prevEnd ? { end_time: prevEnd } : {}) }
      }
      return null
    }

    case 'meta.adset.update_settings': {
      const back: Record<string, unknown> = {}
      if (command.optimization_goal !== undefined) {
        if (typeof f.optimization_goal !== 'string') return null
        back.optimization_goal = f.optimization_goal
      }
      if (command.destination_type !== undefined) {
        if (typeof f.destination_type !== 'string') return null
        back.destination_type = f.destination_type
      }
      if (command.dsa_beneficiary !== undefined) {
        if (typeof f.dsa_beneficiary !== 'string') return null
        back.dsa_beneficiary = f.dsa_beneficiary
      }
      if (command.dsa_payor !== undefined) {
        if (typeof f.dsa_payor !== 'string') return null
        back.dsa_payor = f.dsa_payor
      }
      // Arrays/records support reverting to "empty" even when there was no
      // prior explicit value — unlike the bare strings above, an empty
      // list/object is itself a valid, expressible state for these fields.
      if (command.regional_regulated_categories !== undefined) {
        back.regional_regulated_categories = Array.isArray(f.regional_regulated_categories) ? f.regional_regulated_categories : []
      }
      if (command.regional_regulation_identities !== undefined) {
        back.regional_regulation_identities =
          f.regional_regulation_identities && typeof f.regional_regulation_identities === 'object' ? f.regional_regulation_identities : {}
      }
      if (command.attribution_spec !== undefined) {
        back.attribution_spec = Array.isArray(f.attribution_spec) ? f.attribution_spec : []
      }
      const extraRollback: Record<string, unknown> = {}
      for (const key of Object.keys(command.extra_params ?? {})) {
        // Some Meta fields cannot express an explicit null reset. Only offer
        // rollback when a concrete prior value was observable.
        if (f[key] !== null && f[key] !== undefined) extraRollback[key] = f[key]
      }
      if (Object.keys(extraRollback).length > 0) back.extra_params = extraRollback
      if (Object.keys(back).length === 0) return null
      return { ...base, type: command.type, adset_id: command.adset_id, ...back } as AdsCommand
    }

    case 'meta.adset.replace_targeting': {
      const prev = f.targeting
      if (!prev || typeof prev !== 'object') return null
      return { ...base, type: command.type, adset_id: command.adset_id, targeting: prev as Record<string, unknown> }
    }

    case 'meta.campaign.update_settings': {
      const prev = Array.isArray(f.special_ad_categories) ? f.special_ad_categories : []
      return { ...base, type: command.type, campaign_id: command.campaign_id, special_ad_categories: prev } as AdsCommand
    }

    default:
      return null
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export const adsetsHandler: CommandHandler = {
  platform: 'meta',
  types: ADSETS_COMMAND_TYPES,

  async snapshot(ctx, command) {
    if (!isAdsetsCommand(command)) throw new AdsValidationError('Not an ad-sets command')
    return snapshotAdsets(ctx, command)
  },

  plan(command, before) {
    if (!isAdsetsCommand(command)) return { ok: false, code: 'wrong_platform', message: 'Not an ad-sets command' }
    return planAdsets(command, before)
  },

  async validate(ctx, command, before) {
    if (!isAdsetsCommand(command)) throw new AdsValidationError('Not an ad-sets command')
    if (command.type === 'meta.adset.create') {
      const { edgePath, body } = buildAdsetCreateBody(command, before)
      await createObject(edgePath, body, ctx.credential, { validateOnly: true })
      return
    }
    const { id, fields } = buildUpdate(command, before)
    await updateObject(id, fields, ctx.credential, { validateOnly: true })
  },

  async execute(ctx, command, before): Promise<ExecuteResult> {
    if (!isAdsetsCommand(command)) throw new AdsValidationError('Not an ad-sets command')
    if (command.type === 'meta.adset.create') {
      const { edgePath, body } = buildAdsetCreateBody(command, before)
      const res = await createObject(edgePath, body, ctx.credential)
      if (!res.id) throw new MetaAdsError('Meta did not return an id for the created ad set')
      return { providerRef: res.id, raw: res }
    }
    const { id, fields } = buildUpdate(command, before)
    const res = await updateObject(id, fields, ctx.credential)
    if (res.success === false) throw new MetaAdsError('Meta reported the update as unsuccessful')
    return { providerRef: id, raw: res }
  },

  async verify(ctx, command, intended, providerRef): Promise<VerifyResult> {
    if (!isAdsetsCommand(command)) throw new AdsValidationError('Not an ad-sets command')
    if (command.type === 'meta.adset.create') {
      if (!providerRef) return { ok: false, mismatches: [{ field: 'id', expected: 'a new object id', actual: null }], observed: null }
      const node = await readNode<{ id: string; name: string; status: string; account_id?: string }>(providerRef, 'id,name,status,account_id', ctx)
      if (!node) return { ok: false, mismatches: [{ field: '*', expected: { name: command.name }, actual: null }], observed: null }
      const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
      if (node.status !== 'PAUSED') mismatches.push({ field: 'status', expected: 'PAUSED', actual: node.status })
      if (!sameAccount(node.account_id, ctx.adAccountId)) mismatches.push({ field: 'account_id', expected: ctx.adAccountId, actual: node.account_id })
      if (node.name !== command.name) mismatches.push({ field: 'name', expected: command.name, actual: node.name })
      return { ok: mismatches.length === 0, mismatches, observed: { id: node.id, name: node.name, status: node.status } }
    }
    const snap = await snapshotAdsets(ctx, command)
    if (!snap) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
    const mismatches = compareFields(intended, snap.fields)
    return { ok: mismatches.length === 0, mismatches, observed: snap.fields }
  },

  buildRollback(command, before) {
    if (!isAdsetsCommand(command)) return null
    return buildAdsetsRollback(command, before)
  },
}
