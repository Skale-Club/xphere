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
/** Google Ads v23+ campaign dates: 'yyyy-MM-dd HH:mm:ss' in the account's time zone. */
const GoogleDateTime = () =>
  z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "Use 'yyyy-MM-dd HH:mm:ss' in the account time zone")
const Url = () => z.string().url().max(2048).refine((v) => /^https?:\/\//.test(v), 'Must be an http(s) URL')
const Minute = () => z.enum(['ZERO', 'FIFTEEN', 'THIRTY', 'FORTY_FIVE'])
const Day = () => z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])
const MetaBidStrategy = () =>
  z.enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'])

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
  google('google.campaign.set_dates', {
    campaign_id: GId(),
    start_date_time: GoogleDateTime().optional(),
    end_date_time: GoogleDateTime().optional(),
  }),
  google('google.campaign.set_target_cpa', { campaign_id: GId(), target_cpa: Money() }),
  /** Ratio: 3.5 = 350% return on ad spend. */
  google('google.campaign.set_target_roas', { campaign_id: GId(), target_roas: z.number().positive().max(1000) }),
  google('google.campaign.set_tracking', {
    campaign_id: GId(),
    /** Empty string clears it. Must contain {lpurl} or a ValueTrack URL when set. */
    tracking_url_template: z.string().max(2048).optional(),
    /** Empty string clears it. e.g. "utm_source=google&utm_medium=cpc" */
    final_url_suffix: z.string().max(2048).optional(),
  }),
  google('google.campaign.add_location', {
    campaign_id: GId(),
    /** Geo target constant id, e.g. 2620 = Portugal (see ads_google_suggest_locations). */
    geo_target_constant_id: GId(),
    /** true = exclude this location. */
    negative: z.boolean().default(false),
  }),
  google('google.campaign.remove_location', { campaign_id: GId(), criterion_id: GId() }),
  google('google.campaign.add_language', {
    campaign_id: GId(),
    /** Language constant id, e.g. 1014 = Portuguese, 1000 = English. */
    language_constant_id: GId(),
  }),
  google('google.campaign.remove_language', { campaign_id: GId(), criterion_id: GId() }),
  google('google.campaign.add_ad_schedule', {
    campaign_id: GId(),
    day_of_week: Day(),
    start_hour: z.number().int().min(0).max(23),
    start_minute: Minute().default('ZERO'),
    end_hour: z.number().int().min(0).max(24),
    end_minute: Minute().default('ZERO'),
    /** Optional bid adjustment for this slot: 1.2 = +20%, 0.8 = -20%. */
    bid_modifier: z.number().min(0.1).max(10).optional(),
  }),
  google('google.campaign.remove_ad_schedule', { campaign_id: GId(), criterion_id: GId() }),
  google('google.ad.set_final_url', { ad_group_id: GId(), ad_id: GId(), final_url: Url() }),
  google('google.conversion_action.set_primary', {
    conversion_action_id: GId(),
    /** Primary actions count in the Conversions column and are used for bidding. */
    primary: z.boolean(),
  }),
  google('google.campaign.set_conversion_goal_biddable', {
    campaign_id: GId(),
    /** ConversionActionCategory, e.g. PURCHASE, SUBMIT_LEAD_FORM, BOOK_APPOINTMENT, PHONE_CALL_LEAD, CONTACT. */
    category: z.string().regex(/^[A-Z_]+$/),
    /** ConversionOrigin, e.g. WEBSITE, CALL_FROM_ADS, GOOGLE_HOSTED, APP, STORE. */
    origin: z.string().regex(/^[A-Z_]+$/),
    biddable: z.boolean(),
  }),

  // Structural (risk 4). Everything is created PAUSED — nothing starts
  // spending until someone explicitly activates it with a set_status command.
  google('google.campaign.create_search', {
    name: Name(),
    daily_budget: Money(),
    bidding: z.enum(['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC']),
    /** Only with MAXIMIZE_CONVERSIONS. */
    target_cpa: Money().optional(),
    /** Also show on Google search partners. */
    search_partners: z.boolean().default(false),
    start_date_time: GoogleDateTime().optional(),
    end_date_time: GoogleDateTime().optional(),
    /** Geo target constant ids (see ads_google_suggest_locations). At least one. */
    location_ids: z.array(GId()).min(1).max(50),
    /** Language constant ids, e.g. 1014 Portuguese, 1000 English. */
    language_ids: z.array(GId()).max(20).default([]),
  }),
  google('google.ad_group.create', {
    campaign_id: GId(),
    name: Name(),
    cpc_bid: Money().optional(),
  }),
  google('google.ad.create_responsive_search', {
    ad_group_id: GId(),
    final_url: Url(),
    /** 3–15 headlines, max 30 characters each. */
    headlines: z.array(z.string().trim().min(1).max(30)).min(3).max(15),
    /** 2–4 descriptions, max 90 characters each. */
    descriptions: z.array(z.string().trim().min(1).max(90)).min(2).max(4),
    path1: z.string().trim().max(15).optional(),
    path2: z.string().trim().max(15).optional(),
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
    /** e.g. feed, story, facebook_reels, marketplace, video_feeds, search, right_hand_column. Replaces the list. */
    facebook_positions: z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(20).optional(),
    /** e.g. stream, story, reels, explore, explore_home, profile_feed. Replaces the list. */
    instagram_positions: z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(20).optional(),
    /** Custom/lookalike audience ids to include. Replaces the list; [] removes all. */
    custom_audience_ids: z.array(MId()).max(100).optional(),
    /** Custom/lookalike audience ids to exclude. Replaces the list; [] removes all. */
    excluded_custom_audience_ids: z.array(MId()).max(100).optional(),
  }),
  meta('meta.campaign.set_bid_strategy', { campaign_id: MId(), bid_strategy: MetaBidStrategy() }),
  meta('meta.adset.set_bid_strategy', {
    adset_id: MId(),
    bid_strategy: MetaBidStrategy(),
    /** Required by bid cap / cost cap, major units. */
    bid_amount: Money().optional(),
    /** Required by LOWEST_COST_WITH_MIN_ROAS: 2.5 = 250%. */
    roas_floor: z.number().positive().max(1000).optional(),
  }),
  meta('meta.ad.set_status', { ad_id: MId(), status: MetaStatus() }),
  meta('meta.ad.rename', { ad_id: MId(), name: Name() }),
  /** Point the ad at an existing creative (built in Ads Manager or via the API). */
  meta('meta.ad.set_creative', { ad_id: MId(), creative_id: MId() }),
  /** Copies are always created PAUSED. deep_copy also copies ad sets/ads beneath. */
  meta('meta.campaign.duplicate', {
    campaign_id: MId(),
    deep_copy: z.boolean().default(false),
    rename_suffix: z.string().max(60).optional(),
  }),
  meta('meta.adset.duplicate', {
    adset_id: MId(),
    deep_copy: z.boolean().default(false),
    /** Copy into another campaign (same account). Defaults to the original campaign. */
    target_campaign_id: MId().optional(),
    rename_suffix: z.string().max(60).optional(),
  }),
  meta('meta.campaign.create', {
    name: Name(),
    objective: z.enum([
      'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS', 'OUTCOME_APP_PROMOTION',
    ]),
    /** Required by Meta; [] when none applies. */
    special_ad_categories: z.array(z.enum(['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS', 'FINANCIAL_PRODUCTS_SERVICES'])).default([]),
    /** Set to use an Advantage campaign budget (CBO); omit for ad set budgets. */
    daily_budget: Money().optional(),
    bid_strategy: MetaBidStrategy().optional(),
  }),
  meta('meta.ad.create', {
    adset_id: MId(),
    name: Name(),
    /** An existing creative of the same ad account (see ads_meta_list_creatives). */
    creative_id: MId(),
  }),
  meta('meta.ad.duplicate', {
    ad_id: MId(),
    target_adset_id: MId().optional(),
    rename_suffix: z.string().max(60).optional(),
  }),
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
  'google.campaign.set_dates': { platform: 'google', resourceType: 'campaign', risk: 1, label: 'Set campaign start/end date' },
  'google.campaign.set_target_cpa': { platform: 'google', resourceType: 'campaign', risk: 3, label: 'Set campaign target CPA' },
  'google.campaign.set_target_roas': { platform: 'google', resourceType: 'campaign', risk: 3, label: 'Set campaign target ROAS' },
  'google.campaign.set_tracking': { platform: 'google', resourceType: 'campaign', risk: 1, label: 'Set campaign tracking template / URL suffix' },
  'google.campaign.add_location': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Add location targeting' },
  'google.campaign.remove_location': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Remove location targeting' },
  'google.campaign.add_language': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Add language targeting' },
  'google.campaign.remove_language': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Remove language targeting' },
  'google.campaign.add_ad_schedule': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Add ad schedule' },
  'google.campaign.remove_ad_schedule': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Remove ad schedule' },
  'google.ad.set_final_url': { platform: 'google', resourceType: 'ad', risk: 2, label: 'Set ad final URL' },
  'google.conversion_action.set_primary': { platform: 'google', resourceType: 'conversion_action', risk: 3, label: 'Set conversion action primary/secondary' },
  'google.campaign.set_conversion_goal_biddable': { platform: 'google', resourceType: 'campaign', risk: 3, label: 'Set campaign conversion goal for bidding' },
  'meta.campaign.set_bid_strategy': { platform: 'meta', resourceType: 'campaign', risk: 3, label: 'Set campaign bid strategy' },
  'meta.adset.set_bid_strategy': { platform: 'meta', resourceType: 'adset', risk: 3, label: 'Set ad set bid strategy' },
  'meta.ad.set_creative': { platform: 'meta', resourceType: 'ad', risk: 4, label: 'Replace ad creative' },
  'meta.campaign.duplicate': { platform: 'meta', resourceType: 'campaign', risk: 4, label: 'Duplicate campaign (paused)' },
  'meta.adset.duplicate': { platform: 'meta', resourceType: 'adset', risk: 4, label: 'Duplicate ad set (paused)' },
  'meta.ad.duplicate': { platform: 'meta', resourceType: 'ad', risk: 4, label: 'Duplicate ad (paused)' },
  'google.campaign.create_search': { platform: 'google', resourceType: 'campaign', risk: 4, label: 'Create Search campaign (paused)' },
  'google.ad_group.create': { platform: 'google', resourceType: 'ad_group', risk: 4, label: 'Create ad group (paused)' },
  'google.ad.create_responsive_search': { platform: 'google', resourceType: 'ad', risk: 4, label: 'Create responsive search ad (paused)' },
  'meta.campaign.create': { platform: 'meta', resourceType: 'campaign', risk: 4, label: 'Create campaign (paused)' },
  'meta.ad.create': { platform: 'meta', resourceType: 'ad', risk: 4, label: 'Create ad from creative (paused)' },
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
    const extra = [cmd.facebook_positions, cmd.instagram_positions, cmd.custom_audience_ids, cmd.excluded_custom_audience_ids]
    if ([age_min, age_max, genders, countries, publisher_platforms, ...extra].every((v) => v === undefined)) {
      return 'Provide at least one targeting field to change'
    }
    if (age_min !== undefined && age_max !== undefined && age_min > age_max) return 'age_min must be <= age_max'
  }
  if (cmd.type === 'google.campaign.set_dates') {
    if (!cmd.start_date_time && !cmd.end_date_time) return 'Provide start_date_time and/or end_date_time'
    if (cmd.start_date_time && cmd.end_date_time && cmd.start_date_time >= cmd.end_date_time) {
      return 'end_date_time must be after start_date_time'
    }
  }
  if (cmd.type === 'google.campaign.set_tracking' && cmd.tracking_url_template === undefined && cmd.final_url_suffix === undefined) {
    return 'Provide tracking_url_template and/or final_url_suffix'
  }
  if (cmd.type === 'google.campaign.add_ad_schedule') {
    if (cmd.end_hour === 24 && cmd.end_minute !== 'ZERO') return 'end_hour 24 only allows end_minute ZERO'
    const start = cmd.start_hour * 60 + MINUTES[cmd.start_minute]
    const end = cmd.end_hour * 60 + MINUTES[cmd.end_minute]
    if (end <= start) return 'The ad schedule must end after it starts (same day)'
  }
  if (cmd.type === 'google.campaign.create_search') {
    if (cmd.target_cpa !== undefined && cmd.bidding !== 'MAXIMIZE_CONVERSIONS') return 'target_cpa only applies to MAXIMIZE_CONVERSIONS'
    if (cmd.start_date_time && cmd.end_date_time && cmd.start_date_time >= cmd.end_date_time) return 'end_date_time must be after start_date_time'
  }
  if (cmd.type === 'google.ad.create_responsive_search') {
    if (new Set(cmd.headlines.map((h) => h.toLowerCase())).size !== cmd.headlines.length) return 'Headlines must be unique'
    if (new Set(cmd.descriptions.map((d) => d.toLowerCase())).size !== cmd.descriptions.length) return 'Descriptions must be unique'
    if (cmd.path2 && !cmd.path1) return 'path2 requires path1'
  }
  if (cmd.type === 'meta.adset.set_bid_strategy') {
    if ((cmd.bid_strategy === 'LOWEST_COST_WITH_BID_CAP' || cmd.bid_strategy === 'COST_CAP') && cmd.bid_amount === undefined) {
      return `${cmd.bid_strategy} requires bid_amount`
    }
    if (cmd.bid_strategy === 'LOWEST_COST_WITH_MIN_ROAS' && cmd.roas_floor === undefined) {
      return 'LOWEST_COST_WITH_MIN_ROAS requires roas_floor'
    }
  }
  return null
}

const MINUTES = { ZERO: 0, FIFTEEN: 15, THIRTY: 30, FORTY_FIVE: 45 } as const

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

/** The id of the resource a command targets, for history rows (most specific id wins). */
export function targetResourceId(cmd: AdsCommand): string | null {
  const c = cmd as Record<string, unknown>
  // Creates have no id until the platform assigns one (checked first: a create
  // carries its parent's id, e.g. meta.ad.create has adset_id).
  if (cmd.type.includes('.create')) return null
  if (typeof c.criterion_id === 'string') return c.criterion_id
  if (typeof c.ad_id === 'string') return typeof c.ad_group_id === 'string' ? `${c.ad_group_id}~${c.ad_id}` : c.ad_id
  if (typeof c.conversion_action_id === 'string') return c.conversion_action_id
  if (typeof c.adset_id === 'string') return c.adset_id
  // Creates have no id until the platform assigns one.
  if (cmd.type === 'google.keyword.add' || cmd.type === 'google.negative_keyword.add' || cmd.type.includes('.add_') || cmd.type.includes('.create')) return null
  if (typeof c.ad_group_id === 'string') return c.ad_group_id
  if (typeof c.campaign_id === 'string') return c.campaign_id
  return null
}
