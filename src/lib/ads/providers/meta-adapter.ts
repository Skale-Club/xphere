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
import { copyObject, createObject, getAdAccountInfo, getObject, listAds, listCampaigns, listCustomAudiences, MetaAdsError, updateObject } from '../meta-api'
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

const BID_STRATEGIES = ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'] as const
type MetaBidStrategyValue = (typeof BID_STRATEGIES)[number]

/** Narrow an unknown snapshot field back into the bid-strategy enum a rollback command needs. */
function asBidStrategy(v: unknown): MetaBidStrategyValue | null {
  return typeof v === 'string' && (BID_STRATEGIES as readonly string[]).includes(v) ? (v as MetaBidStrategyValue) : null
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
  facebook_positions?: string[]
  instagram_positions?: string[]
  custom_audiences?: Array<{ id: string }>
  excluded_custom_audiences?: Array<{ id: string }>
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
  bid_constraints?: { roas_average_floor?: number }
  end_time?: string
  targeting?: Targeting
  campaign?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string; bid_strategy?: string }
}

type MetaAdNode = {
  id: string
  name: string
  status: string
  account_id?: string
  adset_id?: string
  campaign_id?: string
  creative?: { id?: string }
}

type MetaAudienceRef = {
  id: string
  name?: string
  approximate_count_lower_bound?: number
  operation_status?: { code: number; description: string }
}

/** A small custom audience delivers poorly; Meta's own guidance is "aim for 1,000+". */
const SMALL_AUDIENCE_THRESHOLD = 1000

const CAMPAIGN_FIELDS = 'id,name,status,account_id,objective,daily_budget,lifetime_budget,spend_cap,bid_strategy'
const ADSET_FIELDS =
  'id,name,status,account_id,campaign_id,daily_budget,lifetime_budget,bid_amount,bid_strategy,bid_constraints,end_time,targeting,campaign{id,name,daily_budget,lifetime_budget,bid_strategy}'
