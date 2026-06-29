import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AnalyticsMetrics,
  TimeSeriesPoint,
  SourceRow,
  CampaignRow,
  PageRow,
  GeoRow,
  DeviceRow,
  RecentSession,
  DateRange,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: SupabaseClient<any>) { return supabase as any }

export async function getDashboardMetrics(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
  prev: DateRange,
): Promise<AnalyticsMetrics> {
  const from = range.from.toISOString()
  const to = range.to.toISOString()
  const pfrom = prev.from.toISOString()
  const pto = prev.to.toISOString()

  const [sessionsRes, prevSessionsRes, pvRes, eventsRes] = await Promise.all([
    db(supabase)
      .from('analytics_sessions')
      .select('id, visitor_id, is_converted, utm_source, utm_campaign, landing_page')
      .eq('organization_id', orgId)
      .gte('started_at', from)
      .lte('started_at', to),
    db(supabase)
      .from('analytics_sessions')
      .select('id, visitor_id, is_converted')
      .eq('organization_id', orgId)
      .gte('started_at', pfrom)
      .lte('started_at', pto),
    db(supabase)
      .from('analytics_pageviews')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('occurred_at', from)
      .lte('occurred_at', to),
    db(supabase)
      .from('analytics_pageviews')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('occurred_at', pfrom)
      .lte('occurred_at', pto),
  ])

  const sessions: { visitor_id: string; is_converted: boolean; utm_source: string | null; utm_campaign: string | null; landing_page: string | null }[] = sessionsRes.data ?? []
  const prevSessions: { visitor_id: string; is_converted: boolean }[] = prevSessionsRes.data ?? []
  const pvCount: number = pvRes.count ?? 0
  const prevPvCount: number = eventsRes.count ?? 0

  const uniqueVisitors = new Set(sessions.map((s) => s.visitor_id)).size
  const prevUniqueVisitors = new Set(prevSessions.map((s) => s.visitor_id)).size
  const conversions = sessions.filter((s) => s.is_converted).length
  const prevConversions = prevSessions.filter((s) => s.is_converted).length

  // Top source by session count
  const sourceCounts: Record<string, number> = {}
  for (const s of sessions) {
    const key = s.utm_source ?? 'direct'
    sourceCounts[key] = (sourceCounts[key] ?? 0) + 1
  }
  const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // Top campaign
  const campaignCounts: Record<string, number> = {}
  for (const s of sessions) {
    if (s.utm_campaign) campaignCounts[s.utm_campaign] = (campaignCounts[s.utm_campaign] ?? 0) + 1
  }
  const topCampaign = Object.entries(campaignCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // Top landing page
  const landingCounts: Record<string, number> = {}
  for (const s of sessions) {
    if (s.landing_page) {
      try {
        const path = new URL(s.landing_page).pathname
        landingCounts[path] = (landingCounts[path] ?? 0) + 1
      } catch {
        landingCounts[s.landing_page] = (landingCounts[s.landing_page] ?? 0) + 1
      }
    }
  }
  const topLandingPage = Object.entries(landingCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return {
    visitors: uniqueVisitors,
    unique_visitors: uniqueVisitors,
    sessions: sessions.length,
    page_views: pvCount,
    conversions,
    conversion_rate: sessions.length > 0 ? Math.round((conversions / sessions.length) * 1000) / 10 : 0,
    top_source: topSource,
    top_campaign: topCampaign,
    top_landing_page: topLandingPage,
    prev_visitors: prevUniqueVisitors,
    prev_sessions: prevSessions.length,
    prev_page_views: prevPvCount,
    prev_conversions: prevConversions,
  }
}

export async function getSessionsOverTime(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<TimeSeriesPoint[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('started_at, visitor_id')
    .eq('organization_id', orgId)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())
    .order('started_at', { ascending: true })

  const { data: pvData } = await db(supabase)
    .from('analytics_pageviews')
    .select('occurred_at')
    .eq('organization_id', orgId)
    .gte('occurred_at', range.from.toISOString())
    .lte('occurred_at', range.to.toISOString())

  const sessions: { started_at: string; visitor_id: string }[] = data ?? []
  const pvs: { occurred_at: string }[] = pvData ?? []

  const days: Record<string, { visitors: Set<string>; sessions: number; page_views: number }> = {}

  for (const s of sessions) {
    const day = s.started_at.slice(0, 10)
    if (!days[day]) days[day] = { visitors: new Set(), sessions: 0, page_views: 0 }
    days[day].visitors.add(s.visitor_id)
    days[day].sessions++
  }
  for (const pv of pvs) {
    const day = pv.occurred_at.slice(0, 10)
    if (!days[day]) days[day] = { visitors: new Set(), sessions: 0, page_views: 0 }
    days[day].page_views++
  }

  return Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, visitors: d.visitors.size, sessions: d.sessions, page_views: d.page_views }))
}

