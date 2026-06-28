// Copilot tools for the Ads Journey.
//
// These make the Copilot a first-class operator of the ads journey: it can read
// the journey state, GROUND its thinking in Global Knowledge (curated
// fundamentals), inspect live Meta metrics + CRM attribution, and record what it
// learns as memories/plans for the operator to approve. The system prompt
// instructs the Copilot to ACTIVATE the journey for any ads request.

import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createMemory, getOrCreateJourney } from '@/lib/ads/journey-db'
import type { AdsMemoryType } from '@/lib/ads/journey-db'
import { searchGlobalKnowledge } from '@/lib/knowledge/global-knowledge'
import { decrypt } from '@/lib/crypto'
import { getInsights, listCampaigns, getAdAccountInfo } from '@/lib/ads/meta-api'
import type { DatePreset } from '@/lib/ads/meta-api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

type Platform = 'meta' | 'google'

async function getMetaAccessToken(orgId: string): Promise<{ token: string; accountId: string } | null> {
  const { data } = await db()
    .from('ads_connections')
    .select('ad_account_id, encrypted_access_token, status')
    .eq('org_id', orgId)
    .eq('platform', 'meta')
    .in('status', ['active', 'available'])
    .order('status')
    .limit(1)
  const conn = (data as { ad_account_id: string; encrypted_access_token: string }[] | null)?.[0]
  if (!conn) return null
  return { token: await decrypt(conn.encrypted_access_token), accountId: conn.ad_account_id }
}

