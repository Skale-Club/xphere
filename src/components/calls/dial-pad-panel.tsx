'use client'

// Persistent floating dial-pad panel mounted in the dashboard layout.
// All org phone numbers appear as "call from" options.
// The record-calls toggle persists instantly to call_settings.
// Browser-mode calls show live controls (mute / hang-up + timer) and are
// recorded client-side via MediaRecorder and stored in Hetzner S3.

import * as React from 'react'
import {
  Phone,
  PhoneOff,
  PhoneCall,
  Delete,
  Mic,
  MicOff,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { normaliseE164 } from '@/lib/calls/zod-schemas'
import {
  getOrgPhoneNumbers,
  toggleRecordCalls,
  type OrgPhoneNumber,
} from '@/app/(dashboard)/voice/actions'
import { useTwilioDevice } from './twilio-device-provider'
import { useCallRecorder } from '@/hooks/use-call-recorder'
import { useDialPadPrefill } from './dial-pad-context'

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

interface DialPadPanelProps {
  initialRecordCalls: boolean
  routingMode: 'phone_forward' | 'sip' | 'browser'
}

export function DialPadPanel({ initialRecordCalls, routingMode }: DialPadPanelProps) {
  const [open, setOpen] = React.useState(false)
  const [number, setNumber] = React.useState('')
  const [recordCalls, setRecordCalls] = React.useState(initialRecordCalls)
  const [muted, setMuted] = React.useState(false)
  const [calling, setCalling] = React.useState(false)
  const [phoneNumbers, setPhoneNumbers] = React.useState<OrgPhoneNumber[]>([])
  const [fromNumber, setFromNumber] = React.useState<string>('')
  const [elapsed, setElapsed] = React.useState(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const device = useTwilioDevice()
  const isOnCall = device.activeCall !== null || (calling && routingMode !== 'browser')

  // Attach client-side recorder for browser-mode calls
  useCallRecorder(device.activeCall, recordCalls && routingMode === 'browser')

  // Load org phone numbers once
  React.useEffect(() => {
    getOrgPhoneNumbers().then((nums) => {
      setPhoneNumbers(nums)
      const def = nums.find((n) => n.is_default) ?? nums[0]
      if (def) setFromNumber(def.e164)
    })
  }, [])

  // External callers (e.g. contact detail) can prefill the dial-pad without
  // initiating a call — opens the panel and fills the number field.
  const handlePrefill = React.useCallback((phone: string) => {
    setNumber(phone)
    setOpen(true)
  }, [])
  useDialPadPrefill(handlePrefill)

  // Call duration timer
  React.useEffect(() => {
    if (device.activeCall) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setElapsed(0)
      setCalling(false)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [device.activeCall])

  function appendDigit(digit: string) {
    setNumber((n) => {
      if (digit === '0' && n.length === 0) return '+'
      return n + digit
    })
    // DTMF on active browser call
    if (device.activeCall) {
      try {
        device.activeCall.sendDigits(digit)
      } catch {
        // ignore
      }
    }
  }

  function backspace() {
    setNumber((n) => n.slice(0, -1))
  }

  async function handleToggleRecord(val: boolean) {
    setRecordCalls(val)
    const res = await toggleRecordCalls(val)
    if (res.error) {
      setRecordCalls(!val)
      toast.error(res.error)
    }
  }

  function handleMute() {
    if (!device.activeCall) return
    const next = !muted
    device.activeCall.mute(next)
    setMuted(next)
  }

  function handleHangUp() {
    device.hangUp()
    setCalling(false)
    setMuted(false)
  }

  async function handleCall() {
    const norm = normaliseE164(number)
    if (!norm) {
      toast.error('Enter a valid E.164 number — e.g. +14155551234.')
      return
    }
    setCalling(true)

    if (routingMode === 'browser') {
      const call = await device.placeCall(norm)
      if (!call) {
        setCalling(false)
        toast.error('Browser call failed — check your settings.')
      }
      // state tracks via device.activeCall
      return
    }

    // phone_forward / sip — initiate via REST
    try {
      const body: Record<string, string> = { to: norm }
      if (fromNumber) body.from = fromNumber
      const res = await fetch('/api/twilio/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? `Call failed (${res.status})`)
        setCalling(false)
        return
      }
      toast.success(`Calling ${norm} — your phone will ring shortly.`)
      setNumber('')
      // REST calls don't create a browser Call object — reset after a moment
      setTimeout(() => setCalling(false), 4_000)
    } catch {
      toast.error('Network error — could not place call.')
      setCalling(false)
    }
  }

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {open && (
        <div className="w-[272px] rounded-[18px] border border-border bg-bg-primary shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-accent" />
              <span className="text-[13px] font-semibold text-text-primary">Dial pad</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-text-tertiary hover:text-text-primary transition-colors"
              aria-label="Close dial pad"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Active call view (browser mode) */}
            {device.activeCall && (
              <div className="rounded-[12px] border border-accent/30 bg-accent/[0.06] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-text-tertiary">Connected</p>
                    <p className="text-[13px] font-medium text-text-primary">{number || 'Active call'}</p>
                  </div>
                  <span className="text-[13px] font-mono text-accent">{formatElapsed(elapsed)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleMute}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border py-2 text-[12px] font-medium transition-colors',
                      muted
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                        : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary',
                    )}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                  >
                    {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    onClick={handleHangUp}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-rose-500/30 bg-rose-500/10 py-2 text-[12px] font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
                    aria-label="Hang up"
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                    Hang up
                  </button>
                </div>
              </div>
            )}

            {/* Phone number input */}
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+14155551234"
              className="h-11 text-center text-[17px] font-medium tracking-wide"
              disabled={Boolean(device.activeCall)}
            />

            {/* Dial pad grid */}
            <div className="grid grid-cols-3 gap-1.5">
              {DIAL_KEYS.map((k) => (
                <button
                  key={k.digit}
                  type="button"
                  onClick={() => appendDigit(k.digit)}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center rounded-[10px] border border-border bg-bg-secondary text-text-primary transition-all',
                    'hover:border-border-strong hover:bg-bg-tertiary active:scale-95',
                  )}
                >
                  <span className="text-[18px] font-medium leading-none">{k.digit}</span>
                  {k.letters && (
                    <span className="mt-0.5 text-[8.5px] uppercase tracking-wide text-text-tertiary">
                      {k.letters}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* From-number selector */}
            {phoneNumbers.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10.5px] uppercase tracking-wider text-text-tertiary">
                  Call from
                </label>
                <select
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  disabled={isOnCall}
                  className="w-full rounded-[10px] border border-border bg-bg-secondary px-3 py-2 text-[12.5px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                >
                  {phoneNumbers.map((p) => (
                    <option key={p.id} value={p.e164}>
                      {p.friendly_name} ({p.e164})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Action row: backspace + call */}
            {!device.activeCall && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={backspace}
                  disabled={!number || calling}
                  aria-label="Backspace"
                  className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-bg-secondary text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                >
                  <Delete className="h-4 w-4" />
                </button>
                <Button
                  onClick={handleCall}
                  loading={calling}
                  disabled={!number || calling}
                  className="flex-1 h-10"
                >
                  <Phone className="h-4 w-4" />
                  Call
                </Button>
              </div>
            )}

            {/* Record toggle */}
            <div className="flex items-center justify-between rounded-[10px] border border-border bg-bg-secondary px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Mic className="h-3.5 w-3.5 text-text-secondary" />
                <span className="text-[12px] text-text-primary">Record calls</span>
              </div>
              <Switch
                checked={recordCalls}
                onCheckedChange={handleToggleRecord}
                aria-label="Toggle call recording"
              />
            </div>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close dial pad' : 'Open dial pad'}
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all',
          isOnCall
            ? 'bg-accent text-white animate-pulse'
            : 'bg-bg-primary border border-border text-text-secondary hover:text-accent hover:border-accent',
        )}
      >
        {open ? (
          <ChevronDown className="h-5 w-5" />
        ) : isOnCall ? (
          <PhoneCall className="h-5 w-5" />
        ) : (
          <Phone className="h-5 w-5" />
        )}
      </button>
    </div>
  )
}
