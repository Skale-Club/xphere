'use client'

/**
 * useOutboundCallStatus | live status for server-initiated (phone_forward / sip)
 * outbound calls.
 *
 * These calls are placed via /api/twilio/outbound. Twilio rings the operator's
 * physical phone and bridges to the contact, so the browser is NOT part of the
 * call and has no Twilio Voice SDK `Call` object to read. The only source of
 * truth is the call_logs row, updated by the /api/twilio/status webhook. We
 * subscribe to it via Supabase Realtime (postgres_changes), the same mechanism
 * the chat inbox uses, and surface a UI-friendly lifecycle:
 *
 *   Starting... -> Ringing... -> Connected -> Ended / Busy / No answer / ...
 *
 * The hook is self-contained (no provider) so it works regardless of routing
 * mode. Browser-mode calls use device.activeCall directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { createClient } from '@/lib/supabase/client'

export type CallPhase =
  | 'initiating'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'busy'
  | 'no-answer'
  | 'failed'
  | 'canceled'

const TERMINAL_PHASES: ReadonlySet<CallPhase> = new Set<CallPhase>([
  'ended',
  'busy',
  'no-answer',
  'failed',
  'canceled',
])

/** Map a raw Twilio call_logs.status to a UI phase. */
function toPhase(raw: string | null | undefined): CallPhase {
  switch ((raw ?? '').toLowerCase()) {
    case 'ringing':
      return 'ringing'
    case 'in-progress':
    case 'answered':
      return 'connected'
    case 'completed':
      return 'ended'
    case 'busy':
      return 'busy'
    case 'no-answer':
      return 'no-answer'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'initiated':
    case 'queued':
    default:
      return 'initiating'
  }
}

const PHASE_LABELS: Record<CallPhase, string> = {
  initiating: 'Starting...',
  ringing: 'Ringing...',
  connected: 'Connected',
  ended: 'Ended',
  busy: 'Busy',
  'no-answer': 'No answer',
  failed: 'Failed',
  canceled: 'Canceled',
}

export interface ActiveOutboundCall {
  sid: string
  /** Display number / contact name for the call header. */
  label: string
  phase: CallPhase
  /** Human-readable phase label. */
  phaseLabel: string
  isTerminal: boolean
  /** Final duration from the webhook, once known. */
  durationSeconds: number | null
}

export interface UseOutboundCallStatusResult {
  active: ActiveOutboundCall | null
  /** Live seconds since the call connected (frozen on terminal). */
  elapsed: number
  /** Begin tracking a call returned by /api/twilio/outbound. */
  track: (sid: string, label: string) => void
  /** Hang up the in-flight call via REST. */
  hangUp: () => Promise<void>
  /** Clear the card (after a terminal state, or to dismiss). */
  dismiss: () => void
}

// Keep the terminal card on screen briefly so the outcome is readable.
const AUTO_DISMISS_MS = 6_000

export function useOutboundCallStatus(): UseOutboundCallStatusResult {
  const [active, setActive] = useState<ActiveOutboundCall | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the active sid synchronously so realtime handlers/cleanup can compare
  // without closing over stale state.
  const sidRef = useRef<string | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const dismiss = useCallback(() => {
    sidRef.current = null
    if (dismissRef.current) clearTimeout(dismissRef.current)
    dismissRef.current = null
    clearTimer()
    setElapsed(0)
    setActive(null)
  }, [clearTimer])

  const track = useCallback((sid: string, label: string) => {
    if (dismissRef.current) clearTimeout(dismissRef.current)
    dismissRef.current = null
    sidRef.current = sid
    setElapsed(0)
    setActive({
      sid,
      label,
      phase: 'initiating',
      phaseLabel: PHASE_LABELS.initiating,
      isTerminal: false,
      durationSeconds: null,
    })
  }, [])

  const hangUp = useCallback(async () => {
    const sid = sidRef.current
    if (!sid) return
    try {
      await fetch('/api/twilio/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid }),
      })
    } catch {
      // The status webhook will still reconcile the terminal state.
    }
  }, [])

  // Subscribe to call_logs changes for the tracked sid.
  const sid = active?.sid ?? null
  useEffect(() => {
    if (!sid) return
    const supabase = createClient()
    const channel = supabase
      .channel(`outbound-call-${sid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_logs', filter: `call_sid=eq.${sid}` },
        (payload) => {
          if (sidRef.current !== sid) return
          const row = payload.new as Record<string, unknown>
          const phase = toPhase(row.status as string | null)
          const isTerminal = TERMINAL_PHASES.has(phase)
          const durationSeconds =
            typeof row.duration_seconds === 'number' ? row.duration_seconds : null

          setActive((prev) =>
            prev && prev.sid === sid
              ? {
                  ...prev,
                  phase,
                  phaseLabel: PHASE_LABELS[phase],
                  isTerminal,
                  durationSeconds,
                }
              : prev,
          )
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [sid])

  // Elapsed timer: counts while connected, freezes on terminal.
  const phase = active?.phase ?? null
  const isTerminal = active?.isTerminal ?? false
  const finalDuration = active?.durationSeconds ?? null
  useEffect(() => {
    if (phase === 'connected') {
      clearTimer()
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      clearTimer()
      if (isTerminal && typeof finalDuration === 'number' && finalDuration > 0) {
        setElapsed(finalDuration)
      }
    }
    return clearTimer
  }, [phase, isTerminal, finalDuration, clearTimer])

  // Auto-dismiss after a terminal state.
  useEffect(() => {
    if (!isTerminal) return
    if (dismissRef.current) clearTimeout(dismissRef.current)
    dismissRef.current = setTimeout(() => dismiss(), AUTO_DISMISS_MS)
    return () => {
      if (dismissRef.current) clearTimeout(dismissRef.current)
    }
  }, [isTerminal, dismiss])

  return { active, elapsed, track, hangUp, dismiss }
}
