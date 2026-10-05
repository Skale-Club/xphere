// AI action plan for an SEO audit (spec phase 4).
//
// Turns the latest audit (+ Search Console data when linked) into the five
// fixes with the most impact, and title/meta rewrites for pages that rank but
// under-perform. Generated on demand through OpenRouter (org key first, then
// the platform key), structured via a forced function call, metered as
// Copilot credits ('seo_action_plan') and stored on seo_audits.action_plan.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { createOpenRouterClient, resolveOpenRouterCredential } from '@/lib/llm/openrouter'
import { DEFAULT_OPENROUTER_MODEL, estimateCostUsd } from '@/lib/copilot/resolve-provider'
import { meterDebit } from '@/lib/billing/credits'
import { issueDefinition, SEVERITY_ORDER, type IssueSeverity } from './checks/catalog'
import { lowCtr, pagesWithIssues, quickWins, type TopRow } from './gsc/opportunities'
import { selectAll } from './select-all'
import { SeoServiceError } from './service'
import { normalizeUrl } from './url'

type Sb = SupabaseClient<Database>

export const ACTION_PLAN_MODEL = process.env.SEO_ACTION_PLAN_MODEL ?? DEFAULT_OPENROUTER_MODEL

export interface ActionPlanAction {
  title: string
  why: string
  steps: string[]
  impact: 'high' | 'medium' | 'low'
  effort: 'low' | 'medium' | 'high'
  issue_codes: string[]
  urls: string[]
}

export interface ActionPlanRewrite {
  url: string
  current_title: string | null
  suggested_title: string
  current_description: string | null
  suggested_description: string
  target_query: string | null
}

export interface ActionPlan {
  generated_at: string
  model: string
  locale: string
  summary: string
  actions: ActionPlanAction[]
  rewrites: ActionPlanRewrite[]
}

// ── Context ─────────────────────────────────────────────────────────────────

export interface PlanContext {
  host: string
  health_score: number | null
  pages_crawled: number
  issues: Array<{ code: string; severity: string; title: string; count: number; fix: string; example_urls: string[] }>
  search_console: null | {
    top_pages: TopRow[]
    quick_wins: Array<TopRow & { potentialClicks: number }>
    low_ctr: TopRow[]
    pages_with_issues: Array<{ url: string; clicks: number; errors: number; warnings: number }>
    top_queries: string[]
  }
  rewrite_candidates: Array<{ url: string; title: string | null; meta_description: string | null; reason: string }>
}

const MAX_ISSUES = 15
const EXAMPLES_PER_ISSUE = 3
const MAX_REWRITES = 6

