'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, MapPin, Star } from 'lucide-react'

import { getPointDetail, type PointDetail } from '@/app/(dashboard)/seo/local/actions'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { pinColor, pinLabel, pinTitle, type GridPin } from './geogrid-pins'

/** Top 20 businesses at one grid point, in a popup over the map. */
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
  const mapsUrl = pin
    ? `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${pin.lat},${pin.lng},14z`
    : undefined

  return (
    <Dialog open={!!pin} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[min(640px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogHeader className="shrink-0 border-b border-border-subtle px-5 py-4">
          <div className="flex items-center gap-3 pr-8">
            {pin && (
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white shadow-sm"
                style={{ background: pinColor(pin) }}
              >
                {pinLabel(pin)}
              </span>
            )}
            <div className="min-w-0 space-y-1">
              <DialogTitle className="truncate text-[15px]">“{keyword}”</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                {pin && <span className="font-medium text-text-secondary">{pinTitle(pin)}</span>}
                {pin && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-text-tertiary hover:text-text-primary"
                  >
                    <MapPin className="h-3 w-3" />
                    {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error && <p className="px-2 py-6 text-center text-sm text-danger">{error}</p>}
          {!detail && !error && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            </div>
          )}
          {detail?.status === 'failed' && (
            <p className="px-2 py-6 text-center text-sm text-text-secondary">This point could not be fetched: {detail.lastError}</p>
          )}
          {detail && detail.status === 'done' && detail.results.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-text-secondary">Google Maps returned no businesses for this search here.</p>
          )}
          {detail && detail.results.length > 0 && (
            <ol className="space-y-0.5">
              {detail.results.map((r) => (
                <li
                  key={`${r.position}-${r.title}`}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2.5 py-2',
                    r.isTarget ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : 'hover:bg-bg-tertiary/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      r.position <= 3 ? 'bg-success/15 text-success' : 'bg-bg-tertiary text-text-tertiary',
                    )}
                  >
                    {r.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">{r.title}</span>
                      {r.isTarget && (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white">You</span>
                      )}
                    </div>
                    {(r.category || r.address) && (
                      <div className="truncate text-[12px] text-text-tertiary">{[r.category, r.address].filter(Boolean).join(' · ')}</div>
                    )}
                  </div>
                  {r.rating !== null && (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-text-secondary">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {Number(r.rating).toFixed(1)}
                      {r.reviews !== null && <span className="text-text-tertiary">({r.reviews})</span>}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {detail && (detail.truncated || (detail.status === 'done' && detail.rank === null && detail.results.length > 0)) && (
          <div className="shrink-0 border-t border-border-subtle bg-bg-secondary/40 px-5 py-3 text-[12px] text-text-tertiary">
            {detail.rank === null && detail.status === 'done' && detail.results.length > 0 && (
              <p>Your business is not among these results at this point.</p>
            )}
            {detail.truncated && <p>Full results are kept for 60 days; only the top 3 remain for older scans.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
