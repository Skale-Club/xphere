'use client'

import type { ComponentType } from 'react'
import { useState } from 'react'
import { Check, Copy, Grid3x3, List, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Layout = 'grid' | 'list' | 'carousel'
type Theme = 'light' | 'dark'

interface WidgetTemplatePickerProps {
  baseUrl: string
  widgetToken: string
}

function LayoutPreview({ layout }: { layout: Layout }) {
  const card = (opacity = 1) => (
    <div className={cn('rounded bg-bg-primary/60 p-1.5 space-y-[3px]')} style={{ opacity }}>
      <div className="flex items-center gap-1">
        <div className="h-2.5 w-2.5 rounded-full bg-text-tertiary/25 shrink-0" />
        <div className="h-[5px] w-10 rounded-full bg-text-tertiary/35" />
      </div>
      <div className="flex gap-[2px]">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className="h-[4px] w-[4px] rounded-[1px] bg-amber-400/75" />
        ))}
      </div>
      <div className="space-y-[2px]">
        <div className="h-[3px] w-full rounded-full bg-text-tertiary/15" />
        <div className="h-[3px] w-4/5 rounded-full bg-text-tertiary/15" />
      </div>
    </div>
  )

  if (layout === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-1 p-2">
        {card()}
        {card()}
        {card()}
        {card()}
      </div>
    )
  }

  if (layout === 'list') {
    return (
      <div className="p-2 space-y-1">
        {card()}
        {card()}
        {card()}
      </div>
    )
  }

  // carousel
  return (
    <div className="p-2 overflow-hidden">
      <div className="flex gap-1.5">
        <div className="w-[55%] shrink-0">{card()}</div>
        <div className="w-[45%] shrink-0">{card(0.5)}</div>
      </div>
      <div className="flex justify-center gap-1 mt-2">
        <div className="h-[3px] w-4 rounded-full bg-accent" />
        <div className="h-[3px] w-[5px] rounded-full bg-text-tertiary/25" />
        <div className="h-[3px] w-[5px] rounded-full bg-text-tertiary/25" />
      </div>
    </div>
  )
}

const TEMPLATES: Array<{
  id: Layout
  label: string
  icon: ComponentType<{ className?: string }>
  height: string
}> = [
  { id: 'grid', label: 'Grid', icon: Grid3x3, height: '640' },
  { id: 'list', label: 'List', icon: List, height: '600' },
  { id: 'carousel', label: 'Carousel', icon: SlidersHorizontal, height: '360' },
]

export function WidgetTemplatePicker({ baseUrl, widgetToken }: WidgetTemplatePickerProps) {
  const [layout, setLayout] = useState<Layout>('grid')
  const [minRating, setMinRating] = useState('4')
  const [theme, setTheme] = useState<Theme>('light')
  const [copied, setCopied] = useState(false)

  const selected = TEMPLATES.find((t) => t.id === layout)!

  const snippet = `<iframe
  src="${baseUrl}/widget/reviews/${widgetToken}?layout=${layout}&min_rating=${minRating}&theme=${theme}"
  width="100%"
  height="${selected.height}"
  frameborder="0"
  style="border:0;border-radius:16px;"
  loading="lazy"
  title="Google reviews">
</iframe>`

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Layout
        </p>
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.map((t) => {
            const Icon = t.icon
            const active = t.id === layout
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setLayout(t.id)}
                className={cn(
                  'rounded-[10px] border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-accent/50 ring-1 ring-accent/25 bg-accent/5'
                    : 'border-border bg-bg-tertiary/50 hover:border-border-strong hover:bg-bg-tertiary'
                )}
              >
                <div className="h-[88px] overflow-hidden rounded-t-[9px] bg-bg-secondary border-b border-border-subtle">
                  <LayoutPreview layout={t.id} />
                </div>
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-2',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      active ? 'text-accent' : 'text-text-tertiary'
                    )}
                  />
                  <span
                    className={cn(
                      'text-[12px] font-medium',
                      active ? 'text-text-primary' : 'text-text-secondary'
                    )}
                  >
                    {t.label}
                  </span>
                  {active && (
                    <Check className="ml-auto h-3 w-3 text-accent" />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-text-tertiary whitespace-nowrap">
            Min rating
          </Label>
          <Select value={minRating} onValueChange={setMinRating}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">★ 1 and above</SelectItem>
              <SelectItem value="2">★★ 2 and above</SelectItem>
              <SelectItem value="3">★★★ 3 and above</SelectItem>
              <SelectItem value="4">★★★★ 4 and above</SelectItem>
              <SelectItem value="5">★★★★★ 5 only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
            Theme
          </Label>
          <div className="flex overflow-hidden rounded-[6px] border border-border text-[11.5px] font-medium">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={cn(
                  'px-2.5 py-1 capitalize transition-colors',
                  theme === t
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Embed code
        </p>
        <div className="relative rounded-lg border bg-zinc-950 text-zinc-100">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={copy}
            className="absolute right-2 top-2 h-7 gap-1 text-[11.5px]"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </Button>
          <pre className="overflow-x-auto p-4 pr-20 font-mono text-xs leading-relaxed">
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}
