// The command catalog: every change the engine knows how to make, its input
// schema, and its base risk level.
//
// Adding a capability means adding an entry here AND implementing it in the
// platform adapter (providers/*-adapter.ts). A command that is in the catalog
// but not implemented by the adapter is rejected at preview time with
// `unsupported_command`, never silently ignored.

import { z } from 'zod'

import type { AdsPlatform, ResourceType, RiskLevel } from './types'

// Every field schema below is a factory, not a shared constant: the MCP SDK
// converts these schemas to JSON Schema for tool listings, and the converter
// turns a reused zod instance into a `$ref` into another union member — which
// several MCP clients resolve badly. Fresh instances give flat, self-contained
// variants.

/** Google Ads object ids (customer, campaign, budget, ad group, criterion) are digits only. */
const GId = () => z.string().min(1).max(20).regex(/^\d+$/, 'Must be a numeric id')
/** Meta object ids are digits. */
const MId = () => z.string().min(1).max(32).regex(/^\d+$/, 'Must be a numeric id')
const MetaAccount = () => z.string().regex(/^act_\d+$/, 'Ad account id must look like act_1234567890')

/** Major currency units (e.g. 50 = R$50). Bounded so a typo can't become a 1e12 budget. */
const Money = () => z.number().positive().max(10_000_000)