const AD_FIELDS = 'id,name,status,account_id,adset_id,campaign_id,creative{id}'

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
    facebook_positions: t?.facebook_positions ?? null,
    instagram_positions: t?.instagram_positions ?? null,
    custom_audience_ids: (t?.custom_audiences ?? []).map((a) => a.id),
    excluded_custom_audience_ids: (t?.excluded_custom_audiences ?? []).map((a) => a.id),
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshotMeta(ctx: AdapterContext, cmd: MetaCommand): Promise<ResourceSnapshot | null> {
  switch (cmd.type) {
    case 'meta.campaign.set_status':
    case 'meta.campaign.rename':
    case 'meta.campaign.set_daily_budget':
    case 'meta.campaign.set_spend_cap':
    case 'meta.campaign.set_bid_strategy': {
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
        case 'meta.campaign.set_bid_strategy':
          return {
            ...base,
            fields: {
              bid_strategy: node.bid_strategy ?? null,
              daily_budget: fromMinor(node.daily_budget, currency),
              lifetime_budget: fromMinor(node.lifetime_budget, currency),
            },
          }
        default:
          return null
      }
    }

    case 'meta.adset.set_status':
    case 'meta.adset.rename':
    case 'meta.adset.set_daily_budget':
    case 'meta.adset.set_bid_amount':
    case 'meta.adset.set_end_time':
    case 'meta.adset.update_targeting':
    case 'meta.adset.set_bid_strategy': {
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
        case 'meta.adset.update_targeting': {
          // Only fetch the account's custom audiences when the command
          // actually touches them — every other targeting field needs no
          // extra round trip. The full targeting spec (and, when relevant,
          // the audience list) is part of the hashed state: the write sends
          // the merged object back, so any concurrent edit to it must
          // invalidate an approved change.
          const needsAudiences = cmd.custom_audience_ids !== undefined || cmd.excluded_custom_audience_ids !== undefined
          const audiences = needsAudiences ? await listCustomAudiences(ctx.adAccountId, ctx.credential) : null
          return {
            ...base,
            fields: {
              ...targetingFields(node.targeting),
              targeting: node.targeting ?? {},
              ...(audiences ? { available_audiences: audiences } : {}),
            },
          }
        }
        case 'meta.adset.set_bid_strategy':
          return {
            ...base,
            fields: {
              bid_strategy: node.bid_strategy ?? node.campaign?.bid_strategy ?? null,
              bid_amount: fromMinor(node.bid_amount, currency),
              roas_floor: node.bid_constraints?.roas_average_floor != null ? node.bid_constraints.roas_average_floor / 10000 : null,
              campaign_budget_optimization: Boolean(node.campaign?.daily_budget || node.campaign?.lifetime_budget),
            },
          }
        default:
          return null
      }
    }

    case 'meta.ad.set_status':
    case 'meta.ad.rename':
    case 'meta.ad.set_creative': {
      const [node, currency] = await Promise.all([readNode<MetaAdNode>(cmd.ad_id, AD_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      const base = { resourceType: 'ad' as const, resourceId: node.id, resourceName: node.name, campaignId: node.campaign_id ?? null, currency }
      if (cmd.type === 'meta.ad.set_status') return { ...base, fields: { status: node.status } }
      if (cmd.type === 'meta.ad.rename') return { ...base, fields: { name: node.name } }
      // meta.ad.set_creative: also read the target creative so plan() can
      // reject an unknown or cross-account creative_id without another round
      // trip.
      const targetCreative = await readNode<{ id: string; name?: string; account_id?: string }>(cmd.creative_id, 'id,name,account_id', ctx)
      return {
        ...base,
        fields: {
          creative_id: node.creative?.id ?? null,
          target_creative_exists: Boolean(targetCreative),
          target_creative_same_account: sameAccount(targetCreative?.account_id, ctx.adAccountId),
          target_creative_name: targetCreative?.name ?? null,
        },
      }
    }

    case 'meta.campaign.duplicate': {
      const [node, currency] = await Promise.all([readNode<MetaCampaignNode>(cmd.campaign_id, CAMPAIGN_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      return { resourceType: 'campaign', resourceId: node.id, resourceName: node.name, campaignId: node.id, currency, fields: { name: node.name } }
    }

    case 'meta.adset.duplicate': {
      const [node, currency] = await Promise.all([readNode<MetaAdSetNode>(cmd.adset_id, ADSET_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      if (cmd.target_campaign_id) {
        const target = await readNode<{ id: string; account_id?: string }>(cmd.target_campaign_id, 'id,account_id', ctx)
        if (!target || !sameAccount(target.account_id, ctx.adAccountId)) return null
      }
      return {
        resourceType: 'adset',
        resourceId: node.id,
        resourceName: node.name,
        campaignId: node.campaign_id ?? node.campaign?.id ?? null,
        currency,
        fields: { name: node.name },
      }
    }

    case 'meta.ad.duplicate': {
      const [node, currency] = await Promise.all([readNode<MetaAdNode>(cmd.ad_id, AD_FIELDS, ctx), currencyOf(ctx)])
      if (!node || !sameAccount(node.account_id, ctx.adAccountId)) return null
      if (cmd.target_adset_id) {
        const target = await readNode<{ id: string; account_id?: string }>(cmd.target_adset_id, 'id,account_id', ctx)
        if (!target || !sameAccount(target.account_id, ctx.adAccountId)) return null
      }
      return { resourceType: 'ad', resourceId: node.id, resourceName: node.name, campaignId: node.campaign_id ?? null, currency, fields: { name: node.name } }
    }

    case 'meta.campaign.create': {
      const [campaigns, currency] = await Promise.all([listCampaigns(cmd.ad_account_id, ctx.credential), currencyOf(ctx)])
      // "Non-deleted" only — an archived campaign with the same name still
      // collides in Ads Manager, and matching on it too avoids a confusing
      // duplicate-looking pair; DELETED is Meta's true tombstone state.
      const existing = campaigns.find((c) => c.status !== 'DELETED' && c.name === cmd.name)
      return {
        resourceType: 'campaign',
        resourceId: null,
        resourceName: cmd.name,
        campaignId: null,
        currency,
        fields: { already_exists: Boolean(existing), existing_campaign_id: existing?.id ?? null },
      }
    }

    case 'meta.ad.create': {
      const [adset, currency] = await Promise.all([readNode<MetaAdSetNode>(cmd.adset_id, ADSET_FIELDS, ctx), currencyOf(ctx)])
      if (!adset || !sameAccount(adset.account_id, ctx.adAccountId)) return null
      const [creative, ads] = await Promise.all([
        readNode<{ id: string; name?: string; account_id?: string }>(cmd.creative_id, 'id,name,account_id', ctx),
        listAds(ctx.adAccountId, ctx.credential, cmd.adset_id),
      ])
      const existing = ads.find((a) => a.status !== 'DELETED' && a.name === cmd.name)
      return {
        resourceType: 'ad',
        resourceId: null,
        resourceName: cmd.name,
        campaignId: adset.campaign_id ?? adset.campaign?.id ?? null,
        currency,
        fields: {
          adset_status: adset.status,
          adset_name: adset.name,
          target_creative_exists: Boolean(creative),
          target_creative_same_account: sameAccount(creative?.account_id, ctx.adAccountId),
          target_creative_name: creative?.name ?? null,
          already_exists: Boolean(existing),
          existing_ad_id: existing?.id ?? null,
        },
      }
    }

    default:
      return null
  }
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
  // Positions can't be cleared to "automatic" via an empty array (the catalog
  // schema requires at least one entry) — only replaced with another list.
  if (cmd.facebook_positions !== undefined) next.facebook_positions = [...cmd.facebook_positions]
  if (cmd.instagram_positions !== undefined) next.instagram_positions = [...cmd.instagram_positions]
  // Audiences DO support "[] removes the key" — an empty array means "no
  // included/excluded custom audiences", not "leave unchanged".
  if (cmd.custom_audience_ids !== undefined) {
    if (cmd.custom_audience_ids.length === 0) delete next.custom_audiences
    else next.custom_audiences = cmd.custom_audience_ids.map((id) => ({ id }))
  }
  if (cmd.excluded_custom_audience_ids !== undefined) {
    if (cmd.excluded_custom_audience_ids.length === 0) delete next.excluded_custom_audiences
    else next.excluded_custom_audiences = cmd.excluded_custom_audience_ids.map((id) => ({ id }))
  }
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
        facebook_positions: 'Facebook placements',
        instagram_positions: 'Instagram placements',
        custom_audience_ids: 'Included custom audiences',
        excluded_custom_audience_ids: 'Excluded custom audiences',
      }

      // Positions require the matching platform to still be reachable after
      // this command's own publisher_platforms change is merged in.
      if (cmd.facebook_positions !== undefined && next.publisher_platforms && !next.publisher_platforms.includes('facebook')) {
        return { ok: false, code: 'placement_platform_mismatch', message: "facebook_positions requires 'facebook' to be included in publisher_platforms." }
      }
      if (cmd.instagram_positions !== undefined && next.publisher_platforms && !next.publisher_platforms.includes('instagram')) {
        return { ok: false, code: 'placement_platform_mismatch', message: "instagram_positions requires 'instagram' to be included in publisher_platforms." }
      }
      if ((cmd.facebook_positions !== undefined || cmd.instagram_positions !== undefined) && !next.publisher_platforms) {
        warnings.push(
          'Placements are still Advantage+ automatic (no publisher_platforms set): Meta will not apply specific positions until publisher_platforms is also set, in this command or a prior one.',
        )
      }

      // Custom/lookalike audience ids must exist in this ad account —
      // snapshot() only fetched the list when the command touches these
      // fields, so `available_audiences` is present exactly when needed.
      const requestedAudienceIds = [...(cmd.custom_audience_ids ?? []), ...(cmd.excluded_custom_audience_ids ?? [])]
      if (requestedAudienceIds.length > 0) {
        const audiences = (f.available_audiences ?? []) as MetaAudienceRef[]
        const byId = new Map(audiences.map((a) => [a.id, a]))
        for (const id of requestedAudienceIds) {
          if (!byId.has(id)) {
            return { ok: false, code: 'unknown_audience', message: `Custom audience ${id} was not found in this ad account.` }
          }
        }
        for (const id of cmd.custom_audience_ids ?? []) {
          const audience = byId.get(id)
          if (audience?.operation_status && audience.operation_status.code !== 200) {
            warnings.push(`Audience "${audience.name ?? id}" is not ready yet (${audience.operation_status.description}); Meta may not deliver against it.`)
          }
          if (typeof audience?.approximate_count_lower_bound === 'number' && audience.approximate_count_lower_bound < SMALL_AUDIENCE_THRESHOLD) {
            warnings.push(`Audience "${audience.name ?? id}" is small (~${audience.approximate_count_lower_bound}+ people); Meta ad delivery may be limited.`)
          }
        }
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

    case 'meta.campaign.set_bid_strategy': {
      const isCbo = Boolean(f.daily_budget || f.lifetime_budget)
      if (!isCbo) {
        return {
          ok: false,
          code: 'not_cbo',
          message: 'Campaign bid strategy only applies to campaigns using a campaign budget (CBO). Set it on the ad set instead with meta.adset.set_bid_strategy.',
        }
      }
      return done({ bid_strategy: cmd.bid_strategy }, [diffField('bid_strategy', 'Bid strategy', f.bid_strategy, cmd.bid_strategy)], { biddingChange: true })
    }

    case 'meta.adset.set_bid_strategy': {
      if (f.campaign_budget_optimization) {
        return {
          ok: false,
          code: 'campaign_budget',
          message: 'The parent campaign uses a campaign budget (CBO); set the bid strategy on the campaign with meta.campaign.set_bid_strategy.',
        }
      }
      const intended: Record<string, unknown> = { bid_strategy: cmd.bid_strategy }
      const diff: DiffEntry[] = [diffField('bid_strategy', 'Bid strategy', f.bid_strategy, cmd.bid_strategy)]
      if (cmd.bid_amount !== undefined) {
        const after = toMetaMinorUnits(cmd.bid_amount, before.currency) / minorUnitsPerMajor(before.currency)
        intended.bid_amount = after
        diff.push(diffMoney('bid_amount', 'Bid amount', f.bid_amount as number | null, after, before.currency))
      }
      if (cmd.roas_floor !== undefined) {
        intended.roas_floor = cmd.roas_floor
        diff.push(diffField('roas_floor', 'Minimum ROAS', f.roas_floor, cmd.roas_floor))
      }
      return done(intended, diff, { biddingChange: true })
    }

    case 'meta.ad.set_creative': {
      if (!f.target_creative_exists) return { ok: false, code: 'creative_not_found', message: 'That creative was not found.' }
      if (!f.target_creative_same_account) return { ok: false, code: 'cross_account_creative', message: 'That creative belongs to a different ad account.' }
      return done({ creative_id: cmd.creative_id }, [diffField('creative_id', 'Creative', f.creative_id, cmd.creative_id)])
    }

    case 'meta.campaign.duplicate': {
      const label = cmd.deep_copy ? 'Duplicate campaign (deep copy, paused)' : 'Duplicate campaign (paused)'
      const newName = cmd.rename_suffix ? `${f.name as string}${cmd.rename_suffix}` : (f.name as string)
      return done(
        { source_name: f.name, deep_copy: cmd.deep_copy, rename_suffix: cmd.rename_suffix ?? null, new_name: newName },
        [diffField('duplicate', 'Action', null, label), diffField('new_name', 'New campaign name', null, newName)],
        {},
      )
    }

    case 'meta.adset.duplicate': {
      const label = cmd.deep_copy ? 'Duplicate ad set (deep copy, paused)' : 'Duplicate ad set (paused)'
      const newName = cmd.rename_suffix ? `${f.name as string}${cmd.rename_suffix}` : (f.name as string)
      const diff = [diffField('duplicate', 'Action', null, label), diffField('new_name', 'New ad set name', null, newName)]
      if (cmd.target_campaign_id) diff.push(diffField('target_campaign_id', 'Target campaign', null, cmd.target_campaign_id))
      return done(
        {
          source_name: f.name,
          deep_copy: cmd.deep_copy,
          rename_suffix: cmd.rename_suffix ?? null,
          new_name: newName,
          target_campaign_id: cmd.target_campaign_id ?? null,
        },
        diff,
        {},
      )
    }

    case 'meta.ad.duplicate': {
      const newName = cmd.rename_suffix ? `${f.name as string}${cmd.rename_suffix}` : (f.name as string)
      const diff = [diffField('duplicate', 'Action', null, 'Duplicate ad (paused)'), diffField('new_name', 'New ad name', null, newName)]
      if (cmd.target_adset_id) diff.push(diffField('target_adset_id', 'Target ad set', null, cmd.target_adset_id))
      return done({ source_name: f.name, rename_suffix: cmd.rename_suffix ?? null, new_name: newName, target_adset_id: cmd.target_adset_id ?? null }, diff, {})
    }

    case 'meta.campaign.create': {
      if (f.already_exists) {
        return {
          ok: false,
          code: 'already_exists',
          message: `A campaign named "${cmd.name}" already exists in this account (${f.existing_campaign_id}). Use meta.campaign.rename or pick a different name.`,
        }
      }
      // Bid strategy on the campaign object only applies when the campaign
      // itself carries the budget (Advantage campaign budget / CBO) — same
      // rule enforced for an existing campaign in meta.campaign.set_bid_strategy.
      if (cmd.bid_strategy !== undefined && cmd.daily_budget === undefined) {
        return {
          ok: false,
          code: 'bid_strategy_requires_budget',
          message: 'bid_strategy only applies with a campaign budget; set daily_budget or omit bid_strategy (ad sets can carry their own budget and bid strategy instead).',
        }
      }
      const intended: Record<string, unknown> = {
        name: cmd.name,
        objective: cmd.objective,
        status: 'PAUSED',
        special_ad_categories: cmd.special_ad_categories,
      }
      const diff: DiffEntry[] = [
        diffField('name', 'Name', null, cmd.name),
        diffField('objective', 'Objective', null, cmd.objective),
        diffField('status', 'Status', null, 'PAUSED'),
        diffField('special_ad_categories', 'Special ad categories', null, cmd.special_ad_categories.length ? cmd.special_ad_categories : '(none)'),
      ]
      let budgetAfter: number | null = null
      if (cmd.daily_budget !== undefined) {
        budgetAfter = toMetaMinorUnits(cmd.daily_budget, before.currency) / minorUnitsPerMajor(before.currency)
        intended.daily_budget = budgetAfter
        diff.push(diffMoney('daily_budget', 'Daily budget', null, budgetAfter, before.currency))
      }
      if (cmd.bid_strategy !== undefined) {
        intended.bid_strategy = cmd.bid_strategy
        diff.push(diffField('bid_strategy', 'Bid strategy', null, cmd.bid_strategy))
      }
      return done(intended, diff, budgetAfter !== null ? { budgetAfter } : {})
    }

    case 'meta.ad.create': {
      if (f.already_exists) {
        return {
          ok: false,
          code: 'already_exists',
          message: `An ad named "${cmd.name}" already exists in this ad set (${f.existing_ad_id}). Use meta.ad.rename or pick a different name.`,
        }
      }
      if (f.adset_status === 'DELETED' || f.adset_status === 'ARCHIVED') {
        return { ok: false, code: 'resource_archived', message: `The ad set is ${f.adset_status} in Meta and cannot receive new ads.` }
      }
      if (!f.target_creative_exists) return { ok: false, code: 'creative_not_found', message: 'That creative was not found.' }
      if (!f.target_creative_same_account) return { ok: false, code: 'cross_account_creative', message: 'That creative belongs to a different ad account.' }
      const intended = { name: cmd.name, adset_id: cmd.adset_id, creative_id: cmd.creative_id, status: 'PAUSED' }
      const diff = [
        diffField('name', 'Name', null, cmd.name),
        diffField('adset_id', 'Ad set', null, (f.adset_name as string | null) ?? cmd.adset_id),
        diffField('creative_id', 'Creative', null, (f.target_creative_name as string | null) ?? cmd.creative_id),
        diffField('status', 'Status', null, 'PAUSED'),
      ]
      return done(intended, diff)
    }

    default:
      // The switch above is exhaustive for every MetaCommand type today, so
      // this never actually runs — it exists so a future catalog.ts addition
      // fails loudly with `unsupported_command` instead of a type error here
      // or, worse, a silent fallthrough.
      return { ok: false, code: 'unsupported_command', message: `${(cmd as { type: string }).type} is not implemented by the Meta adapter.` }
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
    case 'meta.campaign.set_bid_strategy':
      return { id: cmd.campaign_id, fields: { bid_strategy: cmd.bid_strategy } }
    case 'meta.adset.set_bid_strategy': {
      const fields: Record<string, unknown> = { bid_strategy: cmd.bid_strategy }
      if (cmd.bid_amount !== undefined) fields.bid_amount = toMetaMinorUnits(cmd.bid_amount, cur)
      if (cmd.roas_floor !== undefined) fields.bid_constraints = { roas_average_floor: Math.round(cmd.roas_floor * 10000) }
      return { id: cmd.adset_id, fields }
    }
    case 'meta.ad.set_creative':
      return { id: cmd.ad_id, fields: { creative: { creative_id: cmd.creative_id } } }
    case 'meta.campaign.duplicate':
    case 'meta.adset.duplicate':
    case 'meta.ad.duplicate':
      // Duplicates never reach buildUpdate — execute()/validate() route them
      // to buildCopyBody() / copyObject() instead. This branch only exists so
      // the switch stays exhaustive if that routing is ever bypassed.
      throw new AdsValidationError(`${cmd.type} does not use buildUpdate; it is a duplicate command`)
    case 'meta.campaign.create':
    case 'meta.ad.create':
      // Creates never reach buildUpdate — execute()/validate() route them to
      // buildCreateBody() / createObject() instead (a POST to a collection
      // edge, not an update of an existing object id).
      throw new AdsValidationError(`${cmd.type} does not use buildUpdate; it is a create command`)
    default:
      // Handled by a CommandHandler module (providers/meta/*), never by this adapter.
      throw new AdsValidationError(`${cmd.type} is not handled by the base Meta adapter`)
  }
}

/**
 * POST body for a create edge (`act_x/campaigns`, `act_x/ads`). Everything is
 * created PAUSED — nothing this adapter creates starts spending on its own.
 */
function buildCreateBody(cmd: MetaCommand, before: ResourceSnapshot): { edgePath: string; body: Record<string, unknown> } {
  switch (cmd.type) {
    case 'meta.campaign.create': {
      const body: Record<string, unknown> = {
        name: cmd.name,
        objective: cmd.objective,
        status: 'PAUSED',
        special_ad_categories: cmd.special_ad_categories,
      }
      if (cmd.daily_budget !== undefined) body.daily_budget = String(toMetaMinorUnits(cmd.daily_budget, before.currency))
      // Graph v26 rejects a campaign without a campaign budget (code 100 /
      // 4834011) unless it states whether its ad sets may share budget. They
      // may not: each ad set's budget is its own ceiling, which is what the
      // per-change budget policy reasons about.
      else body.is_adset_budget_sharing_enabled = false
      if (cmd.bid_strategy !== undefined) body.bid_strategy = cmd.bid_strategy
      return { edgePath: `${cmd.ad_account_id}/campaigns`, body }
    }
    case 'meta.ad.create':
      return {
        edgePath: `${cmd.ad_account_id}/ads`,
        body: { name: cmd.name, adset_id: cmd.adset_id, creative: { creative_id: cmd.creative_id }, status: 'PAUSED' },
      }
    default:
      throw new AdsValidationError(`${cmd.type} is not a create command`)
  }
}

function isCreateCommand(cmd: MetaCommand): cmd is Extract<MetaCommand, { type: 'meta.campaign.create' | 'meta.ad.create' }> {
  return cmd.type === 'meta.campaign.create' || cmd.type === 'meta.ad.create'
}

/**
 * POST body for `{id}/copies` (see meta-api.ts's `copyObject`). Copies are
 * always requested paused; campaign/ad-set copies may deep-copy their
 * children; an ad set copy can move into another campaign, an ad copy into
 * another ad set; a rename_suffix appends to the source name.
 */
function buildCopyBody(cmd: MetaCommand): { id: string; body: Record<string, unknown> } {
  const withRename = (body: Record<string, unknown>, suffix: string | undefined): Record<string, unknown> => {
    if (suffix) body.rename_options = { rename_suffix: suffix }
    return body
  }
  switch (cmd.type) {
    case 'meta.campaign.duplicate':
      return { id: cmd.campaign_id, body: withRename({ status_option: 'PAUSED', deep_copy: cmd.deep_copy }, cmd.rename_suffix) }
    case 'meta.adset.duplicate': {
      const body: Record<string, unknown> = { status_option: 'PAUSED', deep_copy: cmd.deep_copy }
      if (cmd.target_campaign_id) body.campaign_id = cmd.target_campaign_id
      return { id: cmd.adset_id, body: withRename(body, cmd.rename_suffix) }
    }
    case 'meta.ad.duplicate': {
      const body: Record<string, unknown> = { status_option: 'PAUSED' }
      if (cmd.target_adset_id) body.adset_id = cmd.target_adset_id
      return { id: cmd.ad_id, body: withRename(body, cmd.rename_suffix) }
    }
    default:
      throw new AdsValidationError(`${cmd.type} is not a duplicate command`)
  }
}

function isDuplicateCommand(
  cmd: MetaCommand,
): cmd is Extract<MetaCommand, { type: 'meta.campaign.duplicate' | 'meta.adset.duplicate' | 'meta.ad.duplicate' }> {
  return cmd.type === 'meta.campaign.duplicate' || cmd.type === 'meta.adset.duplicate' || cmd.type === 'meta.ad.duplicate'
}

/**
 * Read-only sanity check used in place of a validate-only dry run for
 * duplicates: Meta's `/copies` endpoint does not document `execution_options`
 * support the way single-object POSTs do, so instead of trusting an
 * undocumented flag this re-confirms the source and any explicit target
 * (target_campaign_id / target_adset_id) still exist in the account right
 * before the real copy call. snapshot() already proved this once at preview
 * time; this guards against the target having been deleted in between.
 */
async function validateDuplicateTargets(ctx: AdapterContext, cmd: MetaCommand): Promise<void> {
  if (cmd.type === 'meta.adset.duplicate' && cmd.target_campaign_id) {
    const node = await readNode<{ id: string; account_id?: string }>(cmd.target_campaign_id, 'id,account_id', ctx)
    if (!node || !sameAccount(node.account_id, ctx.adAccountId)) {
      throw new AdsValidationError('target_campaign_id was not found in this ad account')
    }
  }
  if (cmd.type === 'meta.ad.duplicate' && cmd.target_adset_id) {
    const node = await readNode<{ id: string; account_id?: string }>(cmd.target_adset_id, 'id,account_id', ctx)
    if (!node || !sameAccount(node.account_id, ctx.adAccountId)) {
      throw new AdsValidationError('target_adset_id was not found in this ad account')
    }
  }
}

/**
 * Re-read the freshly created copy and confirm it exists, is PAUSED, and
 * belongs to the same account. Duplicates can't use the generic verify()
 * path below: `command` still names the *source* object, not the copy, so
 * re-snapshotting it would check the wrong resource entirely.
 */
async function verifyDuplicate(ctx: AdapterContext, cmd: MetaCommand, intended: Record<string, unknown>, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'copy_id', expected: 'a new object id', actual: null }], observed: null }
  const fields = cmd.type === 'meta.ad.duplicate' ? AD_FIELDS : cmd.type === 'meta.adset.duplicate' ? ADSET_FIELDS : CAMPAIGN_FIELDS
  const node = await readNode<{ id: string; status: string; account_id?: string }>(providerRef, fields, ctx)
  if (!node) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  if (node.status !== 'PAUSED') mismatches.push({ field: 'status', expected: 'PAUSED', actual: node.status })
  if (!sameAccount(node.account_id, ctx.adAccountId)) mismatches.push({ field: 'account_id', expected: ctx.adAccountId, actual: node.account_id })
  return { ok: mismatches.length === 0, mismatches, observed: { id: node.id, status: node.status, same_account: sameAccount(node.account_id, ctx.adAccountId) } }
}

/**
 * Re-read a freshly created campaign/ad and confirm it exists, is PAUSED, has
 * the requested name, and belongs to the same account. Like verifyDuplicate,
 * `command` names no existing object for a create — `providerRef` is the only
 * way to find what to re-read.
 */
async function verifyCreate(ctx: AdapterContext, cmd: MetaCommand, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef) return { ok: false, mismatches: [{ field: 'id', expected: 'a new object id', actual: null }], observed: null }
  const fields = cmd.type === 'meta.ad.create' ? AD_FIELDS : CAMPAIGN_FIELDS
  const node = await readNode<{ id: string; name: string; status: string; account_id?: string }>(providerRef, fields, ctx)
  if (!node) return { ok: false, mismatches: [{ field: '*', expected: { name: (cmd as { name?: string }).name }, actual: null }], observed: null }
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = []
  if (node.status !== 'PAUSED') mismatches.push({ field: 'status', expected: 'PAUSED', actual: node.status })
  if (!sameAccount(node.account_id, ctx.adAccountId)) mismatches.push({ field: 'account_id', expected: ctx.adAccountId, actual: node.account_id })
  const expectedName = isCreateCommand(cmd) ? cmd.name : null
  if (expectedName !== null && node.name !== expectedName) mismatches.push({ field: 'name', expected: expectedName, actual: node.name })
  return {
    ok: mismatches.length === 0,
    mismatches,
    observed: { id: node.id, name: node.name, status: node.status, same_account: sameAccount(node.account_id, ctx.adAccountId) },
  }
}

// Rate limiting and transient platform faults (Graph API error reference).
const META_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004, 80014])

