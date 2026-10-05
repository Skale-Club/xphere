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
const Sha256 = () => z.string().regex(/^[a-f0-9]{64}$/, 'Must be a lowercase hex SHA-256 digest')
const HashedAddress = () => z.object({
  hashed_first_name: Sha256(),
  hashed_last_name: Sha256(),
  country_code: z.string().regex(/^[A-Z]{2}$/),
  postal_code: z.string().trim().min(1).max(20),
}).strict()
const Consent = () => z.enum(['GRANTED', 'DENIED', 'UNSPECIFIED'])
const Level = () => z.enum(['campaign', 'ad_group'])
const UpperSnake = () => z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Use the platform enum value, e.g. LEAD_GENERATION')
const JsonObject = () => z.record(z.string(), z.unknown())
const MetaRegionalCategory = () =>
  z.enum(['TAIWAN_FINSERV', 'AUSTRALIA_FINSERV', 'INDIA_FINSERV', 'TAIWAN_UNIVERSAL', 'SINGAPORE_UNIVERSAL', 'THAILAND_UNIVERSAL', 'BRAZIL_REGULATION'])
const MetaBidStrategy = () =>
  z.enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'])
const GoogleBusinessTarget = () =>
  z.string().regex(/^accounts\/[^/]+\/locations\/[^/]+$/, 'Use accounts/{account_id}/locations/{location_id}')
const GoogleBusinessCategory = () =>
  z.string().trim().min(1).max(255).transform((value) => value.replace(/^categories\//, ''))
const GoogleBusinessTime = () =>
  z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (or 24:00)')
const GoogleBusinessDay = () => z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])

const google = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ platform: z.literal('google'), ad_account_id: GId(), type: z.literal(type), ...shape }).strict()

const meta = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ platform: z.literal('meta'), ad_account_id: MetaAccount(), type: z.literal(type), ...shape }).strict()

const googleBusiness = <K extends string, T extends z.ZodRawShape>(type: K, shape: T) =>
  z.object({ platform: z.literal('google_business'), ad_account_id: GoogleBusinessTarget(), type: z.literal(type), ...shape }).strict()

