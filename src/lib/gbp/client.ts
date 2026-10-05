import 'server-only'

// Google Business Profile API client for one connection (one Google account).
//
//   Account Management   mybusinessaccountmanagement.googleapis.com/v1
//   Business Information mybusinessbusinessinformation.googleapis.com/v1
//   Reviews, local posts mybusiness.googleapis.com/v4 (still the only home)
//   Performance          businessprofileperformance.googleapis.com/v1
//
// Access tokens are refreshed before they expire and once more on a 401. A
// dead refresh token marks the connection `error` so the UI asks for a
// reconnect instead of failing silently (the Google Contacts lesson).
//
// Writes here are only called from the change ledger (src/lib/gbp/commands.ts).

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt, encrypt } from '@/lib/crypto'
import { GoogleAuthError, refreshGoogleAccessToken } from '@/lib/google/oauth'
import type { Database } from '@/types/database'

type Admin = SupabaseClient<Database>

const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const V4 = 'https://mybusiness.googleapis.com/v4'
const PERF = 'https://businessprofileperformance.googleapis.com/v1'

export const GBP_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/business.manage']

export const LOCATION_READ_MASK =
  'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,profile,metadata,latlng,openInfo'

export type GbpErrorKind = 'auth' | 'quota' | 'invalid' | 'not_found' | 'transient'

export class GbpApiError extends Error {
  constructor(
    readonly kind: GbpErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GbpApiError'
  }
}

export type GbpAccount = { name: string; accountName?: string; type?: string; role?: string }

export type TimeOfDay = { hours?: number; minutes?: number }
export type TimePeriod = { openDay: string; openTime?: TimeOfDay; closeDay: string; closeTime?: TimeOfDay }

export type GbpLocation = {
  name: string
  title?: string
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] }
  categories?: { primaryCategory?: { name?: string; displayName?: string }; additionalCategories?: { name?: string; displayName?: string }[] }
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string; regionCode?: string }
  websiteUri?: string
  regularHours?: { periods?: TimePeriod[] }
  specialHours?: { specialHourPeriods?: unknown[] }
  serviceArea?: unknown
  profile?: { description?: string }
  metadata?: { placeId?: string; mapsUri?: string; newReviewUri?: string; hasGoogleUpdated?: boolean; hasPendingEdits?: boolean; canHaveFoodMenus?: boolean }
  latlng?: { latitude?: number; longitude?: number }
  openInfo?: { status?: string }
}

export type GbpReview = {
  name: string
  reviewId?: string
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean }
  starRating?: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | 'STAR_RATING_UNSPECIFIED'
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

export type GbpLocalPost = {
  name?: string
  languageCode?: string
  summary?: string
  topicType?: string
  callToAction?: { actionType: string; url?: string }
  media?: { mediaFormat: 'PHOTO' | 'VIDEO'; sourceUrl: string }[]
  event?: unknown
  offer?: unknown
  state?: string
  searchUrl?: string
  createTime?: string
}

export const STAR_TO_NUMBER: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

type TokenBlob = { access_token: string; refresh_token: string | null; expires_at?: number }

export class GbpClient {
  private blob: TokenBlob | null = null

  constructor(
    private admin: Admin,
    readonly connectionId: string,
  ) {}

  static async forLocation(admin: Admin, locationId: string): Promise<{ client: GbpClient; accountName: string; locationName: string } | null> {
    const { data } = await admin
      .from('local_seo_locations')
      .select('gbp_connection_id, gbp_account_name, gbp_location_name')
      .eq('id', locationId)
      .maybeSingle()
    if (!data?.gbp_connection_id || !data.gbp_location_name || !data.gbp_account_name) return null
    return { client: new GbpClient(admin, data.gbp_connection_id), accountName: data.gbp_account_name, locationName: data.gbp_location_name }
  }

  private async loadTokens(): Promise<TokenBlob> {
    if (this.blob) return this.blob
    const { data } = await this.admin
      .from('gbp_connections')
      .select('encrypted_tokens, status, token_expires_at')
      .eq('id', this.connectionId)
      .maybeSingle()
    if (!data) throw new GbpApiError('auth', 401, 'The Google connection no longer exists.')
    if (data.status === 'revoked') throw new GbpApiError('auth', 401, 'The Google connection was disconnected.')
    const blob = JSON.parse(await decrypt(data.encrypted_tokens)) as TokenBlob
    blob.expires_at = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0
    this.blob = blob
    return blob
  }

