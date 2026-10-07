import Link from 'next/link'
import { format } from 'date-fns'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2, SearchCheck } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { addDays } from '@/lib/seo/gsc/dates'
import { dailySeries, pctChange, totals, type DailyMetricRow, type Totals } from '@/lib/seo/gsc/metrics'
import { lowCtr, pagesWithIssues, quickWins, type TopRow } from '@/lib/seo/gsc/opportunities'
import { selectAll } from '@/lib/seo/select-all'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AutoRefresh } from '@/components/seo/auto-refresh'
import { GscPerformanceChart } from '@/components/seo/gsc-performance-chart'
import { GscPropertyPicker } from '@/components/seo/gsc-property-picker'

export const RANGES = [7, 28, 90, 480] as const
export type RangeDays = (typeof RANGES)[number]
const RANGE_LABEL: Record<RangeDays, string> = { 7: '7 days', 28: '28 days', 90: '3 months', 480: '16 months' }

interface SiteForPerformance {
  id: string
  host: string
  gsc_property: string | null
  gsc_synced_at: string | null
  gsc_last_error: string | null
}

export async function PerformanceTab({
  site,
  range,
  canManage,
  latestAuditId,
  gscError,
}: {
  site: SiteForPerformance
  range: RangeDays
  canManage: boolean
  latestAuditId: string | null
  gscError: string | null
}) {
  const supabase = await createClient()
  const base = `/seo/website/${site.id}?tab=performance`
  const connectHref = `/api/google/search-console/connect?return=${encodeURIComponent(base)}`

  const { data: integration } = await supabase
    .from('integrations')
    .select('health_status, is_active, key_hint')
    .eq('provider', 'google_search_console')
    .maybeSingle()

  const errorBanner = gscError ? <ConnectError code={gscError} /> : null

  if (!integration) {
    return (
      <div className="space-y-4">
        {errorBanner}
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="rounded-full bg-accent-muted p-3">
              <SearchCheck className="h-6 w-6 text-accent" />
            </div>
            <h2 className="text-lg font-semibold">Connect Google Search Console</h2>
            <p className="max-w-md text-sm text-text-secondary">
              See the clicks, impressions and rankings Google actually sends this site, find queries that are close to page
              one, and see which pages with audit issues already get traffic.
            </p>
            {canManage ? (
              <Button asChild>
                {/* A real <a>: the connect route redirects to Google. */}
                <a href={connectHref}>Connect Search Console</a>
              </Button>
            ) : (
              <p className="text-xs text-text-tertiary">Ask an admin to connect Search Console.</p>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const disconnected = integration.health_status === 'disconnected' || !integration.is_active
  const reconnect = disconnected ? (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-[var(--warning-muted)] p-4 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
      <p className="flex-1 text-text-primary">
        {integration.is_active
          ? 'Google Search Console access expired, so data stopped syncing. Reconnect to resume.'
          : 'The Search Console integration is turned off in Integrations.'}
      </p>
      {canManage && integration.is_active && (
        <Button asChild size="sm" variant="outline">
          <a href={connectHref}>Reconnect</a>
        </Button>
      )}
    </div>
  ) : null

  if (!site.gsc_property) {
    return (
      <div className="space-y-4">
        {errorBanner}
        {reconnect}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Link a Search Console property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-text-secondary">
              Connected as {integration.key_hint ?? 'your Google account'}. Choose the property for {site.host}.
            </p>
            {canManage && !disconnected ? (
              <GscPropertyPicker siteId={site.id} current={null} />
            ) : (
              !canManage && <p className="text-xs text-text-tertiary">Ask an admin to link the property.</p>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data: newest } = await supabase
    .from('seo_gsc_daily')
    .select('date')
    .eq('site_id', site.id)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!newest) {
    return (
      <div className="space-y-4">
        {errorBanner}
        {reconnect}
        <Card>
          <CardContent className="space-y-3 p-5">
            {site.gsc_last_error ? (
              <p className="text-sm text-danger">Sync failed: {site.gsc_last_error}</p>
            ) : site.gsc_synced_at ? (
              <p className="text-sm text-text-secondary">Search Console has no data for {site.gsc_property} yet.</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing up to 16 months of data from {site.gsc_property}…
              </p>
            )}
            {!site.gsc_synced_at && !site.gsc_last_error && <AutoRefresh />}
            {canManage && <GscPropertyPicker siteId={site.id} current={site.gsc_property} />}
          </CardContent>
        </Card>
      </div>
    )
  }

  // Current period ends at the newest day Search Console has; previous is the same length before it.
  const end = newest.date
  const start = addDays(end, -(range - 1))
  const prevEnd = addDays(start, -1)
  const prevStart = addDays(prevEnd, -(range - 1))

  const [daily, topRows, audit] = await Promise.all([
    selectAll<DailyMetricRow>((from, to) =>
      supabase
        .from('seo_gsc_daily')
        .select('date, device, clicks, impressions, ctr, position')
        .eq('site_id', site.id)
        .gte('date', prevStart)
        .lte('date', end)
        .order('date')
        .order('device')
        .range(from, to),
    ),
    latestTop(supabase, site.id),
    latestAuditId ? auditPageMap(supabase, latestAuditId) : Promise.resolve(new Map()),
  ])

  const current = daily.filter((r) => r.date >= start)
  const previous = daily.filter((r) => r.date < start)
  const cur = totals(current)
  const prev = totals(previous)
  const series = dailySeries(current, start, end).map((d) => ({
    label: format(new Date(`${d.date}T00:00:00Z`), range > 90 ? 'MMM yy' : 'MMM d'),
    clicks: d.clicks,
    impressions: d.impressions,
  }))

  const queries = topRows.rows.filter((r) => r.dimension === 'query')
  const pages = topRows.rows.filter((r) => r.dimension === 'page')
  const wins = quickWins(queries, 10)
  const ctrGaps = lowCtr([...queries, ...pages], 10)
  const fixFirst = pagesWithIssues(pages, audit, 10)

  return (
    <div className="space-y-4">
      {errorBanner}
      {reconnect}

      <div className="flex flex-wrap items-center gap-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`${base}&range=${r}`}
            scroll={false}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs',
              r === range ? 'bg-accent-muted font-medium text-accent' : 'text-text-secondary hover:bg-bg-tertiary',
            )}
          >
            {RANGE_LABEL[r]}
          </Link>
        ))}
        <span className="ml-auto text-xs text-text-tertiary">
          {site.gsc_property} · through {format(new Date(`${end}T00:00:00Z`), 'MMM d, yyyy')}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Clicks" value={cur.clicks.toLocaleString()} change={pctChange(cur.clicks, prev.clicks)} />
        <Kpi label="Impressions" value={cur.impressions.toLocaleString()} change={pctChange(cur.impressions, prev.impressions)} />
        <Kpi label="CTR" value={`${(cur.ctr * 100).toFixed(1)}%`} change={pctChange(cur.ctr, prev.ctr)} />
        <PositionKpi cur={cur} prev={prev} />
      </div>

      <Card>
        <CardContent className="p-4">
          <GscPerformanceChart data={series} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Opportunity
          title="Almost on page one"
          hint="Queries ranking 4–20 with real demand. Strengthen the ranking page (content, internal links) to reach the top 3."
          empty="No queries between positions 4 and 20 with enough impressions."
        >
          {wins.map((w) => (
            <OppRow key={w.key} label={w.key} meta={`pos ${w.position.toFixed(1)} · ${w.impressions.toLocaleString()} impr.`} value={`+${w.potentialClicks}`} />
          ))}
        </Opportunity>
        <Opportunity
          title="Low CTR for the position"
          hint="Ranking well but rarely clicked. Rewrite the title and meta description to match what searchers want."
          empty="No results with unusually low CTR."
        >
          {ctrGaps.map((r) => (
            <OppRow
              key={r.key}
              label={r.key}
              meta={`pos ${r.position.toFixed(1)} · CTR ${(r.ctr * 100).toFixed(1)}% vs ~${(r.expectedCtr * 100).toFixed(0)}%`}
              value={`−${r.missedClicks}`}
            />
          ))}
        </Opportunity>
        <Opportunity
          title="Fix first: pages with traffic and issues"
          hint="Pages that already earn clicks and have errors or warnings in the last audit."
          empty={latestAuditId ? 'No page with search traffic has audit issues.' : 'Run an audit to cross-reference.'}
        >
          {fixFirst.map((p) => (
            <OppRow
              key={p.url}
              label={p.url}
              href={`/seo/website/${site.id}?tab=pages&page=${p.pageId}`}
              meta={`${p.errors} errors · ${p.warnings} warnings`}
              value={`${p.clicks.toLocaleString()} clicks`}
            />
          ))}
        </Opportunity>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TopTable title="Top queries" rows={queries.slice(0, 25)} windowEnd={topRows.windowEnd} />
        <TopTable title="Top pages" rows={pages.slice(0, 25)} windowEnd={topRows.windowEnd} isUrl />
      </div>
    </div>
  )
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

async function latestTop(supabase: SupabaseServer, siteId: string) {
  const { data: latest } = await supabase
    .from('seo_gsc_top')
    .select('window_end')
    .eq('site_id', siteId)
    .order('window_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latest) return { windowEnd: null, rows: [] as Array<TopRow & { dimension: string }> }
  const rows = await selectAll<TopRow & { dimension: string }>((from, to) =>
    supabase
      .from('seo_gsc_top')
      .select('dimension, key, clicks, impressions, ctr, position')
      .eq('site_id', siteId)
      .eq('window_end', latest.window_end)
      .order('clicks', { ascending: false })
      .range(from, to),
  )
  return { windowEnd: latest.window_end, rows }
}

async function auditPageMap(supabase: SupabaseServer, auditId: string) {
  const [pages, issues] = await Promise.all([
    selectAll<{ id: string; url: string }>((from, to) =>
      supabase.from('seo_audit_pages').select('id, url').eq('audit_id', auditId).order('id').range(from, to),
    ),
    selectAll<{ page_id: string | null; severity: string }>((from, to) =>
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
  return new Map(pages.map((p) => [p.url, { pageId: p.id, ...(counts.get(p.id) ?? { errors: 0, warnings: 0 }) }]))
}

// ── Presentational bits ─────────────────────────────────────────────────────

const CONNECT_ERRORS: Record<string, string> = {
  denied: 'Google access was not granted.',
  scope: 'Search Console access was not granted. Reconnect and keep the Search Console permission checked.',
  forbidden: 'You do not have permission to connect integrations.',
  csrf: 'The connection attempt expired. Try again.',
  not_configured: 'Google sign-in is not configured on this server.',
}

function ConnectError({ code }: { code: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-[var(--danger-muted)] p-3 text-sm text-danger">
      {CONNECT_ERRORS[code] ?? 'Connecting Search Console failed. Try again.'}
    </div>
  )
}

function Delta({ change, invert = false }: { change: number | null; invert?: boolean }) {
  if (change === null || !Number.isFinite(change)) return <span className="text-xs text-text-tertiary">—</span>
  const good = invert ? change < 0 : change > 0
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center text-xs', change === 0 ? 'text-text-tertiary' : good ? 'text-success' : 'text-danger')}>
      <Icon className="h-3 w-3" />
      {Math.abs(change * 100).toFixed(0)}%
    </span>
  )
}

function Kpi({ label, value, change }: { label: string; value: string; change: number | null }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-text-tertiary">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
        <Delta change={change} />
      </CardContent>
    </Card>
  )
}

function PositionKpi({ cur, prev }: { cur: Totals; prev: Totals }) {
  // Lower is better: show the change in positions, green when it went down.
  const diff = cur.position !== null && prev.position !== null ? cur.position - prev.position : null
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-text-tertiary">Avg. position</p>
        <p className="text-2xl font-semibold tabular-nums text-text-primary">{cur.position !== null ? cur.position.toFixed(1) : '—'}</p>
        {diff === null ? (
          <span className="text-xs text-text-tertiary">—</span>
        ) : (
          <span className={cn('text-xs', diff < 0 ? 'text-success' : diff > 0 ? 'text-danger' : 'text-text-tertiary')}>
            {diff < 0 ? '▲' : diff > 0 ? '▼' : ''} {Math.abs(diff).toFixed(1)} positions
          </span>
        )}
      </CardContent>
    </Card>
  )
}

function Opportunity({ title, hint, empty, children }: { title: string; hint: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-text-tertiary">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {children.length ? children : <p className="py-4 text-sm text-text-tertiary">{empty}</p>}
      </CardContent>
    </Card>
  )
}

function OppRow({ label, meta, value, href }: { label: string; meta: string; value: string; href?: string }) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{label}</p>
        <p className="text-xs text-text-tertiary">{meta}</p>
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums text-text-secondary">{value}</span>
    </>
  )
  return href ? (
    <Link href={href} scroll={false} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-bg-tertiary">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-2 py-1.5">{body}</div>
  )
}

function TopTable({ title, rows, windowEnd, isUrl = false }: { title: string; rows: TopRow[]; windowEnd: string | null; isUrl?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-text-tertiary">
          Last 28 days{windowEnd ? ` through ${format(new Date(`${windowEnd}T00:00:00Z`), 'MMM d')}` : ''} · updated weekly
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-text-tertiary">No data yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-text-tertiary">
              <tr>
                <th className="py-1.5 text-left font-normal">{isUrl ? 'Page' : 'Query'}</th>
                <th className="py-1.5 text-right font-normal">Clicks</th>
                <th className="py-1.5 text-right font-normal">Impr.</th>
                <th className="py-1.5 text-right font-normal">CTR</th>
                <th className="py-1.5 text-right font-normal">Pos.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border-subtle">
                  <td className="max-w-[260px] truncate py-1.5 text-text-primary" title={r.key}>
                    {isUrl ? r.key.replace(/^https?:\/\/[^/]+/, '') || '/' : r.key}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">{r.impressions.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">{(r.ctr * 100).toFixed(1)}%</td>
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">{r.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
