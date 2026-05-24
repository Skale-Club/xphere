'use client'

import type { ReactNode } from 'react'
import { Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface FilterPopoverProps {
  children: ReactNode
  activeCount?: number
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function FilterPopover({
  children,
  activeCount = 0,
  align = 'end',
  className,
}: FilterPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            'h-8 text-[12.5px]',
            activeCount > 0 && 'border-accent/40 bg-accent-muted/20 text-accent'
          )}
        >
          <Filter className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Filter</span>
          {activeCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('w-[320px] p-0', className)}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

interface FilterPopoverHeaderProps {
  title: string
  onClear?: () => void
  showClear?: boolean
}

export function FilterPopoverHeader({
  title,
  onClear,
  showClear,
}: FilterPopoverHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {showClear && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-xs text-text-tertiary transition-colors hover:text-text-primary"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  )
}

interface FilterSectionProps {
  title: string
  children: ReactNode
}

export function FilterSection({ title, children }: FilterSectionProps) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

interface FilterPillProps {
  active: boolean
  onClick: () => void
  children: ReactNode
}

export function FilterPill({ active, onClick, children }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-accent/50 bg-accent-muted/30 text-accent'
          : 'border-border-subtle bg-bg-secondary text-text-secondary hover:border-border-strong hover:bg-bg-tertiary'
      )}
    >
      {children}
    </button>
  )
}
