import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  /** Primary CTA */
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
  /** Optional secondary action (e.g. learn more) */
  secondary?: {
    label: string
    href?: string
    onClick?: () => void
  }
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, secondary, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        'rounded-[12px] border border-dashed border-border bg-bg-secondary/40',
        className,
      )}
    >
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle">
        {/* halo */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full opacity-60"
          style={{
            background: 'radial-gradient(circle, var(--accent-muted) 0%, transparent 70%)',
          }}
        />
        <Icon className="relative h-6 w-6 text-text-secondary" />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-1.5">
        <h3 className="text-[15px] font-semibold tracking-tight text-text-primary">{title}</h3>
        {description && (
          <p className="text-[13px] text-text-secondary leading-relaxed break-words">{description}</p>
        )}
      </div>

      {(action || secondary) && (
        <div className="flex items-center gap-2 pt-1">
          {action && (
            action.href ? (
              <Button asChild>
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ) : (
              <Button onClick={action.onClick}>{action.label}</Button>
            )
          )}
          {secondary && (
            secondary.href ? (
              <Button asChild variant="ghost">
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            ) : (
              <Button variant="ghost" onClick={secondary.onClick}>{secondary.label}</Button>
            )
          )}
        </div>
      )}
    </div>
  )
}
