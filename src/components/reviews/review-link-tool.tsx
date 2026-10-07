'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { ClipboardPaste, Copy, ExternalLink, Loader2, MapPin, Share2, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { generateReviewLink } from '@/app/(dashboard)/seo/reviews/review-link/actions'
import type { ReviewLinkPlace, ReviewLinkResult } from '@/lib/reviews/review-link'
import { extractUrl } from '@/lib/reviews/review-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { StarRating } from './star-rating'

const RECENT_KEY = 'xphere:review-link:recent'
const MAX_RECENT = 8

type RecentLink = { title: string | null; reviewUrl: string; at: number }

// Recent links live in localStorage (per browser, a convenience only), read
// through useSyncExternalStore so the server render and hydration agree.
const recentListeners = new Set<() => void>()

function subscribeRecent(listener: () => void) {
  recentListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    recentListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function readRecentRaw(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? ''
  } catch {
    return ''
  }
}

function parseRecent(raw: string): RecentLink[] {
  try {
    const parsed = raw ? (JSON.parse(raw) as RecentLink[]) : []
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function saveRecent(list: RecentLink[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
  } catch {
    // private mode / storage blocked: recent links are a convenience only
  }
  recentListeners.forEach((listener) => listener())
}

const noopSubscribe = () => () => {}

/** Best-effort "near me" for name searches; never blocks the search for long. */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6_000, maximumAge: 10 * 60_000 },
    )
  })
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success('Link copied')
  } catch {
    toast.error('Could not copy. Long-press the link to copy it.')
  }
}

export function ReviewLinkTool({ initialText }: { initialText: string }) {
  const [text, setText] = useState(initialText)
  const [result, setResult] = useState<ReviewLinkResult | null>(null)
  const [selected, setSelected] = useState<ReviewLinkPlace | null>(null)
  const recentRaw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => '')
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw])
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === 'function',
    () => false,
  )
  const [pending, startTransition] = useTransition()
  const autoRan = useRef(false)

  const remember = useCallback((place: ReviewLinkPlace) => {
    const prev = parseRecent(readRecentRaw())
    saveRecent([
      { title: place.title, reviewUrl: place.reviewUrl, at: Date.now() },
      ...prev.filter((r) => r.reviewUrl !== place.reviewUrl),
    ])
  }, [])

  const pick = useCallback(
    (place: ReviewLinkPlace) => {
      setSelected(place)
      remember(place)
    },
    [remember],
  )

  const run = useCallback(
    (value: string) => {
      const input = value.trim()
      if (!input) return
      setSelected(null)
      startTransition(async () => {
        // Only name searches use the location; a Maps link already names the place.
        const near = extractUrl(input) ? null : await currentPosition()
        const res = await generateReviewLink({ text: input, near })
        setResult(res)
        if (res.kind === 'place') pick(res.place)
        if (res.kind === 'error') toast.error(res.error)
      })
    },
    [pick],
  )

  // Opened from the share sheet: generate straight away.
  useEffect(() => {
    if (autoRan.current || !initialText) return
    const timer = window.setTimeout(() => {
      autoRan.current = true
      run(initialText)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialText, run])

  async function handlePaste() {
    try {
      const value = await navigator.clipboard.readText()
      if (!value.trim()) {
        toast.info('Clipboard is empty.')
        return
      }
      setText(value)
      run(value)
    } catch {
      toast.error('Clipboard access was blocked. Paste into the box instead.')
    }
  }

  async function handleShare(place: ReviewLinkPlace) {
    try {
      await navigator.share({
        title: place.title ? `Review ${place.title}` : 'Leave us a review',
        url: place.reviewUrl,
      })
    } catch {
      // user dismissed the share sheet
    }
  }

  function clearRecent() {
    saveRecent([])
  }

  const candidates = result?.kind === 'candidates' ? result.candidates : []

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Review link</h1>
        <p className="text-sm text-muted-foreground">Google Business → link for customers to leave a review</p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(text)
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a Google Maps link (Share → Copy link) or type the business name"
          className="min-h-24 text-base"
          aria-label="Google Maps link or business name"
        />
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Button type="button" variant="secondary" size="lg" onClick={handlePaste} disabled={pending}>
            <ClipboardPaste className="mr-2 h-4 w-4" />
            Paste
          </Button>
          <Button type="submit" size="lg" disabled={pending || !text.trim()}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Star className="mr-2 h-4 w-4" />}
            Generate link
          </Button>
        </div>
      </form>

      {selected ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="min-w-0">
              <p className="truncate font-medium">{selected.title ?? 'Business'}</p>
              {selected.address ? <p className="truncate text-xs text-muted-foreground">{selected.address}</p> : null}
              {selected.rating ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <StarRating rating={selected.rating} size="sm" />
                  <span className="tabular-nums">{selected.rating.toFixed(1)}</span>
                  {selected.reviews ? <span className="opacity-60">({selected.reviews})</span> : null}
                </p>
              ) : null}
            </div>
            <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">{selected.reviewUrl}</p>
            {selected.placeId ? null : (
              <p className="text-xs text-muted-foreground">
                No Place ID could be resolved, so this link opens the review box through Google Search. It works,
                but the Maps-native link is more reliable: try again with a business name search.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" onClick={() => copyText(selected.reviewUrl)}>
                <Copy className="mr-1.5 h-4 w-4" />
                Copy
              </Button>
              <Button type="button" variant="secondary" onClick={() => handleShare(selected)} disabled={!canShare}>
                <Share2 className="mr-1.5 h-4 w-4" />
                Share
              </Button>
              <Button type="button" variant="secondary" asChild>
                <a href={selected.reviewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Open
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {candidates.length > 0 && !selected ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pick the business</p>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {candidates.map((place) => (
              <li key={place.reviewUrl}>
                <button
                  type="button"
                  onClick={() => pick(place)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{place.title}</span>
                    {place.address ? (
                      <span className="block truncate text-xs text-muted-foreground">{place.address}</span>
                    ) : null}
                  </span>
                  {place.rating ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      ★ {place.rating.toFixed(1)}
                      {place.reviews ? ` (${place.reviews})` : ''}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent</p>
            <Button type="button" variant="ghost" size="sm" onClick={clearRecent} className="h-7 px-2 text-xs">
              <Trash2 className="mr-1 h-3 w-3" />
              Clear
            </Button>
          </div>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {recent.map((r) => (
              <li key={r.reviewUrl} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{r.title ?? r.reviewUrl}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => copyText(r.reviewUrl)}
                  aria-label={`Copy review link for ${r.title ?? 'business'}`}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm">
        <p className="font-medium">Getting the link on your phone</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Open the business in the Google Maps app.</li>
          <li>
            Tap <span className="font-medium text-foreground">Share</span> →{' '}
            <span className="font-medium text-foreground">Copy link</span>.
          </li>
          <li>
            Come back here and tap <span className="font-medium text-foreground">Paste</span>.
          </li>
        </ol>
        <p className="text-muted-foreground">Or just type the business name: the search uses your location.</p>
        <p className="text-xs text-muted-foreground">
          Tip: install this app on your phone, then in Google Maps share the business straight to it.
        </p>
      </div>
    </div>
  )
}
