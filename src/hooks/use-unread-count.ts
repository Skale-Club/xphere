'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

async function fetchUnreadCount(): Promise<number> {
  try {
    const res = await fetch('/api/chat/unread-count')
    if (!res.ok) return 0
    const data = await res.json() as { count?: number }
    return data.count ?? 0
  } catch {
    return 0
  }
}

/**
 * Returns the live count of conversations with unread messages for the current user.
 * Refreshes whenever conversation_reads or conversations change via Supabase Realtime.
 *
 * @param initialCount Server-computed seed value so the badge paints correctly
 * on first render instead of always starting at 0 and waiting for the client
 * fetch. The mount-time fetch still runs and reconciles to the live count.
 */
export function useUnreadCount(userId: string | null | undefined, initialCount = 0): number {
  const [count, setCount] = useState(initialCount)
  const instanceId = useRef(Math.random().toString(36).slice(2))

  useEffect(() => {
    if (!userId) return

    fetchUnreadCount().then(setCount)

    const supabase = createClient()
    const id = instanceId.current

    // Refetch on any conversation_reads change (mark read/unread)
    // or on new messages arriving (conversations UPDATE with new last_message_at)
    const channel = supabase
      .channel(`unread-count:${userId}:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_reads', filter: `user_id=eq.${userId}` },
        () => { fetchUnreadCount().then(setCount) },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        () => { fetchUnreadCount().then(setCount) },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        () => { fetchUnreadCount().then(setCount) },
      )
      .subscribe()

    // Instant local feedback so the badge reacts on the same tick the user
    // opens a thread, without waiting for the realtime round-trip:
    //   - 'xphere:unread-decrement' drops the count by one (opening an unread
    //     conversation). Realtime then reconciles to the authoritative count.
    //   - 'xphere:unread-refresh' forces a refetch (e.g. after re-marking the
    //     open thread read as inbound messages stream in).
    const onDecrement = () => setCount((c) => Math.max(0, c - 1))
    const onRefresh = () => { void fetchUnreadCount().then(setCount) }
    window.addEventListener('xphere:unread-decrement', onDecrement)
    window.addEventListener('xphere:unread-refresh', onRefresh)

    return () => {
      void supabase.removeChannel(channel)
      window.removeEventListener('xphere:unread-decrement', onDecrement)
      window.removeEventListener('xphere:unread-refresh', onRefresh)
    }
  }, [userId])

  return count
}
