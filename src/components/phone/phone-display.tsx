'use client'

/**
 * PhoneDisplay — single source of truth for rendering a phone number.
 *
 *   • Always shows the formatted display string (`+1 (508) 700-1010`) while
 *     the raw E.164 stays in props / state / DB for search and dedup.
 *   • Click behaviour adapts to the org:
 *       - Dialpad available (Twilio + ≥1 active voice number) →
 *         opens the floating dial-pad pre-filled with the number.
 *       - Otherwise → renders an `<a href="tel:+15087001010">` so the user's
 *         OS / browser handles the call (softphone, mobile dialer, etc.).
 *
 * For non-interactive contexts (table rows where the row is the click
 * target) pass `interactive={false}` and a plain span is rendered.
 */

import * as React from 'react'

import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { prefillDialPad } from '@/components/calls/dial-pad-context'
import { useDialpadAvailable } from './dialpad-availability-context'

interface PhoneDisplayProps {
  /** Raw E.164 (or any string we have). Renders nothing if empty. */
  value: string | null | undefined
  /** When false, renders a plain span instead of a button/link. */
  interactive?: boolean
  /** Override the formatted text (e.g. show name + phone). */
  children?: React.ReactNode
  className?: string
  /**
   * Stop click propagation. Useful when the phone sits inside a row that has
   * its own click handler (contacts table) and we don't want the row click
   * to fire when the user clicks the phone link.
   */
  stopPropagation?: boolean
}

export function PhoneDisplay({
  value,
  interactive = true,
  children,
  className,
  stopPropagation = false,
}: PhoneDisplayProps) {
  const dialpadAvailable = useDialpadAvailable()

  if (!value) return null
  const display = children ?? formatPhoneDisplay(value)

  if (!interactive) {
    return <span className={cn('tabular-nums', className)}>{display}</span>
  }

  const baseClasses = cn(
    'inline-flex items-center gap-1 tabular-nums hover:underline focus-visible:underline',
    'focus-visible:outline-none focus-visible:text-accent',
    className,
  )

  if (dialpadAvailable) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation()
          prefillDialPad(value)
        }}
        className={baseClasses}
        title={`Call ${value}`}
      >
        {display}
      </button>
    )
  }

  return (
    <a
      href={`tel:${value}`}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className={baseClasses}
      title={`Call ${value}`}
    >
      {display}
    </a>
  )
}
