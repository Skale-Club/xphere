'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Runs when the app opens via the incoming-call push deep link
 * (/calls?answer={callSid}). Asks the server to redirect the still-ringing
 * call to this user's Voice SDK client; the globally-mounted TwilioDevice
 * then receives the <Client> leg and the incoming-call banner takes over.
 */
export function AnswerCallHandler({ callSid }: { callSid: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const fired = React.useRef(false)

  React.useEffect(() => {
    if (fired.current) return
    fired.current = true

    const clearParam = () => {
      const params = new URLSearchParams(Array.from(sp.entries()))
      params.delete('answer')
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
    }

    const run = async () => {
      const id = toast.loading('Connecting the call to this device…')
      try {
        const res = await fetch('/api/twilio/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callSid }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (res.ok) {
          toast.success('Incoming call ringing on this device — answer the banner.', { id })
        } else if (data.error === 'already_answered') {
          toast.info('This call was already answered on another device.', { id })
        } else if (data.error === 'call_ended') {
          toast.info('This call already ended.', { id })
        } else {
          toast.error(data.error ?? 'Could not connect the call.', { id })
        }
      } catch {
        toast.error('Could not connect the call.', { id: undefined })
      } finally {
        clearParam()
      }
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