  private async refresh(): Promise<string> {
    const blob = await this.loadTokens()
    if (!blob.refresh_token) {
      await this.markError('No refresh token stored. Reconnect the Google account.')
      throw new GbpApiError('auth', 401, 'No refresh token stored. Reconnect the Google account.')
    }
    try {
      const t = await refreshGoogleAccessToken(blob.refresh_token)
      const next: TokenBlob = { access_token: t.access_token, refresh_token: t.refresh_token ?? blob.refresh_token }
      const expiresAt = new Date(Date.now() + t.expires_in * 1000)
      await this.admin
        .from('gbp_connections')
        .update({
          encrypted_tokens: await encrypt(JSON.stringify(next)),
          token_expires_at: expiresAt.toISOString(),
          status: 'active',
          connection_error: null,
          last_verified_at: new Date().toISOString(),
        })
        .eq('id', this.connectionId)
      this.blob = { ...next, expires_at: expiresAt.getTime() }
      return next.access_token
    } catch (err) {
      if (err instanceof GoogleAuthError && err.code === 'invalid_grant') {
        await this.markError(err.message)
        throw new GbpApiError('auth', 401, err.message)
      }
      throw new GbpApiError('transient', 0, err instanceof Error ? err.message : 'Token refresh failed')
    }
  }

  private async markError(message: string) {
    await this.admin.from('gbp_connections').update({ status: 'error', connection_error: message.slice(0, 500) }).eq('id', this.connectionId)
  }

  private async accessToken(): Promise<string> {
    const blob = await this.loadTokens()
    // Refresh a minute early so a long sync never runs on an expiring token.
    if (!blob.expires_at || blob.expires_at - Date.now() < 60_000) return this.refresh()
    return blob.access_token
  }

