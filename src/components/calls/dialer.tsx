'use client'

import * as React from 'react'
import { Phone, PhoneOff, Delete, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { normaliseE164 } from '@/lib/calls/zod-schemas'
import { DestinationTimeNotice } from '@/components/calls/destination-time-notice'
import {
  useOutboundCallStatus,
  type CallPhase,
} from '@/hooks/use-outbound-call-status'

function phaseDotClass(phase: CallPhase): string {
  switch (phase) {
    case 'connected':
      return 'bg-emerald-400'
    case 'initiating':
    case 'ringing':
      return 'bg-amber-400 animate-pulse'
    case 'busy':
    case 'no-answer':
    case 'failed':
    case 'canceled':
      return 'bg-rose-400'
    case 'ended':
    default:
      return 'bg-text-tertiary'
  }
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

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
  const call = useOutboundCallStatus()

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
      const data = (await res.json()) as { sid?: string }
      if (data.sid) {
        // Keep the dialog open and surface the live call lifecycle inline; the
        // user closes it themselves once they've seen the outcome.
        call.track(data.sid, norm)
      } else {
        toast.success(`Calling ${norm} | your phone will ring shortly.`)
        onComplete?.()
      }
    } finally {
      setCalling(false)
    }
  }

  const activeCall = call.active
  const callLive = activeCall !== null && !activeCall.isTerminal
  const showTimer =
    activeCall !== null &&
    (activeCall.phase === 'connected' || (activeCall.isTerminal && call.elapsed > 0))

  return (
    <div className="space-y-5">
      {/* Live call card | phone_forward/sip status from the call_logs realtime feed */}
      {activeCall && (
        <div className="rounded-[12px] border border-accent/30 bg-accent/[0.06] p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-tertiary">
                <span className={cn('h-2 w-2 rounded-full', phaseDotClass(activeCall.phase))} />
                {activeCall.phaseLabel}
              </p>
              <p className="truncate text-[13px] font-medium text-text-primary">{activeCall.label}</p>
            </div>
            {showTimer && (
              <span className="shrink-0 text-[13px] font-mono text-accent">
                {formatElapsed(call.elapsed)}
              </span>
            )}
          </div>
          {activeCall.isTerminal ? (
            <Button variant="ghost" className="w-full" onClick={() => call.dismiss()}>
              <X className="h-4 w-4" />
              Fechar
            </Button>
          ) : (
            <Button
              className="w-full border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
              onClick={() => call.hangUp()}
            >
              <PhoneOff className="h-4 w-4" />
              Encerrar
            </Button>
          )}
        </div>
      )}

      <Input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="+14155551234"
        className="h-12 text-center text-[18px] font-medium tracking-wide"
        disabled={callLive}
      />

      <DestinationTimeNotice number={number} />

      <div className="grid grid-cols-3 gap-2">
        {DIAL_KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            onClick={() => append(k.digit)}
            disabled={callLive}
            className={cn(
              'flex aspect-square flex-col items-center justify-center rounded-[12px] border border-border bg-bg-secondary text-text-primary transition-all',
              'hover:border-border-strong hover:bg-bg-tertiary active:scale-95 disabled:opacity-40',
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
        <Button onClick={placeCall} loading={calling} disabled={callLive} className="flex-1">
          <Phone className="h-4 w-4" />
          Call
        </Button>
      </div>
    </div>
  )
}
