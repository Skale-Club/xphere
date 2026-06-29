import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createMemory, getOrCreateJourney } from '@/lib/ads/journey-db'
import type { AdsMemoryType, AdsMemorySource } from '@/lib/ads/journey-db'
import {
  searchGlobalKnowledge,
  ingestGlobalKnowledgeText,
  isPlatformAdminUser,
} from '@/lib/knowledge/global-knowledge'
import { decrypt } from '@/lib/crypto'
import { getInsights, listCampaigns, getAdAccountInfo } from '@/lib/ads/meta-api'
import type { DatePreset } from '@/lib/ads/meta-api'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const DaysSchema = z.number().int().positive().max(365)
const PlatformSchema = z.enum(['meta', 'google']).optional()

const MetaDatePresetSchema = z.enum([
  'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d',
  'last_90d', 'this_month', 'last_month', 'maximum',
]).default('last_30d')

async function getMetaAccessToken(orgId: string, adAccountId?: string): Promise<{ token: string; accountId: string } | null> {
  let q = db()
    .from('ads_connections')
    .select('ad_account_id, encrypted_access_token, status')
    .eq('org_id', orgId)
    .eq('platform', 'meta')
    .in('status', ['active', 'available'])
    .order('status') // 'active' sorts before 'available'

  if (adAccountId) q = q.eq('ad_account_id', adAccountId)
  else q = q.limit(1)

  const { data } = await q
  const conn = (data as { ad_account_id: string; encrypted_access_token: string }[] | null)?.[0]
  if (!conn) return null
  return { token: await decrypt(conn.encrypted_access_token), accountId: conn.ad_account_id }
}