export async function getAnalyticsSources(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<SourceRow[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('utm_source, is_converted')
    .eq('organization_id', orgId)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())

  const rows: { utm_source: string | null; is_converted: boolean }[] = data ?? []
  const map: Record<string, { sessions: number; conversions: number }> = {}

  for (const r of rows) {
    const source = r.utm_source ?? 'direct'
    if (!map[source]) map[source] = { sessions: 0, conversions: 0 }
    map[source].sessions++
    if (r.is_converted) map[source].conversions++
  }

  return Object.entries(map)
    .map(([source, d]) => ({ source, ...d }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20)
}

export async function getUTMCampaigns(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<CampaignRow[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('utm_campaign, utm_source, utm_medium, is_converted')
    .eq('organization_id', orgId)
    .not('utm_campaign', 'is', null)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())

  const rows: { utm_campaign: string; utm_source: string | null; utm_medium: string | null; is_converted: boolean }[] = data ?? []
  const map: Record<string, CampaignRow> = {}

  for (const r of rows) {
    const key = r.utm_campaign
    if (!map[key]) map[key] = { campaign: key, source: r.utm_source, medium: r.utm_medium, sessions: 0, conversions: 0 }
    map[key].sessions++
    if (r.is_converted) map[key].conversions++
  }

  return Object.values(map).sort((a, b) => b.sessions - a.sessions).slice(0, 20)
}

export async function getTopPages(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<PageRow[]> {
  const { data } = await db(supabase)
    .from('analytics_pageviews')
    .select('path, session_id')
    .eq('organization_id', orgId)
    .gte('occurred_at', range.from.toISOString())
    .lte('occurred_at', range.to.toISOString())

  const rows: { path: string; session_id: string }[] = data ?? []
  const map: Record<string, { views: number; sessions: Set<string> }> = {}

  for (const r of rows) {
    if (!map[r.path]) map[r.path] = { views: 0, sessions: new Set() }
    map[r.path].views++
    map[r.path].sessions.add(r.session_id)
  }

  return Object.entries(map)
    .map(([path, d]) => ({ path, views: d.views, sessions: d.sessions.size }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20)
}

export async function getTopLandingPages(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<PageRow[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('landing_page, id')
    .eq('organization_id', orgId)
    .not('landing_page', 'is', null)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())

  const rows: { landing_page: string; id: string }[] = data ?? []
  const map: Record<string, { views: number; sessions: Set<string> }> = {}

  for (const r of rows) {
    let path = r.landing_page
    try { path = new URL(r.landing_page).pathname } catch { /* keep original */ }
    if (!map[path]) map[path] = { views: 0, sessions: new Set() }
    map[path].views++
    map[path].sessions.add(r.id)
  }

  return Object.entries(map)
    .map(([path, d]) => ({ path, views: d.views, sessions: d.sessions.size }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20)
}

export async function getGeoBreakdown(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<GeoRow[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('country_name, country_code')
    .eq('organization_id', orgId)
    .not('country_name', 'is', null)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())

  const rows: { country_name: string; country_code: string | null }[] = data ?? []
  const map: Record<string, GeoRow> = {}

  for (const r of rows) {
    const key = r.country_name
    if (!map[key]) map[key] = { country_name: key, country_code: r.country_code, sessions: 0 }
    map[key].sessions++
  }

  return Object.values(map).sort((a, b) => b.sessions - a.sessions).slice(0, 20)
}

export async function getDeviceBreakdown(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange,
): Promise<DeviceRow[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('device_type')
    .eq('organization_id', orgId)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())

  const rows: { device_type: string | null }[] = data ?? []
  const map: Record<string, number> = {}

  for (const r of rows) {
    const key = r.device_type ?? 'unknown'
    map[key] = (map[key] ?? 0) + 1
  }

  return Object.entries(map).map(([device_type, sessions]) => ({ device_type, sessions })).sort((a, b) => b.sessions - a.sessions)
}

export async function getRecentSessions(
  supabase: SupabaseClient,
  orgId: string,
  limit = 20,
): Promise<RecentSession[]> {
  const { data } = await db(supabase)
    .from('analytics_sessions')
    .select('id, started_at, landing_page, utm_source, utm_campaign, device_type, country_name, is_converted, page_view_count')
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as RecentSession[]
}

export function getPrevRange(range: DateRange): DateRange {
  const ms = range.to.getTime() - range.from.getTime()
  return {
    from: new Date(range.from.getTime() - ms),
    to: new Date(range.from),
  }
}

export function trendPct(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 100)
}
