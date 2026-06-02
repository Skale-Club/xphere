'use client'

import type { ComponentType } from 'react'
import { useMemo, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  Grid3x3,
  List,
  MonitorSmartphone,
  SlidersHorizontal,
  Star,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { StarRating } from './star-rating'

type Layout = 'grid' | 'list' | 'carousel'
type Theme = 'light' | 'dark'
type EmbedMode = 'iframe' | 'script'

export type ReviewWidgetPreviewReview = {
  id: string
  reviewerName: string | null
  reviewerPhotoUrl: string | null
  reviewerProfileUrl: string | null
  rating: number
  text: string | null
  dateText: string | null
  isLocalGuide: boolean
  helpfulCount: number
  ownerResponse: string | null
  ownerResponseDate: string | null
  photos: { url: string }[]
}

interface ReviewWidgetBuilderProps {
  baseUrl: string
  widgetToken: string
  embedded?: boolean
  business: {
    name: string | null
    address: string | null
    averageRating: number | null
    totalReviewsCount: number | null
  }
  distribution: { rating: number; count: number }[]
  reviews: ReviewWidgetPreviewReview[]
}

const LAYOUTS: Array<{
  id: Layout
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'grid', label: 'Grid', icon: Grid3x3 },
  { id: 'list', label: 'List', icon: List },
  { id: 'carousel', label: 'Carousel', icon: SlidersHorizontal },
]

