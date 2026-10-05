import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/rbac/server'
import { cn } from '@/lib/utils'
import { ISSUE_CATALOG, SEVERITY_ORDER, issueDefinition, type IssueSeverity } from '@/lib/seo/checks/catalog'
import type { CoreWebVitals, SiteChecks } from '@/lib/seo/checks/site'
import { SCHEDULE_LABELS } from '@/lib/seo/constants'
import { describeIssueDetails } from '@/lib/seo/format'
import { selectAll } from '@/lib/seo/select-all'
import { PageContainer } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AuditProgress } from '@/components/seo/audit-progress'
import { DetailSheet } from '@/components/seo/detail-sheet'
import { PagesTable, type PageRow } from '@/components/seo/pages-table'
import { RunAuditButton } from '@/components/seo/run-audit-button'
import { ScoreBadge } from '@/components/seo/score-badge'
import { ScoreHistoryChart } from '@/components/seo/score-history-chart'
import { SiteSettingsDialog } from '@/components/seo/site-settings-dialog'
import { PerformanceTab, RANGES, type RangeDays } from './performance'

export const dynamic = 'force-dynamic'

type Tab = 'overview' | 'performance' | 'issues' | 'pages'
const TABS: Tab[] = ['overview', 'performance', 'issues', 'pages']
type Summary = {
  by_severity?: Partial<Record<IssueSeverity, number>>
  by_code?: Record<string, number>
  total?: number
} | null

const SEVERITY_BADGE: Record<IssueSeverity, 'danger' | 'warning' | 'info'> = { error: 'danger', warning: 'warning', notice: 'info' }
const SEVERITY_LABEL: Record<IssueSeverity, string> = { error: 'Errors', warning: 'Warnings', notice: 'Notices' }

