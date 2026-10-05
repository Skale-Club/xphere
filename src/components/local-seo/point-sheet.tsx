'use client'

import { useEffect, useState } from 'react'
import { Loader2, Star } from 'lucide-react'

import { getPointDetail, type PointDetail } from '@/app/(dashboard)/local-seo/actions'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { pinColor, pinLabel, type GridPin } from './geogrid-pins'

/** Top 20 businesses at one grid point. */
export function PointSheet({ pin, keyword, onClose }: { pin: GridPin | null; keyword: string; onClose: () => void }) {
  // Results are keyed by pin so a stale answer never shows under a new pin.
  const [loaded, setLoaded] = useState<{ pinId: string; detail?: PointDetail; error?: string } | null>(null)

  useEffect(() => {
    if (!pin) return
    let cancelled = false
    getPointDetail(pin.id).then((res) => {
      if (cancelled) return
      setLoaded('error' in res ? { pinId: pin.id, error: res.error } : { pinId: pin.id, detail: res })
    })
    return () => {
      cancelled = true
    }
  }, [pin])

  const current = loaded && pin && loaded.pinId === pin.id ? loaded : null
  const detail = current?.detail ?? null
  const error = current?.error ?? null

  return (
    <Sheet open={!!pin} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {pin && (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: pinColor(pin) }}
              >
                {pinLabel(pin)}
              </span>
            )}
            “{keyword}” here
          </SheetTitle>
          <SheetDescription>
            {pin ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : null}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {error && <p className="text-sm text-danger">{error}</p>}
          {!detail && !error && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            </div>
          )}
          {detail?.status === 'failed' && (
            <p className="text-sm text-text-secondary">This point could not be fetched: {detail.lastError}</p>
          )}
          {detail && detail.status === 'done' && detail.results.length === 0 && (
            <p className="text-sm text-text-secondary">Google Maps returned no businesses for this search here.</p>
          )}
          {detail && detail.results.length > 0 && (
            <ol className="space-y-1">
              {detail.results.map((r) => (
                <li
                  key={`${r.position}-${r.title}`}
                  className={cn(
                    'flex items-start gap-3 rounded-lg px-3 py-2',
                    r.isTarget ? 'bg-accent/10 ring-1 ring-accent/40' : 'hover:bg-bg-tertiary',
                  )}
                >
                  <span className="w-5 shrink-0 pt-0.5 text-right text-[12px] font-semibold tabular-nums text-text-tertiary">
                    {r.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">{r.title}</div>
                    {(r.category || r.address) && (
                      <div className="truncate text-xs text-text-secondary">{[r.category, r.address].filter(Boolean).join(' · ')}</div>
                    )}
                  </div>
                  {r.rating !== null && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {Number(r.rating).toFixed(1)}
                      {r.reviews !== null && <span className="text-text-tertiary">({r.reviews})</span>}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {detail?.truncated && (
            <p className="mt-3 text-xs text-text-tertiary">Full results are kept for 60 days; only the top 3 remain for older scans.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
