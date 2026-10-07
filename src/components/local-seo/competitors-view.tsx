'use client'

import { useMemo, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Pin, PinOff, Star } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'

import { togglePinnedCompetitor } from '@/app/(dashboard)/seo/local/actions'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePathname } from '@/lib/org/navigation'
import { cn } from '@/lib/utils'

export type CompetitorRow = {
  key: string
  placeId: string | null
  title: string
  isTarget: boolean
  appearances: number
  avgRank: number | null
  solv: number | null
  rating: number | null
  reviews: number | null
  category: string | null
}

export type SolvHistoryPoint = { key: string; title: string; at: string; solv: number }

const SERIES = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

export function CompetitorsView({
  locationId,
  keywords,
  keywordId,
  scannedAt,
  pointsTotal,
  rows,
  pinned,
  history,
  canManage,
}: {
  locationId: string
  keywords: { id: string; keyword: string }[]
  keywordId: string | null
  scannedAt: string | null
  pointsTotal: number
  rows: CompetitorRow[]
  pinned: string[]
  history: SolvHistoryPoint[]
  canManage: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [busy, start] = useTransition()

  const series = useMemo(() => {
    const keys = [...new Set(history.map((h) => h.key))]
    const titles = new Map(history.map((h) => [h.key, h.title]))
    const byDay = new Map<string, Record<string, number | string>>()
    for (const h of [...history].sort((a, b) => a.at.localeCompare(b.at))) {
      const d = h.at.slice(0, 10)
      const row = byDay.get(d) ?? { day: d }
      row[titles.get(h.key) ?? h.key] = h.solv
      byDay.set(d, row)
    }
    return { names: keys.map((k) => titles.get(k) ?? k), data: [...byDay.values()] }
  }, [history])

  function pin(row: CompetitorRow) {
    start(async () => {
      const res = await togglePinnedCompetitor(locationId, { key: row.key, placeId: row.placeId, title: row.title })
      if ('error' in res) toast.error(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={keywordId ?? undefined}
          onValueChange={(v) => {
            const q = new URLSearchParams(params.toString())
            q.set('keyword', v)
            router.push(`${pathname}?${q.toString()}`)
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Keyword" />
          </SelectTrigger>
          <SelectContent>
            {keywords.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.keyword}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scannedAt && (
          <span className="text-[12px] text-text-tertiary">
            Latest scan {new Date(scannedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {pointsTotal} points
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          Competitors show up after a finished scan for this keyword.
        </div>
      ) : (
        <>
          {series.data.length > 1 && series.names.length > 0 && (
            <div className="h-[280px] rounded-xl border border-border-subtle p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #e5e7eb)" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {series.names.map((n, i) => (
                    <Line key={n} type="monotone" dataKey={n} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead className="text-right" title="Share of local voice: % of grid points in the top 3">SoLV</TableHead>
                  <TableHead className="text-right">Avg rank</TableHead>
                  <TableHead className="text-right" title="Grid points where it appears in the top 20">Seen</TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                  {canManage && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const isPinned = pinned.includes(r.key)
                  return (
                    <TableRow key={r.key} className={cn(r.isTarget && 'bg-accent/5')}>
                      <TableCell className="tabular-nums text-text-tertiary">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary">{r.title}</span>
                          {r.isTarget && <Badge variant="primary">You</Badge>}
                          {isPinned && <Pin className="h-3 w-3 text-accent" />}
                        </div>
                        {r.category && <div className="text-xs text-text-tertiary">{r.category}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.solv !== null ? `${r.solv}%` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.avgRank ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.appearances}/{pointsTotal}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.rating !== null ? (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {Number(r.rating).toFixed(1)}
                            {r.reviews !== null && <span className="text-text-tertiary">({r.reviews})</span>}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          {!r.isTarget && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => pin(r)}
                              className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                              aria-label={isPinned ? `Unpin ${r.title}` : `Pin ${r.title}`}
                              title={isPinned ? 'Stop following' : 'Follow this competitor over time'}
                            >
                              {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                            </button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
