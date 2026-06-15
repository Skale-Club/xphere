'use client'

import { useState, useEffect } from 'react'
import { SlidersHorizontal, ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  DateFilter,
  PRESET_LABELS,
  QUICK_PRESETS,
  MORE_PRESETS,
  filterLabel as getFilterLabel,
} from './ads-date-filter.utils'
import { adsViewStorageKey, type AdsPlatformPanelProps } from './platform-panel-contract'

export function AdsDateFilter({ platform, value, onChange }: AdsPlatformPanelProps) {
  const [open, setOpen] = useState(false)
  const [customSince, setCustomSince] = useState('')
  const [customUntil, setCustomUntil] = useState('')
  const [viewSaved, setViewSaved] = useState(false)

  // Restore saved view on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(adsViewStorageKey(platform))
      if (raw) onChange(JSON.parse(raw) as DateFilter)
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform])

  const label = getFilterLabel(value)
  const isMore = value.type === 'custom' || (value.type === 'preset' && MORE_PRESETS.includes(value.value))

  function select(preset: string) {
    onChange({ type: 'preset', value: preset })
    setOpen(false)
  }

  function applyCustom() {
    if (!customSince || !customUntil) return
    onChange({ type: 'custom', since: customSince, until: customUntil })
    setOpen(false)
  }

  function saveView() {
    try {
      localStorage.setItem(adsViewStorageKey(platform), JSON.stringify(value))
      setViewSaved(true)
      setTimeout(() => setViewSaved(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
      {QUICK_PRESETS.map((p) => (
        <button
          key={p}
          onClick={() => select(p)}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
            value.type === 'preset' && value.value === p
              ? 'bg-bg-primary text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
              isMore
                ? 'bg-bg-primary text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <SlidersHorizontal className="h-3 w-3" />
            {isMore ? label : 'More'}
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-64 p-2">
          {/* Extended presets */}
          <div className="space-y-0.5">
            {MORE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => select(p)}
                className={cn(
                  'w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                  value.type === 'preset' && value.value === p
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                )}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>

          <div className="my-2 border-t border-border-subtle" />

          {/* Custom range */}
          <div className="space-y-2 px-1 pb-1">
            <p className="text-[11px] font-medium text-text-secondary">Custom range</p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
                <span className="w-8 shrink-0">From</span>
                <input
                  type="date"
                  value={customSince}
                  max={customUntil || undefined}
                  onChange={(e) => setCustomSince(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[11.5px] text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
                <span className="w-8 shrink-0">To</span>
                <input
                  type="date"
                  value={customUntil}
                  min={customSince || undefined}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[11.5px] text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!customSince || !customUntil}
              onClick={applyCustom}
            >
              Apply range
            </Button>

            {/* Save as default view */}
            <div className="my-1 border-t border-border-subtle" />
            <button
              onClick={saveView}
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
            >
              Save as default view
              {viewSaved && <Check className="h-3.5 w-3.5 text-green-400" />}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
