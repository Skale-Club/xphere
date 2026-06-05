import { refreshAccessToken, type GoogleAdsTokens } from './google-oauth'

const GADS_BASE = 'https://googleads.googleapis.com/v20'

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'GoogleAdsError'
  }
}

// ─── Token management ──────────────────────────────────────────────────────────
// encrypted_access_token stores JSON: { access_token, refresh_token }
// Access tokens expire in ~1 hour; we always refresh before API calls.

export function serializeTokens(tokens: GoogleAdsTokens): string {
  return JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token })
}

export function parseTokens(stored: string): GoogleAdsTokens {
  const parsed = JSON.parse(stored) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!parsed.access_token || !parsed.refresh_token) throw new Error('Invalid stored token format')
  return { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expires_in: parsed.expires_in ?? 3600 }
}

async function getFreshAccessToken(refreshToken: string): Promise<string> {
  return refreshAccessToken(refreshToken)
}

// ─── Core request helper ───────────────────────────────────────────────────────

async function gadsRequest<T>(
  path: string,
  refreshToken: string,
  options: { method?: string; body?: unknown; loginCustomerId?: string },
): Promise<T> {
  const accessToken = await getFreshAccessToken(refreshToken)
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
    'Content-Type': 'application/json',
  }
  if (options.loginCustomerId) {
    headers['login-customer-id'] = options.loginCustomerId
  }

  const res = await fetch(`${GADS_BASE}/${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })

  if (!res.ok) {
    let msg = `Google Ads API error ${res.status}`
    let code: string | undefined
    try {
      const body = (await res.json()) as {
        error?: { message?: string; status?: string; details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }> }> }
      }
      msg = body.error?.message ?? msg
      code = body.error?.status
    } catch { /* ignore */ }
    throw new GoogleAdsError(msg, code)
  }

  return res.json() as Promise<T>
}

async function gaqlSearch<T>(
  customerId: string,
  refreshToken: string,
  query: string,
): Promise<T[]> {
  const res = await gadsRequest<{ results?: T[] }>(
    `customers/${customerId}/googleAds:search`,
    refreshToken,
    { method: 'POST', body: { query } },
  )
  return res.results ?? []
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GAdsCampaign = {
  id: string
  name: string
  status: string
  channelType: string
  biddingStrategy: string
  budgetAmountMicros: string
  budgetId: string
}

export type GAdsCampaignWithMetrics = GAdsCampaign & {
  impressions: string
  clicks: string
  costMicros: string
  conversions: string
  ctr: string
  averageCpc: string
}

export type GAdsAccountOverview = {
  impressions: string
  clicks: string
  costMicros: string
  conversions: string
  ctr: string
  averageCpc: string
}

export type GAdsAdGroup = {
  id: string
  name: string
  campaignId: string
  campaignName: string
  status: string
  impressions: string
  clicks: string
  costMicros: string
}

// ─── GAQL date range helper ────────────────────────────────────────────────────

export type GAdsDuration =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'

export function toGaqlDuration(preset: string): GAdsDuration {
  const map: Record<string, GAdsDuration> = {
    today: 'TODAY',
    yesterday: 'YESTERDAY',
    last_7d: 'LAST_7_DAYS',
    last_14d: 'LAST_14_DAYS',
    last_30d: 'LAST_30_DAYS',
    last_90d: 'LAST_90_DAYS',
    this_month: 'THIS_MONTH',
    last_month: 'LAST_MONTH',
  }
  return map[preset] ?? 'LAST_30_DAYS'
}

/**
 * Builds a GAQL WHERE date condition that accepts either a named preset or a
 * custom since/until range. Handles the new shared presets (last_3m, last_6m,
 * last_year, last_2y) that the Google API doesn't natively support.
 */
export function buildGaqlDateCondition(preset: string, since?: string, until?: string): string {
  if (since && until) return `segments.date BETWEEN '${since}' AND '${until}'`
  const nativeMap: Record<string, string> = {
    today: 'TODAY',
    yesterday: 'YESTERDAY',
    last_7d: 'LAST_7_DAYS',
    last_14d: 'LAST_14_DAYS',
    last_30d: 'LAST_30_DAYS',
    last_90d: 'LAST_90_DAYS',
    this_month: 'THIS_MONTH',
    last_month: 'LAST_MONTH',
    last_year: 'LAST_YEAR',
  }
  const native = nativeMap[preset]
  if (native) return `segments.date DURING ${native}`
  // Non-native: last_3m, last_6m, last_2y — caller should pass since/until
  return `segments.date DURING LAST_30_DAYS`
}

// ─── Account overview ──────────────────────────────────────────────────────────

export async function getAccountOverview(
  customerId: string,
  refreshToken: string,
  duration: GAdsDuration | string,
): Promise<GAdsAccountOverview> {
  type Row = {
    metrics: {
      impressions: string
      clicks: string
      costMicros: string
      conversions: string
      ctr: string
      averageCpc: string
    }
  }
  // duration may be a raw GAQL condition (BETWEEN / DURING) from buildGaqlDateCondition
  const dateClause = duration.includes('BETWEEN') || duration.includes('DURING')
    ? `WHERE ${duration}`
    : `WHERE segments.date DURING ${duration}`
  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.average_cpc
     FROM customer
     ${dateClause}`,
  )
  if (!rows.length) {
    return { impressions: '0', clicks: '0', costMicros: '0', conversions: '0', ctr: '0', averageCpc: '0' }
  }
  // Sum across all rows (customer-level returns one row per day by default)
  const totals = rows.reduce(
    (acc, r) => ({
      impressions: String(Number(acc.impressions) + Number(r.metrics.impressions)),
      clicks: String(Number(acc.clicks) + Number(r.metrics.clicks)),
      costMicros: String(Number(acc.costMicros) + Number(r.metrics.costMicros)),
      conversions: String(Number(acc.conversions) + Number(r.metrics.conversions)),
      ctr: '0',
      averageCpc: '0',
    }),
    { impressions: '0', clicks: '0', costMicros: '0', conversions: '0', ctr: '0', averageCpc: '0' },
  )
  const impr = Number(totals.impressions)
  const clicks = Number(totals.clicks)
  totals.ctr = impr > 0 ? String((clicks / impr) * 100) : '0'
  totals.averageCpc = clicks > 0 ? String(Number(totals.costMicros) / clicks) : '0'
  return totals
}

