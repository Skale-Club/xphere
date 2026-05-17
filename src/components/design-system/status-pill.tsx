import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

type Tone = 'live' | 'success' | 'warning' | 'danger' | 'info' | 'idle' | 'loading'

const toneClasses: Record<Tone, { dot: string; bg: string; text: string }> = {
  live:    { dot: 'bg-success text-success',  bg: 'bg-[var(--success-muted)]', text: 'text-success' },
  success: { dot: 'bg-success',                bg: 'bg-[var(--success-muted)]', text: 'text-success' },
  warning: { dot: 'bg-warning',                bg: 'bg-[var(--warning-muted)]', text: 'text-warning' },
  danger:  { dot: 'bg-danger',                 bg: 'bg-[var(--danger-muted)]',  text: 'text-danger' },
  info:    { dot: 'bg-info',                   bg: 'bg-[var(--info-muted)]',    text: 'text-info' },
  idle:    { dot: 'bg-text-tertiary',          bg: 'bg-bg-tertiary',            text: 'text-text-secondary' },
  loading: { dot: '',                          bg: 'bg-bg-tertiary',            text: 'text-text-secondary' },
}

interface StatusPillProps {
  tone?: Tone
  children: React.ReactNode
  className?: string
}

export function StatusPill({ tone = 'idle', children, className }: StatusPillProps) {
  const c = toneClasses[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle px-1.5 py-0.5',
        'text-[11px] font-medium tracking-tight',
        c.bg,
        c.text,
        className,
      )}
    >
      {tone === 'loading' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : tone === 'live' ? (
        <span className="relative inline-flex h-2 w-2">
          <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-success" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
      ) : (
        <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      )}
      {children}
    </span>
  )
}
