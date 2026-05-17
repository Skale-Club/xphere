import * as React from 'react'
import { ExternalLink } from 'lucide-react'

import { StatusPill } from '@/components/design-system/status-pill'

type SectionTone = 'live' | 'success' | 'warning' | 'danger' | 'info' | 'idle' | 'loading'

/**
 * SectionCard — canonical primitive for "dedicated integration" pages (v2.3).
 *
 * Each dedicated integration page (Twilio, Google Reviews, Meta, Evolution,
 * ManyChat, Google Contacts) composes these section cards to create a
 * consistent visual language. Originally extracted from twilio-settings.tsx
 * during the v2.3 visual unification work.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  ┌──┐  Title                                       [Status pill] │
 *   │  │🔧│  Subtitle / description                                    │
 *   │  └──┘                                                             │
 *   │  [optional help link chips]                                       │
 *   │                                                                   │
 *   │  {children — typically the form / list for this section}         │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * The component is non-interactive itself — all behavior lives in the
 * children. The status pill is informational only.
 */

export interface SectionCardProps {
  icon: React.ComponentType<{ className?: string }>
  title: React.ReactNode
  description: React.ReactNode
  /**
   * `true` shows `readyLabel` in a success-toned pill; `false` shows
   * `emptyLabel` in a warning-toned pill. Pass both labels even when the
   * pill is mostly informational — the warning state is what catches the
   * operator's eye when something needs setup.
   */
  statusReady: boolean
  readyLabel: string
  emptyLabel: string
  /** Optional explicit pill tone override (e.g. `idle` for purely advisory sections). */
  pillToneOverride?: SectionTone
  helpLinks?: Array<{ label: string; href: string }>
  children: React.ReactNode
}

export function SectionCard({
  icon: Icon,
  title,
  description,
  statusReady,
  readyLabel,
  emptyLabel,
  pillToneOverride,
  helpLinks,
  children,
}: SectionCardProps) {
  const pillTone: SectionTone = pillToneOverride ?? (statusReady ? 'success' : 'warning')
  return (
    <section className="rounded-[14px] border border-border bg-bg-secondary p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-text-primary">{title}</h2>
            <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary leading-relaxed">
              {description}
            </p>
          </div>
        </div>
        <StatusPill tone={pillTone}>
          {statusReady ? readyLabel : emptyLabel}
        </StatusPill>
      </div>

      {helpLinks && helpLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {helpLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-tertiary px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:text-text-primary hover:border-border-strong"
            >
              <ExternalLink className="h-3 w-3" />
              {link.label}
            </a>
          ))}
        </div>
      )}

      {children}
    </section>
  )
}