export async function buildPlanContext(sb: Sb, orgId: string, siteId: string): Promise<{ auditId: string; context: PlanContext }> {
  const { data: site } = await sb.from('seo_sites').select('id, host, gsc_property').eq('org_id', orgId).eq('id', siteId).maybeSingle()
  if (!site) throw new SeoServiceError('Site not found', 'not_found')
  const { data: audit } = await sb
    .from('seo_audits')
    .select('id, health_score, summary, pages_crawled')
    .eq('org_id', orgId)
    .eq('site_id', siteId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!audit) throw new SeoServiceError('Run an audit first — the plan is built from its results.', 'not_found')

  const byCode = ((audit.summary as { by_code?: Record<string, number> } | null)?.by_code ?? {}) as Record<string, number>
  const ranked = Object.entries(byCode)
    .map(([code, count]) => ({ code, count, def: issueDefinition(code) }))
    .filter((i) => i.def)
    .sort((a, b) => SEVERITY_ORDER[a.def!.severity as IssueSeverity] - SEVERITY_ORDER[b.def!.severity as IssueSeverity] || b.count - a.count)
    .slice(0, MAX_ISSUES)

  const examples = ranked.length
    ? await selectAll<{ code: string; url: string | null }>((from, to) =>
        sb
          .from('seo_audit_issues')
          .select('code, url')
          .eq('audit_id', audit.id)
          .in('code', ranked.map((i) => i.code))
          .not('url', 'is', null)
          .order('url')
          .range(from, to),
      5000)
    : []
  const examplesByCode = new Map<string, string[]>()
  for (const e of examples) {
    const list = examplesByCode.get(e.code) ?? []
    if (e.url && list.length < EXAMPLES_PER_ISSUE) list.push(e.url)
    examplesByCode.set(e.code, list)
  }

  const pages = await selectAll<{ id: string; url: string; title: string | null; meta_description: string | null }>((from, to) =>
    sb.from('seo_audit_pages').select('id, url, title, meta_description').eq('audit_id', audit.id).order('id').range(from, to),
  )
  const pageByUrl = new Map(pages.map((p) => [p.url, p]))

  let searchConsole: PlanContext['search_console'] = null
  const rewriteCandidates: PlanContext['rewrite_candidates'] = []

  if (site.gsc_property) {
    const { data: latest } = await sb
      .from('seo_gsc_top')
      .select('window_end')
      .eq('site_id', site.id)
      .order('window_end', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest) {
      const top = await selectAll<TopRow & { dimension: string }>((from, to) =>
        sb
          .from('seo_gsc_top')
          .select('dimension, key, clicks, impressions, ctr, position')
          .eq('site_id', site.id)
          .eq('window_end', latest.window_end)
          .order('clicks', { ascending: false })
          .range(from, to),
      )
      const queries = top.filter((r) => r.dimension === 'query')
      const gscPages = top.filter((r) => r.dimension === 'page')
      const issueCounts = await pageIssueCounts(sb, audit.id, pages)
      const lowCtrPages = lowCtr(gscPages, 10)
      searchConsole = {
        top_pages: gscPages.slice(0, 15),
        quick_wins: quickWins(queries, 8),
        low_ctr: lowCtr([...queries, ...gscPages], 8),
        pages_with_issues: pagesWithIssues(gscPages, issueCounts, 8).map((p) => ({ url: p.url, clicks: p.clicks, errors: p.errors, warnings: p.warnings })),
        top_queries: queries.slice(0, 25).map((q) => q.key),
      }
      for (const p of lowCtrPages) {
        const url = normalizeUrl(p.key) ?? p.key
        const page = pageByUrl.get(url)
        rewriteCandidates.push({
          url,
          title: page?.title ?? null,
          meta_description: page?.meta_description ?? null,
          reason: `CTR ${(p.ctr * 100).toFixed(1)}% at position ${p.position.toFixed(1)} with ${p.impressions} impressions`,
        })
      }
    }
  }

  // Without (enough) Search Console data, rewrite pages whose title/meta the audit flagged.
  if (rewriteCandidates.length < MAX_REWRITES) {
    const seen = new Set(rewriteCandidates.map((c) => c.url))
    for (const code of ['title_missing', 'title_length', 'meta_description_missing', 'title_duplicate', 'meta_description_length']) {
      for (const url of examplesByCode.get(code) ?? []) {
        if (seen.has(url) || rewriteCandidates.length >= MAX_REWRITES) continue
        const page = pageByUrl.get(url)
        seen.add(url)
        rewriteCandidates.push({ url, title: page?.title ?? null, meta_description: page?.meta_description ?? null, reason: issueDefinition(code)?.title ?? code })
      }
    }
  }

  return {
    auditId: audit.id,
    context: {
      host: site.host,
      health_score: audit.health_score,
      pages_crawled: audit.pages_crawled,
      issues: ranked.map((i) => ({
        code: i.code,
        severity: i.def!.severity,
        title: i.def!.title,
        count: i.count,
        fix: i.def!.fix,
        example_urls: examplesByCode.get(i.code) ?? [],
      })),
      search_console: searchConsole,
      rewrite_candidates: rewriteCandidates.slice(0, MAX_REWRITES),
    },
  }
}

async function pageIssueCounts(sb: Sb, auditId: string, pages: Array<{ id: string; url: string }>) {
  const issues = await selectAll<{ page_id: string | null; severity: string }>((from, to) =>
    sb.from('seo_audit_issues').select('page_id, severity').eq('audit_id', auditId).not('page_id', 'is', null).order('id').range(from, to),
  )
  const counts = new Map<string, { errors: number; warnings: number }>()
  for (const i of issues) {
    if (!i.page_id) continue
    const c = counts.get(i.page_id) ?? { errors: 0, warnings: 0 }
    if (i.severity === 'error') c.errors++
    else if (i.severity === 'warning') c.warnings++
    counts.set(i.page_id, c)
  }
  return new Map(pages.map((p) => [p.url, { pageId: p.id, ...(counts.get(p.id) ?? { errors: 0, warnings: 0 }) }]))
}

// ── Prompt + parsing (pure) ─────────────────────────────────────────────────

export function languageName(locale: string): string {
  const l = locale.toLowerCase()
  if (l.startsWith('pt')) return 'Brazilian Portuguese'
  if (l.startsWith('es')) return 'Spanish'
  return 'English'
}

export function buildPlanPrompt(context: PlanContext, locale: string): string {
  return `You are a senior technical SEO consultant. Build a prioritized action plan for ${context.host} from the audit and Google Search Console data below.

Rules:
- Pick the 5 actions with the highest impact on organic traffic. Fixing problems on pages that already get clicks comes first, then errors that affect many pages, then quick-win queries close to page one.
- Every action must be grounded in the data: cite the issue codes and real URLs from it. Never invent URLs, numbers or queries.
- Steps must be concrete enough for a web developer or content editor to do without further research.
- Rewrites: for each rewrite candidate, write a title (30-60 characters) and a meta description (70-160 characters) that match search intent, include the most relevant query from top_queries when it fits, and keep the brand. Skip candidates you cannot improve.
- Write everything in ${languageName(locale)}. Keep issue codes and URLs unchanged.

Data (JSON):
${JSON.stringify(context).slice(0, 24_000)}`
}

