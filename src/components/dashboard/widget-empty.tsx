import * as React from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'

interface WidgetEmptyProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: React.ReactNode
  /** Primary CTA — either a link or a click handler */
  cta?: {
    label: string
    href?: string
    onClick?: () => void
  }
  /** Vertical density. "compact" works inside small widgets, "default" for full panels. */
  size?: 'compact' | 'default'
  className?: string
}

/**
 * Compact empty-state shell used *inside* widget cards. Pairs with
 * WidgetCard so the surrounding header (title + View all link) stays
 * consistent. Unlike the dashed-border global EmptyState component, this
 * one blends into the widget's content area.
 */
export function WidgetEmpty({
  icon: Icon,
  title,
  description,
  cta,
  size = 'default',
  className,
}: WidgetEmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        size === 'compact' ? 'py-6' : 'py-10',
        className,
      )}
    >
      <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle">
        <div
          aria-hidden
          className="absolute inset-0 rounded-full opacity-50"
          style={{
            background: 'radial-gradient(circle, var(--accent-muted) 0%, transparent 70%)',
          }}
        />
        <Icon className="relative h-4 w-4 text-text-tertiary" />
      </div>
      <div className="flex max-w-xs flex-col gap-1">
        <h4 className="text-[13.5px] font-medium text-text-primary">{title}</h4>
        {description && (
          <p className="text-[12px] text-text-tertiary leading-relaxed">{description}</p>
        )}
      </div>
      {cta &&
        (cta.href ? (
          <Link
            href={cta.href}
            className="inline-flex items-center gap-1 rounded-[6px] bg-bg-tertiary px-2.5 py-1 text-[11.5px] font-medium text-text-primary ring-1 ring-border-subtle transition-colors hover:bg-bg-tertiary/70 hover:ring-border-strong"
          >
            {cta.label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={cta.onClick}
            className="inline-flex items-center gap-1 rounded-[6px] bg-bg-tertiary px-2.5 py-1 text-[11.5px] font-medium text-text-primary ring-1 ring-border-subtle transition-colors hover:bg-bg-tertiary/70 hover:ring-border-strong"
          >
            {cta.label}
            <ArrowRight className="h-3 w-3" />
          </button>
        ))}
    </div>
  )
}
