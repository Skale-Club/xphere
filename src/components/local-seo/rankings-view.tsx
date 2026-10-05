'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { getCompetitorRanks } from '@/app/(dashboard)/local-seo/actions'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePathname } from '@/lib/org/navigation'
import type { GridShape, ScanStatus } from '@/lib/local-seo/types'

import { GeoGridMap } from './geogrid-map'
import type { GridPin } from './geogrid-pins'
import { PointSheet } from './point-sheet'
import { ScanMetrics, type MetricSet } from './scan-metrics'
import { ScanNowDialog } from './scan-now-dialog'

export type ScanSummary = {
  id: string
  status: ScanStatus
  createdAt: string
  gridSize: number
  spacingM: number
  shape: GridShape
  pointsTotal: number
  pointsDone: number
  pointsFailed: number
  error: string | null
  metrics: MetricSet
}

type Props = {
  locationId: string
  center: { lat: number; lng: number }
  keywords: { id: string; keyword: string }[]
  keywordId: string | null
  scans: ScanSummary[]
  scan: ScanSummary | null
  previous: MetricSet | null
  pins: GridPin[]
  /** Scan chosen in "Compare with", rendered side by side. */
  compare: { scan: ScanSummary; pins: GridPin[] } | null
  competitors: { key: string; placeId: string | null; title: string }[]
  canManage: boolean
  mapsKey: string | null
  mapId: string | null
  defaults: { gridSize: number; spacingM: number; shape: GridShape }
}

const YOU = '__you__'
const NO_COMPARE = '__none__'

const STATUS_BADGE: Record<ScanStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'secondary' }> = {
  completed: { label: 'Completed', variant: 'success' },
  partial: { label: 'Partial', variant: 'warning' },
  failed: { label: 'Failed', variant: 'danger' },
  queued: { label: 'Queued', variant: 'info' },
  running: { label: 'Running', variant: 'info' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
}

export function RankingsView(p: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [selectedPin, setSelectedPin] = useState<GridPin | null>(null)
  // "View as competitor": rank of the chosen competitor at each point.
  const [viewAs, setViewAs] = useState<{ scanId: string; key: string; ranks: Record<string, number | null> } | null>(null)
  const activeViewAs = viewAs && viewAs.scanId === p.scan?.id ? viewAs : null
  const shownPins = useMemo(
    () => (activeViewAs ? p.pins.map((pin) => (pin.status === 'done' ? { ...pin, rank: activeViewAs.ranks[pin.id] ?? null } : pin)) : p.pins),
    [activeViewAs, p.pins],
  )

  async function chooseViewAs(key: string) {
    if (!p.scan || key === YOU) {
      setViewAs(null)
      return
    }
    const c = p.competitors.find((x) => x.key === key)
    if (!c) return
    const res = await getCompetitorRanks(p.scan.id, { placeId: c.placeId, title: c.title })
    if ('error' in res) return
    setViewAs({ scanId: p.scan.id, key, ranks: res.ranks })
  }
  const keyword = p.keywords.find((k) => k.id === p.keywordId)?.keyword ?? ''
  const open = p.scan && (p.scan.status === 'queued' || p.scan.status === 'running')

  // Live progress while the scan runs: re-render from the server every 4 s.
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(t)
  }, [open, router])

  function navigate(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k)
      else q.set(k, v)
    }
    router.push(`${pathname}?${q.toString()}`)
  }

  if (p.keywords.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">
        Add keywords in <span className="font-medium text-text-primary">Settings</span> to start scanning.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={p.keywordId ?? undefined} onValueChange={(v) => navigate({ keyword: v, scan: null, compare: null })}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Keyword" />
          </SelectTrigger>
          <SelectContent>
            {p.keywords.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.keyword}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {p.scans.length > 0 && (
          <Select value={p.scan?.id} onValueChange={(v) => navigate({ scan: v })}>
            <SelectTrigger className="w-[230px]">
              <SelectValue placeholder="Scan" />
            </SelectTrigger>
            <SelectContent>
              {p.scans.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {new Date(s.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {s.gridSize}×{s.gridSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {p.scan && <Badge variant={STATUS_BADGE[p.scan.status].variant}>{STATUS_BADGE[p.scan.status].label}</Badge>}
        {p.scan && p.scans.length > 1 && (
          <Select value={p.compare?.scan.id ?? NO_COMPARE} onValueChange={(v) => navigate({ compare: v === NO_COMPARE ? null : v })}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COMPARE}>Compare with…</SelectItem>
              {p.scans
                .filter((s) => s.id !== p.scan?.id)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {new Date(s.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} · {s.gridSize}×{s.gridSize}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        {p.scan && !p.compare && p.competitors.length > 0 && (
          <Select value={activeViewAs?.key ?? YOU} onValueChange={chooseViewAs}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={YOU}>View as: this business</SelectItem>
              {p.competitors.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto">
          {p.canManage && (
            <ScanNowDialog locationId={p.locationId} keywords={p.keywords} defaultKeywordId={p.keywordId} defaults={p.defaults} />
          )}
        </div>
      </div>

      {open && p.scan && (
        <div className="flex items-center gap-2 rounded-lg bg-bg-secondary px-3 py-2 text-[13px] text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scanning {p.scan.pointsDone + p.scan.pointsFailed} of {p.scan.pointsTotal} points…
        </div>
      )}
      {p.scan?.error && p.scan.status !== 'completed' && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {p.scan.error}
        </div>
      )}

      {p.scan && p.compare ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[p.compare, { scan: p.scan, pins: p.pins }]
            .sort((a, b) => a.scan.createdAt.localeCompare(b.scan.createdAt))
            .map(({ scan, pins }, i) => (
              <div key={scan.id} className="space-y-2">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium text-text-primary">
                    {i === 0 ? 'Before' : 'After'} · {new Date(scan.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  </span>
                  <span className="tabular-nums text-text-secondary">
                    SoLV {scan.metrics.solv ?? '—'}% · Avg rank {scan.metrics.arp ?? '—'}
                  </span>
                </div>
                <GeoGridMap
                  apiKey={p.mapsKey}
                  mapId={p.mapId}
                  center={p.center}
                  pins={pins}
                  size={scan.gridSize}
                  selectedId={selectedPin?.id}
                  onSelect={setSelectedPin}
                />
              </div>
            ))}
        </div>
      ) : !p.scan ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          No scans for “{keyword}” yet.{p.canManage ? ' Run one with Scan now.' : ''}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <GeoGridMap
            apiKey={p.mapsKey}
            mapId={p.mapId}
            center={p.center}
            pins={shownPins}
            size={p.scan.gridSize}
            selectedId={selectedPin?.id}
            onSelect={setSelectedPin}
          />
          <div className="space-y-3">
            {activeViewAs ? (
              <div className="rounded-xl border border-border-subtle p-5 text-[13px] text-text-secondary">
                Showing where <span className="font-medium text-text-primary">{p.competitors.find((c) => c.key === activeViewAs.key)?.title}</span>{' '}
                ranks at each point of this scan.
              </div>
            ) : (
              <ScanMetrics metrics={p.scan.metrics} previous={p.previous} pins={p.pins} />
            )}
            <p className="px-1 text-[11.5px] leading-relaxed text-text-tertiary">
              Simulated searches from each point at zoom 13, without personalisation. Compare scans with the same grid
              to see real movement.
            </p>
          </div>
        </div>
      )}

      <PointSheet pin={selectedPin} keyword={keyword} onClose={() => setSelectedPin(null)} />
    </div>
  )
}