const KeywordText = () =>
  z
    .string()
    .trim()
    .min(1)
    .max(80, 'Google Ads keywords are limited to 80 characters')
    // Google rejects these outright; catching them here gives a clear message
    // instead of a generic INVALID_ARGUMENT after the round-trip.
    .refine((v) => !/[!@%^()={};~`<>?\\|]/.test(v), 'Keyword contains characters Google Ads does not allow')
    .refine((v) => v.split(/\s+/).length <= 10, 'Google Ads keywords are limited to 10 words')

const MatchType = () => z.enum(['EXACT', 'PHRASE', 'BROAD'])
const GoogleStatus = () => z.enum(['ENABLED', 'PAUSED'])
const MetaStatus = () => z.enum(['ACTIVE', 'PAUSED'])
const Name = () => z.string().trim().min(1).max(255)
const IsoDateTime = () => z.string().datetime({ offset: true })

const google = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ platform: z.literal('google'), ad_account_id: GId(), type: z.literal(type), ...shape }).strict()

const meta = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ platform: z.literal('meta'), ad_account_id: MetaAccount(), type: z.literal(type), ...shape }).strict()

export const AdsCommandSchema = z.discriminatedUnion('type', [
  // ─── Google Ads ─────────────────────────────────────────────────────────────
  google('google.campaign.set_status', { campaign_id: GId(), status: GoogleStatus() }),
  google('google.campaign.set_daily_budget', { campaign_id: GId(), daily_budget: Money() }),
  google('google.campaign.rename', { campaign_id: GId(), name: Name() }),
  google('google.ad_group.set_status', { ad_group_id: GId(), status: GoogleStatus() }),
  google('google.ad_group.rename', { ad_group_id: GId(), name: Name() }),
  google('google.ad_group.set_cpc_bid', { ad_group_id: GId(), cpc_bid: Money() }),
  google('google.ad.set_status', { ad_group_id: GId(), ad_id: GId(), status: GoogleStatus() }),
  google('google.keyword.add', {
    ad_group_id: GId(),
    text: KeywordText(),
    match_type: MatchType(),
    cpc_bid: Money().optional(),
  }),
  google('google.keyword.set_status', { ad_group_id: GId(), criterion_id: GId(), status: GoogleStatus() }),
  google('google.keyword.set_cpc_bid', { ad_group_id: GId(), criterion_id: GId(), cpc_bid: Money() }),
  google('google.negative_keyword.add', {
    level: z.enum(['campaign', 'ad_group']),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    text: KeywordText(),
    match_type: MatchType(),
  }),
  google('google.negative_keyword.remove', {
    level: z.enum(['campaign', 'ad_group']),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    criterion_id: GId(),
  }),

  // ─── Meta Ads ───────────────────────────────────────────────────────────────
  meta('meta.campaign.set_status', { campaign_id: MId(), status: MetaStatus() }),
  meta('meta.campaign.set_daily_budget', { campaign_id: MId(), daily_budget: Money() }),
  meta('meta.campaign.rename', { campaign_id: MId(), name: Name() }),
  meta('meta.campaign.set_spend_cap', { campaign_id: MId(), spend_cap: Money() }),
  meta('meta.adset.set_status', { adset_id: MId(), status: MetaStatus() }),
  meta('meta.adset.set_daily_budget', { adset_id: MId(), daily_budget: Money() }),
  meta('meta.adset.rename', { adset_id: MId(), name: Name() }),
  meta('meta.adset.set_bid_amount', { adset_id: MId(), bid_amount: Money() }),
  meta('meta.adset.set_end_time', { adset_id: MId(), end_time: IsoDateTime() }),
  meta('meta.adset.update_targeting', {
    adset_id: MId(),
    age_min: z.number().int().min(13).max(65).optional(),
    age_max: z.number().int().min(13).max(65).optional(),
    /** Meta encoding: 1 = male, 2 = female. Empty array = all. */
    genders: z.array(z.union([z.literal(1), z.literal(2)])).max(2).optional(),
    /** ISO 3166-1 alpha-2. Replaces geo_locations.countries only. */
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(50).optional(),
    publisher_platforms: z
      .array(z.enum(['facebook', 'instagram', 'audience_network', 'messenger', 'threads']))
      .min(1)
      .optional(),
  }),
  meta('meta.ad.set_status', { ad_id: MId(), status: MetaStatus() }),
  meta('meta.ad.rename', { ad_id: MId(), name: Name() }),
])

export type AdsCommand = z.infer<typeof AdsCommandSchema>
export type AdsCommandType = AdsCommand['type']
export type CommandOf<T extends AdsCommandType> = Extract<AdsCommand, { type: T }>

type CatalogEntry = {
  platform: AdsPlatform
  resourceType: ResourceType
  risk: RiskLevel
  /** Short operator-facing label for history rows and the MCP catalog. */
  label: string
}

export const COMMAND_CATALOG: Record<AdsCommandType, CatalogEntry> = {
  'google.campaign.set_status': { platform: 'google', resourceType: 'campaign', risk: 1, label: 'Set campaign status' },
  'google.campaign.set_daily_budget': { platform: 'google', resourceType: 'campaign', risk: 1, label: 'Set campaign daily budget' },
  'google.campaign.rename': { platform: 'google', resourceType: 'campaign', risk: 1, label: 'Rename campaign' },
  'google.ad_group.set_status': { platform: 'google', resourceType: 'ad_group', risk: 1, label: 'Set ad group status' },
  'google.ad_group.rename': { platform: 'google', resourceType: 'ad_group', risk: 1, label: 'Rename ad group' },
  'google.ad_group.set_cpc_bid': { platform: 'google', resourceType: 'ad_group', risk: 3, label: 'Set ad group max CPC' },
  'google.ad.set_status': { platform: 'google', resourceType: 'ad', risk: 1, label: 'Set ad status' },
  'google.keyword.add': { platform: 'google', resourceType: 'keyword', risk: 2, label: 'Add keyword' },
  'google.keyword.set_status': { platform: 'google', resourceType: 'keyword', risk: 2, label: 'Set keyword status' },
  'google.keyword.set_cpc_bid': { platform: 'google', resourceType: 'keyword', risk: 3, label: 'Set keyword max CPC' },
  'google.negative_keyword.add': { platform: 'google', resourceType: 'negative_keyword', risk: 2, label: 'Add negative keyword' },
  'google.negative_keyword.remove': { platform: 'google', resourceType: 'negative_keyword', risk: 2, label: 'Remove negative keyword' },
  'meta.campaign.set_status': { platform: 'meta', resourceType: 'campaign', risk: 1, label: 'Set campaign status' },
  'meta.campaign.set_daily_budget': { platform: 'meta', resourceType: 'campaign', risk: 1, label: 'Set campaign daily budget (CBO)' },
  'meta.campaign.rename': { platform: 'meta', resourceType: 'campaign', risk: 1, label: 'Rename campaign' },
  'meta.campaign.set_spend_cap': { platform: 'meta', resourceType: 'campaign', risk: 2, label: 'Set campaign spend cap' },
  'meta.adset.set_status': { platform: 'meta', resourceType: 'adset', risk: 1, label: 'Set ad set status' },
  'meta.adset.set_daily_budget': { platform: 'meta', resourceType: 'adset', risk: 1, label: 'Set ad set daily budget (ABO)' },
  'meta.adset.rename': { platform: 'meta', resourceType: 'adset', risk: 1, label: 'Rename ad set' },
  'meta.adset.set_bid_amount': { platform: 'meta', resourceType: 'adset', risk: 3, label: 'Set ad set bid amount' },
  'meta.adset.set_end_time': { platform: 'meta', resourceType: 'adset', risk: 1, label: 'Set ad set end time' },
  'meta.adset.update_targeting': { platform: 'meta', resourceType: 'adset', risk: 2, label: 'Update ad set targeting' },
  'meta.ad.set_status': { platform: 'meta', resourceType: 'ad', risk: 1, label: 'Set ad status' },
  'meta.ad.rename': { platform: 'meta', resourceType: 'ad', risk: 1, label: 'Rename ad' },
}

/**
 * Cross-field rules a discriminated union can't hold (zod rejects ZodEffects
 * members). Returns an error message, or null when the command is coherent.
 */
export function checkCommandShape(cmd: AdsCommand): string | null {
  if (cmd.type === 'google.negative_keyword.add' || cmd.type === 'google.negative_keyword.remove') {
    if (cmd.level === 'campaign' && !cmd.campaign_id) return 'campaign_id is required for a campaign-level negative keyword'
    if (cmd.level === 'ad_group' && !cmd.ad_group_id) return 'ad_group_id is required for an ad-group-level negative keyword'
  }
  if (cmd.type === 'meta.adset.update_targeting') {
    const { age_min, age_max, genders, countries, publisher_platforms } = cmd
    if ([age_min, age_max, genders, countries, publisher_platforms].every((v) => v === undefined)) {
      return 'Provide at least one targeting field to change'
    }
    if (age_min !== undefined && age_max !== undefined && age_min > age_max) return 'age_min must be <= age_max'
  }
  return null
}

/** Parse untrusted input into a command, with the cross-field checks applied. */
export function parseCommand(input: unknown): { ok: true; command: AdsCommand } | { ok: false; message: string } {
  const parsed = AdsCommandSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.')
    return { ok: false, message: `${path ? `${path}: ` : ''}${issue?.message ?? 'Invalid command'}` }
  }
  const shapeError = checkCommandShape(parsed.data)
  if (shapeError) return { ok: false, message: shapeError }
  return { ok: true, command: parsed.data }
}

/** The id of the resource a command targets, for history rows. */
export function targetResourceId(cmd: AdsCommand): string | null {
  switch (cmd.type) {
    case 'google.campaign.set_status':
    case 'google.campaign.set_daily_budget':
    case 'google.campaign.rename':
    case 'meta.campaign.set_status':
    case 'meta.campaign.set_daily_budget':
    case 'meta.campaign.rename':
    case 'meta.campaign.set_spend_cap':
      return cmd.campaign_id
    case 'google.ad_group.set_status':
    case 'google.ad_group.rename':
    case 'google.ad_group.set_cpc_bid':
      return cmd.ad_group_id
    case 'google.ad.set_status':
      return `${cmd.ad_group_id}~${cmd.ad_id}`
    case 'google.keyword.set_status':
    case 'google.keyword.set_cpc_bid':
    case 'google.negative_keyword.remove':
      return cmd.criterion_id
    case 'google.keyword.add':
    case 'google.negative_keyword.add':
      return null
    case 'meta.adset.set_status':
    case 'meta.adset.set_daily_budget':
    case 'meta.adset.rename':
    case 'meta.adset.set_bid_amount':
    case 'meta.adset.set_end_time':
    case 'meta.adset.update_targeting':
      return cmd.adset_id
    case 'meta.ad.set_status':
    case 'meta.ad.rename':
      return cmd.ad_id
  }
}
