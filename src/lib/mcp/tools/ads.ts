import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const DaysSchema = z.number().int().positive().max(365)
const PlatformSchema = z.enum(['meta', 'google']).optional()

export const adsTools: McpToolDef[] = [
  {
    name: 'ads_list_connections',
    title: 'List ads connections',
    description: 'List all connected ad accounts (Meta and Google Ads) for the organization.',
    area: 'general_xphere',
    inputSchema: z.object({
      platform: PlatformSchema,
    }).strict(),
    handler: async ({ platform }, { auth }) => {
      let q = db()
        .from('ads_connections')
        .select('id, platform, ad_account_id, ad_account_name, status, connection_error, token_expires_at, created_at, updated_at')
        .eq('org_id', auth.orgId)
        .order('platform')
        .order('ad_account_name')
      if (platform) q = q.eq('platform', platform)
      const { data, error } = await q
      if (error) return { error: 'query_failed', detail: error.message }
      return { connections: data ?? [] }
    },
  },

  {
    name: 'ads_get_attribution',
    title: 'Get ads attribution',
    description:
      'UTM-level lead and revenue attribution for ad campaigns. Joins traffic sessions → visitor contacts → CRM opportunities. Returns sessions, identified contacts, opportunities and pipeline revenue per campaign.',
    area: 'general_xphere',
    inputSchema: z.object({
      days: DaysSchema.optional(),
      platform: PlatformSchema,
    }).strict(),
    handler: async ({ days = 30, platform }, { auth }) => {
      const from = new Date(Date.now() - days * 864e5).toISOString()
      const to = new Date().toISOString()

      // Pull sessions with UTM data
      let sessionQ = db()
        .from('traffic_sessions')
        .select('id, utm_source, utm_medium, utm_campaign, visitor_id')
        .eq('organization_id', auth.orgId)
        .not('utm_campaign', 'is', null)
        .gte('started_at', from)
        .lte('started_at', to)
        .limit(5000)

      if (platform === 'meta') {
        sessionQ = sessionQ.in('utm_source', ['meta', 'facebook', 'instagram', 'fb'])
      } else if (platform === 'google') {
        sessionQ = sessionQ.in('utm_source', ['google', 'adwords', 'google-ads'])
      }

      const { data: sessions, error: sessErr } = await sessionQ
      if (sessErr) return { error: 'query_failed', detail: sessErr.message }
      if (!sessions?.length) {
        return {
          rows: [],
          totals: { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 },
          period_days: days,
          platform: platform ?? 'all',
        }
      }

      // Resolve contact_ids for visitor_ids
      const visitorIds = [...new Set((sessions as { visitor_id: string }[]).map((s) => s.visitor_id))]
      const { data: visitors } = await db()
        .from('traffic_visitors')
        .select('id, contact_id')
        .in('id', visitorIds)
        .not('contact_id', 'is', null)

      const visitorContactMap = new Map<string, string>()
      for (const v of (visitors ?? []) as { id: string; contact_id: string }[]) {
        visitorContactMap.set(v.id, v.contact_id)
      }

      // Also pull contact_id from traffic_events (contact_created signal)
      const sessionIds = (sessions as { id: string }[]).map((s) => s.id)
      const { data: events } = await db()
        .from('traffic_events')
        .select('session_id, contact_id')
        .in('session_id', sessionIds)
        .not('contact_id', 'is', null)

      const eventContactMap = new Map<string, string>()
      for (const e of (events ?? []) as { session_id: string; contact_id: string }[]) {
        if (!eventContactMap.has(e.session_id)) eventContactMap.set(e.session_id, e.contact_id)
      }

      // Aggregate per campaign
      type CampaignRow = {
        utm_source: string | null
        utm_medium: string | null
        utm_campaign: string | null
        sessions: number
        contact_ids: Set<string>
        opp_ids: Set<string>
        revenue: number
      }
      const map = new Map<string, CampaignRow>()

      for (const s of sessions as { id: string; visitor_id: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }[]) {
        const key = `${s.utm_source ?? ''}|${s.utm_medium ?? ''}|${s.utm_campaign ?? ''}`
        if (!map.has(key)) {
          map.set(key, {
            utm_source: s.utm_source,
            utm_medium: s.utm_medium,
            utm_campaign: s.utm_campaign,
            sessions: 0,
            contact_ids: new Set(),
            opp_ids: new Set(),
            revenue: 0,
          })
        }
        const row = map.get(key)!
        row.sessions++

        const contactId = visitorContactMap.get(s.visitor_id) ?? eventContactMap.get(s.id)
        if (contactId) row.contact_ids.add(contactId)
      }

      // Resolve opportunities for all identified contacts
      const allContactIds = [...new Set([...visitorContactMap.values(), ...eventContactMap.values()])]
      if (allContactIds.length) {
        const { data: opps } = await db()
          .from('opportunities')
          .select('id, contact_id, value')
          .in('contact_id', allContactIds)
          .eq('org_id', auth.orgId)

        // Map contact_id → session keys to attribute opportunities
        const contactSessionKeys = new Map<string, string[]>()
        for (const s of sessions as { id: string; visitor_id: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }[]) {
          const contactId = visitorContactMap.get(s.visitor_id) ?? eventContactMap.get(s.id)
          if (!contactId) continue
          const key = `${s.utm_source ?? ''}|${s.utm_medium ?? ''}|${s.utm_campaign ?? ''}`
          const keys = contactSessionKeys.get(contactId) ?? []
          if (!keys.includes(key)) keys.push(key)
          contactSessionKeys.set(contactId, keys)
        }

        for (const opp of (opps ?? []) as { id: string; contact_id: string; value: number | null }[]) {
          const keys = contactSessionKeys.get(opp.contact_id) ?? []
          for (const key of keys) {
            const row = map.get(key)
            if (row && !row.opp_ids.has(opp.id)) {
              row.opp_ids.add(opp.id)
              row.revenue += opp.value ?? 0
            }
          }
        }
      }

      const rows = Array.from(map.values())
        .map((r) => ({
          utm_source: r.utm_source,
          utm_medium: r.utm_medium,
          utm_campaign: r.utm_campaign,
          sessions: r.sessions,
          identified_contacts: r.contact_ids.size,
          opportunities: r.opp_ids.size,
          revenue: r.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions)

      const totals = rows.reduce(
        (acc, r) => ({
          sessions: acc.sessions + r.sessions,
          identified_contacts: acc.identified_contacts + r.identified_contacts,
          opportunities: acc.opportunities + r.opportunities,
          revenue: acc.revenue + r.revenue,
        }),
        { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 },
      )

      return { rows, totals, period_days: days, platform: platform ?? 'all' }
    },
  },
]
