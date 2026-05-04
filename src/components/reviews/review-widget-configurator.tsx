'use client'

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Database } from '@/types/database'

type Layout = 'carousel' | 'grid' | 'list' | 'compact'
type Theme = 'light' | 'dark'

type ReviewWidgetConfig = {
  layout: Layout
  theme: Theme
  primaryColor: string
  starColor: string
  showPhoto: boolean
  showDate: boolean
  showGoogleButton: boolean
  borderRadius: number
  maxWidth: number
}

type ReviewRow = Database['public']['Tables']['google_reviews']['Row']

interface ReviewWidgetConfiguratorProps {
  locationId: string
  locationName: string
  reviewToken: string
  mapsUrl: string | null
  reviews: ReviewRow[]
}

const DEFAULT_CONFIG: ReviewWidgetConfig = {
  layout: 'grid',
  theme: 'light',
  primaryColor: '#18181B',
  starColor: '#F59E0B',
  showPhoto: true,
  showDate: true,
  showGoogleButton: true,
  borderRadius: 18,
  maxWidth: 960,
}

export function ReviewWidgetConfigurator({
  locationId,
  locationName,
  reviewToken,
  mapsUrl,
  reviews,
}: ReviewWidgetConfiguratorProps) {
  const [config, setConfig] = useState<ReviewWidgetConfig>(DEFAULT_CONFIG)

  const sortedReviews = useMemo(
    () => [...reviews].sort((a, b) => a.display_order - b.display_order),
    [reviews]
  )

  const embedCode = useMemo(() => {
    return [
      '<script',
      '  src="https://operator.skale.club/reviews-widget.js"',
      `  data-token="${reviewToken}"`,
      `  data-layout="${config.layout}"`,
      `  data-theme="${config.theme}"`,
      `  data-primary-color="${config.primaryColor}"`,
      `  data-star-color="${config.starColor}"`,
      `  data-show-photo="${String(config.showPhoto)}"`,
      `  data-show-date="${String(config.showDate)}"`,
      `  data-show-google-button="${String(config.showGoogleButton)}"`,
      `  data-border-radius="${config.borderRadius}"`,
      `  data-max-width="${config.maxWidth}"`,
      '  async',
      '></script>',
    ].join('\n')
  }, [config, reviewToken])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(embedCode)
      toast.success('Review widget snippet copied.')
    } catch {
      toast.error('Failed to copy snippet.')
    }
  }

  return (
    <Card id={`review-widget-${locationId}`}>
      <CardHeader>
        <CardTitle>Embed widget</CardTitle>
        <CardDescription>
          Configure the public reviews widget for {locationName} and copy a ready-to-paste script tag.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Layout">
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={config.layout}
                  onChange={(event) => updateConfig(setConfig, 'layout', event.target.value as Layout)}
                >
                  <option value="carousel">Carousel</option>
                  <option value="grid">Grid</option>
                  <option value="list">List</option>
                  <option value="compact">Compact</option>
                </select>
              </Field>

              <Field label="Theme">
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={config.theme}
                  onChange={(event) => updateConfig(setConfig, 'theme', event.target.value as Theme)}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </Field>

              <ColorField
                label="Primary color"
                value={config.primaryColor}
                onChange={(value) => updateConfig(setConfig, 'primaryColor', value)}
              />

              <ColorField
                label="Star color"
                value={config.starColor}
                onChange={(value) => updateConfig(setConfig, 'starColor', value)}
              />

              <RangeField
                label="Border radius"
                value={config.borderRadius}
                min={8}
                max={40}
                onChange={(value) => updateConfig(setConfig, 'borderRadius', value)}
              />

              <RangeField
                label="Max width"
                value={config.maxWidth}
                min={320}
                max={1280}
                step={20}
                onChange={(value) => updateConfig(setConfig, 'maxWidth', value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <ToggleField
                label="Show photo"
                checked={config.showPhoto}
                onCheckedChange={(checked) => updateConfig(setConfig, 'showPhoto', checked)}
              />
              <ToggleField
                label="Show date"
                checked={config.showDate}
                onCheckedChange={(checked) => updateConfig(setConfig, 'showDate', checked)}
              />
              <ToggleField
                label="Google button"
                checked={config.showGoogleButton}
                onCheckedChange={(checked) => updateConfig(setConfig, 'showGoogleButton', checked)}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Install snippet</p>
                  <p className="text-xs text-muted-foreground">
                    Appearance is encoded directly in the `data-*` attributes. Nothing is stored in the database.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy snippet
                </Button>
              </div>

              <Textarea readOnly value={embedCode} rows={12} className="font-mono text-xs" />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">Local preview</p>
              <p className="text-xs text-muted-foreground">
                Uses the reviews already cached for this location. Public URL token: {reviewToken}
              </p>
            </div>
            <ReviewWidgetPreview
              locationName={locationName}
              mapsUrl={mapsUrl}
              reviews={sortedReviews}
              config={config}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <div className="flex gap-3">
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="#18181B" />
        <Input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-14 p-1" />
      </div>
    </Field>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={`${label} (${value})`}>
      <Input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-3">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function ReviewWidgetPreview({
  locationName,
  mapsUrl,
  reviews,
  config,
}: {
  locationName: string
  mapsUrl: string | null
  reviews: ReviewRow[]
  config: ReviewWidgetConfig
}) {
  const containerClassName =
    config.layout === 'grid'
      ? 'grid gap-3 md:grid-cols-2'
      : config.layout === 'carousel'
        ? 'flex gap-3 overflow-x-auto pb-1'
        : 'grid gap-3'

  return (
    <div
      className="overflow-hidden border shadow-sm"
      style={{
        borderRadius: config.borderRadius + 8,
        maxWidth: config.maxWidth,
        background: config.theme === 'dark'
          ? 'linear-gradient(180deg, #171717 0%, #222222 100%)'
          : 'linear-gradient(180deg, #fff7ed 0%, #fffdfa 100%)',
      }}
    >
      <div className="flex items-end justify-between gap-3 px-5 py-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Google reviews</p>
          <h3
            className="mt-1 text-xl font-semibold"
            style={{ color: config.primaryColor }}
          >
            What customers say about {locationName}
          </h3>
        </div>
        {config.layout === 'carousel' ? (
          <div className="flex gap-2 text-muted-foreground">
            <span className="rounded-full border px-3 py-1 text-xs">Prev</span>
            <span className="rounded-full border px-3 py-1 text-xs">Next</span>
          </div>
        ) : null}
      </div>

      <div className="px-5 pb-5">
        <div className={containerClassName}>
          {reviews.map((review) => (
            <div
              key={review.id}
              className="min-w-[260px] border bg-background/90 p-4 shadow-sm"
              style={{ borderRadius: config.borderRadius }}
            >
              <div className="mb-3 flex gap-0.5" style={{ color: config.starColor }}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <span key={index}>{index < review.rating ? '★' : '☆'}</span>
                ))}
              </div>

              <p className="text-sm leading-6 text-foreground">
                {review.review_text || review.original_text || 'Recommended by a Google reviewer.'}
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {config.showPhoto ? (
                    review.author_photo_url ? (
                      <img
                        src={review.author_photo_url}
                        alt={review.author_name}
                        className="h-10 w-10 rounded-full border object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold"
                        style={{ backgroundColor: `${config.primaryColor}18`, color: config.primaryColor }}
                      >
                        {getInitials(review.author_name)}
                      </div>
                    )
                  ) : null}

                  <div>
                    <p className="text-sm font-semibold">{review.author_name}</p>
                    {config.showDate && review.relative_time ? (
                      <p className="text-xs text-muted-foreground">{review.relative_time}</p>
                    ) : null}
                  </div>
                </div>

                {config.showGoogleButton && review.google_maps_url ? (
                  <a
                    href={review.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full px-3 py-2 text-xs font-semibold text-white"
                    style={{ backgroundColor: config.primaryColor }}
                  >
                    Read on Google
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <img src="/google-logo.svg" alt="Google" className="h-3 w-auto" />
          Powered by Google
        </div>
        {mapsUrl ? (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
            View place listing
          </a>
        ) : null}
      </div>
    </div>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return name.slice(0, 2).toUpperCase() || 'GR'
}

function updateConfig<K extends keyof ReviewWidgetConfig>(
  setConfig: Dispatch<SetStateAction<ReviewWidgetConfig>>,
  key: K,
  value: ReviewWidgetConfig[K]
) {
  setConfig((current) => ({ ...current, [key]: value }))
}