/**
 * Commands this adapter actually implements, kept as an explicit list rather
 * than "every meta.* entry in COMMAND_CATALOG": the catalog is a contract
 * shared with the Google adapter and other in-flight work, so a future Meta
 * catalog entry landing before its adapter branches do must not be advertised
 * as a capability — that would let ads_get_capabilities and the MCP tool
 * listing promise something preview() then rejects as unsupported_command.
 */
const IMPLEMENTED_META_COMMANDS = new Set<AdsCommand['type']>([
  'meta.campaign.set_status',
  'meta.campaign.set_daily_budget',
  'meta.campaign.rename',
  'meta.campaign.set_spend_cap',
  'meta.campaign.set_bid_strategy',
  'meta.campaign.duplicate',
  'meta.adset.set_status',
  'meta.adset.set_daily_budget',
  'meta.adset.rename',
  'meta.adset.set_bid_amount',
  'meta.adset.set_end_time',
  'meta.adset.update_targeting',
  'meta.adset.set_bid_strategy',
  'meta.adset.duplicate',
  'meta.ad.set_status',
  'meta.ad.rename',
  'meta.ad.set_creative',
  'meta.ad.duplicate',
  'meta.campaign.create',
  'meta.ad.create',
])

export const metaAdapter: AdsProviderAdapter = {
  platform: 'meta',

  capabilities(): Capability[] {
    return (Object.entries(COMMAND_CATALOG) as Array<[AdsCommand['type'], (typeof COMMAND_CATALOG)[AdsCommand['type']]]>)
      .filter(([type, entry]) => entry.platform === 'meta' && IMPLEMENTED_META_COMMANDS.has(type))
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
    if (isDuplicateCommand(command)) {
      await validateDuplicateTargets(ctx, command)
      return
    }
    if (isCreateCommand(command)) {
      const { edgePath, body } = buildCreateBody(command, before)
      await createObject(edgePath, body, ctx.credential, { validateOnly: true })
      return
    }
    const { id, fields } = buildUpdate(command, before)
    await updateObject(id, fields, ctx.credential, { validateOnly: true })
  },

  async execute(ctx, command, before): Promise<ExecuteResult> {
    if (!isMeta(command)) throw new AdsValidationError('Not a Meta Ads command')
    if (isDuplicateCommand(command)) {
      const { id, body } = buildCopyBody(command)
      const res = await copyObject(id, body, ctx.credential)
      const providerRef = res.copied_campaign_id ?? res.copied_adset_id ?? res.copied_ad_id ?? null
      if (!providerRef) throw new MetaAdsError('Meta did not return an id for the duplicated object')
      return { providerRef, raw: res }
    }
    if (isCreateCommand(command)) {
      const { edgePath, body } = buildCreateBody(command, before)
      const res = await createObject(edgePath, body, ctx.credential)
      if (!res.id) throw new MetaAdsError('Meta did not return an id for the created object')
      return { providerRef: res.id, raw: res }
    }
    const { id, fields } = buildUpdate(command, before)
    const res = await updateObject(id, fields, ctx.credential)
    if (res.success === false) throw new MetaAdsError('Meta reported the update as unsuccessful')
    return { providerRef: id, raw: res }
  },

  async verify(ctx, command, intended, providerRef): Promise<VerifyResult> {
    if (!isMeta(command)) throw new AdsValidationError('Not a Meta Ads command')
    if (isDuplicateCommand(command)) return verifyDuplicate(ctx, command, intended, providerRef ?? null)
    if (isCreateCommand(command)) return verifyCreate(ctx, command, providerRef ?? null)
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
        // Positions can't be reverted to "automatic" (the schema requires a
        // non-empty list), only to whatever explicit list existed before.
        if (command.facebook_positions !== undefined) {
          if (!Array.isArray(f.facebook_positions) || f.facebook_positions.length === 0) return null
          back.facebook_positions = f.facebook_positions
        }
        if (command.instagram_positions !== undefined) {
          if (!Array.isArray(f.instagram_positions) || f.instagram_positions.length === 0) return null
          back.instagram_positions = f.instagram_positions
        }
        // Audiences DO support [] as "remove all", so an empty prior list is a
        // valid, reversible state (unlike positions above).
        if (command.custom_audience_ids !== undefined) back.custom_audience_ids = Array.isArray(f.custom_audience_ids) ? f.custom_audience_ids : []
        if (command.excluded_custom_audience_ids !== undefined) {
          back.excluded_custom_audience_ids = Array.isArray(f.excluded_custom_audience_ids) ? f.excluded_custom_audience_ids : []
        }
        return { ...base, type: command.type, adset_id: command.adset_id, ...back } as AdsCommand
      }

      case 'meta.campaign.set_bid_strategy': {
        const strategy = asBidStrategy(f.bid_strategy)
        return strategy ? { ...base, type: command.type, campaign_id: command.campaign_id, bid_strategy: strategy } : null
      }

      case 'meta.adset.set_bid_strategy': {
        const strategy = asBidStrategy(f.bid_strategy)
        if (!strategy) return null
        // A rollback that recreates BID_CAP/COST_CAP/MIN_ROAS must still carry
        // the field that strategy requires (checkCommandShape enforces this on
        // any command, including one built here) — if the prior state didn't
        // have it, there is nothing safe to roll back to.
        if ((strategy === 'LOWEST_COST_WITH_BID_CAP' || strategy === 'COST_CAP') && typeof f.bid_amount !== 'number') return null
        if (strategy === 'LOWEST_COST_WITH_MIN_ROAS' && typeof f.roas_floor !== 'number') return null
        const back: Record<string, unknown> = { bid_strategy: strategy }
        if (typeof f.bid_amount === 'number' && f.bid_amount > 0) back.bid_amount = f.bid_amount
        if (typeof f.roas_floor === 'number' && f.roas_floor > 0) back.roas_floor = f.roas_floor
        return { ...base, type: command.type, adset_id: command.adset_id, ...back } as AdsCommand
      }

      case 'meta.ad.set_creative':
        return typeof f.creative_id === 'string' ? { ...base, type: command.type, ad_id: command.ad_id, creative_id: f.creative_id } : null

      case 'meta.campaign.duplicate':
      case 'meta.adset.duplicate':
      case 'meta.ad.duplicate':
        // A duplicate creates a brand-new paused object; there is no command
        // that "undoes" a creation short of deleting it, which this adapter
        // does not do automatically (deletion is destructive and out of scope
        // for a rollback). An operator who wants the copy gone removes it by
        // hand in Ads Manager or Xphere.
        return null

      case 'meta.campaign.create':
      case 'meta.ad.create':
        // Same reasoning as duplicates above: a create's only "undo" is
        // deleting the new object, which this adapter never does automatically.
        return null

      default:
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
