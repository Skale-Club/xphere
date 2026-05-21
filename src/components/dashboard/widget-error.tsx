'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'

interface WidgetErrorProps {
  title?: string
  message?: string
  className?: string
  /** Show a retry button. Defaults to true. */
  retry?: boolean
}

/**
 * Standard widget error fallback. Looks like a normal card with a soft
 * danger tone, an inline retry button, and a one-line "Widget unavailable"
 * message. NEVER throws or imports heavy design-system pieces | keeps the
 * dependency graph small so the fallback itself can't crash.
 */
export function WidgetError({
  title,
  message = 'Widget unavailable',
  className,
  retry = true,
}: WidgetErrorProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-start gap-2 rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm',
        className,
      )}
      role="alert"
    >
      {title && (
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          {title}
        </div>
      )}
      <div className="flex items-center gap-2 text-[13px] text-text-secondary">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        <span>{message}</span>
      </div>
      {retry && (
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') window.location.reload()
          }}
          className="mt-1 inline-flex items-center gap-1 rounded-[5px] px-1.5 py-1 text-[11.5px] font-medium text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  )
}