export const AdsCommandSchema = z.discriminatedUnion('type', [
  // ─── Google Ads ─────────────────────────────────────────────────────────────
  google('google.campaign.set_status', { campaign_id: GId(), status: GoogleStatus() }),
  google('google.campaign.set_daily_budget', { campaign_id: GId(), daily_budget: Money() }),
  google('google.campaign.rename', { campaign_id: GId(), name: Name() }),
  google('google.ad_group.set_status', { ad_group_id: GId(), status: GoogleStatus() }),
  google('google.ad_group.rename', { ad_group_id: GId(), name: Name() }),
  google('google.ad_group.set_cpc_bid', { ad_group_id: GId(), cpc_bid: Money() }),
  google('google.ad_group.set_rotation_mode', {
    ad_group_id: GId(),
    rotation_mode: z.enum(['OPTIMIZE', 'ROTATE_INDEFINITELY']),
  }),
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
    /** 1.2 = +20%; not allowed on exclusions. */
    bid_modifier: z.number().min(0.1).max(10).optional(),
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
    contains_eu_political_advertising: z.boolean().default(false),
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

  // ─── Round 4: bidding, budgets, proximity, keyword removal, Display ─────────
  google('google.campaign.set_bidding_strategy', {
    campaign_id: GId(),
    strategy: z.enum(['MANUAL_CPC', 'MAXIMIZE_CLICKS', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE']),
    /** Only with MAXIMIZE_CONVERSIONS (this is Google's "Target CPA"). */
    target_cpa: Money().optional(),
    /** Only with MAXIMIZE_CONVERSION_VALUE (Google's "Target ROAS"); 3.5 = 350%. */
    target_roas: z.number().positive().max(1000).optional(),
    /** Only with MAXIMIZE_CLICKS. */
    cpc_bid_ceiling: Money().optional(),
  }),
  google('google.campaign.set_cpc_bid_ceiling', { campaign_id: GId(), cpc_bid_ceiling: Money() }),
  /** Total (campaign-lifetime) budget; the campaign needs an end date. */
  google('google.campaign.set_total_budget', { campaign_id: GId(), total_budget: Money() }),
  google('google.campaign.add_proximity', {
    campaign_id: GId(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius: z.number().positive().max(800),
    radius_units: z.enum(['KILOMETERS', 'MILES']).default('KILOMETERS'),
    bid_modifier: z.number().min(0.1).max(10).optional(),
  }),
  google('google.campaign.remove_proximity', { campaign_id: GId(), criterion_id: GId() }),
  /** Irreversible in Google Ads; rollback re-adds a keyword with the same text and match type (new id). */
  google('google.keyword.remove', { ad_group_id: GId(), criterion_id: GId() }),
  google('google.campaign.create_display', {
    name: Name(),
    daily_budget: Money(),
    bidding: z.enum(['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC']),
    target_cpa: Money().optional(),
    start_date_time: GoogleDateTime().optional(),
    end_date_time: GoogleDateTime().optional(),
    location_ids: z.array(GId()).min(1).max(50),
    language_ids: z.array(GId()).max(20).default([]),
    contains_eu_political_advertising: z.boolean().default(false),
  }),
  google('google.ad_group.create_display', { campaign_id: GId(), name: Name(), cpc_bid: Money().optional() }),

  // ─── Round 4: ad assets (extensions) ────────────────────────────────────────
  google('google.asset.add_sitelink', {
    level: Level(),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    link_text: z.string().trim().min(1).max(25),
    final_url: Url(),
    description1: z.string().trim().max(35).optional(),
    description2: z.string().trim().max(35).optional(),
  }),
  google('google.asset.add_callout', {
    level: Level(),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    text: z.string().trim().min(1).max(25),
  }),
  google('google.asset.add_structured_snippet', {
    level: Level(),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    /** Google's predefined header, e.g. "Services", "Brands", "Types", "Amenities". */
    header: z.string().trim().min(1).max(50),
    values: z.array(z.string().trim().min(1).max(25)).min(3).max(10),
  }),
  google('google.asset.add_call', {
    level: Level(),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    country_code: z.string().regex(/^[A-Z]{2}$/),
    phone_number: z.string().trim().min(4).max(30),
  }),
  google('google.asset.unlink', {
    level: Level(),
    campaign_id: GId().optional(),
    ad_group_id: GId().optional(),
    asset_id: GId(),
    field_type: z.enum(['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL']),
  }),

  // ─── Round 4: Customer Match ────────────────────────────────────────────────
  google('google.user_list.create', {
    name: Name(),
    description: z.string().trim().max(500).optional(),
    membership_life_span_days: z.number().int().refine((v) => (v >= 1 && v <= 540) || v === 10_000, {
      message: 'Use 1-540 days, or 10000 for no expiration',
    }).default(540),
  }),
  google('google.user_list.rename', { user_list_id: GId(), name: Name() }),
  /** Permanent. Detaches the list from every ad group/campaign using it. */
  google('google.user_list.remove', { user_list_id: GId() }),
  /**
   * Hashes only — normalise (trim, lowercase; phones E.164) then SHA-256.
   * The MCP tool and dashboard hash raw contacts server-side; raw PII is
   * never accepted here, so it never reaches the change ledger.
   */
  google('google.user_list.upload', {
    user_list_id: GId(),
    hashed_emails: z.array(Sha256()).max(10_000).default([]),
    hashed_phones: z.array(Sha256()).max(10_000).default([]),
    hashed_addresses: z.array(HashedAddress()).max(10_000).default([]),
    operation_type: z.enum(['ADD', 'REMOVE']).default('ADD'),
    consent_ad_user_data: Consent().default('UNSPECIFIED'),
    consent_ad_personalization: Consent().default('UNSPECIFIED'),
  }),
  google('google.user_list.attach', {
    ad_group_id: GId(),
    user_list_id: GId(),
    exclude: z.boolean().default(false),
    targeting_mode: z.enum(['UNCHANGED', 'TARGETING', 'OBSERVATION']).default('UNCHANGED'),
  }),
  google('google.user_list.detach', { ad_group_id: GId(), criterion_id: GId() }),

  // ─── Google Business Profile ──────────────────────────────────────────────
  // These mirror the complete Windsor google_my_business write surface. The
  // composite target keeps both ids required by the legacy v4 Posts/Reviews/
  // Media endpoints while remaining one tenant-scoped connection key.
  googleBusiness('google_business.local_post.create', {
    summary: z.string().trim().min(1).max(1500),
    language_code: z.string().trim().min(2).max(35).default('en'),
    photo_url: Url().optional(),
    cta_type: z.enum(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']).optional(),
    cta_url: Url().optional(),
    topic_type: z.enum(['STANDARD', 'EVENT', 'OFFER', 'ALERT']).default('STANDARD'),
    // EVENT and OFFER posts: title and the period they run (ISO datetimes).
    event: z.object({
      title: z.string().trim().min(1).max(58),
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
    }).strict().optional(),
    offer: z.object({
      coupon_code: z.string().trim().min(1).max(58).optional(),
      redeem_online_url: Url().optional(),
      terms: z.string().trim().min(1).max(5000).optional(),
    }).strict().optional(),
  }),
  googleBusiness('google_business.local_post.delete', {
    post_id: z.string().trim().min(1).max(500),
  }),
  googleBusiness('google_business.local_post.update', {
    post_id: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(1500).optional(),
    photo_url: Url().optional(),
    cta_type: z.enum(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']).optional(),
    cta_url: Url().optional(),
  }),
  googleBusiness('google_business.review.reply', {
    review_id: z.string().trim().min(1).max(500),
    comment: z.string().trim().min(1).max(4096),
  }),
  googleBusiness('google_business.review.delete_reply', {
    review_id: z.string().trim().min(1).max(500),
  }),
  googleBusiness('google_business.media.upload', {
    photo_url: Url(),
    category: z.enum(['ADDITIONAL', 'COVER', 'PROFILE', 'LOGO', 'EXTERIOR', 'INTERIOR', 'PRODUCT', 'AT_WORK', 'FOOD_AND_DRINK', 'MENU', 'COMMON_AREA', 'ROOMS', 'TEAMS']).default('ADDITIONAL'),
  }),
  googleBusiness('google_business.location.update_info', {
    // null clears the field on the profile.
    description: z.string().trim().min(1).max(750).nullable().optional(),
    primary_phone: z.string().trim().min(1).max(40).optional(),
    website_url: Url().nullable().optional(),
  }),
  googleBusiness('google_business.location.update_service_items', {
    service_items: z.array(z.object({
      service_type_id: z.string().trim().min(1).optional(),
      category_id: GoogleBusinessCategory().optional(),
      display_name: z.string().trim().min(1).max(140).optional(),
      description: z.string().trim().min(1).max(300).optional(),
      language_code: z.string().trim().min(2).max(35).optional(),
      price: z.object({ currency_code: z.string().regex(/^[A-Z]{3}$/), amount: z.union([z.number().nonnegative(), z.string().regex(/^\d+(?:\.\d{1,9})?$/)]) }).strict().optional(),
    }).strict()).min(1).max(100),
  }),
  googleBusiness('google_business.location.update_categories', {
    primary_category_id: GoogleBusinessCategory(),
    additional_category_ids: z.array(GoogleBusinessCategory()).max(9).default([]),
  }),
  googleBusiness('google_business.location.update_service_area', {
    business_type: z.enum(['CUSTOMER_LOCATION_ONLY', 'CUSTOMER_AND_BUSINESS_LOCATION']),
    places: z.array(z.object({ place_name: z.string().trim().min(1).max(255), place_id: z.string().trim().min(1).max(255) }).strict()).min(1).max(20),
  }),
  googleBusiness('google_business.location.update_attributes', {
    attributes: z.array(z.object({
      attribute_id: z.string().trim().min(1).max(255),
      values: z.array(z.union([z.boolean(), z.string()])).min(1).optional(),
      uri_values: z.array(Url()).min(1).optional(),
      set_enum_values: z.array(z.string().trim().min(1)).min(1).optional(),
      unset_enum_values: z.array(z.string().trim().min(1)).min(1).optional(),
    }).strict()).max(100).default([]),
    unset_attribute_ids: z.array(z.string().trim().min(1).max(255)).max(100).default([]),
  }),
  googleBusiness('google_business.location.update_address', {
    region_code: z.string().regex(/^[A-Z]{2}$/),
    address_lines: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
    administrative_area: z.string().trim().min(1).max(100).optional(),
    locality: z.string().trim().min(1).max(100).optional(),
    postal_code: z.string().trim().min(1).max(30).optional(),
    acknowledge_reverification_risk: z.literal(true),
  }),
  googleBusiness('google_business.location.set_regular_hours', {
    periods: z.array(z.object({
      open_day: GoogleBusinessDay(), open_time: GoogleBusinessTime(),
      close_day: GoogleBusinessDay().optional(), close_time: GoogleBusinessTime(),
    }).strict()).min(1).max(70),
  }),
  googleBusiness('google_business.location.set_special_hours', {
    periods: z.array(z.object({
      date: z.string().date(), closed: z.boolean().default(false),
      open_time: GoogleBusinessTime().optional(), close_time: GoogleBusinessTime().optional(),
    }).strict()).min(1).max(100),
  }),
  googleBusiness('google_business.location.set_open_status', {
    status: z.enum(['OPEN', 'CLOSED_TEMPORARILY']),
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
    lifetime_budget: Money().optional(),
    is_adset_budget_sharing_enabled: z.boolean().optional(),
    bid_strategy: MetaBidStrategy().optional(),
  }),
  meta('meta.ad.create', {
    adset_id: MId(),
    name: Name(),
    /** An existing creative of the same ad account (see ads_meta_list_creatives). */
    creative_id: MId(),
  }),
  /** Create a paused ad from a complete Meta creative reference/spec. */
  meta('meta.ad.create_from_spec', {
    adset_id: MId(),
    name: Name(),
    creative: JsonObject(),
  }),
  meta('meta.ad.update_settings', {
    ad_id: MId(),
    name: Name().optional(),
    conversion_domain: z.string().trim().min(1).max(255).optional(),
    display_sequence: z.number().int().min(0).optional(),
  }),

  // ─── Round 4: ad sets, lifetime budgets, settings ───────────────────────────
  meta('meta.adset.create', {
    campaign_id: MId(),
    name: Name(),
    /** e.g. LEAD_GENERATION, OFFSITE_CONVERSIONS, LINK_CLICKS, LANDING_PAGE_VIEWS, REACH, CONVERSATIONS, POST_ENGAGEMENT. */
    optimization_goal: UpperSnake(),
    /** Usually IMPRESSIONS. */
    billing_event: UpperSnake().default('IMPRESSIONS'),
    /** Full Meta targeting spec, e.g. {"geo_locations":{"countries":["PT"]},"age_min":25}. */
    targeting: JsonObject(),
    daily_budget: Money().optional(),
    lifetime_budget: Money().optional(),
    start_time: IsoDateTime().optional(),
    end_time: IsoDateTime().optional(),
    bid_strategy: MetaBidStrategy().optional(),
    bid_amount: Money().optional(),
    /** e.g. {"pixel_id":"…","custom_event_type":"LEAD"} or {"page_id":"…"}. */
    promoted_object: JsonObject().optional(),
    /** e.g. WEBSITE, ON_AD, MESSENGER, WHATSAPP, INSTAGRAM_DIRECT, ON_POST. */
    destination_type: UpperSnake().optional(),
    /** Required for ads delivered in the EU. */
    dsa_beneficiary: z.string().trim().max(512).optional(),
    dsa_payor: z.string().trim().max(512).optional(),
    regional_regulated_categories: z.array(MetaRegionalCategory()).optional(),
    regional_regulation_identities: z.record(z.string(), z.string()).optional(),
    /** Unmodelled Meta fields. Reserved/core keys are rejected by checkCommandShape. */
    extra_params: JsonObject().optional(),
  }),
  meta('meta.campaign.set_lifetime_budget', { campaign_id: MId(), lifetime_budget: Money() }),
  meta('meta.adset.set_lifetime_budget', { adset_id: MId(), lifetime_budget: Money(), end_time: IsoDateTime().optional() }),
  meta('meta.adset.update_settings', {
    adset_id: MId(),
    optimization_goal: UpperSnake().optional(),
    destination_type: UpperSnake().optional(),
    dsa_beneficiary: z.string().trim().max(512).optional(),
    dsa_payor: z.string().trim().max(512).optional(),
    regional_regulated_categories: z.array(MetaRegionalCategory()).optional(),
    regional_regulation_identities: z.record(z.string(), z.string()).optional(),
    /** e.g. [{"event_type":"CLICK_THROUGH","window_days":7}]. */
    attribution_spec: z.array(JsonObject()).max(10).optional(),
    /** Unmodelled Meta fields. Reserved/core keys are rejected by checkCommandShape. */
    extra_params: JsonObject().optional(),
  }),
  /** Replaces the whole targeting spec (interests, locations, languages, audiences...). */
  meta('meta.adset.replace_targeting', { adset_id: MId(), targeting: JsonObject() }),
  meta('meta.campaign.update_settings', {
    campaign_id: MId(),
    special_ad_categories: z.array(z.enum(['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS', 'FINANCIAL_PRODUCTS_SERVICES'])),
  }),

  // ─── Round 4: media, creatives, boosts ──────────────────────────────────────
  /** Fetched server-side (https, public hosts only, ≤ 30 MB) and uploaded to the ad account's image library. */
  meta('meta.media.upload_image', { image_url: Url(), name: z.string().trim().max(100).optional() }),
  meta('meta.media.upload_images', {
    images: z.array(z.object({ image_url: Url(), name: z.string().trim().max(100).optional() }).strict()).min(1).max(20),
  }),
  /** Meta fetches the file itself; the command waits until the video is ready. */
  meta('meta.media.upload_video', { video_url: Url(), name: Name() }),
  meta('meta.ad.create_with_creative', {
    adset_id: MId(),
    name: Name(),
    page_id: MId(),
    /** Destination URL; omit for click-to-message ads (set messaging_destination). */
    link: Url().optional(),
    message: z.string().trim().max(2000).optional(),
    headline: z.string().trim().max(255).optional(),
    description: z.string().trim().max(255).optional(),
    /** From meta.media.upload_image. */
    image_hash: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    /** From meta.media.upload_video; needs image_hash as thumbnail. */
    video_id: MId().optional(),
    /** e.g. LEARN_MORE, SIGN_UP, BOOK_NOW, CONTACT_US, WHATSAPP_MESSAGE, SEND_MESSAGE. */
    call_to_action_type: UpperSnake().optional(),
    messaging_destination: z.enum(['MESSENGER', 'INSTAGRAM_DIRECT', 'WHATSAPP']).optional(),
    instagram_user_id: MId().optional(),
  }),
  /** Creatives are immutable: builds a copy with the changes and repoints the ad. Rollback repoints to the old creative. */
  meta('meta.ad.update_creative', {
    ad_id: MId(),
    message: z.string().trim().max(2000).optional(),
    headline: z.string().trim().max(255).optional(),
    description: z.string().trim().max(255).optional(),
    link: Url().optional(),
    image_hash: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    call_to_action_type: UpperSnake().optional(),
    /** e.g. "utm_source=facebook&utm_medium=paid"; "" clears it. */
    url_tags: z.string().max(1024).optional(),
    /** Carousel: which card (0-based) headline/description/link/image apply to. */
    card_index: z.number().int().min(0).max(9).optional(),
    /** Advantage+ creative enhancements; {} resets to Meta defaults. */
    degrees_of_freedom_spec: JsonObject().optional(),
  }),
  /** Promote an existing organic post ("{page_id}_{post_id}") as an ad in an engagement ad set. */
  meta('meta.post.boost', {
    adset_id: MId(),
    post_id: z.string().regex(/^\d+_\d+$/, 'Use the full "{page_id}_{post_id}" id'),
    name: Name(),
    call_to_action_type: UpperSnake().optional(),
  }),
  /** Click-to-message ads: greeting shown when the conversation opens. */
  meta('meta.ad.set_welcome_message', {
    ad_id: MId(),
    welcome_message: z.string().trim().min(1).max(300).optional(),
    welcome_message_spec: JsonObject().optional(),
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
  'google.ad_group.set_rotation_mode': { platform: 'google', resourceType: 'ad_group', risk: 1, label: 'Set ad group rotation mode' },
  'google.ad.set_status': { platform: 'google', resourceType: 'ad', risk: 1, label: 'Set ad status' },
  'google.keyword.add': { platform: 'google', resourceType: 'keyword', risk: 2, label: 'Add keyword' },
  'google.keyword.set_status': { platform: 'google', resourceType: 'keyword', risk: 2, label: 'Set keyword status' },
  'google.keyword.set_cpc_bid': { platform: 'google', resourceType: 'keyword', risk: 3, label: 'Set keyword max CPC' },
  'google.negative_keyword.add': { platform: 'google', resourceType: 'negative_keyword', risk: 2, label: 'Add negative keyword' },
  'google.negative_keyword.remove': { platform: 'google', resourceType: 'negative_keyword', risk: 2, label: 'Remove negative keyword' },
  'google_business.local_post.create': { platform: 'google_business', resourceType: 'local_post', risk: 4, label: 'Publish Google Business Profile post' },
  'google_business.local_post.update': { platform: 'google_business', resourceType: 'local_post', risk: 2, label: 'Update Google Business Profile post' },
  'google_business.local_post.delete': { platform: 'google_business', resourceType: 'local_post', risk: 3, label: 'Delete Google Business Profile post' },
  'google_business.review.reply': { platform: 'google_business', resourceType: 'review', risk: 3, label: 'Reply to Google review' },
  'google_business.review.delete_reply': { platform: 'google_business', resourceType: 'review', risk: 3, label: 'Delete reply to Google review' },
  'google_business.media.upload': { platform: 'google_business', resourceType: 'media', risk: 4, label: 'Upload Google Business Profile photo' },
  'google_business.location.update_info': { platform: 'google_business', resourceType: 'location', risk: 2, label: 'Update Google Business Profile information' },
  'google_business.location.update_service_items': { platform: 'google_business', resourceType: 'service_item', risk: 2, label: 'Replace Google Business Profile services' },
  'google_business.location.update_categories': { platform: 'google_business', resourceType: 'location', risk: 4, label: 'Replace Google Business Profile categories' },
  'google_business.location.update_service_area': { platform: 'google_business', resourceType: 'location', risk: 3, label: 'Replace Google Business Profile service area' },
  'google_business.location.update_attributes': { platform: 'google_business', resourceType: 'attribute', risk: 2, label: 'Update Google Business Profile attributes' },
  'google_business.location.update_address': { platform: 'google_business', resourceType: 'location', risk: 4, label: 'Replace Google Business Profile address' },
  'google_business.location.set_regular_hours': { platform: 'google_business', resourceType: 'location', risk: 2, label: 'Replace Google Business Profile regular hours' },
  'google_business.location.set_special_hours': { platform: 'google_business', resourceType: 'location', risk: 2, label: 'Replace Google Business Profile special hours' },
  'google_business.location.set_open_status': { platform: 'google_business', resourceType: 'location', risk: 4, label: 'Set Google Business Profile open status' },
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
  'meta.ad.create_from_spec': { platform: 'meta', resourceType: 'ad', risk: 4, label: 'Create ad from full creative spec (paused)' },
  'meta.ad.update_settings': { platform: 'meta', resourceType: 'ad', risk: 2, label: 'Update ad settings' },
  'google.campaign.set_bidding_strategy': { platform: 'google', resourceType: 'campaign', risk: 3, label: 'Change campaign bidding strategy' },
  'google.campaign.set_cpc_bid_ceiling': { platform: 'google', resourceType: 'campaign', risk: 3, label: 'Set Maximize Clicks CPC ceiling' },
  'google.campaign.set_total_budget': { platform: 'google', resourceType: 'campaign', risk: 2, label: 'Set campaign total budget' },
  'google.campaign.add_proximity': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Add radius targeting' },
  'google.campaign.remove_proximity': { platform: 'google', resourceType: 'campaign_criterion', risk: 2, label: 'Remove radius targeting' },
  'google.keyword.remove': { platform: 'google', resourceType: 'keyword', risk: 2, label: 'Remove keyword' },
  'google.campaign.create_display': { platform: 'google', resourceType: 'campaign', risk: 4, label: 'Create Display campaign (paused)' },
  'google.ad_group.create_display': { platform: 'google', resourceType: 'ad_group', risk: 4, label: 'Create Display ad group (paused)' },
  'google.asset.add_sitelink': { platform: 'google', resourceType: 'asset', risk: 2, label: 'Add sitelink' },
  'google.asset.add_callout': { platform: 'google', resourceType: 'asset', risk: 2, label: 'Add callout' },
  'google.asset.add_structured_snippet': { platform: 'google', resourceType: 'asset', risk: 2, label: 'Add structured snippet' },
  'google.asset.add_call': { platform: 'google', resourceType: 'asset', risk: 2, label: 'Add call asset' },
  'google.asset.unlink': { platform: 'google', resourceType: 'asset', risk: 2, label: 'Remove asset from campaign/ad group' },
  'google.user_list.create': { platform: 'google', resourceType: 'user_list', risk: 2, label: 'Create Customer Match list' },
  'google.user_list.rename': { platform: 'google', resourceType: 'user_list', risk: 1, label: 'Rename Customer Match list' },
  'google.user_list.remove': { platform: 'google', resourceType: 'user_list', risk: 4, label: 'Delete Customer Match list' },
  'google.user_list.upload': { platform: 'google', resourceType: 'user_list', risk: 3, label: 'Upload contacts to Customer Match list' },
  'google.user_list.attach': { platform: 'google', resourceType: 'ad_group', risk: 2, label: 'Target/exclude Customer Match list in ad group' },
  'google.user_list.detach': { platform: 'google', resourceType: 'ad_group', risk: 2, label: 'Remove Customer Match list from ad group' },
  'meta.adset.create': { platform: 'meta', resourceType: 'adset', risk: 4, label: 'Create ad set (paused)' },
  'meta.campaign.set_lifetime_budget': { platform: 'meta', resourceType: 'campaign', risk: 2, label: 'Set campaign lifetime budget' },
  'meta.adset.set_lifetime_budget': { platform: 'meta', resourceType: 'adset', risk: 2, label: 'Set ad set lifetime budget' },
  'meta.adset.update_settings': { platform: 'meta', resourceType: 'adset', risk: 3, label: 'Update ad set settings' },
  'meta.adset.replace_targeting': { platform: 'meta', resourceType: 'adset', risk: 3, label: 'Replace ad set targeting' },
  'meta.campaign.update_settings': { platform: 'meta', resourceType: 'campaign', risk: 2, label: 'Update campaign special ad categories' },
  'meta.media.upload_image': { platform: 'meta', resourceType: 'media', risk: 1, label: 'Upload ad image' },
  'meta.media.upload_images': { platform: 'meta', resourceType: 'media', risk: 1, label: 'Upload multiple ad images' },
  'meta.media.upload_video': { platform: 'meta', resourceType: 'media', risk: 1, label: 'Upload ad video' },
  'meta.ad.create_with_creative': { platform: 'meta', resourceType: 'ad', risk: 4, label: 'Create ad with new creative (paused)' },
  'meta.ad.update_creative': { platform: 'meta', resourceType: 'ad', risk: 3, label: 'Edit ad creative' },
  'meta.post.boost': { platform: 'meta', resourceType: 'ad', risk: 4, label: 'Boost post (paused)' },
  'meta.ad.set_welcome_message': { platform: 'meta', resourceType: 'ad', risk: 2, label: 'Set click-to-message welcome message' },
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
  if (cmd.type === 'google.campaign.add_location' && cmd.negative && cmd.bid_modifier !== undefined) {
    return 'bid_modifier is not allowed on an excluded location'
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
  if (
    cmd.type === 'google.asset.add_sitelink' || cmd.type === 'google.asset.add_callout' ||
    cmd.type === 'google.asset.add_structured_snippet' || cmd.type === 'google.asset.add_call' ||
    cmd.type === 'google.asset.unlink'
  ) {
    if (cmd.level === 'campaign' && !cmd.campaign_id) return 'campaign_id is required for a campaign-level asset'
    if (cmd.level === 'ad_group' && !cmd.ad_group_id) return 'ad_group_id is required for an ad-group-level asset'
  }
  if (cmd.type === 'google.campaign.set_bidding_strategy') {
    if (cmd.target_cpa !== undefined && cmd.strategy !== 'MAXIMIZE_CONVERSIONS') return 'target_cpa only applies to MAXIMIZE_CONVERSIONS'
    if (cmd.target_roas !== undefined && cmd.strategy !== 'MAXIMIZE_CONVERSION_VALUE') return 'target_roas only applies to MAXIMIZE_CONVERSION_VALUE'
    if (cmd.cpc_bid_ceiling !== undefined && cmd.strategy !== 'MAXIMIZE_CLICKS') return 'cpc_bid_ceiling only applies to MAXIMIZE_CLICKS'
  }
  if (cmd.type === 'google.campaign.create_display') {
    if (cmd.target_cpa !== undefined && cmd.bidding !== 'MAXIMIZE_CONVERSIONS') return 'target_cpa only applies to MAXIMIZE_CONVERSIONS'
    if (cmd.start_date_time && cmd.end_date_time && cmd.start_date_time >= cmd.end_date_time) return 'end_date_time must be after start_date_time'
  }
  if (
    cmd.type === 'google.user_list.upload' &&
    cmd.hashed_emails.length + cmd.hashed_phones.length + cmd.hashed_addresses.length === 0
  ) {
    return 'Provide hashed_emails, hashed_phones and/or hashed_addresses'
  }
  if (cmd.type === 'google_business.local_post.create' || cmd.type === 'google_business.local_post.update') {
    if (cmd.cta_type && cmd.cta_type !== 'CALL' && !cmd.cta_url) return `${cmd.cta_type} requires cta_url`
    if (cmd.cta_type === 'CALL' && cmd.cta_url) return 'CALL uses the profile phone number and does not accept cta_url'
    if (cmd.type === 'google_business.local_post.update' && [cmd.summary, cmd.photo_url, cmd.cta_type].every((value) => value === undefined)) {
      return 'Provide summary, photo_url and/or cta_type'
    }
  }
  if (cmd.type === 'google_business.local_post.create') {
    if ((cmd.topic_type === 'EVENT' || cmd.topic_type === 'OFFER') && !cmd.event) return `${cmd.topic_type} posts need event (title, start, end)`
    if (cmd.event && Date.parse(cmd.event.end) <= Date.parse(cmd.event.start)) return 'event.end must be after event.start'
    if (cmd.offer && cmd.topic_type !== 'OFFER') return 'offer only applies to OFFER posts'
  }
  if (cmd.type === 'google_business.location.update_info') {
    if ([cmd.description, cmd.primary_phone, cmd.website_url].every((value) => value === undefined)) {
      return 'Provide description, primary_phone and/or website_url'
    }
  }
  if (cmd.type === 'google_business.location.update_service_items') {
    for (const [index, item] of cmd.service_items.entries()) {
      const structured = Boolean(item.service_type_id)
      const freeForm = Boolean(item.category_id && item.display_name)
      if (structured === freeForm) return `service_items.${index}: provide service_type_id, or category_id + display_name`
    }
  }
  if (cmd.type === 'google_business.location.update_attributes') {
    if (cmd.attributes.length === 0 && cmd.unset_attribute_ids.length === 0) return 'Provide attributes and/or unset_attribute_ids'
    for (const [index, attribute] of cmd.attributes.entries()) {
      const valueSets = [attribute.values, attribute.uri_values, attribute.set_enum_values, attribute.unset_enum_values]
      if (valueSets.every((value) => value === undefined)) return `attributes.${index}: provide at least one value field`
    }
  }
  if (cmd.type === 'google_business.location.set_regular_hours') {
    for (const [index, period] of cmd.periods.entries()) {
      if (period.open_time === '24:00') return `periods.${index}.open_time cannot be 24:00`
    }
  }
  if (cmd.type === 'google_business.location.set_special_hours') {
    for (const [index, period] of cmd.periods.entries()) {
      if (period.closed && (period.open_time || period.close_time)) return `periods.${index}: a closed date cannot have times`
      if (!period.closed && (!period.open_time || !period.close_time)) return `periods.${index}: open_time and close_time are required when not closed`
    }
  }
  if (cmd.type === 'meta.campaign.create') {
    if (cmd.daily_budget !== undefined && cmd.lifetime_budget !== undefined) return 'Provide daily_budget or lifetime_budget, not both'
    if (cmd.bid_strategy !== undefined && cmd.daily_budget === undefined && cmd.lifetime_budget === undefined) {
      return 'bid_strategy requires a campaign budget'
    }
    if (cmd.is_adset_budget_sharing_enabled === true && (cmd.daily_budget !== undefined || cmd.lifetime_budget !== undefined)) {
      return 'is_adset_budget_sharing_enabled only applies when the campaign has no campaign budget'
    }
  }
  if (cmd.type === 'meta.adset.create') {
    if (cmd.daily_budget !== undefined && cmd.lifetime_budget !== undefined) return 'Provide daily_budget or lifetime_budget, not both'
    if (cmd.lifetime_budget !== undefined && !cmd.end_time) return 'lifetime_budget requires end_time'
    if ((cmd.bid_strategy === 'LOWEST_COST_WITH_BID_CAP' || cmd.bid_strategy === 'COST_CAP') && cmd.bid_amount === undefined) {
      return `${cmd.bid_strategy} requires bid_amount`
    }
    if (cmd.start_time && cmd.end_time && cmd.start_time >= cmd.end_time) return 'end_time must be after start_time'
    if (cmd.extra_params) {
      const unsafe = Object.keys(cmd.extra_params).find((key) => !/^[a-z][a-z0-9_]*$/.test(key))
      if (unsafe) return `extra_params key ${unsafe} is not a valid Meta field name`
      const reserved = new Set([
        'campaign_id', 'name', 'optimization_goal', 'billing_event', 'targeting', 'daily_budget', 'lifetime_budget',
        'start_time', 'end_time', 'bid_strategy', 'bid_amount', 'promoted_object', 'destination_type', 'status',
        'dsa_beneficiary', 'dsa_payor', 'regional_regulated_categories', 'regional_regulation_identities',
      ])
      const collision = Object.keys(cmd.extra_params).find((key) => reserved.has(key))
      if (collision) return `extra_params cannot override ${collision}; use the named field instead`
    }
  }
  if (cmd.type === 'meta.adset.update_settings') {
    const settingKeys = [
      'optimization_goal', 'destination_type', 'dsa_beneficiary', 'dsa_payor', 'regional_regulated_categories',
      'regional_regulation_identities', 'attribution_spec', 'extra_params',
    ] as const
    if (settingKeys.every((key) => cmd[key] === undefined)) return 'Provide at least one setting to change'
    if (cmd.extra_params) {
      const unsafe = Object.keys(cmd.extra_params).find((key) => !/^[a-z][a-z0-9_]*$/.test(key))
      if (unsafe) return `extra_params key ${unsafe} is not a valid Meta field name`
      const reserved = new Set([
        'optimization_goal', 'destination_type', 'dsa_beneficiary', 'dsa_payor', 'regional_regulated_categories',
        'regional_regulation_identities', 'attribution_spec', 'status', 'name', 'targeting', 'daily_budget',
        'lifetime_budget', 'bid_amount', 'bid_strategy', 'end_time',
      ])
      const collision = Object.keys(cmd.extra_params).find((key) => reserved.has(key))
      if (collision) return `extra_params cannot override ${collision}; use the dedicated command or named field instead`
    }
  }
  if (cmd.type === 'meta.ad.update_settings') {
    if ([cmd.name, cmd.conversion_domain, cmd.display_sequence].every((value) => value === undefined)) return 'Provide at least one ad setting to change'
  }
  if (cmd.type === 'meta.ad.update_creative') {
    const creativeValues = [
      cmd.message, cmd.headline, cmd.description, cmd.link, cmd.image_hash, cmd.call_to_action_type,
      cmd.url_tags, cmd.degrees_of_freedom_spec,
    ]
    if (creativeValues.every((value) => value === undefined)) return 'Provide at least one creative field to change'
  }
  if (cmd.type === 'meta.ad.create_with_creative') {
    if (!cmd.link && !cmd.messaging_destination) return 'Provide link, or messaging_destination for a click-to-message ad'
    if (cmd.video_id && !cmd.image_hash) return 'A video ad needs image_hash as its thumbnail'
    if (!cmd.video_id && !cmd.image_hash && !cmd.messaging_destination) return 'Provide image_hash (or video_id + image_hash)'
  }
  if (cmd.type === 'meta.ad.create_from_spec' && Object.keys(cmd.creative).length === 0) {
    return 'creative must not be empty'
  }
  if (cmd.type === 'meta.ad.set_welcome_message') {
    if (!cmd.welcome_message && !cmd.welcome_message_spec) return 'Provide welcome_message or welcome_message_spec'
    if (cmd.welcome_message && cmd.welcome_message_spec) return 'Provide welcome_message or welcome_message_spec, not both'
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
