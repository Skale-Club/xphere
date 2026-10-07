import { z } from 'zod'
import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createMemory, getOrCreateJourney, updateMemory } from '@/lib/ads/journey-db'
import type { AdsMemoryType, AdsMemorySource } from '@/lib/ads/journey-db'
import { searchMemoriesSemantic } from '@/lib/ads/memory-search'
import {
  searchGlobalKnowledge,
  ingestGlobalKnowledgeText,
  isPlatformAdminUser,
  getGlobalKnowledgeSourceMode,
  listGlobalKnowledgeSources,
} from '@/lib/knowledge/global-knowledge'
import { createGlobalKnowledgeNotionPage, listGlobalKnowledgeNotionRoots } from '@/lib/knowledge/notion-write'
import { processNextGlobalKnowledgeSyncJob } from '@/lib/knowledge/notion-sync'
import { extractUrlContent } from '@/lib/knowledge/url-extract'
import { KnowledgeRefsInputSchema } from '@/lib/knowledge/refs'
import { getInsights, listCampaigns, getAdAccountInfo } from '@/lib/ads/meta-api'
import type { DatePreset } from '@/lib/ads/meta-api'
import { withMetaConnection } from '@/lib/ads/connection-health'
import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { getAdsAttributionForOrg } from '@/lib/ads/attribution'
import { formatCurrency } from '@/lib/ads/currency'
import {
  parseTokens,
  getAccountOverview,
  listCampaigns as googleListCampaigns,
  buildGaqlDateCondition,
} from '@/lib/ads/google-api'
import { getCustomerInfo, refreshAccessToken } from '@/lib/ads/google-oauth'
import { compareAdsPeriods, describeComparison } from '@/lib/ads/snapshot'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const DaysSchema = z.number().int().positive().max(365)
const PlatformSchema = z.enum(['meta', 'google']).optional()

const MetaDatePresetSchema = z.enum([
  'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d',
  'last_90d', 'this_month', 'last_month', 'maximum',
]).default('last_30d')

