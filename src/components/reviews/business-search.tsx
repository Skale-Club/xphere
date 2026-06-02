'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, MapPin, Search } from 'lucide-react'
import { toast } from 'sonner'

import { searchBusinesses, selectPlaceId } from '@/app/(dashboard)/integrations/google-reviews/actions'
import type { SerpApiMapsSearchPlace } from '@/lib/serpapi/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StarRating } from './star-rating'

interface BusinessSearchProps {
  hasApiKey: boolean
  currentPlaceId: string | null
  /** Called after a business is successfully selected (used by the setup wizard). */
  onSelected?: () => void
}

export function BusinessSearch({ hasApiKey, currentPlaceId, onSelected }: BusinessSearchProps) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [results, setResults] = useState<SerpApiMapsSearchPlace[]>([])
  const [searchPending, startSearch] = useTransition()
  const [selectPending, startSelect] = useTransition()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    startSearch(async () => {
      const res = await searchBusinesses({ query, location: location || undefined })
      if (res.error) {
        toast.error(res.error)
        setResults([])
        return
      }
      setResults(res.results ?? [])
      if ((res.results ?? []).length === 0) toast.info('No results found.')
    })
  }

  function handleSelect(place: SerpApiMapsSearchPlace) {
    if (!place.place_id) {
      toast.error('This result has no Place ID.')
      return
    }
    setSelectedId(place.place_id)
    startSelect(async () => {
      const res = await selectPlaceId({
        placeId: place.place_id!,
        businessName: place.title ?? 'Unknown business',
        address: place.address,
      })
      if (res.error) {
        toast.error(res.error)
        setSelectedId(null)
        return
      }
      toast.success(`${place.title} selected. Click "Refresh now" to fetch reviews.`)
      onSelected?.()
    })
  }

  if (!hasApiKey) {
    return (
      <p className="rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Save your SerpAPI key above first.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <div className="space-y-1.5">
            <Label htmlFor="biz-query" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Business name
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="biz-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "Skale Club São Paulo"'
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-loc" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              City (optional)
            </Label>
            <Input id="biz-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="São Paulo, Brazil" />
          </div>
        </div>
        <Button type="submit" size="sm" disabled={searchPending || query.trim().length < 2}>
          {searchPending ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Searching…
            </>
          ) : (
            'Search Google Maps'
          )}
        </Button>
      </form>

      {results.length > 0 ? (
        <ul className="divide-y rounded-lg border bg-card">
          {results.map((place) => {
            const isCurrent = place.place_id === currentPlaceId
            const isSelected = place.place_id === selectedId
            return (
              <li
                key={place.place_id ?? place.title}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="mt-0.5 rounded-full bg-amber-100 p-1.5 dark:bg-amber-900/40">
                  <MapPin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{place.title}</p>
                    {place.rating ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <StarRating rating={place.rating} size="sm" />
                        <span className="tabular-nums">{place.rating.toFixed(1)}</span>
                        {place.reviews ? <span className="opacity-60">({place.reviews})</span> : null}
                      </span>
                    ) : null}
                  </div>
                  {place.address ? (
                    <p className="truncate text-xs text-muted-foreground">{place.address}</p>
                  ) : null}
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                    {place.place_id}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={isCurrent ? 'secondary' : 'default'}
                  onClick={() => handleSelect(place)}
                  disabled={selectPending || isCurrent}
                >
                  {isCurrent ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Connected
                    </>
                  ) : isSelected && selectPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Select'
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
