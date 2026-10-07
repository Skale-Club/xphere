import { CompetitorsView, type CompetitorRow, type SolvHistoryPoint } from '@/components/local-seo/competitors-view'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function CompetitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ keyword?: string }>
}) {
  const { locationId } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const [{ data: keywords }, { data: pinnedRows }, canManage] = await Promise.all([
    supabase
      .from('local_seo_keywords')
      .select('id, keyword')
      .eq('location_id', locationId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.from('local_seo_competitors').select('competitor_key').eq('location_id', locationId),
    can('local_seo.manage'),
  ])
  const keywordId = keywords?.find((k) => k.id === sp.keyword)?.id ?? keywords?.[0]?.id ?? null
  const pinned = (pinnedRows ?? []).map((p) => p.competitor_key)

  const { data: scans } = keywordId
    ? await supabase
        .from('local_seo_scans')
        .select('id, created_at, points_done, comparable_key')
        .eq('location_id', locationId)
        .eq('keyword_id', keywordId)
        .in('status', ['completed', 'partial'])
        .order('created_at', { ascending: false })
        .limit(60)
    : { data: [] }
  const latest = scans?.[0] ?? null

  let rows: CompetitorRow[] = []
  let history: SolvHistoryPoint[] = []
  if (latest) {
    const { data: snaps } = await supabase
      .from('local_seo_competitor_snapshots')
      .select('competitor_key, place_id, title, is_target, appearances, avg_rank, solv, rating, reviews, category')
      .eq('scan_id', latest.id)
      .order('solv', { ascending: false })
      .limit(50)
    rows = (snaps ?? []).map((s) => ({
      key: s.competitor_key,
      placeId: s.place_id,
      title: s.title,
      isTarget: s.is_target,
      appearances: s.appearances,
      avgRank: s.avg_rank === null ? null : Number(s.avg_rank),
      solv: s.solv === null ? null : Number(s.solv),
      rating: s.rating === null ? null : Number(s.rating),
      reviews: s.reviews,
      category: s.category,
    }))

    // SoLV over time for the business and the pinned competitors, on scans
    // comparable with the latest one.
    const comparable = (scans ?? []).filter((s) => s.comparable_key === latest.comparable_key).map((s) => s.id)
    const targetKey = rows.find((r) => r.isTarget)?.key
    const followKeys = [...new Set([...(targetKey ? [targetKey] : []), ...pinned])]
    if (comparable.length > 1 && followKeys.length) {
      const { data: hist } = await supabase
        .from('local_seo_competitor_snapshots')
        .select('competitor_key, title, solv, created_at, is_target')
        .in('scan_id', comparable)
        .in('competitor_key', followKeys)
      history = (hist ?? []).map((h) => ({
        key: h.competitor_key,
        title: h.is_target ? `${h.title} (you)` : h.title,
        at: h.created_at,
        solv: Number(h.solv ?? 0),
      }))
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <CompetitorsView
        locationId={locationId}
        keywords={keywords ?? []}
        keywordId={keywordId}
        scannedAt={latest?.created_at ?? null}
        pointsTotal={latest?.points_done ?? 0}
        rows={rows}
        pinned={pinned}
        history={history}
        canManage={canManage}
      />
    </div>
  )
}
