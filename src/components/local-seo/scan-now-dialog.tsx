'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Radar } from 'lucide-react'
import { toast } from 'sonner'

import { estimateScans, runScans, type ScanEstimateView } from '@/app/(dashboard)/local-seo/actions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GRID_SIZES, type GridShape } from '@/lib/local-seo/types'

const SPACINGS = [250, 500, 1000, 1500, 2000, 3000, 5000]

export function ScanNowDialog({
  locationId,
  keywords,
  defaultKeywordId,
  defaults,
}: {
  locationId: string
  keywords: { id: string; keyword: string }[]
  defaultKeywordId: string | null
  defaults: { gridSize: number; spacingM: number; shape: GridShape }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(defaultKeywordId ? [defaultKeywordId] : [])
  const [gridSize, setGridSize] = useState(defaults.gridSize)
  const [spacingM, setSpacingM] = useState(defaults.spacingM)
  const [shape, setShape] = useState<GridShape>(defaults.shape)
  const inputsKey = JSON.stringify([selected, gridSize, spacingM, shape])
  const [estimated, setEstimated] = useState<{ key: string; estimate?: ScanEstimateView; error?: string } | null>(null)
  const [estimating, startEstimate] = useTransition()
  const [running, startRun] = useTransition()

  useEffect(() => {
    if (!open || selected.length === 0) return
    startEstimate(async () => {
      const res = await estimateScans({ locationId, keywordIds: selected, gridSize, spacingM, shape })
      setEstimated('error' in res ? { key: inputsKey, error: res.error } : { key: inputsKey, estimate: res.estimate })
    })
  }, [open, selected, gridSize, spacingM, shape, locationId, inputsKey])

  // Only show an estimate that matches the current inputs.
  const fresh = open && selected.length > 0 && estimated?.key === inputsKey ? estimated : null
  const estimate = fresh?.estimate ?? null
  const estimateError = fresh?.error ?? null

  const overQuota = estimate ? estimate.billable && estimate.totalPoints > estimate.quota.remaining : false

  function run() {
    startRun(async () => {
      const res = await runScans({ locationId, keywordIds: selected, gridSize, spacingM, shape })
      if ('error' in res && !('scanIds' in res)) {
        toast.error(res.error)
        return
      }
      if ('scanIds' in res) {
        toast.success(res.scanIds.length === 1 ? 'Scan started' : `${res.scanIds.length} scans started`)
        if (res.error) toast.warning(res.error)
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={keywords.length === 0}>
          <Radar className="h-4 w-4" />
          Scan now
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run a geogrid scan</DialogTitle>
          <DialogDescription>Each grid point is one search on Google Maps and uses one point of your monthly quota.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Keywords</Label>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border-subtle p-2">
              {keywords.map((k) => (
                <label key={k.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(k.id)}
                    onCheckedChange={(v) =>
                      setSelected((cur) => (v ? [...cur, k.id] : cur.filter((id) => id !== k.id)))
                    }
                  />
                  {k.keyword}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Grid</Label>
              <Select value={String(gridSize)} onValueChange={(v) => setGridSize(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s} × {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Spacing</Label>
              <Select value={String(spacingM)} onValueChange={(v) => setSpacingM(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...SPACINGS, spacingM])].sort((a, b) => a - b).map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s >= 1000 ? `${s / 1000} km` : `${s} m`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Shape</Label>
              <Select value={shape} onValueChange={(v) => setShape(v as GridShape)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">Square</SelectItem>
                  <SelectItem value="circle">Circle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg bg-bg-secondary px-3 py-2.5 text-[13px]">
            {estimating && !estimate ? (
              <span className="flex items-center gap-2 text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Estimating…
              </span>
            ) : estimateError ? (
              <span className="text-danger">{estimateError}</span>
            ) : estimate ? (
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Points</span>
                  <span className="font-medium tabular-nums">
                    {estimate.scans} × {estimate.points} = {estimate.totalPoints}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Left this month</span>
                  <span className={overQuota ? 'font-medium text-danger' : 'font-medium tabular-nums'}>
                    {estimate.billable ? `${estimate.quota.remaining} of ${estimate.quota.limit}` : 'Not counted'}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-text-secondary">Pick at least one keyword.</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={run} loading={running} disabled={!estimate || overQuota || selected.length === 0}>
            Start scan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