function parseLeads(actions?: Array<{ action_type: string; value: string }>): number {
  return parseFloat(actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
}

// ─── Read: journey state ──────────────────────────────────────────────────────
async function queryAdsJourney(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const platform = input.platform as Platform | undefined
  const limit = Math.min(Number(input.limit ?? 10), 50)
  const orgId = ctx.orgId

  let memQ = db()
    .from('ads_memories')
    .select('id, type, status, platform, title, content, campaign_name, confidence, created_at')
    .eq('org_id', orgId)
    .in('status', ['active', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (platform) memQ = memQ.or(`platform.eq.${platform},platform.is.null`)

  let execQ = db()
    .from('ads_executions')
    .select('id, type, platform, title, campaign_name, after_value, executed_by_ai, executed_at')
    .eq('org_id', orgId)
    .order('executed_at', { ascending: false })
    .limit(limit)
  if (platform) execQ = execQ.eq('platform', platform)

  let planQ = db()
    .from('ads_plans')
    .select('id, type, title, description, platform, metric, target_value, deadline, status')
    .eq('org_id', orgId)
    .in('status', ['active', 'draft'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (platform) planQ = planQ.or(`platform.eq.${platform},platform.is.null`)

  const [{ data: memories }, { data: executions }, { data: plans }] = await Promise.all([memQ, execQ, planQ])
  return { success: true, data: { memories: memories ?? [], executions: executions ?? [], plans: plans ?? [], platform: platform ?? 'all' } }
}

// ─── Read: Global Knowledge (fundamentals) ─────────────────────────────────
async function searchGlobalKnowledgeTool(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = String(input.query ?? '').trim()
  if (!query) return { success: false, error: 'query is required' }
  const result = await searchGlobalKnowledge({
    orgId: ctx.orgId,
    query,
    platform: input.platform as Platform | undefined,
    topK: input.top_k ? Math.min(Number(input.top_k), 20) : 6,
  })
  if ('error' in result) return { success: false, error: result.detail ?? result.error }
  return { success: true, data: result }
}

// ─── Read: live Meta metrics ──────────────────────────────────────────────────
async function getAdsOverview(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const conn = await getMetaAccessToken(ctx.orgId)
  if (!conn) return { success: false, error: 'No active Meta Ads connection for this org.' }
  const datePreset = (input.date_preset as DatePreset) ?? 'last_30d'
  try {
    const [info, insights] = await Promise.all([
      getAdAccountInfo(conn.accountId, conn.token),
      getInsights(conn.accountId, conn.token, { level: 'account', datePreset }),
    ])
    const raw = insights.data[0] ?? null
    const leads = raw ? parseLeads(raw.actions) : 0
    const spend = raw ? parseFloat(raw.spend ?? '0') : 0
    return {
      success: true,
      data: {
        ad_account_name: info.name,
        currency: info.currency,
        date_preset: datePreset,
        metrics: raw ? {
          spend, leads,
          impressions: parseInt(raw.impressions ?? '0', 10),
          clicks: parseInt(raw.clicks ?? '0', 10),
          ctr: raw.ctr ? parseFloat(raw.ctr) : null,
          cpm: raw.cpm ? parseFloat(raw.cpm) : null,
          cpc: raw.cpc ? parseFloat(raw.cpc) : null,
          cpl: leads > 0 ? spend / leads : null,
        } : null,
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Meta API error' }
  }
}

async function listAdsCampaigns(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const conn = await getMetaAccessToken(ctx.orgId)
  if (!conn) return { success: false, error: 'No active Meta Ads connection for this org.' }
  const datePreset = (input.date_preset as DatePreset) ?? 'last_30d'
  try {
    const [campaigns, insights] = await Promise.all([
      listCampaigns(conn.accountId, conn.token),
      getInsights(conn.accountId, conn.token, {
        level: 'campaign', datePreset,
        fields: ['impressions', 'clicks', 'spend', 'cpc', 'cpm', 'ctr', 'actions', 'campaign_id', 'campaign_name'],
      }),
    ])
    const map = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).campaign_id, i]))
    const enriched = campaigns.map((c) => {
      const ins = map.get(c.id)
      const leads = ins ? parseLeads(ins.actions) : 0
      const spend = ins ? parseFloat(ins.spend ?? '0') : 0
      return {
        id: c.id, name: c.name, status: c.effective_status, objective: c.objective,
        daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
        spend, leads,
        ctr: ins?.ctr ? parseFloat(ins.ctr) : null,
        cpl: leads > 0 ? spend / leads : null,
      }
    })
    return { success: true, data: { campaigns: enriched, total: enriched.length } }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Meta API error' }
  }
}

// ─── Write: record memories / plans ───────────────────────────────────────────
async function writeMemory(input: Record<string, unknown>, ctx: ToolContext, proposed: boolean): Promise<ToolResult> {
  const id = await createMemory({
    orgId: ctx.orgId,
    type: input.type as AdsMemoryType,
    source: 'chat',
    platform: input.platform as Platform | undefined,
    title: String(input.title ?? ''),
    content: String(input.content ?? ''),
    campaignName: input.campaign_name as string | undefined,
    confidence: input.confidence ? Number(input.confidence) : (proposed ? 2 : 4),
    proposed,
    status: proposed ? 'needs_review' : 'active',
  })
  if (!id) return { success: false, error: 'Failed to save memory' }
  return { success: true, data: { id, status: proposed ? 'needs_review' : 'active' } }
}

async function createAdsPlan(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const journey = await getOrCreateJourney(ctx.orgId)
  const { data, error } = await db()
    .from('ads_plans')
    .insert({
      org_id: ctx.orgId,
      journey_id: journey.id,
      type: input.type,
      title: String(input.title ?? ''),
      description: (input.description as string | undefined) ?? null,
      platform: (input.platform as Platform | undefined) ?? null,
      metric: (input.metric as string | undefined) ?? null,
      target_value: input.target_value != null ? Number(input.target_value) : null,
      deadline: (input.deadline as string | undefined) ?? null,
      status: 'active',
    })
    .select('id')
    .single()
  if (error) return { success: false, error: error.message }
  return { success: true, data: { id: data.id } }
}

const PLATFORM_PROP = { type: 'string', enum: ['meta', 'google'], description: 'Ad platform (omit for cross-platform)' }
const MEMORY_TYPE_PROP = { type: 'string', enum: ['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal'] }

export const adsTools: CopilotToolRegistry = {
  query_ads_journey: {
    mode: 'read',
    definition: {
      name: 'query_ads_journey',
      description: 'Get the current ads journey state: recent memories (insights/decisions/plans/risks), recent executions (pauses/budget changes), and active plans. ALWAYS call this first when the operator asks anything about ads.',
      input_schema: { type: 'object', properties: { platform: PLATFORM_PROP, limit: { type: 'number', description: 'Max items per section (default 10, max 50)' } } },
    },
    handler: queryAdsJourney,
  },
  search_global_knowledge: {
    mode: 'read',
    definition: {
      name: 'search_global_knowledge',
      description: 'Semantic search over Global Knowledge by media. Use this to ground every diagnosis and recommendation in curated fundamentals before proposing changes.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What you need fundamentals about (e.g. "scaling a winning ABO campaign on Meta")' }, platform: PLATFORM_PROP, top_k: { type: 'number', description: 'Max passages (default 6, max 20)' } }, required: ['query'] },
    },
    handler: searchGlobalKnowledgeTool,
  },
  get_ads_overview: {
    mode: 'read',
    definition: {
      name: 'get_ads_overview',
      description: 'Account-level Meta Ads performance: spend, leads, impressions, clicks, CTR, CPM, CPC, CPL. Uses the org\'s active Meta connection.',
      input_schema: { type: 'object', properties: { date_preset: { type: 'string', description: 'e.g. last_7d, last_30d (default), last_90d, this_month' } } },
    },
    handler: getAdsOverview,
  },
  list_ads_campaigns: {
    mode: 'read',
    definition: {
      name: 'list_ads_campaigns',
      description: 'List Meta Ads campaigns with status, spend, leads, CTR and CPL. Use to find which campaigns to diagnose.',
      input_schema: { type: 'object', properties: { date_preset: { type: 'string', description: 'e.g. last_7d, last_30d (default), last_90d' } } },
    },
    handler: listAdsCampaigns,
  },
  create_ads_memory: {
    mode: 'write',
    definition: {
      name: 'create_ads_memory',
      description: 'Record a confirmed insight/decision/plan/risk/observation/result/goal into the journey (status active). Use for things the operator confirmed or that are clearly true.',
      input_schema: { type: 'object', properties: { type: MEMORY_TYPE_PROP, title: { type: 'string' }, content: { type: 'string' }, platform: PLATFORM_PROP, campaign_name: { type: 'string' }, confidence: { type: 'number', description: '1-5' } }, required: ['type', 'title', 'content'] },
    },
    handler: (input, ctx) => writeMemory(input, ctx, false),
  },
  propose_ads_memory: {
    mode: 'write',
    definition: {
      name: 'propose_ads_memory',
      description: 'Propose a memory for the operator to review/approve (status needs_review). Use when less certain — proposals show in the journey Story tab with approve/dismiss.',
      input_schema: { type: 'object', properties: { type: MEMORY_TYPE_PROP, title: { type: 'string' }, content: { type: 'string' }, platform: PLATFORM_PROP, campaign_name: { type: 'string' }, confidence: { type: 'number', description: '1-5' } }, required: ['type', 'title', 'content'] },
    },
    handler: (input, ctx) => writeMemory(input, ctx, true),
  },
  create_ads_plan: {
    mode: 'write',
    definition: {
      name: 'create_ads_plan',
      description: 'Create a strategy, hypothesis, target, or experiment in the journey Planning tab. Ground it in Global Knowledge.',
      input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['strategy', 'hypothesis', 'target', 'experiment'] }, title: { type: 'string' }, description: { type: 'string' }, platform: PLATFORM_PROP, metric: { type: 'string' }, target_value: { type: 'number' }, deadline: { type: 'string', description: 'ISO date' } }, required: ['type', 'title'] },
    },
    handler: createAdsPlan,
  },
}
