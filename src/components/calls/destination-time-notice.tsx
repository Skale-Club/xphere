'use client'

import * as React from 'react'
import { Clock, Moon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { normaliseE164 } from '@/lib/calls/zod-schemas'
import { describeDestinationTime } from '@/lib/phone-numbers/timezone'

export interface DestinationTimeNoticeProps {
  /** Raw number from the dialer input (E.164-ish, may be incomplete). */
  number: string
}

/**
 * Shows the local time at the number's destination before a call is placed —
 * but only when that timezone actually differs from the caller's own, so local
 * calls stay clutter-free. When it's outside reasonable calling hours there,
 * the notice switches to a warning style.
 *
 * Renders nothing (returns `null`) until mounted on the client, to keep the
 * timezone/Date computation out of SSR and avoid hydration mismatches.
 */
export function DestinationTimeNotice({ number }: DestinationTimeNoticeProps) {
  const [now, setNow] = React.useState<Date | null>(null)

  React.useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const viewerTz = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  )

  const info = React.useMemo(() => {
    if (!now) return null
    const e164 = normaliseE164(number)
    if (!e164) return null
    return describeDestinationTime(e164, now, viewerTz)
  }, [number, now, viewerTz])

  // Nothing to show, or the destination shares the caller's clock.
  if (!info || info.diffMinutes === 0) return null

  const Icon = info.isOffHours ? Moon : Clock

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px]',
        info.isOffHours
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-border bg-bg-secondary text-text-secondary',
      )}
      role={info.isOffHours ? 'alert' : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-medium">{info.localTime}</span> in {info.label}
        <span className="text-text-tertiary"> · {info.diffLabel}</span>
        {info.isOffHours && (
          <span className="font-medium"> · outside calling hours</span>
        )}
      </span>
    </div>
  )
}
