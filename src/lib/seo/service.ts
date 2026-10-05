// SEO read/write operations shared by the workflow action, the MCP tools and
// the Copilot tools. Every function takes the caller's Supabase client and the
// org explicitly and filters by org_id, so it is safe with the service-role
// client (MCP, workflows) as well as with an RLS-scoped user client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { issueDefinition, SEVERITY_ORDER, type IssueSeverity } from './checks/catalog'
import { addDays } from './gsc/dates'
import { totals, type DailyMetricRow } from './gsc/metrics'
import { lowCtr, quickWins, type TopRow } from './gsc/opportunities'
import { selectAll } from './select-all'

type Sb = SupabaseClient<Database>

export type AuditTrigger = 'manual' | 'schedule' | 'workflow' | 'mcp'

export class SeoServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'already_running' | 'db_error',
  ) {
    super(message)
    this.name = 'SeoServiceError'
  }
}

/** Accepts a site id, a host ("acme.com"), or a URL; returns the org's site. */
export async function resolveSite(sb: Sb, orgId: string, ref: string) {
  const trimmed = ref.trim()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
  let host = trimmed.toLowerCase()
  try {
    if (/^https?:\/\//i.test(trimmed)) host = new URL(trimmed).hostname.toLowerCase()
  } catch {
    /* not a URL */
  }
  const query = sb.from('seo_sites').select('*').eq('org_id', orgId)
  const { data } = isUuid
    ? await query.eq('id', trimmed).maybeSingle()
    : await query.in('host', [host, host.replace(/^www\./, ''), `www.${host.replace(/^www\./, '')}`]).limit(1).maybeSingle()
  if (!data) throw new SeoServiceError(`No SEO site matches "${ref}". Add it in SEO first.`, 'not_found')
  return data
}

export async function listSites(sb: Sb, orgId: string) {
  const { data: sites } = await sb
    .from('seo_sites')
    .select('id, name, host, root_url, audit_schedule, gsc_property')
    .eq('org_id', orgId)
    .order('created_at')
  const ids = (sites ?? []).map((s) => s.id)
  const { data: audits } = ids.length
    ? await sb
        .from('seo_audits')
        .select('site_id, status, health_score, summary, finished_at, created_at')
        .in('site_id', ids)
        .order('created_at', { ascending: false })
        .limit(ids.length * 10)
    : { data: [] }
  return (sites ?? []).map((s) => {
    const mine = (audits ?? []).filter((a) => a.site_id === s.id)
    const last = mine.find((a) => a.status === 'completed')
    const active = mine.find((a) => a.status === 'pending' || a.status === 'running')
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      url: s.root_url,
      schedule: s.audit_schedule,
      search_console_property: s.gsc_property,
      health_score: last?.health_score ?? null,
      issues_by_severity: (last?.summary as { by_severity?: Record<string, number> } | null)?.by_severity ?? null,
      last_audit_at: last?.finished_at ?? null,
      audit_running: Boolean(active),
    }
  })
}

/** Queue an audit; the cron starts it within a minute. */
export async function queueAudit(sb: Sb, orgId: string, siteRef: string, trigger: AuditTrigger, createdBy: string | null = null) {
  const site = await resolveSite(sb, orgId, siteRef)
  const { data, error } = await sb
    .from('seo_audits')
    .insert({ org_id: orgId, site_id: site.id, trigger, max_pages: site.crawl_max_pages, created_by: createdBy })
    .select('id, status')
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: running } = await sb
        .from('seo_audits')
        .select('id, status')
        .eq('site_id', site.id)
        .in('status', ['pending', 'running'])
        .maybeSingle()
      return { site_id: site.id, host: site.host, audit_id: running?.id ?? null, status: running?.status ?? 'running', already_running: true }
    }
    throw new SeoServiceError(error.message, 'db_error')
  }
  return { site_id: site.id, host: site.host, audit_id: data.id, status: data.status, already_running: false }
}

/** Latest completed audit with its issues grouped by code (most severe first). */
export async function getAuditReport(sb: Sb, orgId: string, siteRef: string) {
  const site = await resolveSite(sb, orgId, siteRef)
  const { data: audit } = await sb
    .from('seo_audits')
    .select('id, health_score, summary, site_checks, pages_crawled, finished_at')
    .eq('org_id', orgId)
    .eq('site_id', site.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!audit) return { site: { id: site.id, host: site.host }, audit: null }

  const byCode = ((audit.summary as { by_code?: Record<string, number> } | null)?.by_code ?? {}) as Record<string, number>
  const issues = Object.entries(byCode)
    .map(([code, count]) => {
      const def = issueDefinition(code)
      return { code, count, severity: def?.severity ?? 'notice', title: def?.title ?? code, scope: def?.scope ?? 'page', fix: def?.fix ?? '' }
    })
    .sort((a, b) => SEVERITY_ORDER[a.severity as IssueSeverity] - SEVERITY_ORDER[b.severity as IssueSeverity] || b.count - a.count)

  return {
    site: { id: site.id, host: site.host },
    audit: {
      id: audit.id,
      health_score: audit.health_score,
      pages_crawled: audit.pages_crawled,
      finished_at: audit.finished_at,
      issues,
      core_web_vitals: (audit.site_checks as { cwv?: unknown } | null)?.cwv ?? null,
    },
  }
}

