'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, Trash2 } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'

import { acknowledgeAlert, addAnnotation, deleteAnnotation } from '@/app/(dashboard)/seo/local/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Metric = 'solv' | 'arp' | 'atrp' | 'found_pct'

export type TrendPoint = { scanId: string; keywordId: string | null; keyword: string; at: string } & Record<Metric, number | null>
export type Annotation = { id: string; occurredAt: string; title: string; kind: string }
export type AlertItem = { id: string; keyword: string; metricLabel: string; previous: number | null; current: number | null; delta: number; isWorse: boolean; createdAt: string }

const METRICS: { key: Metric; label: string; reversed: boolean; unit: string }[] = [
  { key: 'solv', label: 'SoLV', reversed: false, unit: '%' },
  { key: 'arp', label: 'Average rank', reversed: true, unit: '' },
  { key: 'atrp', label: 'ATRP', reversed: true, unit: '' },
  { key: 'found_pct', label: 'Found', reversed: false, unit: '%' },
]

// Categorical series colours, distinguishable in light and dark themes.
const SERIES = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

const day = (iso: string) => iso.slice(0, 10)

export function TrendsView({
  locationId,
  points,
  annotations,
  alerts,
  canManage,
}: {
  locationId: string
  points: TrendPoint[]
  annotations: Annotation[]
  alerts: AlertItem[]
  canManage: boolean
}) {
  const router = useRouter()
  const [metric, setMetric] = useState<Metric>('solv')
  const [busy, start] = useTransition()
  const meta = METRICS.find((m) => m.key === metric)!

  const keywords = useMemo(() => [...new Set(points.map((p) => p.keyword))], [points])
  // One row per day, one column per keyword (latest scan of that day wins).
  const data = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string | null>>()
    for (const p of [...points].sort((a, b) => a.at.localeCompare(b.at))) {
      const row = byDay.get(day(p.at)) ?? { day: day(p.at) }
      row[p.keyword] = p[metric]
      byDay.set(day(p.at), row)
    }
    return [...byDay.values()]
  }, [points, metric])

  function ack(id: string) {
    start(async () => {
      const res = await acknowledgeAlert(id)
      if ('error' in res) toast.error(res.error)
      else router.refresh()
    })
  }

  function removeNote(id: string) {
    start(async () => {
      const res = await deleteAnnotation(id, locationId)
      if ('error' in res) toast.error(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h3 className="text-sm font-semibold text-text-primary">Open alerts</h3>
          {alerts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="text-text-secondary">
                <span className="font-medium text-text-primary">{a.keyword}</span> · {a.metricLabel} went from {a.previous ?? '—'} to{' '}
                {a.current ?? '—'}{' '}
                <span className={a.isWorse ? 'text-danger' : 'text-success'}>({a.delta > 0 ? '+' : ''}{a.delta})</span>
                <span className="ml-2 text-text-tertiary">{new Date(a.createdAt).toLocaleDateString()}</span>
              </span>
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => ack(a.id)} disabled={busy}>
                  <Check className="h-4 w-4" />
                  Dismiss
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRICS.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">{canManage && <AddAnnotationDialog locationId={locationId} />}</div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          Trends appear after the first finished scan. Schedule scans in Settings to build history.
        </div>
      ) : (
        <div className="h-[360px] rounded-xl border border-border-subtle p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #e5e7eb)" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                reversed={meta.reversed}
                domain={meta.unit === '%' ? [0, 100] : [1, 'auto']}
                unit={meta.unit}
              />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {annotations.map((a) => (
                <ReferenceLine
                  key={a.id}
                  x={day(a.occurredAt)}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{ value: a.title, position: 'insideTopLeft', fontSize: 10, fill: '#64748b' }}
                />
              ))}
              {keywords.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={SERIES[i % SERIES.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {annotations.length > 0 && (
        <div className="rounded-xl border border-border-subtle p-4">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Annotations</h3>
          <ul className="space-y-1 text-[13px]">
            {annotations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="text-text-tertiary">{new Date(a.occurredAt).toLocaleDateString()}</span>{' '}
                  <span className="text-text-primary">{a.title}</span>
                  {a.kind !== 'manual' && <span className="ml-2 text-xs text-text-tertiary">{a.kind.replace('_', ' ')}</span>}
                </span>
                {canManage && a.kind === 'manual' && (
                  <button
                    type="button"
                    onClick={() => removeNote(a.id)}
                    className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                    aria-label="Delete annotation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AddAnnotationDialog({ locationId }: { locationId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, start] = useTransition()

  function save() {
    start(async () => {
      const res = await addAnnotation(locationId, { title, occurredAt: date })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setOpen(false)
      setTitle('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus className="h-4 w-4" />
          Annotation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add an annotation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">What changed</Label>
            <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Updated GBP categories" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-date">Date</Label>
            <Input id="ann-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} loading={saving} disabled={!title.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