  async request<T>(url: string, init: RequestInit = {}, retried = false): Promise<T> {
    const token = await this.accessToken()
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      throw new GbpApiError('transient', 0, `Google request failed: ${(err as Error).message}`)
    }
    if (res.status === 401 && !retried) {
      await this.refresh()
      return this.request<T>(url, init, true)
    }
    if (res.status === 204) return {} as T
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } } & T
    if (!res.ok) {
      const msg = body.error?.message ?? `Google returned ${res.status}`
      const kind: GbpErrorKind =
        res.status === 401 || res.status === 403
          ? 'auth'
          : res.status === 404
            ? 'not_found'
            : res.status === 429
              ? 'quota'
              : res.status >= 500
                ? 'transient'
                : 'invalid'
      if (kind === 'auth' && res.status === 401) await this.markError(msg)
      throw new GbpApiError(kind, res.status, msg)
    }
    return body
  }

  // ── Accounts & locations ──────────────────────────────────────────────────
  async listAccounts(): Promise<GbpAccount[]> {
    const out: GbpAccount[] = []
    let pageToken = ''
    do {
      const r = await this.request<{ accounts?: GbpAccount[]; nextPageToken?: string }>(
        `${ACCOUNTS}/accounts?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      )
      out.push(...(r.accounts ?? []))
      pageToken = r.nextPageToken ?? ''
    } while (pageToken)
    return out
  }

  async listLocations(accountName: string): Promise<GbpLocation[]> {
    const out: GbpLocation[] = []
    let pageToken = ''
    do {
      const r = await this.request<{ locations?: GbpLocation[]; nextPageToken?: string }>(
        `${INFO}/${accountName}/locations?pageSize=100&readMask=${encodeURIComponent(LOCATION_READ_MASK)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      )
      out.push(...(r.locations ?? []))
      pageToken = r.nextPageToken ?? ''
    } while (pageToken)
    return out
  }

  getLocation(locationName: string): Promise<GbpLocation> {
    return this.request<GbpLocation>(`${INFO}/${locationName}?readMask=${encodeURIComponent(LOCATION_READ_MASK)}`)
  }

  /** The fields Google itself changed, when metadata.hasGoogleUpdated is set. */
  getGoogleUpdated(locationName: string): Promise<{ location?: GbpLocation; diffMask?: string; pendingMask?: string }> {
    return this.request(`${INFO}/${locationName}:getGoogleUpdated?readMask=${encodeURIComponent(LOCATION_READ_MASK)}`)
  }

  patchLocation(locationName: string, updateMask: string[], body: Partial<GbpLocation>, validateOnly = false): Promise<GbpLocation> {
    const q = new URLSearchParams({ updateMask: updateMask.join(','), validateOnly: String(validateOnly) })
    return this.request<GbpLocation>(`${INFO}/${locationName}?${q.toString()}`, { method: 'PATCH', body: JSON.stringify(body) })
  }

  // ── Reviews (v4) ──────────────────────────────────────────────────────────
  async listReviews(accountName: string, locationName: string, maxPages = 10): Promise<{ reviews: GbpReview[]; averageRating?: number; totalReviewCount?: number }> {
    const out: GbpReview[] = []
    let pageToken = ''
    let meta: { averageRating?: number; totalReviewCount?: number } = {}
    for (let page = 0; page < maxPages; page++) {
      const r = await this.request<{ reviews?: GbpReview[]; nextPageToken?: string; averageRating?: number; totalReviewCount?: number }>(
        `${V4}/${accountName}/${locationName}/reviews?pageSize=50&orderBy=updateTime%20desc${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      )
      out.push(...(r.reviews ?? []))
      meta = { averageRating: r.averageRating, totalReviewCount: r.totalReviewCount }
      pageToken = r.nextPageToken ?? ''
      if (!pageToken) break
    }
    return { reviews: out, ...meta }
  }

  getReview(reviewName: string): Promise<GbpReview> {
    return this.request<GbpReview>(`${V4}/${reviewName}`)
  }

  updateReply(reviewName: string, comment: string): Promise<{ comment?: string; updateTime?: string }> {
    return this.request(`${V4}/${reviewName}/reply`, { method: 'PUT', body: JSON.stringify({ comment }) })
  }

  deleteReply(reviewName: string): Promise<unknown> {
    return this.request(`${V4}/${reviewName}/reply`, { method: 'DELETE' })
  }

  // ── Local posts (v4) ──────────────────────────────────────────────────────
  createLocalPost(accountName: string, locationName: string, post: GbpLocalPost): Promise<GbpLocalPost> {
    return this.request<GbpLocalPost>(`${V4}/${accountName}/${locationName}/localPosts`, { method: 'POST', body: JSON.stringify(post) })
  }

  getLocalPost(postName: string): Promise<GbpLocalPost> {
    return this.request<GbpLocalPost>(`${V4}/${postName}`)
  }

  deleteLocalPost(postName: string): Promise<unknown> {
    return this.request(`${V4}/${postName}`, { method: 'DELETE' })
  }

  // ── Performance ───────────────────────────────────────────────────────────
  async fetchDailyMetrics(
    locationName: string,
    metrics: string[],
    start: Date,
    end: Date,
  ): Promise<{ metric: string; date: string; value: number }[]> {
    const q = new URLSearchParams()
    for (const m of metrics) q.append('dailyMetrics', m)
    const set = (prefix: string, d: Date) => {
      q.set(`${prefix}.year`, String(d.getUTCFullYear()))
      q.set(`${prefix}.month`, String(d.getUTCMonth() + 1))
      q.set(`${prefix}.day`, String(d.getUTCDate()))
    }
    set('dailyRange.startDate', start)
    set('dailyRange.endDate', end)
    const r = await this.request<{
      multiDailyMetricTimeSeries?: {
        dailyMetricTimeSeries?: {
          dailyMetric?: string
          timeSeries?: { datedValues?: { date?: { year: number; month: number; day: number }; value?: string }[] }
        }[]
      }[]
    }>(`${PERF}/${locationName}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`)
    const out: { metric: string; date: string; value: number }[] = []
    for (const group of r.multiDailyMetricTimeSeries ?? []) {
      for (const series of group.dailyMetricTimeSeries ?? []) {
        for (const dv of series.timeSeries?.datedValues ?? []) {
          if (!dv.date || !series.dailyMetric) continue
          const date = `${dv.date.year}-${String(dv.date.month).padStart(2, '0')}-${String(dv.date.day).padStart(2, '0')}`
          out.push({ metric: series.dailyMetric, date, value: Number(dv.value ?? 0) })
        }
      }
    }
    return out
  }

  async fetchSearchKeywords(
    locationName: string,
    startMonth: Date,
    endMonth: Date,
  ): Promise<{ keyword: string; impressions: number | null; threshold: number | null }[]> {
    const out: { keyword: string; impressions: number | null; threshold: number | null }[] = []
    let pageToken = ''
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({
        'monthlyRange.startMonth.year': String(startMonth.getUTCFullYear()),
        'monthlyRange.startMonth.month': String(startMonth.getUTCMonth() + 1),
        'monthlyRange.endMonth.year': String(endMonth.getUTCFullYear()),
        'monthlyRange.endMonth.month': String(endMonth.getUTCMonth() + 1),
        pageSize: '100',
      })
      if (pageToken) q.set('pageToken', pageToken)
      const r = await this.request<{
        searchKeywordsCounts?: { searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }[]
        nextPageToken?: string
      }>(`${PERF}/${locationName}/searchkeywords/impressions/monthly?${q.toString()}`)
      for (const k of r.searchKeywordsCounts ?? []) {
        if (!k.searchKeyword) continue
        out.push({
          keyword: k.searchKeyword,
          impressions: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null,
          threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null,
        })
      }
      pageToken = r.nextPageToken ?? ''
      if (!pageToken) break
    }
    return out
  }
}

export const PERFORMANCE_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
] as const