function parseLeads(actions?: Array<{ action_type: string; value: string }>): number {
  return parseFloat(actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
}

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

  // ─── Meta Ads live metrics ────────────────────────────────────────────────────

  {
    name: 'ads_meta_get_overview',
    title: 'Get Meta Ads overview',
    description:
      'Get account-level Meta Ads performance metrics: spend, impressions, clicks, CTR, CPM, CPC, reach, and leads. Pass ad_account_id to target a specific account, otherwise uses the first active Meta connection for the org.',
    area: 'general_xphere',
    inputSchema: z.object({
      ad_account_id: z.string().optional(),
      date_preset: MetaDatePresetSchema,
    }).strict(),
    handler: async ({ ad_account_id, date_preset }, { auth }) => {
      const conn = await getMetaAccessToken(auth.orgId, ad_account_id)
      if (!conn) return { error: 'no_connection', detail: 'No active Meta Ads connection found for this org.' }

      try {
        const [accountInfo, insights] = await Promise.all([
          getAdAccountInfo(conn.accountId, conn.token),
          getInsights(conn.accountId, conn.token, { level: 'account', datePreset: date_preset as DatePreset }),
        ])
        const raw = insights.data[0] ?? null
        const leads = raw ? parseLeads(raw.actions) : 0
        const spend = raw ? parseFloat(raw.spend ?? '0') : 0
        return {
          ad_account_id: conn.accountId,
          ad_account_name: accountInfo.name,
          currency: accountInfo.currency,
          date_preset,
          metrics: raw ? {
            spend,
            impressions: parseInt(raw.impressions ?? '0', 10),
            clicks: parseInt(raw.clicks ?? '0', 10),
            reach: parseInt(raw.reach ?? '0', 10),
            leads,
            ctr: raw.ctr ? parseFloat(raw.ctr) : null,
            cpm: raw.cpm ? parseFloat(raw.cpm) : null,
            cpc: raw.cpc ? parseFloat(raw.cpc) : null,
            cpp: raw.cpp ? parseFloat(raw.cpp) : null,
            frequency: raw.frequency ? parseFloat(raw.frequency) : null,
            cpl: leads > 0 ? spend / leads : null,
            date_start: raw.date_start,
            date_stop: raw.date_stop,
          } : null,
        }
      } catch (e) {
        return { error: 'meta_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_meta_list_campaigns',
    title: 'List Meta Ads campaigns',
    description:
      'List Meta Ads campaigns for the org with enriched performance insights: status, spend, impressions, clicks, CTR, CPM, CPC, leads, and CPL. Use this to analyze which campaigns are active and performing.',
    area: 'general_xphere',
    inputSchema: z.object({
      ad_account_id: z.string().optional(),
      date_preset: MetaDatePresetSchema,
    }).strict(),
    handler: async ({ ad_account_id, date_preset }, { auth }) => {
      const conn = await getMetaAccessToken(auth.orgId, ad_account_id)
      if (!conn) return { error: 'no_connection', detail: 'No active Meta Ads connection found for this org.' }

      try {
        const [campaigns, insights] = await Promise.all([
          listCampaigns(conn.accountId, conn.token),
          getInsights(conn.accountId, conn.token, {
            level: 'campaign',
            datePreset: date_preset as DatePreset,
            fields: ['impressions', 'clicks', 'spend', 'reach', 'cpc', 'cpm', 'ctr', 'actions', 'campaign_id', 'campaign_name'],
          }),
        ])

        const insightMap = new Map(
          insights.data.map((i) => {
            const raw = i as unknown as Record<string, string>
            return [raw.campaign_id, i]
          })
        )

        const enriched = campaigns.map((c) => {
          const ins = insightMap.get(c.id)
          const leads = ins ? parseLeads(ins.actions) : 0
          const spend = ins ? parseFloat(ins.spend ?? '0') : 0
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            effective_status: c.effective_status,
            objective: c.objective,
            daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
            lifetime_budget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
            insights: ins ? {
              spend,
              impressions: parseInt(ins.impressions ?? '0', 10),
              clicks: parseInt(ins.clicks ?? '0', 10),
              reach: parseInt(ins.reach ?? '0', 10),
              leads,
              ctr: ins.ctr ? parseFloat(ins.ctr) : null,
              cpm: ins.cpm ? parseFloat(ins.cpm) : null,
              cpc: ins.cpc ? parseFloat(ins.cpc) : null,
              cpl: leads > 0 ? spend / leads : null,
            } : null,
          }
        })

        return {
          ad_account_id: conn.accountId,
          date_preset,
          campaigns: enriched,
          total_campaigns: enriched.length,
          active_campaigns: enriched.filter((c) => c.effective_status === 'ACTIVE').length,
        }
      } catch (e) {
        return { error: 'meta_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
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
        .from('analytics_sessions')
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
        .from('analytics_visitors')
        .select('id, contact_id')
        .in('id', visitorIds)
        .not('contact_id', 'is', null)

      const visitorContactMap = new Map<string, string>()
      for (const v of (visitors ?? []) as { id: string; contact_id: string }[]) {
        visitorContactMap.set(v.id, v.contact_id)
      }

      const sessionIds = (sessions as { id: string }[]).map((s) => s.id)
      const { data: events } = await db()
        .from('analytics_events')
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

  // ─── Global Knowledge (curated fundamentals) ─────────────────────────────────

  {
    name: 'global_knowledge_search',
    title: 'Search Global Knowledge',
    description:
      'Semantic search over the platform-wide, expert-curated ads knowledge base (transcribed courses, market best-practices) segmented by media. Use this to GROUND diagnostics, proposals, and plans in proven fundamentals before suggesting changes. A requested platform also returns platform-agnostic "global" fundamentals. Cite what you use.',
    area: 'general_xphere',
    inputSchema: z.object({
      query: z.string().min(1),
      platform: PlatformSchema,
      top_k: z.number().int().positive().max(20).optional(),
    }).strict(),
    handler: async ({ query, platform, top_k }, { auth }) => {
      const result = await searchGlobalKnowledge({
        orgId: auth.orgId,
        query,
        platform,
        topK: top_k,
      })
      return result
    },
  },

  // ─── Global Knowledge management (SUPER ADMIN ONLY) ──────────────────────────
  // These feed/curate the global corpus. Gated to the platform super admin (the
  // calling MCP user must be a platform admin), regardless of which org the token
  // belongs to. Ingestion is billed to the platform OpenRouter key.

  {
    name: 'global_knowledge_add_text',
    title: 'Add text to Global Knowledge (super admin)',
    description:
      'SUPER ADMIN ONLY. Ingest curated material into Global Knowledge for a media scope (meta/google) or "global". Chunks and embeds synchronously using the platform OpenRouter key.',
    area: 'general_xphere',
    inputSchema: z.object({
      name: z.string().min(1).max(200),
      content: z.string().min(1).max(500_000),
      platform: z.enum(['meta', 'google', 'global']).default('global'),
    }).strict(),
    handler: async ({ name, content, platform }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) {
        return { error: 'forbidden', detail: 'Only the platform super admin can manage Global Knowledge.', status: 403 }
      }
      const result = await ingestGlobalKnowledgeText({ name, content, platform, createdBy: auth.userId })
      return result
    },
  },

  {
    name: 'global_knowledge_list',
    title: 'List Global Knowledge sources (super admin)',
    description: 'SUPER ADMIN ONLY. List Global Knowledge sources, optionally filtered by media.',
    area: 'general_xphere',
    inputSchema: z.object({
      platform: z.enum(['meta', 'google', 'global']).optional(),
    }).strict(),
    handler: async ({ platform }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) {
        return { error: 'forbidden', detail: 'Only the platform super admin can manage Global Knowledge.', status: 403 }
      }
      let q = db()
        .from('global_knowledge_sources')
        .select('id, platform, name, source_type, status, error_detail, chunk_count, created_at')
        .order('created_at', { ascending: false })
      if (platform) q = q.eq('platform', platform)
      const { data, error } = await q
      if (error) return { error: 'query_failed', detail: error.message }
      return { sources: data ?? [], count: (data ?? []).length }
    },
  },

  {
    name: 'global_knowledge_delete',
    title: 'Delete a Global Knowledge source (super admin)',
    description: 'SUPER ADMIN ONLY. Remove a Global Knowledge source and its vector chunks.',
    area: 'general_xphere',
    inputSchema: z.object({
      source_id: z.string().uuid(),
    }).strict(),
    handler: async ({ source_id }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) {
        return { error: 'forbidden', detail: 'Only the platform super admin can manage Global Knowledge.', status: 403 }
      }
      await db().from('documents').delete().contains('metadata', { global_knowledge_source_id: source_id })
      const { error } = await db().from('global_knowledge_sources').delete().eq('id', source_id)
      if (error) return { error: 'delete_failed', detail: error.message }
      return { ok: true }
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
