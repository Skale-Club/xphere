'use server'

import { createServiceRoleClient } from '@/lib/supabase/admin'

export type TrafficOrgRow = {
  org_id: string
  org_name: string
  total_pageviews: number
  total_sessions: number
  total_visitors: number
  last_event_at: string | null
  setup_verification: string
}

export type TrafficPlatformMetrics = {
  total_setups: number
  verified_setups: number
  total_pageviews_30d: number
  total_sessions_30d: number
  total_visitors_30d: number
  top_orgs: TrafficOrgRow[]
  recent_sessions: Array<{
    id: string
    org_name: string
    country_code: string | null
    device_type: string | null
    utm_source: string | null
    started_at: string
    pageview_count: number
  }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: any) { return supabase }

export async function getTrafficOverview(): Promise<TrafficPlatformMetrics> {
  const supabase = createServiceRoleClient()
  const s = db(supabase)

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [setupsRes, pageviewsRes, sessionsRes, visitorsRes, recentSessionsRes] = await Promise.all([
    s.from('traffic_setups').select('id, verification_state'),
    s.from('traffic_pageviews').select('id', { count: 'exact', head: true }).gte('created_at', since30d),
    s.from('traffic_sessions').select('id', { count: 'exact', head: true }).gte('started_at', since30d),
    s.from('traffic_visitors').select('id', { count: 'exact', head: true }).gte('created_at', since30d),
    // Recent sessions with org info — top-orgs are aggregated from this window below
    s.from('traffic_sessions')
      .select(`
        id,
        organization_id,
        country_code,
        device_type,
        utm_source,
        started_at,
        pageview_count
      `)
      .order('started_at', { ascending: false })
      .limit(20),
  ])

  // Setups summary
  const setups: Array<{ id: string; verification_state: string }> = setupsRes.data ?? []
  const total_setups = setups.length
  const verified_setups = setups.filter((s) => s.verification_state === 'verified').length

  // 30d aggregate counts
  const total_pageviews_30d = pageviewsRes.count ?? 0
  const total_sessions_30d = sessionsRes.count ?? 0
  const total_visitors_30d = visitorsRes.count ?? 0

  // Build top orgs (group by organization_id from recent sessions)
  const sessionData: Array<{
    id: string
    organization_id: string
    country_code: string | null
    device_type: string | null
    utm_source: string | null
    started_at: string
    pageview_count: number
  }> = recentSessionsRes.data ?? []

  // Get org names from the organization_ids in recent sessions
  const orgIds = Array.from(new Set(sessionData.map((s) => s.organization_id)))
  let orgNames: Record<string, string> = {}
  if (orgIds.length > 0) {
    const orgsRes = await s.from('organizations').select('id, name').in('id', orgIds)
    const orgs: Array<{ id: string; name: string }> = orgsRes.data ?? []
    orgNames = Object.fromEntries(orgs.map((o) => [o.id, o.name]))
  }

  // Aggregate per-org metrics from session data (approximate from recent window)
  const orgMap = new Map<string, { pageviews: number; sessions: number; last_at: string | null }>()
  for (const s of sessionData) {
    const cur = orgMap.get(s.organization_id) ?? { pageviews: 0, sessions: 0, last_at: null }
    cur.sessions += 1
    cur.pageviews += s.pageview_count ?? 0
    if (!cur.last_at || s.started_at > cur.last_at) cur.last_at = s.started_at
    orgMap.set(s.organization_id, cur)
  }

  const top_orgs: TrafficOrgRow[] = Array.from(orgMap.entries())
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .slice(0, 10)
    .map(([org_id, m]) => ({
      org_id,
      org_name: orgNames[org_id] ?? org_id,
      total_pageviews: m.pageviews,
      total_sessions: m.sessions,
      total_visitors: 0,
      last_event_at: m.last_at,
      setup_verification: setups.find(() => true)?.verification_state ?? 'unknown',
    }))

  const recent_sessions = sessionData.slice(0, 10).map((s) => ({
    id: s.id,
    org_name: orgNames[s.organization_id] ?? s.organization_id,
    country_code: s.country_code,
    device_type: s.device_type,
    utm_source: s.utm_source,
    started_at: s.started_at,
    pageview_count: s.pageview_count,
  }))

  return {
    total_setups,
    verified_setups,
    total_pageviews_30d,
    total_sessions_30d,
    total_visitors_30d,
    top_orgs,
    recent_sessions,
  }
}
