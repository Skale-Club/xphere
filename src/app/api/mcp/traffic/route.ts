export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { validateMcpToken } from '@/lib/projects/mcp-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

function ok(data: unknown) {
  return Response.json({ ok: true, data })
}

function err(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status })
}

export async function POST(request: Request) {
  const auth = await validateMcpToken(request.headers.get('authorization'))
  if (!auth) return err('Unauthorized', 401)

  let body: { action: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON')
  }

  const { action, params = {} } = body
  const { orgId } = auth
  const supabase = db()

  if (action === 'get_traffic_summary') {
    const days = Math.min(Number(params.days ?? 30), 90)
    const from = new Date(Date.now() - days * 864e5).toISOString()
    const to = new Date().toISOString()

    const [sessionsRes, pvRes] = await Promise.all([
      supabase.from('traffic_sessions').select('id, visitor_id, is_converted, utm_source, utm_campaign').eq('organization_id', orgId).gte('started_at', from).lte('started_at', to),
      supabase.from('traffic_pageviews').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('occurred_at', from).lte('occurred_at', to),
    ])

    const sessions: { visitor_id: string; is_converted: boolean; utm_source: string | null; utm_campaign: string | null }[] = sessionsRes.data ?? []
    const uniqueVisitors = new Set(sessions.map((s) => s.visitor_id)).size
    const conversions = sessions.filter((s) => s.is_converted).length

    const sourceCounts: Record<string, number> = {}
    for (const s of sessions) {
      const key = s.utm_source ?? 'direct'
      sourceCounts[key] = (sourceCounts[key] ?? 0) + 1
    }

    return ok({
      period_days: days,
      unique_visitors: uniqueVisitors,
      sessions: sessions.length,
      page_views: pvRes.count ?? 0,
      conversions,
      conversion_rate: sessions.length > 0 ? `${((conversions / sessions.length) * 100).toFixed(1)}%` : '0%',
      top_sources: Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([source, count]) => ({ source, sessions: count })),
    })
  }

  if (action === 'list_traffic_sessions') {
    const limit = Math.min(Number(params.limit ?? 20), 100)
    let q = supabase.from('traffic_sessions')
      .select('id, started_at, landing_page, utm_source, utm_campaign, utm_medium, device_type, country_name, is_converted, page_view_count')
      .eq('organization_id', orgId)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (params.utm_source) q = q.eq('utm_source', params.utm_source)
    if (params.utm_campaign) q = q.eq('utm_campaign', params.utm_campaign)
    if (params.converted_only === true) q = q.eq('is_converted', true)

    const { data } = await q
    return ok(data ?? [])
  }

  if (action === 'list_traffic_campaigns') {
    const days = Math.min(Number(params.days ?? 30), 90)
    const from = new Date(Date.now() - days * 864e5).toISOString()

    const { data } = await supabase
      .from('traffic_sessions')
      .select('utm_campaign, utm_source, utm_medium, is_converted')
      .eq('organization_id', orgId)
      .not('utm_campaign', 'is', null)
      .gte('started_at', from)

    const rows: { utm_campaign: string; utm_source: string | null; utm_medium: string | null; is_converted: boolean }[] = data ?? []
    const map: Record<string, { sessions: number; conversions: number; source: string | null; medium: string | null }> = {}
    for (const r of rows) {
      if (!map[r.utm_campaign]) map[r.utm_campaign] = { sessions: 0, conversions: 0, source: r.utm_source, medium: r.utm_medium }
      map[r.utm_campaign].sessions++
      if (r.is_converted) map[r.utm_campaign].conversions++
    }

    return ok(Object.entries(map).map(([campaign, d]) => ({ campaign, ...d })).sort((a, b) => b.sessions - a.sessions))
  }

  if (action === 'get_traffic_setup') {
    const { data } = await supabase
      .from('traffic_setups')
      .select('script_token, primary_website_url, verification_state, verified_at')
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!data) return err('No traffic setup found', 404)
    return ok(data)
  }

  return err(`Unknown action: ${action}`)
}
