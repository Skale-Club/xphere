'use client'

/**
 * usePolling | run a fetcher on an interval (replacement for Supabase Realtime).
 *
 * Behaviour:
 *   - Runs the fetcher every `intervalMs` (plus jitter so tabs do not sync up).
 *   - Pauses while `document.hidden` (unless `hiddenIntervalMs` is set, see
 *     below); refetches immediately when the tab becomes visible again and when
 *     the window regains focus.
 *   - Never overlaps requests: a run is skipped while the previous one is
 *     still in flight, and the next one is scheduled after it settles.
 *   - A fetcher that throws / rejects backs off exponentially
 *     (interval * 2^failures, capped at `maxBackoffMs`); the first success
 *     resets it.
 *   - Stops on unmount or when `enabled` becomes false.
 *
 * The fetcher is read through a ref, so passing an inline function is fine and
 * does not restart the loop. `intervalMs` is also read through a ref: changing
 * it takes effect on the next scheduled run without an extra immediate fetch.
 *
 * Data must come from server code (server actions / route handlers), never from
 * a browser Supabase client, so RLS and the per-tab org header still apply.
 */

import { useCallback, useEffect, useRef } from 'react'

export interface UsePollingOptions {
  /** Base interval while the tab is visible. */
  intervalMs: number
  /** Set false to stop polling (e.g. nothing active to watch). Default true. */
  enabled?: boolean
  /** Run once right away on mount / when re-enabled. Default true. */
  immediate?: boolean
  /** Cap for the error backoff. Default 60s (never below `intervalMs`). */
  maxBackoffMs?: number
  /** Jitter as a fraction of the delay, applied as +/-. Default 0.15. */
  jitter?: number
  /**
   * Keep polling while the tab is hidden, at this (slower) interval. Unset
   * means "pause while hidden". Only for polls whose result cannot wait for a
   * refocus (the notification bell's incoming-call alert).
   */
  hiddenIntervalMs?: number
}

export interface UsePollingResult {
  /** Run the fetcher now. If one is in flight, runs once more right after it. */
  refetch: () => Promise<void>
}

export const DEFAULT_MAX_BACKOFF_MS = 60_000
export const DEFAULT_JITTER = 0.15
/** Ignore a focus/visibility wake-up this soon after a run started. */
export const MIN_WAKE_GAP_MS = 500

/**
 * Delay before the next run. Exported for tests.
 * `random` is injectable (defaults to Math.random) so jitter is deterministic.
 */
export function computePollDelay(
  intervalMs: number,
  failures: number,
  options: { maxBackoffMs?: number; jitter?: number; random?: () => number } = {},
): number {
  const maxBackoff = Math.max(options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS, intervalMs)
  const jitter = options.jitter ?? DEFAULT_JITTER
  const random = options.random ?? Math.random
  const exponent = Math.min(Math.max(failures, 0), 20)
  const base = Math.min(intervalMs * 2 ** exponent, maxBackoff)
  const spread = (random() * 2 - 1) * jitter
  return Math.max(0, Math.round(base * (1 + spread)))
}

export function usePolling(
  fetcher: () => Promise<unknown> | unknown,
  options: UsePollingOptions,
): UsePollingResult {
  const { enabled = true, immediate = true } = options

  const fetcherRef = useRef(fetcher)
  const optionsRef = useRef(options)
  const runRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    fetcherRef.current = fetcher
    optionsRef.current = options
  })

  useEffect(() => {
    if (!enabled) {
      runRef.current = null
      return
    }

    let stopped = false
    let inFlight = false
    let failures = 0
    let rerunRequested = false
    let lastStartedAt = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    // Always replaces any pending timer, so at most one is ever armed.
    const schedule = () => {
      clearTimer()
      if (stopped) return
      const { intervalMs, maxBackoffMs, jitter, hiddenIntervalMs } = optionsRef.current
      if (document.hidden && !hiddenIntervalMs) return
      const base = document.hidden && hiddenIntervalMs ? hiddenIntervalMs : intervalMs
      timer = setTimeout(() => {
        timer = null
        void run()
      }, computePollDelay(base, failures, { maxBackoffMs, jitter }))
    }

    // `force` is set by explicit refetch() calls: if a run is already in flight
    // its data may predate the change that prompted the refetch, so run once
    // more right after it settles (still never two at the same time).
    const run = async (force = false): Promise<void> => {
      if (stopped) return
      if (inFlight) {
        if (force) rerunRequested = true
        return
      }
      inFlight = true
      lastStartedAt = Date.now()
      try {
        await fetcherRef.current()
        failures = 0
      } catch {
        failures += 1
      } finally {
        inFlight = false
      }
      if (stopped) return
      if (rerunRequested) {
        rerunRequested = false
        if (!document.hidden) {
          await run()
          return
        }
      }
      // A plain hidden tab arms no timer here; the visibility handler resumes it.
      schedule()
    }

    // Whatever path it takes, a wake-up leaves exactly one thing pending: a
    // run in flight (which schedules the next one when it settles), a run
    // started now, or one timer. Returning early without that would strand the
    // loop, e.g. a run that ended while the tab was hidden (no timer armed)
    // followed by a refocus inside MIN_WAKE_GAP_MS.
    const wake = () => {
      if (stopped || document.hidden || inFlight) return
      if (Date.now() - lastStartedAt < MIN_WAKE_GAP_MS) {
        schedule()
        return
      }
      clearTimer()
      void run()
    }

    const onVisibility = () => {
      if (document.hidden) {
        // Swap the visible-rate timer for the hidden-rate one (or none).
        if (!inFlight) schedule()
        else clearTimer()
      } else {
        wake()
      }
    }

    runRef.current = () => run(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', wake)

    if (immediate && !document.hidden) void run()
    else schedule()

    return () => {
      stopped = true
      clearTimer()
      runRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', wake)
    }
  }, [enabled, immediate])

  const refetch = useCallback(async () => {
    await runRef.current?.()
  }, [])

  return { refetch }
}
