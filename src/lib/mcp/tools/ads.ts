import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createMemory, getOrCreateJourney } from '@/lib/ads/journey-db'
import type { AdsMemoryType, AdsMemorySource } from '@/lib/ads/journey-db'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const DaysSchema = z.number().int().positive().max(365)
const PlatformSchema = z.enum(['meta', 'google']).optional()

export const adsTools: McpToolDef[] = [
  // ─── Connections ──────────────────────────────────────────────────────────────

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

  // ─── Attribution ──────────────────────────────────────────────────────────────

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

      const allContactIds = [...new Set([...visitorContactMap.values(), ...eventContactMap.values()])]
      if (allContactIds.length) {
        const { data: opps } = await db()
          .from('opportunities')
          .select('id, contact_id, value')
          .in('contact_id', allContactIds)
          .eq('org_id', auth.orgId)

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

  // ─── Journey ──────────────────────────────────────────────────────────────────

  {
    name: 'ads_get_journey_summary',
    title: 'Get ads journey summary',
    description:
      'Get a summary of the ads journey: recent memories (insights/decisions/plans), recent executions (pauses/budget changes), and active plans. Use this to understand the current state of the ads strategy.',
    area: 'general_xphere',
    inputSchema: z.object({
      platform: PlatformSchema,
      limit: z.number().int().min(1).max(50).default(10),
    }).strict(),
    handler: async ({ platform, limit }, { auth }) => {
      const orgId = auth.orgId

      // Memories
      let memQ = db()
        .from('ads_memories')
        .select('id, type, status, source, platform, title, content, campaign_name, confidence, created_at')
        .eq('org_id', orgId)
        .in('status', ['active', 'needs_review'])
        .order('created_at', { ascending: false })
        .limit(limit)

      if (platform) memQ = memQ.or(`platform.eq.${platform},platform.is.null`)
      const { data: memories } = await memQ

      // Executions
      let execQ = db()
        .from('ads_executions')
        .select('id, type, platform, title, campaign_name, before_value, after_value, executed_by_ai, executed_at')
        .eq('org_id', orgId)
        .order('executed_at', { ascending: false })
        .limit(limit)

      if (platform) execQ = execQ.eq('platform', platform)
      const { data: executions } = await execQ

      // Active plans
      let planQ = db()
        .from('ads_plans')
        .select('id, type, title, description, platform, metric, target_value, deadline, status')
        .eq('org_id', orgId)
        .in('status', ['active', 'draft'])
        .order('created_at', { ascending: false })
        .limit(limit)

      if (platform) planQ = planQ.or(`platform.eq.${platform},platform.is.null`)
      const { data: plans } = await planQ

      return {
        memories: memories ?? [],
        executions: executions ?? [],
        plans: plans ?? [],
        platform: platform ?? 'all',
      }
    },
  },

  {
    name: 'ads_search_memories',
    title: 'Search ads memories',
    description: 'Search through stored ads insights, decisions, plans, and observations. Filter by type, status, platform, or campaign.',
    area: 'general_xphere',
    inputSchema: z.object({
      type: z.enum(['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal']).optional(),
      status: z.enum(['active', 'archived', 'superseded', 'needs_review']).default('active'),
      platform: PlatformSchema,
      campaign_name: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(),
    handler: async ({ type, status, platform, campaign_name, limit }, { auth }) => {
      let q = db()
        .from('ads_memories')
        .select('*')
        .eq('org_id', auth.orgId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (type) q = q.eq('type', type)
      if (platform) q = q.or(`platform.eq.${platform},platform.is.null`)
      if (campaign_name) q = q.ilike('campaign_name', `%${campaign_name}%`)

      const { data, error } = await q
      if (error) return { error: 'query_failed', detail: error.message }
      return { memories: data ?? [], count: (data ?? []).length }
    },
  },

  {
    name: 'ads_create_memory',
    title: 'Create ads memory',
    description:
      'Record an insight, decision, plan, risk, or observation about the ads strategy. Use this after analyzing data via MCP to preserve important findings for future sessions.',
    area: 'general_xphere',
    inputSchema: z.object({
      type: z.enum(['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal']),
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(2000),
      platform: PlatformSchema,
      campaign_name: z.string().optional(),
      confidence: z.number().int().min(1).max(5).default(4),
    }).strict(),
    handler: async ({ type, title, content, platform, campaign_name, confidence }, { auth }) => {
      const id = await createMemory({
        orgId: auth.orgId,
        type: type as AdsMemoryType,
        source: 'mcp' as AdsMemorySource,
        platform,
        title,
        content,
        campaignName: campaign_name,
        confidence,
        proposed: false,
        status: 'active',
      })
      if (!id) return { error: 'Failed to create memory' }
      return { id, ok: true }
    },
  },

  {
    name: 'ads_propose_memory',
    title: 'Propose ads memory for review',
    description:
      'Propose a memory for the user to review and approve. Use when you are less certain and want the user to validate the insight before it becomes active context.',
    area: 'general_xphere',
    inputSchema: z.object({
      type: z.enum(['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal']),
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(2000),
      platform: PlatformSchema,
      campaign_name: z.string().optional(),
      confidence: z.number().int().min(1).max(5).default(2),
    }).strict(),
    handler: async ({ type, title, content, platform, campaign_name, confidence }, { auth }) => {
      const id = await createMemory({
        orgId: auth.orgId,
        type: type as AdsMemoryType,
        source: 'mcp' as AdsMemorySource,
        platform,
        title,
        content,
        campaignName: campaign_name,
        confidence,
        proposed: true,
        status: 'needs_review',
      })
      if (!id) return { error: 'Failed to propose memory' }
      return { id, ok: true, status: 'needs_review' }
    },
  },

  {
    name: 'ads_create_plan',
    title: 'Create ads plan',
    description:
      'Create a strategic plan, hypothesis, target, or experiment for the ads journey. Plans appear in the Planejamento section of the journey.',
    area: 'general_xphere',
    inputSchema: z.object({
      type: z.enum(['strategy', 'hypothesis', 'target', 'experiment']),
      title: z.string().min(1).max(200),
      description: z.string().optional(),
      platform: PlatformSchema,
      metric: z.string().optional(),
      target_value: z.number().optional(),
      deadline: z.string().optional(),
    }).strict(),
    handler: async ({ type, title, description, platform, metric, target_value, deadline }, { auth }) => {
      const journey = await getOrCreateJourney(auth.orgId)

      const { data, error } = await db()
        .from('ads_plans')
        .insert({
          org_id: auth.orgId,
          journey_id: journey.id,
          type,
          title,
          description: description ?? null,
          platform: platform ?? null,
          metric: metric ?? null,
          target_value: target_value ?? null,
          deadline: deadline ?? null,
          status: 'active',
        })
        .select('id')
        .single()

      if (error) return { error: 'Failed to create plan', detail: error.message }
      return { id: data.id, ok: true }
    },
  },
]