function initials(name: string | null): string {
  if (!name) return 'R'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function firstText(text: string | null): string {
  if (!text) return 'No written review.'
  if (text.length <= 220) return text
  return `${text.slice(0, 220).trim()}...`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function iframeHeight(layout: Layout, showHero: boolean): number {
  if (layout === 'carousel') return showHero ? 500 : 360
  if (layout === 'list') return showHero ? 720 : 560
  return showHero ? 760 : 620
}

function buildWidgetUrl({
  baseUrl,
  widgetToken,
  layout,
  minRating,
  theme,
  limit,
  showHero,
}: {
  baseUrl: string
  widgetToken: string
  layout: Layout
  minRating: string
  theme: Theme
  limit: string
  showHero: boolean
}) {
  const params = new URLSearchParams({
    layout,
    min_rating: minRating,
    theme,
    limit,
  })
  if (!showHero) params.set('hero', '0')
  return `${baseUrl}/widget/reviews/${widgetToken}?${params.toString()}`
}

function PreviewCard({
  review,
  theme,
  compact = false,
}: {
  review: ReviewWidgetPreviewReview
  theme: Theme
  compact?: boolean
}) {
  return (
    <article
      className={cn(
        'min-w-0 rounded-[14px] border p-4 shadow-sm',
        theme === 'dark'
          ? 'border-white/10 bg-zinc-900 text-zinc-50 shadow-black/30'
          : 'border-zinc-200 bg-white text-zinc-950 shadow-zinc-200/70',
      )}
    >
      <header className="flex items-start gap-3">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={review.reviewerPhotoUrl ?? undefined} alt={review.reviewerName ?? 'Reviewer'} />
          <AvatarFallback className="bg-amber-100 text-xs font-semibold text-amber-900">
            {initials(review.reviewerName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[13px] font-semibold">
              {review.reviewerName ?? 'Anonymous'}
            </p>
            {review.isLocalGuide ? (
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                  theme === 'dark' ? 'bg-amber-400/15 text-amber-300' : 'bg-amber-100 text-amber-700',
                )}
              >
                Local Guide
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StarRating rating={review.rating} size="sm" />
            {review.dateText ? (
              <span className={cn('text-[11px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                {review.dateText}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <p
        className={cn(
          'mt-3 whitespace-pre-line text-[13px] leading-relaxed',
          theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700',
          compact && 'line-clamp-4',
        )}
      >
        {firstText(review.text)}
      </p>

      {review.photos.length > 0 ? (
        <div className="mt-3 flex gap-1.5 overflow-hidden">
          {review.photos.slice(0, 4).map((photo, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${photo.url}-${index}`}
              src={photo.url}
              alt=""
              className="h-14 w-14 rounded-[8px] object-cover"
              loading="lazy"
            />
          ))}
        </div>
      ) : null}

      {review.ownerResponse ? (
        <div
          className={cn(
            'mt-3 rounded-[10px] border-l-2 border-amber-400 px-3 py-2',
            theme === 'dark' ? 'bg-amber-400/10 text-zinc-200' : 'bg-amber-50 text-zinc-700',
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-600">
            Owner response
          </p>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed">{review.ownerResponse}</p>
        </div>
      ) : null}
    </article>
  )
}

export function ReviewWidgetBuilder({
  baseUrl,
  widgetToken,
  embedded = false,
  business,
  distribution,
  reviews,
}: ReviewWidgetBuilderProps) {
  const [layout, setLayout] = useState<Layout>('grid')
  const [theme, setTheme] = useState<Theme>('light')
  const [minRating, setMinRating] = useState('4')
  const [limit, setLimit] = useState('12')
  const [showHero, setShowHero] = useState(true)
  const [embedMode, setEmbedMode] = useState<EmbedMode>('iframe')
  const [copied, setCopied] = useState(false)

  const visibleReviews = useMemo(() => {
    const min = Number.parseInt(minRating, 10)
    return reviews.filter((review) => review.rating >= min).slice(0, Number.parseInt(limit, 10))
  }, [limit, minRating, reviews])

  const widgetUrl = buildWidgetUrl({
    baseUrl,
    widgetToken,
    layout,
    minRating,
    theme,
    limit,
    showHero,
  })
  const height = iframeHeight(layout, showHero)
  const title = `${business.name ?? 'Google'} reviews`
  const safeTitle = escapeAttribute(title)

  const iframeSnippet = `<iframe
  src="${widgetUrl}"
  width="100%"
  height="${height}"
  frameborder="0"
  style="border:0;border-radius:16px;overflow:hidden;"
  loading="lazy"
  title="${safeTitle}">
</iframe>`

  const scriptSnippet = `<div
  data-operator-reviews
  data-token="${widgetToken}"
  data-layout="${layout}"
  data-theme="${theme}"
  data-min-rating="${minRating}"
  data-limit="${limit}"
  data-hero="${showHero ? '1' : '0'}">
</div>
<script src="${baseUrl}/reviews-widget.js" defer></script>`

  const snippet = embedMode === 'iframe' ? iframeSnippet : scriptSnippet
  const maxDistribution = Math.max(...distribution.map((row) => row.count), 1)

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section
      className={cn(
        'overflow-hidden',
        embedded ? 'rounded-none' : 'rounded-[8px] border border-border bg-bg-secondary',
      )}
    >
      <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
        <aside
          className={cn(
            'border-b border-border-subtle p-5 lg:border-b-0 lg:border-r',
            embedded && 'p-0 pb-5 lg:pb-0 lg:pr-5',
          )}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-bg-tertiary text-accent">
              <MonitorSmartphone className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-text-primary">Website widget</h2>
              <p className="text-[12px] text-text-tertiary">Preview and embed code</p>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Layout
              </Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {LAYOUTS.map((item) => {
                  const Icon = item.icon
                  const active = item.id === layout
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLayout(item.id)}
                      className={cn(
                        'flex h-16 flex-col items-center justify-center gap-1 rounded-[8px] border text-[11px] font-medium transition-colors',
                        active
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-border bg-bg-tertiary/50 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  Min rating
                </Label>
                <Select value={minRating} onValueChange={setMinRating}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1+ stars</SelectItem>
                    <SelectItem value="2">2+ stars</SelectItem>
                    <SelectItem value="3">3+ stars</SelectItem>
                    <SelectItem value="4">4+ stars</SelectItem>
                    <SelectItem value="5">5 stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  Limit
                </Label>
                <Select value={limit} onValueChange={setLimit}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 reviews</SelectItem>
                    <SelectItem value="9">9 reviews</SelectItem>
                    <SelectItem value="12">12 reviews</SelectItem>
                    <SelectItem value="18">18 reviews</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-[8px] border border-border bg-bg-tertiary/50 px-3 py-2">
              <Label htmlFor="reviews-widget-hero" className="text-[12px] font-medium text-text-secondary">
                Summary header
              </Label>
              <Switch id="reviews-widget-hero" checked={showHero} onCheckedChange={setShowHero} />
            </div>

            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Theme
              </Label>
              <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-[8px] border border-border bg-bg-tertiary/50 p-1">
                {(['light', 'dark'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTheme(item)}
                    className={cn(
                      'rounded-[6px] px-3 py-1.5 text-[12px] font-medium capitalize transition-colors',
                      theme === item ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  Embed
                </Label>
                <div className="flex overflow-hidden rounded-[7px] border border-border bg-bg-tertiary/50 p-1">
                  {(['iframe', 'script'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setEmbedMode(item)}
                      className={cn(
                        'rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors',
                        embedMode === item ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary',
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative rounded-[10px] border border-border bg-zinc-950 text-zinc-100">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={copySnippet}
                  className="absolute right-2 top-2 h-7 gap-1 text-[11.5px]"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <pre className="max-h-72 overflow-auto p-4 pr-20 font-mono text-[11px] leading-relaxed">
                  <code>{snippet}</code>
                </pre>
              </div>
            </div>
          </div>
        </aside>

        <div className={cn('min-w-0 p-5', embedded && 'p-0 pt-5 lg:pl-5 lg:pt-0')}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-text-tertiary" />
              <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Live preview
              </p>
            </div>
            <p className="text-[11px] text-text-tertiary">
              {visibleReviews.length} of {reviews.length}
            </p>
          </div>

          <div
            className={cn(
              'max-h-[760px] overflow-auto rounded-[16px] border p-4',
              theme === 'dark'
                ? 'border-zinc-800 bg-zinc-950'
                : 'border-zinc-200 bg-[#fafaf7]',
            )}
          >
            {showHero ? (
              <section
                className={cn(
                  'mb-4 rounded-[16px] border p-5',
                  theme === 'dark'
                    ? 'border-white/10 bg-gradient-to-br from-amber-400/15 to-zinc-900 text-zinc-50'
                    : 'border-amber-200 bg-gradient-to-br from-amber-100 to-white text-zinc-950',
                )}
              >
                <div className="grid gap-5 md:grid-cols-[1fr_220px] md:items-center">
                  <div>
                    <p className="text-[14px] font-semibold">{business.name ?? 'Google reviews'}</p>
                    {business.address ? (
                      <p className={cn('mt-0.5 text-[12px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                        {business.address}
                      </p>
                    ) : null}
                    <div className="mt-4 flex items-baseline gap-3">
                      <span className="text-5xl font-semibold leading-none tracking-tight tabular-nums">
                        {(business.averageRating ?? 0).toFixed(1)}
                      </span>
                      <div>
                        <StarRating rating={business.averageRating ?? 0} size="md" />
                        <p className={cn('mt-1 text-[12px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                          {business.totalReviewsCount ?? reviews.length} reviews
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {distribution.map((row) => (
                      <div key={row.rating} className="flex items-center gap-2">
                        <span className={cn('flex w-8 items-center gap-1 text-[11px]', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                          {row.rating}
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        </span>
                        <div className={cn('h-2 flex-1 overflow-hidden rounded-full', theme === 'dark' ? 'bg-white/10' : 'bg-zinc-200')}>
                          <div
                            className="h-full rounded-full bg-amber-400"
                            style={{ width: `${Math.round((row.count / maxDistribution) * 100)}%` }}
                          />
                        </div>
                        <span className={cn('w-7 text-right text-[11px] tabular-nums', theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500')}>
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {visibleReviews.length === 0 ? (
              <div
                className={cn(
                  'rounded-[14px] border border-dashed p-10 text-center text-sm',
                  theme === 'dark' ? 'border-white/10 text-zinc-400' : 'border-zinc-300 text-zinc-500',
                )}
              >
                No reviews match this widget setup.
              </div>
            ) : layout === 'list' ? (
              <div className="space-y-3">
                {visibleReviews.map((review) => (
                  <PreviewCard key={review.id} review={review} theme={theme} />
                ))}
              </div>
            ) : layout === 'carousel' ? (
              <div className="overflow-x-auto pb-2">
                <div className="grid auto-cols-[minmax(280px,70%)] grid-flow-col gap-3">
                  {visibleReviews.map((review) => (
                    <PreviewCard key={review.id} review={review} theme={theme} compact />
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleReviews.map((review) => (
                  <PreviewCard key={review.id} review={review} theme={theme} compact />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
