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
 */
export function useUnreadCount(userId: string | null | undefined): number {
  const [count, setCount] = useState(0)
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

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])

  return count
}
