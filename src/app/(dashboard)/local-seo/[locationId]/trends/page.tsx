import { TrendsView, type TrendPoint } from '@/components/local-seo/trends-view'
import { METRIC_LABEL, type MetricKey } from '@/lib/local-seo/events'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const HISTORY_DAYS = 365

function historyStart(): string {
  return new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
}

export default async function TrendsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const since = historyStart()

  const [{ data: scans }, { data: annotations }, { data: alerts }, canManage] = await Promise.all([
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
  ])

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
    </div>
  )
}