export default async function SeoSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { siteId } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const tabParam = one(sp.tab)
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'overview'
  const rangeParam = Number(one(sp.range))
  const range: RangeDays = (RANGES as readonly number[]).includes(rangeParam) ? (rangeParam as RangeDays) : 28
  const issueParam = one(sp.issue)
  const pageParam = one(sp.page)

  const supabase = await createClient()
  const [{ data: site }, canManage] = await Promise.all([
    supabase.from('seo_sites').select('*').eq('id', siteId).maybeSingle(),
    can('seo.manage'),
  ])
  if (!site) notFound()

  const { data: audits } = await supabase
    .from('seo_audits')
    .select('id, status, stage, health_score, summary, site_checks, pages_crawled, pages_discovered, error_message, finished_at, created_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(30)

  const active = (audits ?? []).find((a) => a.status === 'pending' || a.status === 'running') ?? null
  const latest = (audits ?? []).find((a) => a.status === 'completed') ?? null
  const newest = audits?.[0] ?? null
  const failedNewest = newest && newest.status === 'failed' && newest.error_message !== 'Cancelled' ? newest : null
  const history = (audits ?? [])
    .filter((a) => a.status === 'completed' && a.health_score !== null && a.finished_at)
    .reverse()
    .map((a) => ({ label: format(new Date(a.finished_at!), 'MMM d'), score: a.health_score! }))

  const summary = (latest?.summary ?? null) as Summary
  const base = `/seo/${siteId}`

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-text-primary">{site.name}</h1>
          <a
            href={site.root_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-accent"
          >
            {site.host}
            <ExternalLink className="h-3 w-3" />
          </a>
          <p className="mt-1 text-xs text-text-tertiary">
            {SCHEDULE_LABELS[site.audit_schedule]}
            {site.next_audit_at && site.audit_schedule !== 'off'
              ? ` · next audit ${formatDistanceToNow(new Date(site.next_audit_at), { addSuffix: true })}`
              : ''}
            {` · up to ${site.crawl_max_pages} pages`}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <RunAuditButton siteId={site.id} activeAuditId={active?.id ?? null} />
            <SiteSettingsDialog site={site} />
          </div>
        )}
      </div>

      {active && (
        <Card>
          <CardContent className="p-4">
            <AuditProgress
              status={active.status as 'pending' | 'running'}
              stage={active.stage}
              crawled={active.pages_crawled}
              discovered={active.pages_discovered}
            />
          </CardContent>
        </Card>
      )}

      {!active && failedNewest && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-[var(--danger-muted)] p-4 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">The last audit failed</p>
            <p className="text-text-secondary">{failedNewest.error_message}</p>
          </div>
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-border-subtle">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === 'overview' ? base : `${base}?tab=${t}`}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm capitalize transition-colors',
              tab === t ? 'border-accent font-medium text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {t}
            {t === 'issues' && summary?.total ? <span className="ml-1.5 text-xs text-text-tertiary">{summary.total}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === 'performance' ? (
        <PerformanceTab
          site={site}
          range={range}
          canManage={canManage}
          latestAuditId={latest?.id ?? null}
          gscError={one(sp.gsc_error) ?? null}
        />
      ) : !latest ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-sm text-text-secondary">
            {active ? 'The first audit is running — results appear here when it finishes.' : 'No completed audit yet.'}
          </CardContent>
        </Card>
      ) : (
        <>
          {tab === 'overview' && <Overview audit={latest} summary={summary} history={history} base={base} />}
          {tab === 'issues' && <IssueGroups summary={summary} base={base} />}
          {tab === 'pages' && <PagesTab auditId={latest.id} base={base} />}
        </>
      )}

      {latest && issueParam && <IssueSheet auditId={latest.id} code={issueParam} />}
      {latest && pageParam && <PageSheet auditId={latest.id} pageId={pageParam} />}
    </PageContainer>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function Overview({
  audit,
  summary,
  history,
  base,
}: {
  audit: { health_score: number | null; pages_crawled: number; finished_at: string | null; site_checks: unknown }
  summary: Summary
  history: { label: string; score: number }[]
  base: string
}) {
  const checks = (audit.site_checks ?? {}) as Partial<SiteChecks>
  const byCode = summary?.by_code ?? {}
  const top = topIssues(byCode).slice(0, 6)
  const sev = summary?.by_severity ?? {}

  const siteRows: Array<{ label: string; ok: boolean; note: string }> = [
    {
      label: 'robots.txt',
      ok: !byCode.robots_blocks_all && !byCode.robots_missing,
      note: byCode.robots_blocks_all ? 'Blocks the whole site' : byCode.robots_missing ? 'Not found' : 'OK',
    },
    {
      label: 'Sitemap',
      ok: !byCode.sitemap_missing && !byCode.sitemap_invalid,
      note: byCode.sitemap_missing
        ? 'Not found'
        : byCode.sitemap_invalid
          ? 'Could not be parsed'
          : `${checks.sitemap?.urls ?? 0} URLs`,
    },
    { label: 'HTTPS redirect', ok: !byCode.no_https_redirect, note: byCode.no_https_redirect ? 'http:// is not redirected' : 'OK' },
    { label: 'www / non-www', ok: !byCode.www_inconsistent, note: byCode.www_inconsistent ? 'Both versions resolve' : 'OK' },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardContent className="flex items-center gap-5 p-5">
          <ScoreBadge score={audit.health_score} size="lg" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-text-primary">Health score</p>
            <p className="text-danger">{sev.error ?? 0} errors</p>
            <p className="text-warning">{sev.warning ?? 0} warnings</p>
            <p className="text-text-tertiary">{sev.notice ?? 0} notices</p>
            <p className="pt-1 text-xs text-text-tertiary">
              {audit.pages_crawled} pages ·{' '}
              {audit.finished_at ? formatDistanceToNow(new Date(audit.finished_at), { addSuffix: true }) : ''}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Score history</CardTitle>
        </CardHeader>
        <CardContent>
          <ScoreHistoryChart data={history} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top issues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {top.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-tertiary">No issues found. 🎉</p>
          ) : (
            top.map(({ code, count }) => <IssueRow key={code} code={code} count={count} base={base} />)
          )}
          {top.length > 0 && (
            <Link href={`${base}?tab=issues`} className="block pt-2 text-xs text-accent hover:underline">
              See all issues
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Site checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {siteRows.map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-sm">
              {r.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
              <span className="text-text-primary">{r.label}</span>
              <span className="ml-auto text-xs text-text-tertiary">{r.note}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Core Web Vitals (mobile)</CardTitle>
        </CardHeader>
        <CardContent>
          <CwvTable rows={checks.cwv ?? []} />
        </CardContent>
      </Card>
    </div>
  )
}

function CwvTable({ rows }: { rows: CoreWebVitals[] }) {
  if (!rows.length) return <p className="py-4 text-sm text-text-tertiary">Not measured in this audit.</p>
  const cell = (v: string, bad: boolean) => <td className={cn('py-1.5 text-right tabular-nums', bad && 'text-danger')}>{v}</td>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-tertiary">
          <tr>
            <th className="py-1.5 text-left font-normal">Page</th>
            <th className="py-1.5 text-right font-normal">Performance</th>
            <th className="py-1.5 text-right font-normal">LCP</th>
            <th className="py-1.5 text-right font-normal">CLS</th>
            <th className="py-1.5 text-right font-normal">INP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.url} className="border-t border-border-subtle">
              <td className="max-w-[360px] truncate py-1.5 text-text-secondary">{r.url}</td>
              {r.error ? (
                <td colSpan={4} className="py-1.5 text-right text-xs text-text-tertiary">
                  {r.error}
                </td>
              ) : (
                <>
                  {cell(r.performance != null ? String(r.performance) : '—', (r.performance ?? 100) < 50)}
                  {cell(r.lcpMs != null ? `${(r.lcpMs / 1000).toFixed(1)}s` : '—', (r.lcpMs ?? 0) > 4000)}
                  {cell(r.cls != null ? r.cls.toFixed(2) : '—', (r.cls ?? 0) > 0.25)}
                  {cell(r.inpMs != null ? `${r.inpMs}ms` : '—', (r.inpMs ?? 0) > 500)}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Issues ──────────────────────────────────────────────────────────────────

function topIssues(byCode: Record<string, number>) {
  return Object.entries(byCode)
    .map(([code, count]) => ({ code, count, sev: issueDefinition(code)?.severity ?? 'notice' }))
    .sort((a, b) => SEVERITY_ORDER[a.sev] - SEVERITY_ORDER[b.sev] || b.count - a.count)
}

function IssueRow({ code, count, base }: { code: string; count: number; base: string }) {
  const def = issueDefinition(code)
  if (!def) return null
  return (
    <Link
      href={`${base}?tab=issues&issue=${code}`}
      scroll={false}
      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-bg-tertiary"
    >
      <Badge variant={SEVERITY_BADGE[def.severity]} className="w-16 justify-center capitalize">
        {def.severity}
      </Badge>
      <span className="flex-1 text-text-primary">{def.title}</span>
      <span className="tabular-nums text-xs text-text-tertiary">
        {def.scope === 'site' ? 'site-wide' : `${count} ${count === 1 ? 'page' : 'pages'}`}
      </span>
    </Link>
  )
}

function IssueGroups({ summary, base }: { summary: Summary; base: string }) {
  const issues = topIssues(summary?.by_code ?? {})
  if (!issues.length) {
    return <p className="py-10 text-center text-sm text-text-tertiary">No issues found in the last audit.</p>
  }
  return (
    <div className="space-y-6">
      {(['error', 'warning', 'notice'] as IssueSeverity[]).map((sev) => {
        const group = issues.filter((i) => i.sev === sev)
        if (!group.length) return null
        return (
          <section key={sev} className="space-y-1">
            <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">{SEVERITY_LABEL[sev]}</h2>
            {group.map(({ code, count }) => (
              <IssueRow key={code} code={code} count={count} base={base} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

async function IssueSheet({ auditId, code }: { auditId: string; code: string }) {
  const def = (ISSUE_CATALOG as Record<string, (typeof ISSUE_CATALOG)[keyof typeof ISSUE_CATALOG]>)[code]
  if (!def) return null
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('seo_audit_issues')
    .select('id, url, details')
    .eq('audit_id', auditId)
    .eq('code', code)
    .order('url')
    .limit(500)

  return (
    <DetailSheet param="issue" title={def.title} description={def.why}>
      <div className="rounded-lg border border-border bg-bg-secondary p-3 text-sm">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary">How to fix</p>
        <p className="text-text-primary">{def.fix}</p>
      </div>
      <p className="text-xs text-text-tertiary">
        {def.scope === 'site' ? 'Affects the whole site' : `${rows?.length ?? 0} affected ${rows?.length === 1 ? 'page' : 'pages'}`}
        {rows?.length === 500 ? ' (showing the first 500)' : ''}
      </p>
      <ul className="space-y-2">
        {(rows ?? []).map((r) => {
          const lines = describeIssueDetails(code, r.details as Record<string, unknown> | null)
          return (
            <li key={r.id} className="rounded-md border border-border-subtle p-2.5 text-sm">
              {r.url && (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="block break-all text-text-primary hover:text-accent">
                  {r.url}
                </a>
              )}
              {lines.map((l, i) => (
                <p key={i} className="break-all text-xs text-text-tertiary">
                  {l}
                </p>
              ))}
            </li>
          )
        })}
      </ul>
    </DetailSheet>
  )
}

// ── Pages ───────────────────────────────────────────────────────────────────

async function PagesTab({ auditId, base }: { auditId: string; base: string }) {
  const supabase = await createClient()
  const [pages, issues] = await Promise.all([
    selectAll<Omit<PageRow, 'errors' | 'warnings'>>((from, to) =>
      supabase
        .from('seo_audit_pages')
        .select('id, url, status, http_status, redirect_to, title, word_count, inlinks, depth')
        .eq('audit_id', auditId)
        .neq('status', 'queued')
        .order('depth')
        .order('url')
        .range(from, to),
    ),
    selectAll<{ page_id: string | null; severity: IssueSeverity }>((from, to) =>
      supabase.from('seo_audit_issues').select('page_id, severity').eq('audit_id', auditId).not('page_id', 'is', null).order('id').range(from, to),
    ),
  ])

  const counts = new Map<string, { errors: number; warnings: number }>()
  for (const i of issues) {
    if (!i.page_id) continue
    const c = counts.get(i.page_id) ?? { errors: 0, warnings: 0 }
    if (i.severity === 'error') c.errors++
    else if (i.severity === 'warning') c.warnings++
    counts.set(i.page_id, c)
  }
  const rows: PageRow[] = pages.map((p) => ({ ...p, ...(counts.get(p.id) ?? { errors: 0, warnings: 0 }) }))

  return <PagesTable pages={rows} pageHrefPrefix={`${base}?tab=pages&page=`} />
}

async function PageSheet({ auditId, pageId }: { auditId: string; pageId: string }) {
  const supabase = await createClient()
  const [{ data: page }, { data: issues }] = await Promise.all([
    supabase
      .from('seo_audit_pages')
      .select('url, http_status, status, redirect_to, title, meta_description, h1, word_count, canonical, indexable, in_sitemap, inlinks, outlinks, ttfb_ms, error')
      .eq('audit_id', auditId)
      .eq('id', pageId)
      .maybeSingle(),
    supabase.from('seo_audit_issues').select('id, code, details').eq('audit_id', auditId).eq('page_id', pageId),
  ])
  if (!page) return null

  const facts: Array<[string, React.ReactNode]> = [
    ['Status', page.status === 'failed' ? `Failed — ${page.error ?? ''}` : page.status === 'skipped' ? 'Blocked by robots.txt' : String(page.http_status ?? '—')],
    ...(page.redirect_to ? [['Redirects to', page.redirect_to] as [string, React.ReactNode]] : []),
    ['Title', page.title ?? '—'],
    ['Meta description', page.meta_description ?? '—'],
    ['H1', page.h1 ?? '—'],
    ['Canonical', page.canonical ?? '—'],
    ['Indexable', page.indexable ? 'Yes' : 'No'],
    ['In sitemap', page.in_sitemap ? 'Yes' : 'No'],
    ['Words', page.word_count ?? '—'],
    ['Internal links in / out', `${page.inlinks ?? '—'} / ${page.outlinks ?? '—'}`],
    ['Response time', page.ttfb_ms != null ? `${page.ttfb_ms} ms` : '—'],
  ]
  const sorted = (issues ?? [])
    .map((i) => ({ ...i, def: issueDefinition(i.code) }))
    .filter((i) => i.def)
    .sort((a, b) => SEVERITY_ORDER[a.def!.severity] - SEVERITY_ORDER[b.def!.severity])

  return (
    <DetailSheet
      param="page"
      title={<span className="break-all">{page.url}</span>}
      description={
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
          Open page <ExternalLink className="h-3 w-3" />
        </a>
      }
    >
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-tertiary">{k}</dt>
            <dd className="break-words text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Issues on this page</p>
        {sorted.length === 0 && <p className="text-sm text-text-tertiary">None.</p>}
        {sorted.map((i) => (
          <div key={i.id} className="rounded-md border border-border-subtle p-2.5 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={SEVERITY_BADGE[i.def!.severity]} className="capitalize">
                {i.def!.severity}
              </Badge>
              <span className="font-medium text-text-primary">{i.def!.title}</span>
            </div>
            {describeIssueDetails(i.code, i.details as Record<string, unknown> | null).map((l, idx) => (
              <p key={idx} className="mt-1 break-all text-xs text-text-tertiary">
                {l}
              </p>
            ))}
            <p className="mt-1 text-xs text-text-secondary">{i.def!.fix}</p>
          </div>
        ))}
      </div>
    </DetailSheet>
  )
}