function parseLeads(actions?: Array<{ action_type: string; value: string }>): number {
  return parseFloat(actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
}

const MemoryTypeSchema = z.enum(['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal'])
const MemoryStatusSchema = z.enum(['active', 'archived', 'superseded', 'needs_review'])

const FORBIDDEN_GLOBAL_KNOWLEDGE = {
  error: 'forbidden',
  detail: 'Only the platform super admin can manage Global Knowledge.',
  status: 403,
} as const

/**
 * Drain the Notion sync queue after the response so a page created through MCP
 * becomes searchable in seconds instead of waiting for the next cron drain.
 * `after` throws outside a request scope; the cron picks the job up anyway.
 */
function scheduleGlobalKnowledgeSync(): void {
  try {
    after(() => processNextGlobalKnowledgeSyncJob().then(() => undefined))
  } catch {
    // No request scope — the scheduled drain will process the queued job.
  }
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
      'Get account-level Meta Ads performance metrics: spend, impressions, clicks, CTR, CPM, CPC, reach, and leads. Pass ad_account_id to target a specific account. If the org has more than one active account and none is specified, this returns the list so you can ask which one — it never guesses. All money values are in the account currency returned alongside them.',
    area: 'general_xphere',
    inputSchema: z.object({
      ad_account_id: z.string().optional(),
      date_preset: MetaDatePresetSchema,
    }).strict(),
    handler: async ({ ad_account_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'meta', ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }

      try {
        const [accountInfo, insights] = await withMetaConnection(auth.orgId, conn.accountId, () =>
          Promise.all([
            getAdAccountInfo(conn.accountId, conn.token),
            getInsights(conn.accountId, conn.token, { level: 'account', datePreset: date_preset as DatePreset }),
          ]),
        )
        const raw = insights.data[0] ?? null
        const leads = raw ? parseLeads(raw.actions) : 0
        const spend = raw ? parseFloat(raw.spend ?? '0') : 0
        const currency = accountInfo.currency
        return {
          ad_account_id: conn.accountId,
          ad_account_name: accountInfo.name,
          currency,
          date_preset,
          metrics: raw ? {
            spend,
            spend_formatted: formatCurrency(spend, currency),
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
            cpl_formatted: leads > 0 ? formatCurrency(spend / leads, currency) : null,
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
      'List Meta Ads campaigns for the org with enriched performance insights: status, spend, impressions, clicks, CTR, CPM, CPC, leads, and CPL. Use this to analyze which campaigns are active and performing. Money values are in the account currency returned alongside them.',
    area: 'general_xphere',
    inputSchema: z.object({
      ad_account_id: z.string().optional(),
      date_preset: MetaDatePresetSchema,
    }).strict(),
    handler: async ({ ad_account_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'meta', ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }

      try {
        const [accountInfo, campaigns, insights] = await withMetaConnection(auth.orgId, conn.accountId, () =>
          Promise.all([
            getAdAccountInfo(conn.accountId, conn.token).catch(() => null),
            listCampaigns(conn.accountId, conn.token),
            getInsights(conn.accountId, conn.token, {
              level: 'campaign',
              datePreset: date_preset as DatePreset,
              fields: ['impressions', 'clicks', 'spend', 'reach', 'cpc', 'cpm', 'ctr', 'actions', 'campaign_id', 'campaign_name'],
            }),
          ]),
        )
        const currency = accountInfo?.currency ?? 'USD'

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
          ad_account_name: conn.accountName,
          currency,
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

  // ─── Google Ads live metrics ──────────────────────────────────────────────────
  // Previously the AI could read Meta but not Google, even though the journey
  // accepted platform='google' — so it could record plans about an account it
  // was structurally unable to look at.

  {
    name: 'ads_google_get_overview',
    title: 'Get Google Ads overview',
    description:
      'Account-level Google Ads performance: cost, impressions, clicks, CTR, average CPC, conversions and cost per conversion. Pass customer_id to target a specific account; with several connected and none specified, this returns the list instead of guessing.',
    area: 'general_xphere',
    inputSchema: z.object({
      customer_id: z.string().optional(),
      date_preset: z.string().default('last_30d'),
    }).strict(),
    handler: async ({ customer_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }

      try {
        const tokens = parseTokens(conn.token)
        const duration = buildGaqlDateCondition(date_preset)
        const [info, overview] = await Promise.all([
          refreshAccessToken(tokens.refresh_token)
            .then((at) => getCustomerInfo(conn.accountId, at))
            .catch(() => null),
          getAccountOverview(conn.accountId, tokens.refresh_token, duration),
        ])

        const currency = info?.currency_code ?? 'USD'
        // Google reports money in micros (1e6 per major unit) in every currency.
        const cost = Number(overview.costMicros) / 1_000_000
        const conversions = parseFloat(overview.conversions)

        return {
          customer_id: conn.accountId,
          customer_name: info?.name ?? conn.accountName,
          currency,
          date_preset,
          metrics: {
            cost,
            cost_formatted: formatCurrency(cost, currency),
            impressions: parseInt(overview.impressions, 10),
            clicks: parseInt(overview.clicks, 10),
            conversions,
            ctr: parseFloat(overview.ctr),
            average_cpc: Number(overview.averageCpc) / 1_000_000,
            cost_per_conversion: conversions > 0 ? cost / conversions : null,
          },
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_google_list_campaigns',
    title: 'List Google Ads campaigns',
    description:
      'List Google Ads campaigns with status, channel type, bidding strategy, daily budget, cost, clicks, conversions and CPA. Use to find which campaigns to diagnose.',
    area: 'general_xphere',
    inputSchema: z.object({
      customer_id: z.string().optional(),
      date_preset: z.string().default('last_30d'),
    }).strict(),
    handler: async ({ customer_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }

      try {
        const tokens = parseTokens(conn.token)
        const duration = buildGaqlDateCondition(date_preset)
        const [info, campaigns] = await Promise.all([
          refreshAccessToken(tokens.refresh_token)
            .then((at) => getCustomerInfo(conn.accountId, at))
            .catch(() => null),
          googleListCampaigns(conn.accountId, tokens.refresh_token, duration),
        ])
        const currency = info?.currency_code ?? 'USD'

        const enriched = campaigns.map((c) => {
          const cost = Number(c.costMicros) / 1_000_000
          const conversions = parseFloat(c.conversions)
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            channel_type: c.channelType,
            bidding_strategy: c.biddingStrategy,
            daily_budget: Number(c.budgetAmountMicros) / 1_000_000,
            cost,
            impressions: parseInt(c.impressions, 10),
            clicks: parseInt(c.clicks, 10),
            conversions,
            ctr: parseFloat(c.ctr),
            cpa: conversions > 0 ? cost / conversions : null,
          }
        })

        return {
          customer_id: conn.accountId,
          customer_name: info?.name ?? conn.accountName,
          currency,
          date_preset,
          campaigns: enriched,
          total_campaigns: enriched.length,
          active_campaigns: enriched.filter((c) => c.status === 'ENABLED').length,
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_compare_periods',
    title: 'Compare ads periods',
    description:
      "Compare a window against the immediately preceding window of equal length, from Xphere's own stored daily history: spend, leads, conversions, CTR, CPC, CPL and the percent change in each. Use before claiming any trend. Returns no_data when history hasn't been captured for the account yet — report that rather than treating zeros as a decline.",
    area: 'general_xphere',
    inputSchema: z.object({
      platform: z.enum(['meta', 'google']).default('meta'),
      ad_account_id: z.string().optional(),
      date_preset: z.string().default('last_30d'),
    }).strict(),
    handler: async ({ platform, ad_account_id, date_preset }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, platform, ad_account_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }

      const comparison = await compareAdsPeriods({
        orgId: auth.orgId,
        platform,
        adAccountId: conn.accountId,
        preset: date_preset,
      })
      return { ...comparison, summary: describeComparison(comparison) }
    },
  },

  // ─── Attribution ──────────────────────────────────────────────────────────────

  {
    name: 'ads_get_attribution',
    title: 'Get ads attribution',
    description:
      'UTM-level lead and revenue attribution. Joins analytics sessions -> identified contacts -> CRM opportunities. Single-touch: each contact and each opportunity is credited to exactly ONE campaign (last_touch by default, first_touch optional), so the rows are additive and the totals are real pipeline, not influenced-revenue counted several times.',
    area: 'general_xphere',
    inputSchema: z.object({
      days: DaysSchema.optional(),
      platform: PlatformSchema,
      model: z.enum(['last_touch', 'first_touch']).default('last_touch'),
    }).strict(),
    handler: async ({ days = 30, platform, model }, { auth }) => {
      const from = new Date(Date.now() - days * 864e5).toISOString()
      const to = new Date().toISOString()

      const summary = await getAdsAttributionForOrg({
        orgId: auth.orgId,
        from,
        to,
        platformFilter: platform ?? null,
        model,
      })

      return {
        rows: summary.rows,
        totals: summary.totals,
        model: summary.model,
        truncated: summary.truncated,
        period_days: days,
        platform: platform ?? 'all',
      }
    },
  },

  // ─── Global Knowledge (curated fundamentals) ─────────────────────────────────

  {
    name: 'global_knowledge_search',
    title: 'Search Global Knowledge',
    description:
      'Semantic search over the platform-wide, expert-curated ads knowledge base (transcribed courses, market best-practices) segmented by media. Use this to GROUND diagnostics, proposals, and plans in proven fundamentals before suggesting changes. A requested platform also returns platform-agnostic "global" fundamentals. Passages below a relevance floor are dropped: when `matches` is empty, `note` says nothing relevant was found — then do not cite Global Knowledge. Cite what you use by source_name (and url when present), and pass each source_id as knowledge_refs to ads_preview_change / ads_create_memory so the outcome can be traced back to the lesson.',
    area: 'general_xphere',
    inputSchema: z.object({
      query: z.string().min(1),
      platform: PlatformSchema,
      top_k: z.number().int().positive().max(20).optional(),
      min_similarity: z.number().min(0).max(1).optional()
        .describe('Relevance floor (cosine similarity). Default 0.3; relevant lessons usually score 0.5+.'),
    }).strict(),
    handler: async ({ query, platform, top_k, min_similarity }, { auth }) => {
      return searchGlobalKnowledge({
        orgId: auth.orgId,
        query,
        platform,
        topK: top_k,
        minSimilarity: min_similarity,
      })
    },
  },

  // ─── Global Knowledge management (SUPER ADMIN ONLY) ──────────────────────────
  // These feed/curate the global corpus. Gated to the platform super admin (the
  // calling MCP user must be a platform admin), regardless of which org the token
  // belongs to. Ingestion is billed to the platform OpenRouter key.
  //
  // In 'notion' source mode retrieval reads only synchronized Notion pages, so
  // a write lands as a new Notion page under a synchronized root and flows
  // through the normal sync. Writing a manual source there would be stored but
  // never searchable — the silent failure this routing exists to prevent.

  {
    name: 'global_knowledge_add_text',
    title: 'Add text to Global Knowledge (super admin)',
    description:
      'SUPER ADMIN ONLY. Add curated material to Global Knowledge for a media scope (meta/google) or "global". When the knowledge base is synchronized from Notion (the usual case) this creates a Notion page under the matching root (or root_id) and queues its sync — it becomes searchable within minutes and stays editable in Notion. Otherwise it chunks and embeds synchronously. One page per topic: before adding, run global_knowledge_search — if a page on the same topic already exists, do not create a duplicate; tell the operator to merge the new material into that page in Notion. Title the page by the topic or question it answers (no lesson numbers). Structure it with these ## sections: Resumo, Quando se aplica, Como fazer (rules and steps), Erros comuns e mitos, Checklist, Fontes. Keep each section self-contained — retrieval returns sections on their own — and pass source_url when it came from a video or article.',
    area: 'general_xphere',
    inputSchema: z.object({
      name: z.string().min(1).max(200).describe('Topic or question the page answers, e.g. "Anúncios no Google Maps: como aparecer" — no lesson numbers'),
      content: z.string().min(1).max(400_000).describe('Markdown content'),
      platform: z.enum(['meta', 'google', 'global']).default('global'),
      root_id: z.string().uuid().optional()
        .describe('Notion root to file the page under (see global_knowledge_list → notion_roots). Defaults to the root matching platform, then the global root.'),
      source_url: z.string().url().max(2000).optional().describe('Original video/article URL, recorded on the page'),
    }).strict(),
    handler: async ({ name, content, platform, root_id, source_url }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) return FORBIDDEN_GLOBAL_KNOWLEDGE

      if ((await getGlobalKnowledgeSourceMode()) === 'notion') {
        const created = await createGlobalKnowledgeNotionPage({
          title: name,
          markdown: content,
          platform,
          rootId: root_id,
          sourceUrl: source_url,
          createdBy: auth.userId,
        })
        if (!created.ok) return { error: created.error, detail: created.detail }
        scheduleGlobalKnowledgeSync()
        return {
          ok: true,
          mode: 'notion',
          notion_page_id: created.pageId,
          notion_url: created.url,
          root: { id: created.rootId, title: created.rootTitle },
          next_step: 'The page was created in Notion and its sync is queued; it becomes searchable once the sync finishes (usually within a few minutes). Edit it in Notion to refine it.',
        }
      }

      const body = source_url ? `Source: ${source_url}\n\n${content}` : content
      const result = await ingestGlobalKnowledgeText({ name, content: body, platform, createdBy: auth.userId })
      return 'error' in result ? result : { ok: true, mode: 'manual', ...result }
    },
  },

  {
    name: 'global_knowledge_fetch_url',
    title: 'Fetch a video transcript or article (super admin)',
    description:
      'SUPER ADMIN ONLY. Read-only: extract the text of a YouTube video (its captions/transcript) or a web article so it can be turned into Global Knowledge. Nothing is saved. Next: structure the text as a topic page (Resumo, Quando se aplica, Como fazer, Erros comuns e mitos, Checklist, Fontes — no filler, keep the author\'s concrete numbers and examples) and call global_knowledge_add_text with source_url, or merge it into the existing page on the same topic. Transcript extraction is best-effort: if it returns transcript_unavailable, ask the operator to paste the transcript.',
    area: 'general_xphere',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({
      url: z.string().url().max(2000),
    }).strict(),
    handler: async ({ url }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) return FORBIDDEN_GLOBAL_KNOWLEDGE
      const result = await extractUrlContent(url)
      if (!result.ok) return { error: result.error, detail: result.detail }
      return {
        ...result,
        characters: result.text.length,
        next_step: 'Structure this as a topic page, show it to the operator if they want to review it, then call global_knowledge_add_text with source_url set to this url — unless a page on the same topic already exists, in which case it should be merged into that page in Notion.',
      }
    },
  },

  {
    name: 'global_knowledge_list',
    title: 'List Global Knowledge sources (super admin)',
    description:
      'SUPER ADMIN ONLY. List Global Knowledge sources with health flags: `searchable` (retrieval can return it right now), `thin` (at most one indexed chunk or untitled — its content probably lives in a video, attachment or database) and `is_container` (a Notion folder: a page with child pages, indexed with no chunks by design — not a problem). Also returns the source mode and, in Notion mode, the synchronized roots you can file new pages under.',
    area: 'general_xphere',
    inputSchema: z.object({
      platform: z.enum(['meta', 'google', 'global']).optional(),
    }).strict(),
    handler: async ({ platform }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) return FORBIDDEN_GLOBAL_KNOWLEDGE
      const result = await listGlobalKnowledgeSources({ platform })
      if ('error' in result) return result
      const roots = result.source_mode === 'notion' ? await listGlobalKnowledgeNotionRoots() : []
      return {
        ...result,
        thin_count: result.sources.filter((s) => s.thin).length,
        unsearchable_count: result.sources.filter((s) => !s.searchable && !s.is_container).length,
        folder_count: result.sources.filter((s) => s.is_container).length,
        notion_roots: roots,
      }
    },
  },

  {
    name: 'global_knowledge_delete',
    title: 'Delete a Global Knowledge source (super admin)',
    description:
      'SUPER ADMIN ONLY. Remove a manually ingested Global Knowledge source and its vector chunks. Notion pages cannot be deleted here — delete or move the page in Notion and the sync removes it.',
    area: 'general_xphere',
    inputSchema: z.object({
      source_id: z.string().uuid(),
    }).strict(),
    handler: async ({ source_id }, { auth }) => {
      if (!(await isPlatformAdminUser(auth.userId))) return FORBIDDEN_GLOBAL_KNOWLEDGE
      const { data: source } = await db()
        .from('global_knowledge_sources')
        .select('id, source_type, source_url')
        .eq('id', source_id)
        .maybeSingle()
      if (!source) return { error: 'not_found', detail: 'No Global Knowledge source with that id.' }
      if (source.source_type === 'notion_page') {
        return {
          error: 'notion_managed',
          detail: 'This source is synchronized from Notion. Delete or move the page in Notion; the next sync removes it from the knowledge base.',
          notion_url: source.source_url,
        }
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
      'Get a summary of the ads journey: recent memories (insights/decisions/plans, plus automatic "result" memories that measure applied changes), recent executions (pauses/budget changes), and active plans. Use this to understand the current state of the ads strategy.',
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
        .select('id, type, status, source, platform, title, content, campaign_name, confidence, knowledge_refs, change_request_id, created_at')
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
    description:
      'Search stored ads insights, decisions, plans, risks, observations and results. Pass `query` to search by meaning (e.g. "leads from broad keywords were low quality") — use this before proposing a change, to find past decisions and measured results that support or contradict it. Without a query, filters by type, status, platform or campaign name, newest first.',
    area: 'general_xphere',
    inputSchema: z.object({
      query: z.string().min(1).max(500).optional(),
      type: MemoryTypeSchema.optional(),
      status: MemoryStatusSchema.default('active'),
      platform: PlatformSchema,
      campaign_name: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(),
    handler: async ({ query, type, status, platform, campaign_name, limit }, { auth }) => {
      if (query) {
        const result = await searchMemoriesSemantic({
          orgId: auth.orgId,
          query,
          platform,
          statuses: [status],
          limit,
        })
        if ('error' in result) return result
        // The semantic index has no type/campaign columns to filter on, so
        // narrow its hits here when those filters were also given.
        const campaign = campaign_name?.toLowerCase()
        const memories = result.memories.filter((m) =>
          (!type || m.type === type) &&
          (!campaign || (m.campaign_name ?? '').toLowerCase().includes(campaign)),
        )
        return { ...result, memories, count: memories.length, mode: 'semantic' }
      }

      let q = db()
        .from('ads_memories')
        .select('id, type, status, source, platform, title, content, campaign_id, campaign_name, confidence, proposed, knowledge_refs, change_request_id, superseded_by, metadata, created_at, updated_at')
        .eq('org_id', auth.orgId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (type) q = q.eq('type', type)
      if (platform) q = q.or(`platform.eq.${platform},platform.is.null`)
      if (campaign_name) q = q.ilike('campaign_name', `%${campaign_name}%`)

      const { data, error } = await q
      if (error) return { error: 'query_failed', detail: error.message }
      return { memories: data ?? [], count: (data ?? []).length, mode: 'filter' }
    },
  },

  {
    name: 'ads_create_memory',
    title: 'Create ads memory',
    description:
      'Record an insight, decision, plan, risk, or observation about the ads strategy. Use this after analyzing data via MCP to preserve important findings for future sessions. Pass knowledge_refs (source_id from global_knowledge_search) when a lesson grounded it. If it replaces an older memory, mark the old one superseded with ads_update_memory.',
    area: 'general_xphere',
    inputSchema: z.object({
      type: MemoryTypeSchema,
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(2000),
      platform: PlatformSchema,
      campaign_name: z.string().optional(),
      confidence: z.number().int().min(1).max(5).default(4),
      knowledge_refs: KnowledgeRefsInputSchema.optional(),
      change_request_id: z.string().uuid().optional().describe('ads change this memory is about'),
    }).strict(),
    handler: async ({ type, title, content, platform, campaign_name, confidence, knowledge_refs, change_request_id }, { auth }) => {
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
        knowledgeRefs: knowledge_refs,
        changeRequestId: change_request_id,
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
      type: MemoryTypeSchema,
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(2000),
      platform: PlatformSchema,
      campaign_name: z.string().optional(),
      confidence: z.number().int().min(1).max(5).default(2),
      knowledge_refs: KnowledgeRefsInputSchema.optional(),
      change_request_id: z.string().uuid().optional(),
    }).strict(),
    handler: async ({ type, title, content, platform, campaign_name, confidence, knowledge_refs, change_request_id }, { auth }) => {
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
        knowledgeRefs: knowledge_refs,
        changeRequestId: change_request_id,
      })
      if (!id) return { error: 'Failed to propose memory' }
      return { id, ok: true, status: 'needs_review' }
    },
  },

  {
    name: 'ads_update_memory',
    title: 'Update an ads memory',
    description:
      'Curate an existing memory so the journey does not accumulate contradictions: approve a proposal (status active), archive it, mark it superseded by a newer memory (superseded_by), or correct its title/content/confidence/knowledge_refs. Only change what the operator agreed to or what is clearly outdated.',
    area: 'general_xphere',
    inputSchema: z.object({
      memory_id: z.string().uuid(),
      status: MemoryStatusSchema.optional(),
      superseded_by: z.string().uuid().optional().describe('Newer memory that replaces this one; forces status superseded'),
      title: z.string().min(1).max(200).optional(),
      content: z.string().min(1).max(2000).optional(),
      confidence: z.number().int().min(1).max(5).optional(),
      knowledge_refs: KnowledgeRefsInputSchema.optional(),
    }).strict(),
    handler: async ({ memory_id, status, superseded_by, title, content, confidence, knowledge_refs }, { auth }) => {
      const result = await updateMemory({
        orgId: auth.orgId,
        memoryId: memory_id,
        status,
        supersededBy: superseded_by,
        title,
        content,
        confidence,
        knowledgeRefs: knowledge_refs,
      })
      if (!result.ok) return { error: result.error, detail: result.detail }
      return { ok: true, memory: result.memory }
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
