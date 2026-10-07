import { GbpPerformance, type PerfDay } from '@/components/local-seo/gbp-performance'
import { TrendsView, type TrendPoint } from '@/components/local-seo/trends-view'
import { METRIC_LABEL, type MetricKey } from '@/lib/local-seo/events'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const HISTORY_DAYS = 365

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

export default async function TrendsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const since = daysAgo(HISTORY_DAYS)

  const perfSince = daysAgo(90).slice(0, 10)
  const [{ data: scans }, { data: annotations }, { data: alerts }, canManage, { data: perf }, { data: keywordRows }] = await Promise.all([
    supabase
      .from('local_seo_scans')
      .select('id, keyword_id, keyword, created_at, solv, arp, atrp, found_pct')
      .eq('location_id', locationId)
      .in('status', ['completed', 'partial'])
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(2000),
    supabase
      .from('local_seo_annotations')
      .select('id, occurred_at, title, kind')
      .eq('location_id', locationId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('local_seo_alerts')
      .select('id, keyword, metric, previous_value, current_value, delta, is_worse, created_at')
      .eq('location_id', locationId)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    can('local_seo.manage'),
    supabase.from('gbp_performance_daily').select('date, metric, value').eq('location_id', locationId).gte('date', perfSince).limit(5000),
    supabase
      .from('gbp_search_keywords_monthly')
      .select('month, keyword, impressions, threshold')
      .eq('location_id', locationId)
      .order('month', { ascending: false })
      .order('impressions', { ascending: false, nullsFirst: false })
      .limit(60),
  ])

  const perfByDay = new Map<string, PerfDay>()
  for (const r of perf ?? []) {
    const d = perfByDay.get(r.date) ?? { date: r.date, impressions: 0, calls: 0, website: 0, directions: 0 }
    const v = Number(r.value)
    if (r.metric.startsWith('BUSINESS_IMPRESSIONS')) d.impressions += v
    else if (r.metric === 'CALL_CLICKS') d.calls += v
    else if (r.metric === 'WEBSITE_CLICKS') d.website += v
    else if (r.metric === 'BUSINESS_DIRECTION_REQUESTS') d.directions += v
    perfByDay.set(r.date, d)
  }
  const perfDays = [...perfByDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  const latestMonth = keywordRows?.[0]?.month ?? null
  const searchKeywords = (keywordRows ?? []).filter((k) => k.month === latestMonth).slice(0, 20)

  const n = (v: number | null) => (v === null ? null : Number(v))
  const points: TrendPoint[] = (scans ?? []).map((s) => ({
    scanId: s.id,
    keywordId: s.keyword_id,
    keyword: s.keyword,
    at: s.created_at,
    solv: n(s.solv),
    arp: n(s.arp),
    atrp: n(s.atrp),
    found_pct: n(s.found_pct),
  }))

  return (
    <div className="px-4 py-6 sm:px-6">
      <TrendsView
        locationId={locationId}
        points={points}
        annotations={(annotations ?? []).map((a) => ({ id: a.id, occurredAt: a.occurred_at, title: a.title, kind: a.kind }))}
        alerts={(alerts ?? []).map((a) => ({
          id: a.id,
          keyword: a.keyword,
          metricLabel: METRIC_LABEL[a.metric as MetricKey] ?? a.metric,
          previous: n(a.previous_value),
          current: n(a.current_value),
          delta: Number(a.delta),
          isWorse: a.is_worse,
          createdAt: a.created_at,
        }))}
        canManage={canManage}
      />
      {(perfDays.length > 0 || searchKeywords.length > 0) && (
        <div className="mt-6">
          <GbpPerformance
            days={perfDays}
            month={latestMonth}
            keywords={searchKeywords.map((k) => ({ keyword: k.keyword, impressions: k.impressions === null ? null : Number(k.impressions), threshold: k.threshold === null ? null : Number(k.threshold) }))}
          />
        </div>
      )}
    </div>
  )
}
