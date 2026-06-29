import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'

async function queryAnalyticsSummary(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const days = Math.min(Number(input.days ?? 30), 90)
  const from = new Date(Date.now() - days * 864e5).toISOString()
  const to = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = ctx.supabase as any

  const [sessionsRes, pvRes, eventsRes] = await Promise.all([
    sb.from('analytics_sessions')
      .select('id, visitor_id, is_converted, utm_source, utm_campaign, utm_medium')
      .eq('organization_id', ctx.orgId)
      .gte('started_at', from)
      .lte('started_at', to),
    sb.from('analytics_pageviews')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ctx.orgId)
      .gte('occurred_at', from)
      .lte('occurred_at', to),
    sb.from('analytics_events')
      .select('event_type')
      .eq('organization_id', ctx.orgId)
      .gte('occurred_at', from)
      .lte('occurred_at', to),
  ])

  const sessions: { visitor_id: string; is_converted: boolean; utm_source: string | null; utm_campaign: string | null; utm_medium: string | null }[] = sessionsRes.data ?? []
  const pvCount: number = pvRes.count ?? 0
  const events: { event_type: string }[] = eventsRes.data ?? []

  const uniqueVisitors = new Set(sessions.map((s) => s.visitor_id)).size
  const conversions = sessions.filter((s) => s.is_converted).length
  const convRate = sessions.length > 0 ? ((conversions / sessions.length) * 100).toFixed(1) : '0'

  const sourceCounts: Record<string, number> = {}
  for (const s of sessions) {
    const key = s.utm_source ?? 'direct'
    sourceCounts[key] = (sourceCounts[key] ?? 0) + 1
  }
  const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const campaignCounts: Record<string, number> = {}
  for (const s of sessions) {
    if (s.utm_campaign) campaignCounts[s.utm_campaign] = (campaignCounts[s.utm_campaign] ?? 0) + 1
  }
  const topCampaigns = Object.entries(campaignCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const eventCounts: Record<string, number> = {}
  for (const e of events) {
    eventCounts[e.event_type] = (eventCounts[e.event_type] ?? 0) + 1
  }

  return {
    success: true,
    data: {
      period_days: days,
      unique_visitors: uniqueVisitors,
      sessions: sessions.length,
      page_views: pvCount,
      conversions,
      conversion_rate: `${convRate}%`,
      top_sources: topSources.map(([source, count]) => ({ source, sessions: count })),
      top_campaigns: topCampaigns.map(([campaign, count]) => ({ campaign, sessions: count })),
      conversion_events: eventCounts,
    },
  }
}

async function queryAnalyticsSessions(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const limit = Math.min(Number(input.limit ?? 20), 50)
  const converted = input.converted_only === true ? true : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (ctx.supabase as any)
    .from('analytics_sessions')
    .select('id, started_at, landing_page, utm_source, utm_campaign, device_type, country_name, is_converted, page_view_count')
    .eq('organization_id', ctx.orgId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (converted !== undefined) q = q.eq('is_converted', converted)
  if (input.utm_source) q = q.eq('utm_source', input.utm_source)
  if (input.utm_campaign) q = q.eq('utm_campaign', input.utm_campaign)

  const { data, error } = await q
  if (error) return { success: false, error: error.message }
  return { success: true, data: { sessions: data, count: data?.length ?? 0 } }
}

async function queryAnalyticsCampaigns(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const days = Math.min(Number(input.days ?? 30), 90)
  const from = new Date(Date.now() - days * 864e5).toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.supabase as any)
    .from('analytics_sessions')
    .select('utm_campaign, utm_source, utm_medium, is_converted')
    .eq('organization_id', ctx.orgId)
    .not('utm_campaign', 'is', null)
    .gte('started_at', from)

  if (error) return { success: false, error: error.message }

  const rows: { utm_campaign: string; utm_source: string | null; utm_medium: string | null; is_converted: boolean }[] = data ?? []
  const map: Record<string, { sessions: number; conversions: number; source: string | null; medium: string | null }> = {}
  for (const r of rows) {
    if (!map[r.utm_campaign]) map[r.utm_campaign] = { sessions: 0, conversions: 0, source: r.utm_source, medium: r.utm_medium }
    map[r.utm_campaign].sessions++
    if (r.is_converted) map[r.utm_campaign].conversions++
  }

  const campaigns = Object.entries(map)
    .map(([campaign, d]) => ({ campaign, ...d }))
    .sort((a, b) => b.sessions - a.sessions)

  return { success: true, data: { campaigns, period_days: days } }
}

export const analyticsTools: CopilotToolRegistry = {
  query_analytics_summary: {
    mode: 'read',
    definition: {
      name: 'query_analytics_summary',
      description: 'Get a summary of website analytics: visitors, sessions, page views, conversions, top sources and campaigns. Default period is 30 days.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look back (max 90, default 30)' },
        },
      },
    },
    handler: queryAnalyticsSummary,
  },
  query_analytics_sessions: {
    mode: 'read',
    definition: {
      name: 'query_analytics_sessions',
      description: 'List recent website sessions. Can filter by source, campaign, or converted-only.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max rows (1-50, default 20)' },
          converted_only: { type: 'boolean', description: 'If true, only return sessions that converted' },
          utm_source: { type: 'string', description: 'Filter by UTM source' },
          utm_campaign: { type: 'string', description: 'Filter by UTM campaign' },
        },
      },
    },
    handler: queryAnalyticsSessions,
  },
  query_analytics_campaigns: {
    mode: 'read',
    definition: {
      name: 'query_analytics_campaigns',
      description: 'List UTM campaigns with their session and conversion counts.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to look back (max 90, default 30)' },
        },
      },
    },
    handler: queryAnalyticsCampaigns,
  },
}
