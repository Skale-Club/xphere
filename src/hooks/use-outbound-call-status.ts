'use client'

/**
 * useOutboundCallStatus | live status for server-initiated (phone_forward / sip)
 * outbound calls.
 *
 * These calls are placed via /api/twilio/outbound. Twilio rings the operator's
 * physical phone and bridges to the contact, so the browser is NOT part of the
 * call and has no Twilio Voice SDK `Call` object to read. The only source of
 * truth is the call_logs row, updated by the /api/twilio/status webhook. We
 * poll it through a route handler (every POLL_OUTBOUND_CALL_MS, only while a
 * call is tracked and the tab is visible) and surface a UI-friendly lifecycle:
 *
 *   Starting... -> Ringing... -> Connected -> Ended / Busy / No answer / ...
 *
 * The hook is self-contained (no provider) so it works regardless of routing
 * mode. Browser-mode calls use device.activeCall directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { pollFetchJson } from '@/lib/polling/fetch-json'
import { usePolling } from '@/hooks/use-polling'
import { POLL_OUTBOUND_CALL_MS } from '@/lib/polling/intervals'

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
export function toPhase(raw: string | null | undefined): CallPhase {
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
  // Track the active sid synchronously so poll results/cleanup can compare
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

  // Poll call_logs for the tracked sid until it reaches a terminal state
  // (replaces the Realtime subscription).
  const sid = active?.sid ?? null
  // After a terminal status keep polling only until the final duration lands
  // (the card auto-dismisses after AUTO_DISMISS_MS anyway).
  const needsPolling = active != null && (!active.isTerminal || active.durationSeconds == null)
  usePolling(
    async () => {
      if (!sid) return
      const row = await pollFetchJson<{ status: string | null; durationSeconds: number | null }>(
        `/api/poll/call-status?sid=${encodeURIComponent(sid)}`,
      )
      // No row yet (webhook has not fired) or the call was dismissed/replaced.
      if (row.status === null || sidRef.current !== sid) return
      const phase = toPhase(row.status)
      const isTerminal = TERMINAL_PHASES.has(phase)
      const durationSeconds = row.durationSeconds

      setActive((prev) =>
        prev && prev.sid === sid
          ? prev.phase === phase && prev.durationSeconds === durationSeconds
            ? prev
            : {
                ...prev,
                phase,
                phaseLabel: PHASE_LABELS[phase],
                isTerminal,
                durationSeconds,
              }
          : prev,
      )
    },
    { intervalMs: POLL_OUTBOUND_CALL_MS, enabled: needsPolling },
  )

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
