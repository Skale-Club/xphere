import { META_ADS_GRAPH_VERSION } from './meta-oauth'

const GRAPH_BASE = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}`

type MetaErrorPayload = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
  }
}

export class MetaAdsError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly subcode?: number,
    /** HTTP status of the failed call, when there was one. */
    public readonly httpStatus?: number,
    /** Meta's user-facing explanation (error_user_msg), often more precise than message. */
    public readonly userMessage?: string,
  ) {
    super(message)
    this.name = 'MetaAdsError'
  }
}

/** Runaway-loop guard when walking `paging.next` — not a result cap. */
const MAX_PAGES = 25

async function graphRequest<T>(
  path: string,
  accessToken: string,
  options?: { method?: string; body?: Record<string, unknown> },
): Promise<T> {
  const method = options?.method ?? 'GET'
  const url = new URL(`${GRAPH_BASE}/${path}`)

  if (method === 'GET') {
    url.searchParams.set('access_token', accessToken)
  }

  const fetchOptions: RequestInit = {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    cache: 'no-store',
  }

  if (method !== 'GET') {
    fetchOptions.body = JSON.stringify({ ...(options?.body ?? {}), access_token: accessToken })
  }

  const res = await fetch(url, fetchOptions)
  if (!res.ok) {
    let msg = `Meta API error ${res.status}`
    let code: number | undefined
    let subcode: number | undefined
    let userMessage: string | undefined
    try {
      const body = (await res.json()) as MetaErrorPayload
      msg = body.error?.message ?? msg
      code = body.error?.code
      subcode = body.error?.error_subcode
      userMessage = body.error?.error_user_msg
    } catch { /* ignore parse error */ }
    throw new MetaAdsError(msg, code, subcode, res.status, userMessage)
  }
  return res.json() as Promise<T>
}

type PagedResponse<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }

/**
 * Follow `paging.next` until the edge is exhausted.
 *
 * Every list call here used to send `limit=100` and read only the first page,
 * so an account with more than 100 campaigns (or ad sets, or ads) was silently
 * truncated — and because insights are joined to those lists by id, the metrics
 * for everything past the cut simply disappeared from the dashboard with no
 * indication anything was missing.
 */
async function graphRequestAll<T>(path: string, accessToken: string): Promise<T[]> {
  const items: T[] = []
  let page = await graphRequest<PagedResponse<T>>(path, accessToken)
  items.push(...(page.data ?? []))

  for (let i = 1; i < MAX_PAGES; i++) {
    const next = page.paging?.next
    if (!next) return items

    // `paging.next` is an absolute URL that already carries the access token
    // and cursor, so it is fetched directly rather than rebuilt.
    const res = await fetch(next, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      let msg = `Meta API error ${res.status}`
      let code: number | undefined
      let subcode: number | undefined
      try {
        const body = (await res.json()) as MetaErrorPayload
        msg = body.error?.message ?? msg
        code = body.error?.code
        subcode = body.error?.error_subcode
      } catch { /* ignore parse error */ }
      throw new MetaAdsError(msg, code, subcode)
    }
    page = (await res.json()) as PagedResponse<T>
    items.push(...(page.data ?? []))
  }

  console.warn('[ads/meta] paging hit the page cap; results may be truncated', {
    path: path.split('?')[0],
    pages: MAX_PAGES,
  })
  return items
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetaCampaign = {
  id: string
  name: string
  status: string
  effective_status: string
  objective: string
  daily_budget?: string
  lifetime_budget?: string
  spend_cap?: string
  start_time?: string
  stop_time?: string
  created_time: string
  updated_time: string
}

export type MetaAdSet = {
  id: string
  name: string
  campaign_id: string
  status: string
  effective_status: string
  daily_budget?: string
  lifetime_budget?: string
  targeting?: Record<string, unknown>
  created_time: string
  updated_time: string
}

export type MetaInsights = {
  impressions: string
  clicks: string
  spend: string
  reach: string
  cpc?: string
  cpm?: string
  ctr?: string
  cpp?: string
  frequency?: string
  actions?: Array<{ action_type: string; value: string }>
  date_start: string
  date_stop: string
}

export type MetaInsightsPaged = {
  data: MetaInsights[]
  paging?: { cursors?: { after?: string }; next?: string }
}

export type MetaDailyInsight = MetaInsights & { campaign_id?: string }

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function listCampaigns(
  adAccountId: string,
  accessToken: string,
): Promise<MetaCampaign[]> {
  return graphRequestAll<MetaCampaign>(
    `${adAccountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time&limit=100`,
    accessToken,
  )
}

/**
 * Current name / status / budget for one campaign — the "before" half of an
 * audit record, read before a mutation overwrites it.
 */
export async function getCampaign(
  campaignId: string,
  accessToken: string,
): Promise<MetaCampaign | null> {
  try {
    return await graphRequest<MetaCampaign>(
      `${campaignId}?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time`,
      accessToken,
    )
  } catch {
    // A missing "before" value must not block the mutation itself.
    return null
  }
}

// ─── Ad Sets ──────────────────────────────────────────────────────────────────

export async function listAdSets(
  adAccountId: string,
  accessToken: string,
  campaignId?: string,
): Promise<MetaAdSet[]> {
  const params = new URLSearchParams({
    fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,created_time,updated_time',
    limit: '100',
  })
  // Drilling into a campaign: query the campaign node so results are actually
  // scoped to it (the account /adsets edge ignores a campaign_id param).
  const node = campaignId ? `${campaignId}/adsets` : `${adAccountId}/adsets`
  return graphRequestAll<MetaAdSet>(`${node}?${params.toString()}`, accessToken)
}

export type MetaAdSetDetailed = MetaAdSet & {
  bid_strategy?: string
  bid_amount?: string | number
  optimization_goal?: string
  billing_event?: string
  start_time?: string
  end_time?: string
  targeting?: Record<string, unknown>
}

/**
 * Ad sets with the fields an operator (or the AI) needs before proposing an
 * edit: bidding, optimization, schedule and the full targeting spec.
 */
export async function listAdSetsDetailed(
  adAccountId: string,
  accessToken: string,
  campaignId?: string,
): Promise<MetaAdSetDetailed[]> {
  const params = new URLSearchParams({
    fields:
      'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,start_time,end_time,targeting,created_time,updated_time',
    limit: '100',
  })
  const node = campaignId ? `${campaignId}/adsets` : `${adAccountId}/adsets`
  return graphRequestAll<MetaAdSetDetailed>(`${node}?${params.toString()}`, accessToken)
}

export type MetaAd = {
  id: string
  name: string
  adset_id: string
  status: string
  effective_status: string
  creative?: { id?: string; thumbnail_url?: string; title?: string; body?: string }
  created_time: string
}

export async function listAds(
  adAccountId: string,
  accessToken: string,
  adsetId?: string,
): Promise<MetaAd[]> {
  const params = new URLSearchParams({
    fields: 'id,name,adset_id,status,effective_status,creative{id,thumbnail_url,title,body},created_time',
    limit: '100',
  })
  // Scope to the ad set node when drilling down.
  const node = adsetId ? `${adsetId}/ads` : `${adAccountId}/ads`
  return graphRequestAll<MetaAd>(`${node}?${params.toString()}`, accessToken)
}

// ─── Insights ─────────────────────────────────────────────────────────────────

export type InsightLevel = 'account' | 'campaign' | 'adset' | 'ad'
export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'last_90d'
  | 'this_month'
  | 'last_month'
  | 'maximum'

export async function getInsights(
  objectId: string,
  accessToken: string,
  opts: {
    level: InsightLevel
    datePreset?: DatePreset
    timeRange?: { since: string; until: string }
    breakdowns?: string[]
    timeIncrement?: number
    fields?: string[]
    limit?: number
  },
): Promise<MetaInsightsPaged> {
  const defaultFields = 'impressions,clicks,spend,reach,cpc,cpm,ctr,cpp,frequency,actions'
  const params = new URLSearchParams({
    fields: opts.fields ? opts.fields.join(',') : defaultFields,
    level: opts.level,
    limit: String(opts.limit ?? 100),
  })
  if (opts.datePreset) params.set('date_preset', opts.datePreset)
  if (opts.timeRange) params.set('time_range', JSON.stringify(opts.timeRange))
  if (opts.breakdowns?.length) params.set('breakdowns', opts.breakdowns.join(','))
  if (opts.timeIncrement) params.set('time_increment', String(opts.timeIncrement))

  // Insights page too: a 90-day daily trend, or an account with many
  // campaigns, exceeds one page and used to come back quietly clipped.
  const data = await graphRequestAll<MetaInsights>(
    `${objectId}/insights?${params.toString()}`,
    accessToken,
  )
  return { data }
}

// ─── Account Overview ─────────────────────────────────────────────────────────

export async function getAdAccountInfo(
  adAccountId: string,
  accessToken: string,
): Promise<{ id: string; name: string; currency: string; account_status: number }> {
  return graphRequest<{ id: string; name: string; currency: string; account_status: number }>(
    `${adAccountId}?fields=id,name,currency,account_status`,
    accessToken,
  )
}

// ─── Generic object read / update (command engine) ────────────────────────────

/** Read one Graph object. Unlike getCampaign this throws, so callers can tell "not found" from "failed". */
export async function getObject<T>(objectId: string, fields: string, accessToken: string): Promise<T> {
  return graphRequest<T>(`${objectId}?fields=${encodeURIComponent(fields)}`, accessToken)
}

/**
 * POST /{object-id} with the given fields. With `validateOnly`, Meta runs the
 * full validation (budget minimums, CBO/ABO conflicts, targeting rules) and
 * writes nothing — used at preview time so a doomed change is rejected before
 * anyone approves it.
 */
export async function updateObject(
  objectId: string,
  fields: Record<string, unknown>,
  accessToken: string,
  opts: { validateOnly?: boolean } = {},
): Promise<{ success?: boolean }> {
  return graphRequest<{ success?: boolean }>(objectId, accessToken, {
    method: 'POST',
    body: opts.validateOnly ? { ...fields, execution_options: ['validate_only'] } : fields,
  })
}

/**
 * POST /{edge-path} — create a new object on an edge (e.g. `act_123/campaigns`,
 * `act_123/ads`). With `validateOnly`, Meta runs full validation and creates
 * nothing — used at preview time, same as `updateObject`'s validate-only mode.
 * The response is `{ id }` for these edges (unlike `/copies`, which returns a
 * `copied_*_id` field instead).
 */
export async function createObject(
  edgePath: string,
  body: Record<string, unknown>,
  accessToken: string,
  opts: { validateOnly?: boolean } = {},
): Promise<{ id: string }> {
  return graphRequest<{ id: string }>(edgePath, accessToken, {
    method: 'POST',
    body: opts.validateOnly ? { ...body, execution_options: ['validate_only'] } : body,
  })
}

/**
 * POST /{object-id}/copies — Meta's campaign/ad-set/ad duplication endpoint.
 * Copies are always requested with `status_option: 'PAUSED'` by the caller
 * (see meta-adapter.ts's buildCopyBody); this function just forwards whatever
 * body it is given. Unlike `updateObject`, this endpoint does not document
 * `execution_options: ['validate_only']` support, so there is no validate-only
 * variant here — the adapter's `validate()` does a read-only sanity check
 * instead (source + target still exist in the account) right before calling
 * this.
 */
export async function copyObject(
  objectId: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<{ copied_campaign_id?: string; copied_adset_id?: string; copied_ad_id?: string; ad_object_ids?: string[] }> {
  return graphRequest<{ copied_campaign_id?: string; copied_adset_id?: string; copied_ad_id?: string; ad_object_ids?: string[] }>(
    `${objectId}/copies`,
    accessToken,
    { method: 'POST', body },
  )
}

export type MetaCustomAudience = {
  id: string
  name?: string
  approximate_count_lower_bound?: number
  operation_status?: { code: number; description: string }
}

/**
 * Custom/lookalike audiences in one ad account — scoped by the `act_x/customaudiences`
 * edge itself, so any id returned here is guaranteed to belong to that account.
 * Used both by the MCP read tool (so an agent can pick an id) and by the
 * adapter's snapshot for `meta.adset.update_targeting` (so an unknown or
 * cross-account audience id is rejected at plan time, not left for Meta to
 * reject after approval).
 */
export async function listCustomAudiences(adAccountId: string, accessToken: string): Promise<MetaCustomAudience[]> {
  return graphRequestAll<MetaCustomAudience>(
    `${adAccountId}/customaudiences?fields=id,name,approximate_count_lower_bound,operation_status&limit=200`,
    accessToken,
  )
}

export type MetaCreative = {
  id: string
  name?: string
  title?: string
  body?: string
  thumbnail_url?: string
  account_id?: string
  object_story_spec?: Record<string, unknown>
}

/** Ad creatives in one ad account, for picking a `creative_id` for `meta.ad.set_creative`. */
export async function listCreatives(adAccountId: string, accessToken: string): Promise<MetaCreative[]> {
  return graphRequestAll<MetaCreative>(
    `${adAccountId}/adcreatives?fields=id,name,title,body,thumbnail_url,object_story_spec&limit=100`,
    accessToken,
  )
}