const IMPACT = new Set(['high', 'medium', 'low'])

/** Validate the model's function-call arguments into an ActionPlan body. Drops anything malformed. */
export function parsePlan(raw: unknown): Pick<ActionPlan, 'summary' | 'actions' | 'rewrites'> | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const strList = (v: unknown, n: number, max: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, n).map((x) => x.trim().slice(0, max)) : []

  const actions: ActionPlanAction[] = (Array.isArray(r.actions) ? r.actions : [])
    .map((a) => {
      const x = (a ?? {}) as Record<string, unknown>
      return {
        title: str(x.title, 160),
        why: str(x.why, 600),
        steps: strList(x.steps, 8, 400),
        impact: (IMPACT.has(x.impact as string) ? x.impact : 'medium') as ActionPlanAction['impact'],
        effort: (IMPACT.has(x.effort as string) ? x.effort : 'medium') as ActionPlanAction['effort'],
        issue_codes: strList(x.issue_codes, 6, 60),
        urls: strList(x.urls, 8, 500),
      }
    })
    .filter((a) => a.title && a.steps.length)
    .slice(0, 5)

  const rewrites: ActionPlanRewrite[] = (Array.isArray(r.rewrites) ? r.rewrites : [])
    .map((w) => {
      const x = (w ?? {}) as Record<string, unknown>
      return {
        url: str(x.url, 500),
        current_title: str(x.current_title, 300) || null,
        suggested_title: str(x.suggested_title, 120),
        current_description: str(x.current_description, 400) || null,
        suggested_description: str(x.suggested_description, 320),
        target_query: str(x.target_query, 200) || null,
      }
    })
    .filter((w) => w.url && w.suggested_title)
    .slice(0, MAX_REWRITES)

  const summary = str(r.summary, 800)
  if (!actions.length && !summary) return null
  return { summary, actions, rewrites }
}

const PLAN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'record_action_plan',
    description: 'Record the prioritized SEO action plan.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Two or three sentences on the state of the site and where the biggest wins are.' },
        actions: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              why: { type: 'string', description: 'Why this matters, citing the data' },
              steps: { type: 'array', items: { type: 'string' }, maxItems: 8 },
              impact: { type: 'string', enum: ['high', 'medium', 'low'] },
              effort: { type: 'string', enum: ['low', 'medium', 'high'] },
              issue_codes: { type: 'array', items: { type: 'string' } },
              urls: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            },
            required: ['title', 'why', 'steps', 'impact', 'effort'],
          },
        },
        rewrites: {
          type: 'array',
          maxItems: MAX_REWRITES,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              current_title: { type: 'string' },
              suggested_title: { type: 'string' },
              current_description: { type: 'string' },
              suggested_description: { type: 'string' },
              target_query: { type: 'string' },
            },
            required: ['url', 'suggested_title', 'suggested_description'],
          },
        },
      },
      required: ['summary', 'actions'],
    },
  },
}

// ── Generation ──────────────────────────────────────────────────────────────

export async function generateActionPlan(sb: Sb, orgId: string, siteId: string, locale: string): Promise<ActionPlan> {
  const { auditId, context } = await buildPlanContext(sb, orgId, siteId)

  const credential = await resolveOpenRouterCredential(orgId, sb)
  const client = createOpenRouterClient(credential.apiKey)
  const response = await client.chat.completions.create({
    model: ACTION_PLAN_MODEL,
    max_tokens: 3000,
    tools: [PLAN_TOOL],
    tool_choice: { type: 'function', function: { name: 'record_action_plan' } },
    messages: [{ role: 'user', content: buildPlanPrompt(context, locale) }],
  })

  // Meter what was spent even if the output turns out unusable.
  const usage = response.usage
  if (usage) {
    await meterDebit(orgId, 'seo_action_plan', estimateCostUsd(ACTION_PLAN_MODEL, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0), null)
  }

  const call = response.choices[0]?.message?.tool_calls?.find(
    (tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function',
  )
  let parsed: ReturnType<typeof parsePlan> = null
  try {
    parsed = call ? parsePlan(JSON.parse(call.function.arguments)) : null
  } catch {
    parsed = null
  }
  if (!parsed) throw new Error('The model did not return a usable plan. Try again.')

  const plan: ActionPlan = { generated_at: new Date().toISOString(), model: ACTION_PLAN_MODEL, locale, ...parsed }
  const { error } = await sb.from('seo_audits').update({ action_plan: plan as unknown as Json }).eq('id', auditId).eq('org_id', orgId)
  if (error) throw new Error(`Saving the plan failed: ${error.message}`)
  return plan
}