/** Pages affected by one issue code in the latest completed audit. */
export async function listIssuePages(sb: Sb, orgId: string, siteRef: string, code: string, limit = 50) {
  const report = await getAuditReport(sb, orgId, siteRef)
  if (!report.audit) return { ...report, pages: [] }
  const { data } = await sb
    .from('seo_audit_issues')
    .select('url, details')
    .eq('org_id', orgId)
    .eq('audit_id', report.audit.id)
    .eq('code', code)
    .order('url')
    .limit(Math.min(limit, 500))
  const def = issueDefinition(code)
  return {
    site: report.site,
    issue: def ? { code, severity: def.severity, title: def.title, why: def.why, fix: def.fix } : { code },
    pages: (data ?? []).map((r) => ({ url: r.url, details: r.details })),
  }
}

/** Search Console totals vs the previous period, plus top opportunities. */
export async function getSearchPerformance(sb: Sb, orgId: string, siteRef: string, days = 28) {
  const site = await resolveSite(sb, orgId, siteRef)
  if (!site.gsc_property) {
    return { site: { id: site.id, host: site.host }, connected: false, message: 'No Search Console property linked to this site.' }
  }
  const { data: newest } = await sb
    .from('seo_gsc_daily')
    .select('date')
    .eq('org_id', orgId)
    .eq('site_id', site.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!newest) return { site: { id: site.id, host: site.host }, connected: true, message: 'Search Console data is still importing.' }

  const span = Math.max(1, Math.min(480, Math.round(days)))
  const start = addDays(newest.date, -(span - 1))
  const prevStart = addDays(start, -span)
  const daily = await selectAll<DailyMetricRow>((from, to) =>
    sb
      .from('seo_gsc_daily')
      .select('date, device, clicks, impressions, ctr, position')
      .eq('org_id', orgId)
      .eq('site_id', site.id)
      .gte('date', prevStart)
      .lte('date', newest.date)
      .order('date')
      .order('device')
      .range(from, to),
  )
  const current = totals(daily.filter((r) => r.date >= start))
  const previous = totals(daily.filter((r) => r.date < start))

  const { data: latestTop } = await sb
    .from('seo_gsc_top')
    .select('window_end')
    .eq('org_id', orgId)
    .eq('site_id', site.id)
    .order('window_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  const top = latestTop
    ? await selectAll<TopRow & { dimension: string }>((from, to) =>
        sb
          .from('seo_gsc_top')
          .select('dimension, key, clicks, impressions, ctr, position')
          .eq('org_id', orgId)
          .eq('site_id', site.id)
          .eq('window_end', latestTop.window_end)
          .order('clicks', { ascending: false })
          .range(from, to),
      )
    : []
  const queries = top.filter((r) => r.dimension === 'query')
  const pages = top.filter((r) => r.dimension === 'page')
  const round = (t: ReturnType<typeof totals>) => ({
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: Number(t.ctr.toFixed(4)),
    position: t.position === null ? null : Number(t.position.toFixed(1)),
  })

  return {
    site: { id: site.id, host: site.host, property: site.gsc_property },
    connected: true,
    period: { start, end: newest.date, days: span },
    current: round(current),
    previous: round(previous),
    top_queries: queries.slice(0, 15),
    top_pages: pages.slice(0, 15),
    quick_wins: quickWins(queries, 10),
    low_ctr: lowCtr([...queries, ...pages], 10),
  }
}

/**
 * Error-severity issues present in `current` but not in `previous`, keyed by
 * code + URL. Used to fire seo.critical_issue_new without re-alerting on
 * problems the site already had.
 */
export function newCriticalIssues(
  current: Array<{ code: string; url: string | null; severity: string }>,
  previous: Array<{ code: string; url: string | null; severity: string }> | null,
): Array<{ code: string; url: string | null }> {
  if (previous === null) return [] // first audit: everything is "new", which is noise
  const seen = new Set(previous.filter((i) => i.severity === 'error').map((i) => `${i.code}|${i.url ?? ''}`))
  const out = new Map<string, { code: string; url: string | null }>()
  for (const i of current) {
    if (i.severity !== 'error') continue
    const key = `${i.code}|${i.url ?? ''}`
    if (!seen.has(key)) out.set(key, { code: i.code, url: i.url })
  }
  return [...out.values()]
}
