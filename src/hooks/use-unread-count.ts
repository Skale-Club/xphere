'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePolling } from '@/hooks/use-polling'
import { POLL_UNREAD_COUNT_MS } from '@/lib/polling/intervals'

/** Drops the badge by one right away (opening an unread conversation). */
export const UNREAD_DECREMENT_EVENT = 'xphere:unread-decrement'
/** Forces a refetch (e.g. after re-marking the open thread read). */
export const UNREAD_REFRESH_EVENT = 'xphere:unread-refresh'

/**
 * Fetch the unread count. Throws on any failure so the caller keeps the last
 * known count (and `usePolling` backs off) instead of flashing the badge to 0.
 */
export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/chat/unread-count')
  if (!res.ok) throw new Error(`unread-count failed (${res.status})`)
  const data = await res.json() as { count?: number }
  return data.count ?? 0
}

/**
 * Returns the count of conversations with unread messages for the current user.
 * Polled every POLL_UNREAD_COUNT_MS (paused while the tab is hidden, refreshed on
 * focus), and refreshed immediately by the 'xphere:unread-*' window events.
 * The request goes through the app's own /api route, so the tab's org header
 * (installed by installTabOrgFetch) applies.
 *
 * @param initialCount Server-computed seed value so the badge paints correctly
 * on first render instead of always starting at 0 and waiting for the client
 * fetch. The mount-time fetch still runs and reconciles to the live count.
 */
export function useUnreadCount(userId: string | null | undefined, initialCount = 0): number {
  const [count, setCount] = useState(initialCount)

  const { refetch } = usePolling(
    async () => { setCount(await fetchUnreadCount()) },
    { intervalMs: POLL_UNREAD_COUNT_MS, enabled: Boolean(userId) },
  )

  // Instant local feedback so the badge reacts on the same tick the user
  // opens a thread, without waiting for the next poll:
  //   - 'xphere:unread-decrement' drops the count by one (opening an unread
  //     conversation). The next fetch reconciles to the authoritative count.
  //   - 'xphere:unread-refresh' forces a refetch (e.g. after re-marking the
  //     open thread read as inbound messages stream in).
  const onRefresh = useCallback(() => { void refetch() }, [refetch])
  useEffect(() => {
    if (!userId) return
    const onDecrement = () => setCount((c) => Math.max(0, c - 1))
    window.addEventListener(UNREAD_DECREMENT_EVENT, onDecrement)
    window.addEventListener(UNREAD_REFRESH_EVENT, onRefresh)
    return () => {
      window.removeEventListener(UNREAD_DECREMENT_EVENT, onDecrement)
      window.removeEventListener(UNREAD_REFRESH_EVENT, onRefresh)
    }
  }, [userId, onRefresh])

  return count
}
