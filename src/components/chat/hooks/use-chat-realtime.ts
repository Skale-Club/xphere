'use client'

/**
 * useChatRealtime | Supabase Realtime wiring for the inbox.
 *
 * Extracted from ChatLayout. Owns three concerns, all behavior-preserving:
 *   1. postgres_changes on `conversations` (INSERT/UPDATE/DELETE) for the org,
 *      emitting mapped ConversationSummary objects to the layout's callbacks.
 *   2. postgres_changes INSERT on `conversation_messages` for the open thread.
 *   3. The per-conversation typing broadcast channel (no DB writes): surfaces an
 *      `isTyping` dot that auto-clears after 3s, plus a `broadcastTyping` sender.
 *
 * The layout keeps the cross-cutting reconciliation (list preview, fetched
 * conversation merge) — this hook only owns the subscriptions and the mapping.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import type {
  ConversationSummary,
  ConversationMessage,
  ConversationPriority,
  ConversationStatus,
} from '@/types/chat'

function mapConversationRow(row: Record<string, unknown>): ConversationSummary {
  const meta = (row.channel_metadata as Record<string, string>) ?? {}
  const pageId = meta?.page_id ?? null
  return {
    id: row.id as string,
    status: ((row.status as string) ?? 'open') as ConversationStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    visitorName: (row.visitor_name as string | null) ?? null,
    visitorEmail: (row.visitor_email as string | null) ?? null,
    visitorPhone: (row.visitor_phone as string | null) ?? null,
    lastMessage: (row.last_message as string | null) ?? null,
    channel: (row.channel as string) ?? 'widget',
    channelMetadata: meta,
    botStatus: (row.bot_status as string) ?? 'active',
    channelAccountName: pageId,
    pinned: Boolean(row.pinned),
    starred: Boolean(row.starred),
    priority: ((row.priority as string) ?? 'normal') as ConversationPriority,
    contactId: (row.contact_id as string | null) ?? null,
    contactName: null, // realtime raw row has no joined contact — preserved from API state via upsert
    contactAvatarUrl: null, // same as contactName — joined later via the next paged fetch
    contactVerified: false, // unknown until the paged refetch resolves it
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
    lastInboundAt: (row.last_inbound_at as string | null) ?? null,
  }
}

function mapMessageRow(row: Record<string, unknown>): ConversationMessage {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as string,
    content: row.content as string,
    createdAt: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    channel: (row.channel as string | null) ?? null,
  }
}

interface UseChatRealtimeParams {
  currentOrgId: string | null
  currentUserId: string | null
  selectedId: string | null
  /** Realtime conversation arrived (mapped). */
  onConversationInsert: (conversation: ConversationSummary) => void
  /** Realtime conversation changed (mapped). */
  onConversationUpdate: (conversation: ConversationSummary) => void
  /** Realtime conversation deleted. */
  onConversationDelete: (id: string) => void
  /** Realtime message arrived on the open thread (mapped). */
  onMessageInsert: (message: ConversationMessage) => void
}

export interface UseChatRealtimeResult {
  isTyping: boolean
  broadcastTyping: () => void
}

export function useChatRealtime({
  currentOrgId,
  currentUserId,
  selectedId,
  onConversationInsert,
  onConversationUpdate,
  onConversationDelete,
  onMessageInsert,
}: UseChatRealtimeParams): UseChatRealtimeResult {
  const [isTyping, setIsTyping] = useState(false)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest-callback ref so the subscriptions below are keyed only on
  // org/conversation id — not on callback identity. Without this, a callback
  // like onMessageInsert (which depends on the conversation list for the
  // preview update) would change on every list mutation and tear down + rebuild
  // the realtime channel on every incoming message, risking dropped events
  // during the resubscribe window.
  const cbRef = useRef({
    onConversationInsert,
    onConversationUpdate,
    onConversationDelete,
    onMessageInsert,
  })
  useEffect(() => {
    cbRef.current = {
      onConversationInsert,
      onConversationUpdate,
      onConversationDelete,
      onMessageInsert,
    }
  })

  // ─────────── Realtime: conversations ───────────
  useEffect(() => {
    if (!currentOrgId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`chat-inbox-conversations-${currentOrgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations', filter: `org_id=eq.${currentOrgId}` },
        (payload) => {
          cbRef.current.onConversationInsert(mapConversationRow(payload.new))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `org_id=eq.${currentOrgId}` },
        (payload) => {
          cbRef.current.onConversationUpdate(mapConversationRow(payload.new))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conversations', filter: `org_id=eq.${currentOrgId}` },
        (payload) => {
          const oldId = (payload.old as { id?: string })?.id
          if (oldId) cbRef.current.onConversationDelete(oldId)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentOrgId])

  // ─────────── Realtime: messages ───────────
  useEffect(() => {
    if (!selectedId || !currentOrgId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`chat-inbox-messages-${selectedId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          cbRef.current.onMessageInsert(mapMessageRow(payload.new))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedId, currentOrgId])

  // ─────────── Realtime: typing broadcast ───────────
  // Broadcast channel per-conversation. Both sides (operator + customer-side
  // adapter) publish a "typing" event on keystroke; we surface it as a dot
  // indicator and auto-clear after 3 seconds of silence.
  useEffect(() => {
    if (!selectedId) {
      setIsTyping(false)
      return
    }
    const supabase = createClient()
    const channel = supabase
      .channel(`typing:${selectedId}`, {
        config: { broadcast: { self: false } },
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const fromUser = (payload.payload as { user_id?: string })?.user_id
        if (fromUser && fromUser === currentUserId) return // own echo
        setIsTyping(true)
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = setTimeout(() => setIsTyping(false), 3000)
      })
      .subscribe()
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      supabase.removeChannel(channel)
    }
  }, [selectedId, currentUserId])

  // Outbound typing broadcast (debounced inside MessageComposer ~500ms)
  const broadcastTyping = useCallback(() => {
    if (!selectedId) return
    const supabase = createClient()
    const channel = supabase.channel(`typing:${selectedId}`)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { user_id: currentUserId, conversation_id: selectedId, ts: Date.now() },
        })
        // Best-effort cleanup | the receiver auto-times out after 3s.
        setTimeout(() => {
          supabase.removeChannel(channel)
        }, 500)
      }
    })
  }, [selectedId, currentUserId])

  return { isTyping, broadcastTyping }
}
