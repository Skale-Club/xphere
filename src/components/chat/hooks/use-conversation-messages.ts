'use client'

/**
 * useConversationMessages | message history + pagination for the open thread.
 *
 * Extracted from ChatLayout. Owns:
 *   - the messages array and its loading flags
 *   - the initial fetch (clears the previous thread first so MessageList detects
 *     an "initial load" and scrolls to bottom — see the comment on the effect)
 *   - cursor-based "load older" pagination
 *   - the realtime-INSERT reconciliation (dedup by id + swap of the optimistic
 *     temp bubble for the canonical row)
 *
 * `setMessages` is exposed so the layout can drive optimistic sends (which also
 * touch the conversation-list preview, a concern that stays in the layout).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationMessage } from '@/types/chat'

const MESSAGE_PAGE_SIZE = 30

export interface UseConversationMessagesResult {
  messages: ConversationMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessage[]>>
  isMessagesLoading: boolean
  hasMoreMessages: boolean
  isLoadingMoreMessages: boolean
  loadMoreMessages: () => Promise<void>
  /** Reconcile a realtime-arrived message: dedup by id, swap matching temp bubble. */
  applyRealtimeInsert: (newMsg: ConversationMessage) => void
}

export function useConversationMessages(
  selectedId: string | null,
): UseConversationMessagesResult {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false)

  // Guards stale responses when the user switches threads mid-fetch.
  const selectedIdRef = useRef<string | null>(selectedId)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const fetchMessages = useCallback(async (id: string) => {
    setIsMessagesLoading(true)
    setHasMoreMessages(false)
    setIsLoadingMoreMessages(false)
    try {
      const res = await fetch(
        `/api/chat/conversations/${id}/messages?includeInternal=true&limit=${MESSAGE_PAGE_SIZE}`,
      )
      if (!res.ok) return
      const data = await res.json()
      if (selectedIdRef.current === id) {
        setMessages(data.messages ?? [])
        setHasMoreMessages(data.hasMore ?? false)
      }
    } catch {
      // ignore
    } finally {
      setIsMessagesLoading(false)
    }
  }, [])

  const loadMoreMessages = useCallback(async () => {
    if (!selectedId || isLoadingMoreMessages || !hasMoreMessages) return
    const cursor = messages[0]?.id
    if (!cursor) return
    setIsLoadingMoreMessages(true)
    try {
      const res = await fetch(
        `/api/chat/conversations/${selectedId}/messages?includeInternal=true&limit=${MESSAGE_PAGE_SIZE}&before=${cursor}`,
      )
      if (!res.ok) return
      const data = await res.json()
      if (selectedIdRef.current === selectedId) {
        setMessages((prev) => [...(data.messages ?? []), ...prev])
        setHasMoreMessages(data.hasMore ?? false)
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingMoreMessages(false)
    }
  }, [selectedId, messages, isLoadingMoreMessages, hasMoreMessages])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    // Clear the previous conversation's messages before fetching so that
    // MessageList sees an empty array on mount and correctly detects the
    // first batch as an "initial load" (scroll to bottom), not a "prepend"
    // (scroll restoration). Without this, switching from a longer to a
    // shorter conversation could leave the view stuck mid-thread.
    setMessages([])
    fetchMessages(selectedId)
  }, [selectedId, fetchMessages])

  const applyRealtimeInsert = useCallback((newMsg: ConversationMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === newMsg.id)) return prev
      const newTime = new Date(newMsg.createdAt).getTime()
      const dupIdx = prev.findIndex(
        (m) =>
          m.id.startsWith('temp-') &&
          m.role === newMsg.role &&
          m.content === newMsg.content &&
          Math.abs(new Date(m.createdAt).getTime() - newTime) < 30000,
      )
      if (dupIdx >= 0) {
        const next = [...prev]
        next[dupIdx] = newMsg
        return next
      }
      return [...prev, newMsg]
    })
  }, [])

  return {
    messages,
    setMessages,
    isMessagesLoading,
    hasMoreMessages,
    isLoadingMoreMessages,
    loadMoreMessages,
    applyRealtimeInsert,
  }
}