// ─── Campaigns ─────────────────────────────────────────────────────────────────

export async function listCampaigns(
  customerId: string,
  refreshToken: string,
  duration: GAdsDuration | string,
): Promise<GAdsCampaignWithMetrics[]> {
  type Row = {
    campaign: {
      id: string
      name: string
      status: string
      advertisingChannelType: string
      biddingStrategyType: string
      campaignBudget: string
    }
    campaignBudget: { amountMicros: string; id: string }
    metrics: {
      impressions: string
      clicks: string
      costMicros: string
      conversions: string
      ctr: string
      averageCpc: string
    }
  }

  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT campaign.id, campaign.name, campaign.status,
            campaign.advertising_channel_type, campaign.bidding_strategy_type,
            campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.id,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.ctr, metrics.average_cpc
     FROM campaign
     WHERE campaign.status != 'REMOVED'
       AND ${duration.includes('BETWEEN') || duration.includes('DURING') ? duration : `segments.date DURING ${duration}`}
     ORDER BY metrics.cost_micros DESC`,
  )

  return rows.map((r) => ({
    id: r.campaign.id,
    name: r.campaign.name,
    status: r.campaign.status,
    channelType: r.campaign.advertisingChannelType,
    biddingStrategy: r.campaign.biddingStrategyType,
    budgetAmountMicros: r.campaignBudget?.amountMicros ?? '0',
    budgetId: r.campaignBudget?.id ?? '',
    impressions: r.metrics.impressions,
    clicks: r.metrics.clicks,
    costMicros: r.metrics.costMicros,
    conversions: r.metrics.conversions,
    ctr: r.metrics.ctr,
    averageCpc: r.metrics.averageCpc,
  }))
}

// ─── Ad groups ─────────────────────────────────────────────────────────────────

export async function listAdGroups(
  customerId: string,
  refreshToken: string,
  duration: GAdsDuration | string,
  campaignId?: string,
): Promise<GAdsAdGroup[]> {
  type Row = {
    adGroup: { id: string; name: string; status: string }
    campaign: { id: string; name: string }
    metrics: { impressions: string; clicks: string; costMicros: string }
  }

  const campaignFilter = campaignId ? ` AND campaign.id = ${campaignId}` : ''
  const rows = await gaqlSearch<Row>(
    customerId,
    refreshToken,
    `SELECT ad_group.id, ad_group.name, ad_group.status,
            campaign.id, campaign.name,
            metrics.impressions, metrics.clicks, metrics.cost_micros
     FROM ad_group
     WHERE ad_group.status != 'REMOVED'${campaignFilter}
       AND ${duration.includes('BETWEEN') || duration.includes('DURING') ? duration : `segments.date DURING ${duration}`}
     ORDER BY metrics.cost_micros DESC`,
  )

  return rows.map((r) => ({
    id: r.adGroup.id,
    name: r.adGroup.name,
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    status: r.adGroup.status,
    impressions: r.metrics.impressions,
    clicks: r.metrics.clicks,
    costMicros: r.metrics.costMicros,
  }))
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export async function updateCampaignStatus(
  customerId: string,
  campaignId: string,
  status: 'ENABLED' | 'PAUSED',
  refreshToken: string,
): Promise<void> {
  await gadsRequest(
    `customers/${customerId}/campaigns:mutate`,
    refreshToken,
    {
      method: 'POST',
      body: {
        operations: [
          {
            update: {
              resourceName: `customers/${customerId}/campaigns/${campaignId}`,
              status,
            },
            updateMask: 'status',
          },
        ],
      },
    },
  )
}

export async function updateCampaignBudget(
  customerId: string,
  budgetId: string,
  amountMicros: number,
  refreshToken: string,
): Promise<void> {
  await gadsRequest(
    `customers/${customerId}/campaignBudgets:mutate`,
    refreshToken,
    {
      method: 'POST',
      body: {
        operations: [
          {
            update: {
              resourceName: `customers/${customerId}/campaignBudgets/${budgetId}`,
              amountMicros: String(amountMicros),
            },
            updateMask: 'amount_micros',
          },
        ],
      },
    },
  )
}
