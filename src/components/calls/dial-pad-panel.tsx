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
  Search,
  X,
  Building2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { normaliseE164 } from '@/lib/calls/zod-schemas'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import {
  getOrgPhoneNumbers,
  toggleRecordCalls,
  type OrgPhoneNumber,
} from '@/app/(dashboard)/voice/actions'
import {
  searchContactsForDialPad,
  type DialPadContactHit,
} from '@/app/(dashboard)/calls/actions'
import { useTwilioDevice } from './twilio-device-provider'
import { useCallRecorder } from '@/hooks/use-call-recorder'
import { useDialPadPrefill, useDialPadToggle } from './dial-pad-context'
import {
  useOutboundCallStatus,
  type CallPhase,
} from '@/hooks/use-outbound-call-status'

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

const DESKTOP_QUERY = '(min-width: 640px)'
const DESKTOP_PANEL_GAP = 16
const DESKTOP_PANEL_TOP = 64

// Status-dot colour by call phase: amber while reaching the contact, green when
// connected, rose on a failed/declined outcome, neutral when cleanly ended.
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
  const [search, setSearch] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<DialPadContactHit[]>([])
  const [searching, setSearching] = React.useState(false)
  const [isDesktop, setIsDesktop] = React.useState(false)
  const [position, setPosition] = React.useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const dragStartRef = React.useRef<{
    pointerId: number
    pointerX: number
    pointerY: number
    panelX: number
    panelY: number
  } | null>(null)

  const device = useTwilioDevice()
  const call = useOutboundCallStatus()
  // A REST (phone_forward / sip) call is "live" until it reaches a terminal
  // outcome; until then the dial pad stays gated just like a browser call.
  const restCallLive = call.active !== null && !call.active.isTerminal
  const isOnCall = device.activeCall !== null || restCallLive || (calling && routingMode !== 'browser')

  const getPanelBounds = React.useCallback(() => {
    const rect = panelRef.current?.getBoundingClientRect()
    return {
      width: rect?.width ?? 272,
      height: rect?.height ?? 520,
    }
  }, [])

  const clampPosition = React.useCallback((next: { x: number; y: number }) => {
    if (typeof window === 'undefined') return next
    const { width, height } = getPanelBounds()
    const maxX = Math.max(DESKTOP_PANEL_GAP, window.innerWidth - width - DESKTOP_PANEL_GAP)
    const maxY = Math.max(DESKTOP_PANEL_GAP, window.innerHeight - height - DESKTOP_PANEL_GAP)
    return {
      x: Math.min(Math.max(next.x, DESKTOP_PANEL_GAP), maxX),
      y: Math.min(Math.max(next.y, DESKTOP_PANEL_GAP), maxY),
    }
  }, [getPanelBounds])

  const getDefaultPosition = React.useCallback(() => {
    if (typeof window === 'undefined') return { x: 0, y: DESKTOP_PANEL_TOP }
    const { width } = getPanelBounds()
    return clampPosition({
      x: window.innerWidth - width - DESKTOP_PANEL_GAP,
      y: DESKTOP_PANEL_TOP,
    })
  }, [clampPosition, getPanelBounds])

  // Attach client-side recorder for browser-mode calls
  useCallRecorder(device.activeCall, recordCalls && routingMode === 'browser')

  React.useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const sync = () => setIsDesktop(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  React.useEffect(() => {
    if (!open || !isDesktop) return
    setPosition((current) => current ? clampPosition(current) : getDefaultPosition())
  }, [clampPosition, getDefaultPosition, isDesktop, open])

  React.useEffect(() => {
    if (!isDesktop) return
    const handleResize = () => {
      setPosition((current) => current ? clampPosition(current) : getDefaultPosition())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampPosition, getDefaultPosition, isDesktop])

  // Load org phone numbers once
  React.useEffect(() => {
    getOrgPhoneNumbers().then((nums) => {
      setPhoneNumbers(nums)
      const def = nums.find((n) => n.is_default) ?? nums[0]
      if (def) setFromNumber(def.e164)
    })
  }, [])

  // External callers (e.g. contact detail) can prefill the dial-pad without
  // initiating a call | opens the panel and fills the number field.
  const handlePrefill = React.useCallback((phone: string) => {
    setNumber(phone)
    setOpen(true)
  }, [])
  useDialPadPrefill(handlePrefill)

  // Header button toggles the panel open/closed.
  const handleToggle = React.useCallback(() => {
    setOpen((v) => !v)
  }, [])
  useDialPadToggle(handleToggle)

  // Contact search | fires after 3 chars with a small debounce. Matches name,
  // company, or phone via ilike on the contacts table.
  React.useEffect(() => {
    const q = search.trim()
    if (q.length < 3) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const handle = setTimeout(async () => {
      const results = await searchContactsForDialPad(q)
      if (cancelled) return
      setSearchResults(results)
      setSearching(false)
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [search])

  function handlePickContact(hit: DialPadContactHit) {
    if (!hit.phone) return
    setNumber(hit.phone)
    setSearch('')
    setSearchResults([])
  }

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

  function handleDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDesktop || event.button !== 0) return
    const current = position ?? getDefaultPosition()
    dragStartRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      panelX: current.x,
      panelY: current.y,
    }
    setPosition(current)
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleDragMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    event.preventDefault()
    setPosition(clampPosition({
      x: start.panelX + event.clientX - start.pointerX,
      y: start.panelY + event.clientY - start.pointerY,
    }))
  }

  function handleDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    dragStartRef.current = null
    setDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  async function handleCall() {
    const norm = normaliseE164(number)
    if (!norm) {
      toast.error('Enter a valid E.164 number | e.g. +14155551234.')
      return
    }
    setCalling(true)

    if (routingMode === 'browser') {
      const call = await device.placeCall(norm)
      if (!call) {
        setCalling(false)
        toast.error('Browser call failed | check your settings.')
      }
      // state tracks via device.activeCall
      return
    }

    // phone_forward / sip | initiate via REST. The browser isn't part of the
    // call, so live status comes from the call_logs realtime subscription that
    // call.track() opens against the returned CallSid.
    try {
      const body: Record<string, string> = { to: norm }
      if (fromNumber) body.from = fromNumber
      const res = await fetch('/api/twilio/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { sid?: string; error?: string }
      if (!res.ok) {
        toast.error(data.error ?? `Call failed (${res.status})`)
        setCalling(false)
        return
      }
      setCalling(false)
      if (data.sid) {
        call.track(data.sid, norm)
      } else {
        // No SID returned (unexpected) | fall back to the original toast.
        toast.success(`Calling ${norm} | your phone will ring shortly.`)
      }
      setNumber('')
    } catch {
      toast.error('Network error | could not place call.')
      setCalling(false)
    }
  }

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (!open) return null

  const trimmedSearch = search.trim()
  const showResults = trimmedSearch.length >= 3

  // Unified active-call card | browser-mode calls read live state from the Twilio
  // Voice SDK (device.activeCall); phone_forward / sip calls read it from the
  // call_logs realtime subscription (call.active). Only one is ever set at a time.
  const browserActive = device.activeCall !== null
  const showCallCard = browserActive || call.active !== null
  const cardPhase: CallPhase = browserActive ? 'connected' : (call.active?.phase ?? 'initiating')
  const cardLabel = browserActive ? (number || 'Chamada ativa') : (call.active?.label ?? '')
  const cardPhaseLabel = browserActive ? 'Conectado' : (call.active?.phaseLabel ?? '')
  const cardElapsed = browserActive ? elapsed : call.elapsed
  const cardTerminal = !browserActive && (call.active?.isTerminal ?? false)
  // Show the timer once connected (browser) or while/after a REST call has a duration.
  const showTimer = browserActive || cardPhase === 'connected' || (cardTerminal && cardElapsed > 0)

  return (
    <>
      {/* Desktop backdrop overlay with blur */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:block hidden animate-dialpad-overlay"
        onClick={() => setOpen(false)}
      />

      <div
        className="fixed inset-0 z-50 sm:inset-auto sm:top-16 sm:right-4"
        style={isDesktop && position ? { left: position.x, top: position.y, right: 'auto' } : undefined}
      >
        <div
          ref={panelRef}
          className="w-full h-full sm:w-[272px] sm:h-auto sm:max-h-[calc(100vh-5rem)] rounded-none sm:rounded-[18px] border-0 sm:border sm:border-border bg-bg-primary shadow-2xl flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        >
          {/* Header */}
          <div
            className={cn(
              'flex items-center justify-between border-b border-border px-6 sm:px-4 py-4 sm:py-3 select-none',
              'sm:cursor-grab sm:touch-none',
              dragging && 'sm:cursor-grabbing',
            )}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-accent" />
              <span className="text-[13px] font-semibold text-text-primary">Dial pad</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              onPointerDown={(event) => event.stopPropagation()}
              className="flex h-9 w-9 sm:h-auto sm:w-auto items-center justify-center rounded-full sm:rounded-none bg-bg-tertiary sm:bg-transparent text-text-secondary sm:text-text-tertiary hover:text-text-primary transition-colors"
              aria-label="Close dial pad"
            >
              <X className="h-5 w-5 sm:hidden" />
              <ChevronDown className="hidden sm:block h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 p-6 sm:p-4 flex flex-col gap-4 sm:gap-0 sm:space-y-4 overflow-y-auto">
            {/* Contact search | name / company / phone, min 3 chars */}
            <div className="relative">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, company or phone"
                  className="h-9 pl-8 pr-8 text-[12.5px]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {showResults && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-[10px] border border-border bg-bg-secondary shadow-lg max-h-[200px] overflow-y-auto">
                  {searching && (
                    <div className="px-3 py-2 text-[11.5px] text-text-tertiary">
                      Searching…
                    </div>
                  )}
                  {!searching && searchResults.length === 0 && (
                    <div className="px-3 py-2 text-[11.5px] text-text-tertiary">
                      No contacts found.
                    </div>
                  )}
                  {!searching &&
                    searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handlePickContact(c)}
                        className="block w-full border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-bg-tertiary"
                      >
                        <div className="truncate text-[12px] font-medium text-text-primary">
                          {c.name || (c.phone ? formatPhoneDisplay(c.phone) : 'Unnamed contact')}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-text-tertiary">
                          {c.company && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Building2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{c.company}</span>
                            </span>
                          )}
                          {c.company && c.phone && <span>·</span>}
                          {c.phone && (
                            <span className="truncate font-mono">{formatPhoneDisplay(c.phone)}</span>
                          )}
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Active call card | browser (Voice SDK) + phone_forward/sip (realtime) */}
            {showCallCard && (
              <div className="rounded-[12px] border border-accent/30 bg-accent/[0.06] p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-tertiary">
                      <span className={cn('h-2 w-2 rounded-full', phaseDotClass(cardPhase))} />
                      {cardPhaseLabel}
                    </p>
                    <p className="truncate text-[13px] font-medium text-text-primary">{cardLabel}</p>
                  </div>
                  {showTimer && (
                    <span className="shrink-0 text-[13px] font-mono text-accent">
                      {formatElapsed(cardElapsed)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Mute only exists for browser-mode calls | phone_forward audio
                      lives on the operator's physical phone and can't be muted here. */}
                  {browserActive && (
                    <button
                      type="button"
                      onClick={handleMute}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border py-2 text-[12px] font-medium transition-colors',
                        muted
                          ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                          : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary',
                      )}
                      aria-label={muted ? 'Reativar som' : 'Mudo'}
                    >
                      {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      {muted ? 'Reativar' : 'Mudo'}
                    </button>
                  )}
                  {cardTerminal ? (
                    <button
                      type="button"
                      onClick={() => call.dismiss()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-bg-secondary py-2 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                      aria-label="Fechar"
                    >
                      <X className="h-3.5 w-3.5" />
                      Fechar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={browserActive ? handleHangUp : () => call.hangUp()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-rose-500/30 bg-rose-500/10 py-2 text-[12px] font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
                      aria-label="Encerrar"
                    >
                      <PhoneOff className="h-3.5 w-3.5" />
                      Encerrar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Phone number input */}
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+14155551234"
              className="h-16 sm:h-11 text-center text-[28px] sm:text-[17px] font-semibold sm:font-medium tracking-wide"
              disabled={browserActive || restCallLive}
            />

            {/* Dial pad grid | mobile-first: keys are square (circular) and sized by the
                grid columns, so they never squish or overlap regardless of panel height.
                The panel scrolls naturally if the viewport is short. */}
            <div className="grid grid-cols-3 gap-3 sm:gap-1.5 mx-auto w-full max-w-[300px] sm:max-w-none">
              {DIAL_KEYS.map((k) => (
                <button
                  key={k.digit}
                  type="button"
                  onClick={() => appendDigit(k.digit)}
                  className={cn(
                    'flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-full sm:rounded-[10px] border border-border bg-bg-tertiary text-text-primary transition-all',
                    'hover:border-border-strong hover:bg-bg-secondary active:scale-95 active:bg-bg-secondary',
                  )}
                >
                  <span className="text-[27px] sm:text-[18px] font-semibold sm:font-medium leading-none">{k.digit}</span>
                  {k.letters && (
                    <span className="text-[9.5px] sm:text-[8.5px] font-medium uppercase leading-none tracking-[0.14em] text-text-tertiary">
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
          </div>

          {/* Pinned footer | stays visible so the Call button never scrolls out of view */}
          <div className="shrink-0 border-t border-border px-6 sm:px-4 py-4 sm:py-3 flex flex-col gap-4 sm:gap-3">
            {/* Action row: backspace + call | hidden while a call is live */}
            {!browserActive && !restCallLive && (
              <div className="flex items-center gap-2 sm:gap-2">
                <button
                  type="button"
                  onClick={backspace}
                  disabled={!number || calling}
                  aria-label="Backspace"
                  className="flex h-16 w-16 sm:h-10 sm:w-10 items-center justify-center rounded-full sm:rounded-[10px] border border-border bg-bg-secondary text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                >
                  <Delete className="h-5 w-5 sm:h-4 sm:w-4" />
                </button>
                <Button
                  onClick={handleCall}
                  loading={calling}
                  disabled={!number || calling}
                  className="flex-1 h-16 sm:h-10 text-base sm:text-sm rounded-full sm:rounded-[10px]"
                >
                  <Phone className="h-5 w-5 sm:h-4 sm:w-4" />
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
      </div>
  </>
)
}
