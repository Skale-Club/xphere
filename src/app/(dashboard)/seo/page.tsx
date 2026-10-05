import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { SearchCheck } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/rbac/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { AddSiteDialog } from '@/components/seo/add-site-dialog'
import { AuditProgress } from '@/components/seo/audit-progress'
import { ScoreBadge } from '@/components/seo/score-badge'
import { selectAll } from '@/lib/seo/select-all'
import { addDays, isoDate } from '@/lib/seo/gsc/dates'

export const dynamic = 'force-dynamic'

type Summary = { by_severity?: { error?: number; warning?: number; notice?: number } } | null

export default async function SeoPage() {
  const supabase = await createClient()
  const [{ data: sites }, canManage] = await Promise.all([
    supabase.from('seo_sites').select('id, name, root_url, host, audit_schedule, gsc_property').order('created_at', { ascending: true }),
    can('seo.manage'),
  ])

  if (!sites?.length) {
    // Suggest the site the org already set up in Analytics.
    const { data: analytics } = await supabase.from('analytics_setups').select('primary_website_url').maybeSingle()
    return (
      <PageContainer>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-accent-muted p-3">
              <SearchCheck className="h-6 w-6 text-accent" />
            </div>
            <h2 className="text-xl font-semibold">Audit your website for SEO issues</h2>
            <p className="max-w-md text-sm text-text-secondary">
              Add a site and we crawl it like Google does: broken pages, missing titles and descriptions, duplicate content,
              redirects, sitemap and robots.txt problems, and Core Web Vitals — each with how to fix it.
            </p>
            {canManage && <AddSiteDialog suggestedUrl={analytics?.primary_website_url ?? null} />}
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  const siteIds = sites.map((s) => s.id)
  // Newest audits first; the first completed and the first active per site win.
  const { data: audits } = await supabase
    .from('seo_audits')
    .select('id, site_id, status, stage, health_score, summary, pages_crawled, pages_discovered, finished_at, created_at')
    .in('site_id', siteIds)
    .order('created_at', { ascending: false })
    .limit(siteIds.length * 12)

  // Search Console clicks over the last 30 days (GSC data lags ~2 days).
  const since = addDays(isoDate(new Date()), -30)
  const gscRows = await selectAll<{ site_id: string; clicks: number }>((from, to) =>
    supabase.from('seo_gsc_daily').select('site_id, clicks').in('site_id', siteIds).gte('date', since).order('date').range(from, to),
  )
  const clicks28 = new Map<string, number>()
  for (const r of gscRows) clicks28.set(r.site_id, (clicks28.get(r.site_id) ?? 0) + r.clicks)

  const latestCompleted = new Map<string, NonNullable<typeof audits>[number]>()
  const previousCompleted = new Map<string, number | null>()
  const active = new Map<string, NonNullable<typeof audits>[number]>()
  for (const a of audits ?? []) {
    if ((a.status === 'pending' || a.status === 'running') && !active.has(a.site_id)) active.set(a.site_id, a)
    if (a.status !== 'completed') continue
    if (!latestCompleted.has(a.site_id)) latestCompleted.set(a.site_id, a)
    else if (!previousCompleted.has(a.site_id)) previousCompleted.set(a.site_id, a.health_score)
  }

  return (
    <PageContainer>
      <PageHeader actions={canManage ? <AddSiteDialog variant="outline" /> : undefined} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sites.map((site) => {
          const last = latestCompleted.get(site.id)
          const running = active.get(site.id)
          const prev = previousCompleted.get(site.id)
          const delta = last?.health_score != null && prev != null ? last.health_score - prev : null
          const sev = (last?.summary as Summary)?.by_severity
          return (
            <Link key={site.id} href={`/seo/${site.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-accent/40">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start gap-4">
                    <ScoreBadge score={last?.health_score} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold text-text-primary">{site.name}</h3>
                      <p className="truncate text-xs text-text-tertiary">{site.host}</p>
                      {site.gsc_property && clicks28.has(site.id) && (
                        <p className="text-xs text-text-secondary">{clicks28.get(site.id)!.toLocaleString()} clicks · last 30 days</p>
                      )}
                      {delta !== null && delta !== 0 && (
                        <p className={delta > 0 ? 'text-xs text-success' : 'text-xs text-danger'}>
                          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} since last audit
                        </p>
                      )}
                    </div>
                  </div>
                  {running ? (
                    <AuditProgress
                      status={running.status as 'pending' | 'running'}
                      stage={running.stage}
                      crawled={running.pages_crawled}
                      discovered={running.pages_discovered}
                      compact
                    />
                  ) : last ? (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-danger">{sev?.error ?? 0} errors</span>
                      <span className="text-warning">{sev?.warning ?? 0} warnings</span>
                      <span className="text-text-tertiary">{sev?.notice ?? 0} notices</span>
                      <span className="ml-auto text-text-tertiary">
                        {last.pages_crawled} pages ·{' '}
                        {last.finished_at ? formatDistanceToNow(new Date(last.finished_at), { addSuffix: true }) : ''}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-text-tertiary">No completed audit yet.</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </PageContainer>
  )
}
