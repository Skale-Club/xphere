'use client'

// PropertyPill | compact "field as pill" used in the task detail meta row.
//
// Renders as a clickable pill showing icon + label + current value. Clicking
// opens a Popover with a list of options to pick from. Designed to replace
// the bulky <Select>+<Label> blocks that took up the old sidebar.

import * as React from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface PropertyPillOption<V extends string> {
  value: V
  label: string
  className?: string   // optional color override for the option row
}

interface Props<V extends string> {
  icon?: LucideIcon
  label: string                          // e.g. "Step"
  value: V
  options: PropertyPillOption<V>[]
  onChange: (next: V) => void
  /** Optional color class applied to the pill's value text (e.g. validation status colors). */
  valueClassName?: string
  disabled?: boolean
  /** Visual variant. "default" matches the meta row; "ghost" omits the chip background. */
  variant?: 'default' | 'ghost'
}

export function PropertyPill<V extends string>({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  valueClassName,
  disabled,
  variant = 'default',
}: Props<V>) {
  const [open, setOpen] = React.useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            variant === 'default'
              ? 'bg-bg-tertiary/50 hover:bg-bg-tertiary text-text-secondary'
              : 'hover:bg-bg-tertiary/40 text-text-secondary',
          )}
        >
          {Icon && <Icon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />}
          <span className="text-text-tertiary">{label}</span>
          <span className={cn('font-medium', valueClassName ?? current?.className ?? 'text-text-primary')}>
            {current?.label ?? value}
          </span>
          <ChevronDown className="h-3 w-3 text-text-tertiary shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="flex flex-col">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (opt.value !== value) onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                'flex items-center justify-between rounded-sm px-2 py-1.5 text-[12.5px] text-left transition-colors',
                'hover:bg-bg-tertiary focus:bg-bg-tertiary focus:outline-none',
                opt.value === value && 'bg-bg-tertiary/60 font-medium',
                opt.className,
              )}
            >
              <span>{opt.label}</span>
              {opt.value === value && <span className="text-accent text-[10px] font-semibold">●</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
