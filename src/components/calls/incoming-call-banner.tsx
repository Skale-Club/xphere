'use client'

import * as React from 'react'
import { Phone, PhoneOff, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTwilioDevice } from './twilio-device-provider'
import { cn } from '@/lib/utils'

/**
 * Floating banner shown when a Twilio Voice SDK `incoming` event fires.
 * Slides in from the top of the viewport with a soft pulse, big Accept/Reject.
 * Only renders when an incoming call is present.
 */
export function IncomingCallBanner() {
  const { incoming, acceptIncoming, rejectIncoming } = useTwilioDevice()
  const [contactName, setContactName] = React.useState<string | null>(null)

  const params = incoming?.parameters
  const fromNumber = params?.From ?? null

  // Best-effort contact name lookup. Fetches from a tiny endpoint to avoid
  // shipping the server-action bundle to the client.
  React.useEffect(() => {
    if (!fromNumber) return
    let cancelled = false
    fetch(`/api/voice/contact-by-phone?phone=${encodeURIComponent(fromNumber)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { name?: string } | null) => {
        if (cancelled) return
        setContactName(data?.name ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [fromNumber])

  if (!incoming) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-4 animate-fade-in">
      <div
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-4 rounded-[14px] border border-accent/40 bg-bg-secondary px-4 py-3',
          'shadow-elevation-lg shadow-glow ring-1 ring-accent/30',
        )}
      >
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <Phone className="h-4 w-4" />
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/30" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
            Incoming call
          </div>
          <div className="truncate text-[14px] font-medium text-text-primary">
            {contactName ?? fromNumber ?? 'Unknown caller'}
          </div>
          {contactName && fromNumber && (
            <div className="flex items-center gap-1 text-[11.5px] text-text-tertiary">
              <User className="h-3 w-3" />
              {fromNumber}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="destructive" size="sm" onClick={rejectIncoming}>
            <PhoneOff className="h-3.5 w-3.5" />
            Decline
          </Button>
          <Button size="sm" onClick={acceptIncoming}>
            <Phone className="h-3.5 w-3.5" />
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
