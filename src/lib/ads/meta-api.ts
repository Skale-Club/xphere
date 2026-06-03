import { META_ADS_GRAPH_VERSION } from './meta-oauth'

const GRAPH_BASE = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}`

type MetaErrorPayload = {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number }
}

export class MetaAdsError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(message)
    this.name = 'MetaAdsError'
  }
}

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
    try {
      const body = (await res.json()) as MetaErrorPayload
      msg = body.error?.message ?? msg
      code = body.error?.code
      subcode = body.error?.error_subcode
    } catch { /* ignore parse error */ }
    throw new MetaAdsError(msg, code, subcode)
  }
  return res.json() as Promise<T>
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
  const res = await graphRequest<{ data?: MetaCampaign[] }>(
    `${adAccountId}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time&limit=100`,
    accessToken,
  )
  return res.data ?? []
}

export async function updateCampaignStatus(
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED',
  accessToken: string,
): Promise<{ success: boolean }> {
  return graphRequest<{ success: boolean }>(campaignId, accessToken, {
    method: 'POST',
    body: { status },
  })
}

export async function updateCampaignDailyBudget(
  campaignId: string,
  dailyBudgetCents: number,
  accessToken: string,
): Promise<{ success: boolean }> {
  return graphRequest<{ success: boolean }>(campaignId, accessToken, {
    method: 'POST',
    body: { daily_budget: String(dailyBudgetCents) },
  })
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
  const res = await graphRequest<{ data?: MetaAdSet[] }>(`${node}?${params.toString()}`, accessToken)
  return res.data ?? []
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
  const res = await graphRequest<{ data?: MetaAd[] }>(`${node}?${params.toString()}`, accessToken)
  return res.data ?? []
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

  return graphRequest<MetaInsightsPaged>(`${objectId}/insights?${params.toString()}`, accessToken)
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
