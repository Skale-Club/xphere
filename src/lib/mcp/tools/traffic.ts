// MCP tools for traffic analytics.
// Ported from the legacy /api/mcp/traffic/route.ts | logic unchanged.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const DaysSchema = z.number().int().positive().max(90)

export const trafficTools: McpToolDef[] = [
  {
    name: 'traffic_get_summary',
    title: 'Traffic summary',
    description: 'High-level traffic metrics for the last N days (max 90).',
    area: 'general_xphere',
    inputSchema: z.object({ days: DaysSchema.optional() }).strict(),
    handler: async ({ days = 30 }, { auth }) => {
      const supabase = db()
      const from = new Date(Date.now() - days * 864e5).toISOString()
      const to = new Date().toISOString()
      const [sessionsRes, pvRes] = await Promise.all([
        supabase.from('traffic_sessions')
          .select('id, visitor_id, is_converted, utm_source, utm_campaign')
          .eq('organization_id', auth.orgId)
          .gte('started_at', from).lte('started_at', to),
        supabase.from('traffic_pageviews')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', auth.orgId)
          .gte('occurred_at', from).lte('occurred_at', to),
      ])
      const sessions: { visitor_id: string; is_converted: boolean; utm_source: string | null; utm_campaign: string | null }[] = sessionsRes.data ?? []
      const uniqueVisitors = new Set(sessions.map((s) => s.visitor_id)).size
      const conversions = sessions.filter((s) => s.is_converted).length

      const sourceCounts: Record<string, number> = {}
      for (const s of sessions) {
        const key = s.utm_source ?? 'direct'
        sourceCounts[key] = (sourceCounts[key] ?? 0) + 1
      }

      return {
        period_days: days,
        unique_visitors: uniqueVisitors,
        sessions: sessions.length,
        page_views: pvRes.count ?? 0,
        conversions,
        conversion_rate: sessions.length > 0
          ? `${((conversions / sessions.length) * 100).toFixed(1)}%`
          : '0%',
        top_sources: Object.entries(sourceCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([source, count]) => ({ source, sessions: count })),
      }
    },
  },
  {
    name: 'traffic_list_sessions',
    title: 'List traffic sessions',
    description: 'List recent traffic sessions with optional UTM and converted-only filters.',
    area: 'general_xphere',
    inputSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
      utm_source: z.string().optional(),
      utm_campaign: z.string().optional(),
      converted_only: z.boolean().optional(),
    }).strict(),
    handler: async ({ limit = 20, utm_source, utm_campaign, converted_only }, { auth }) => {
      let q = db().from('traffic_sessions')
        .select('id, started_at, landing_page, utm_source, utm_campaign, utm_medium, device_type, country_name, is_converted, page_view_count')
        .eq('organization_id', auth.orgId)
        .order('started_at', { ascending: false })
        .limit(limit)
      if (utm_source) q = q.eq('utm_source', utm_source)
      if (utm_campaign) q = q.eq('utm_campaign', utm_campaign)
      if (converted_only === true) q = q.eq('is_converted', true)
      const { data } = await q
      return { sessions: data ?? [] }
    },
  },
  {
    name: 'traffic_list_campaigns',
    title: 'List traffic campaigns',
    description: 'Aggregate UTM campaign performance over the last N days (max 90).',
    area: 'general_xphere',
    inputSchema: z.object({ days: DaysSchema.optional() }).strict(),
    handler: async ({ days = 30 }, { auth }) => {
      const from = new Date(Date.now() - days * 864e5).toISOString()
      const { data } = await db()
        .from('traffic_sessions')
        .select('utm_campaign, utm_source, utm_medium, is_converted')
        .eq('organization_id', auth.orgId)
        .not('utm_campaign', 'is', null)
        .gte('started_at', from)
      const rows: { utm_campaign: string; utm_source: string | null; utm_medium: string | null; is_converted: boolean }[] = data ?? []
      const map: Record<string, { sessions: number; conversions: number; source: string | null; medium: string | null }> = {}
      for (const r of rows) {
        if (!map[r.utm_campaign]) map[r.utm_campaign] = { sessions: 0, conversions: 0, source: r.utm_source, medium: r.utm_medium }
        map[r.utm_campaign].sessions++
        if (r.is_converted) map[r.utm_campaign].conversions++
      }
      return {
        campaigns: Object.entries(map)
          .map(([campaign, d]) => ({ campaign, ...d }))
          .sort((a, b) => b.sessions - a.sessions),
      }
    },
  },
  {
    name: 'traffic_get_setup',
    title: 'Get traffic setup',
    description: 'Returns the org\'s traffic tracking setup (script token, primary URL, verification state).',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const { data } = await db()
        .from('traffic_setups')
        .select('script_token, primary_website_url, verification_state, verified_at')
        .eq('organization_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
]
