import { notFound } from 'next/navigation'

import { RankingsView, type ScanSummary } from '@/components/local-seo/rankings-view'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'
import type { GridShape } from '@/lib/local-seo/types'

export const dynamic = 'force-dynamic'

const SCAN_FIELDS =
  'id, status, created_at, grid_size, spacing_m, shape, points_total, points_done, points_failed, error, arp, atrp, solv, found_pct, comparable_key'

type ScanRow = {
  id: string
  status: ScanSummary['status']
  created_at: string
  grid_size: number
  spacing_m: number
  shape: GridShape
  points_total: number
  points_done: number
  points_failed: number
  error: string | null
  arp: number | null
  atrp: number | null
  solv: number | null
  found_pct: number | null
  comparable_key: string
}

function toSummary(s: ScanRow): ScanSummary {
  const n = (v: number | null) => (v === null ? null : Number(v))
  return {
    id: s.id,
    status: s.status,
    createdAt: s.created_at,
    gridSize: s.grid_size,
    spacingM: s.spacing_m,
    shape: s.shape,
    pointsTotal: s.points_total,
    pointsDone: s.points_done,
    pointsFailed: s.points_failed,
    error: s.error,
    metrics: { arp: n(s.arp), atrp: n(s.atrp), solv: n(s.solv), foundPct: n(s.found_pct) },
  }
}

export default async function RankingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ keyword?: string; scan?: string }>
}) {
  const { locationId } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const [{ data: location }, { data: keywords }, canManage] = await Promise.all([
    supabase
      .from('local_seo_locations')
      .select('id, lat, lng, default_grid_size, default_spacing_m, default_shape')
      .eq('id', locationId)
      .maybeSingle(),
    supabase
      .from('local_seo_keywords')
      .select('id, keyword')
      .eq('location_id', locationId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    can('local_seo.manage'),
  ])
  if (!location) notFound()

  const keywordId = keywords?.find((k) => k.id === sp.keyword)?.id ?? keywords?.[0]?.id ?? null
  const { data: scanRows } = keywordId
    ? await supabase
        .from('local_seo_scans')
        .select(SCAN_FIELDS)
        .eq('location_id', locationId)
        .eq('keyword_id', keywordId)
        .order('created_at', { ascending: false })
        .limit(30)
    : { data: [] as ScanRow[] }
  const rows = (scanRows ?? []) as ScanRow[]
  const current = rows.find((s) => s.id === sp.scan) ?? rows[0] ?? null

  const { data: points } = current
    ? await supabase
        .from('local_seo_scan_points')
        .select('id, row_idx, col_idx, lat, lng, status, rank')
        .eq('scan_id', current.id)
    : { data: [] }
  // Same grid, keyword and provider, finished before this one: the baseline
  // for the deltas.
  const previous = current
    ? (rows.find(
        (s) =>
          s.comparable_key === current.comparable_key &&
          s.created_at < current.created_at &&
          (s.status === 'completed' || s.status === 'partial'),
      ) ?? null)
    : null

  return (
    <div className="px-4 py-6 sm:px-6">
      <RankingsView
        locationId={locationId}
        center={{ lat: location.lat, lng: location.lng }}
        keywords={keywords ?? []}
        keywordId={keywordId}
        scans={rows.map(toSummary)}
        scan={current ? toSummary(current) : null}
        previous={previous ? toSummary(previous).metrics : null}
        pins={(points ?? []).map((pt) => ({
          id: pt.id,
          row: pt.row_idx,
          col: pt.col_idx,
          lat: pt.lat,
          lng: pt.lng,
          status: pt.status,
          rank: pt.rank,
        }))}
        canManage={canManage}
        mapsKey={process.env.GOOGLE_MAPS_BROWSER_KEY ?? null}
        mapId={process.env.GOOGLE_MAPS_MAP_ID ?? null}
        defaults={{
          gridSize: location.default_grid_size,
          spacingM: location.default_spacing_m,
          shape: location.default_shape,
        }}
      />
    </div>
  )
}
