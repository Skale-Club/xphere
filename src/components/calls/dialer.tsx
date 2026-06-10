'use client'

import * as React from 'react'
import { Phone, Delete } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { normaliseE164 } from '@/lib/calls/zod-schemas'
import { DestinationTimeNotice } from '@/components/calls/destination-time-notice'

const DIAL_KEYS: Array<{ digit: string; letters?: string }> = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
]

export interface DialerProps {
  initialNumber?: string
  onComplete?: () => void
}

export function Dialer({ initialNumber, onComplete }: DialerProps) {
  const [number, setNumber] = React.useState(initialNumber ?? '')
  const [calling, setCalling] = React.useState(false)

  function append(digit: string) {
    setNumber((n) => {
      if (digit === '0' && n.length === 0) return '+'
      return n + digit
    })
  }
  function backspace() {
    setNumber((n) => n.slice(0, -1))
  }

  async function placeCall() {
    const norm = normaliseE164(number)
    if (!norm) {
      toast.error('Use an E.164 number | e.g. +14155551234.')
      return
    }
    setCalling(true)
    try {
      const res = await fetch('/api/twilio/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: norm }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? `Call failed (${res.status})`)
        return
      }
      const data = (await res.json()) as { sid: string }
      toast.success(`Calling ${norm} | your phone will ring shortly.`)
      console.log('[dialer] call sid:', data.sid)
      onComplete?.()
    } finally {
      setCalling(false)
    }
  }

  return (
    <div className="space-y-5">
      <Input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="+14155551234"
        className="h-12 text-center text-[18px] font-medium tracking-wide"
      />

      <DestinationTimeNotice number={number} />

      <div className="grid grid-cols-3 gap-2">
        {DIAL_KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            onClick={() => append(k.digit)}
            className={cn(
              'flex aspect-square flex-col items-center justify-center rounded-[12px] border border-border bg-bg-secondary text-text-primary transition-all',
              'hover:border-border-strong hover:bg-bg-tertiary active:scale-95',
            )}
          >
            <span className="text-[20px] font-medium">{k.digit}</span>
            {k.letters && (
              <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
                {k.letters}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={backspace}
          disabled={!number || calling}
          aria-label="Backspace"
        >
          <Delete className="h-4 w-4" />
        </Button>
        <Button onClick={placeCall} loading={calling} className="flex-1">
          <Phone className="h-4 w-4" />
          Call
        </Button>
      </div>
    </div>
  )
}
