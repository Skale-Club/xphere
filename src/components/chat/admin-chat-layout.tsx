'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import { ConversationSummary, ConversationMessage } from '@/types/chat'
import { toggleBotStatus } from '@/app/(dashboard)/chat/actions'
import { createClient } from '@/lib/supabase/client'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { ConversationList } from '@/components/chat/conversation-list'
import { ChatArea } from '@/components/chat/chat-area'

// Maps a raw conversations DB row (snake_case) to the ConversationSummary
// shape used in component state. Realtime payloads do NOT include the joined
// page_name from meta_channels — channelAccountName falls back to the
// page_id when present and is re-enriched on the next manual fetch.
function mapConversationRow(row: Record<string, unknown>): ConversationSummary {
  const meta = (row.channel_metadata as Record<string, string>) ?? {}
  const pageId = meta?.page_id ?? null
  return {
    id: row.id as string,
    status: (row.status as string) ?? 'open',
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
  }
}

// Maps a raw conversation_messages DB row (snake_case) to the
// ConversationMessage shape used in component state.
function mapMessageRow(row: Record<string, unknown>): ConversationMessage {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as string,
    content: row.content as string,
    createdAt: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }
}

interface AdminChatLayoutProps {
  /** Active organization id. Used to scope Realtime subscriptions
   *  (defense-in-depth alongside RLS). */
  currentOrgId: string | null
  /** OBS-08: Maps agent_id → agent name for per-message agent badges. */
  agentMap?: Record<string, string>
}

export function AdminChatLayout({ currentOrgId, agentMap }: AdminChatLayoutProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [isMobileListVisible, setIsMobileListVisible] = useState(true)
  const [botTogglingId, setBotTogglingId] = useState<string | null>(null)
  // Tracks the current conversation ID synchronously to guard stale fetch responses
  const selectedConversationIdRef = useRef<string | null>(null)

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations')
      if (!res.ok) return
      const data = await res.json()
      setConversations(data.conversations ?? [])
    } catch {
      // silently fail — will retry on next interval
    }
  }, [])

  // Fetch messages for a conversation — guards against stale responses when switching conversations
  const fetchMessages = useCallback(async (id: string) => {
    setIsMessagesLoading(true)
    try {
      const res = await fetch(
        `/api/chat/conversations/${id}/messages?includeInternal=true`
      )
      if (!res.ok) return
      const data = await res.json()
      // Discard if user switched away before this response arrived
      if (selectedConversationIdRef.current === id) {
        setMessages(data.messages ?? [])
      }
    } catch {
      // silently fail
    } finally {
      setIsMessagesLoading(false)
    }
  }, [])

  // Initial conversations fetch (warm-up). Realtime takes over for updates.
  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // Keep ref in sync with state so fetchMessages can read current value without stale closure
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId
  }, [selectedConversationId])

  // Initial messages fetch when a conversation is selected (warm-up).
  // Realtime INSERT events take over for live updates.
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      return
    }
    fetchMessages(selectedConversationId)
  }, [selectedConversationId, fetchMessages])

  // Realtime: conversations channel — INSERT prepends, UPDATE replaces in place.
  // Filter by org_id is defense-in-depth alongside RLS so we never receive
  // events for other tenants. Cleanup via removeChannel prevents zombie websockets.
  useEffect(() => {
    if (!currentOrgId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`chat-inbox-conversations-${currentOrgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `org_id=eq.${currentOrgId}`,
        },
        (payload) => {
          const newConv = mapConversationRow(payload.new)
          setConversations((prev) => {
            if (prev.some((c) => c.id === newConv.id)) return prev
            return [newConv, ...prev]
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `org_id=eq.${currentOrgId}`,
        },
        (payload) => {
          const updated = mapConversationRow(payload.new)
          setConversations((prev) => {
            const next = prev.map((c) =>
              c.id === updated.id
                ? // Preserve the resolved channelAccountName from the initial fetch
                  // since realtime payloads don't include the joined meta_channels.page_name
                  { ...updated, channelAccountName: c.channelAccountName ?? updated.channelAccountName }
                : c
            )
            // Re-sort by last_message_at desc (matches initial fetch order)
            return next.sort(
              (a, b) =>
                new Date(b.lastMessageAt ?? 0).getTime() -
                new Date(a.lastMessageAt ?? 0).getTime()
            )
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentOrgId])

  // Realtime: messages channel — only the currently-open conversation.
  // Re-subscribes when selectedConversationId changes; cleanup tears down
  // the previous channel.
  useEffect(() => {
    if (!selectedConversationId || !currentOrgId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`chat-inbox-messages-${selectedConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        (payload) => {
          const newMsg = mapMessageRow(payload.new)
          setMessages((prev) => {
            // De-dup against optimistic temp messages already appended on send.
            // The temp uses a `temp-*` id; the real row has a UUID — so direct
            // id matching won't catch it. Fall back to (role, content, ~recent)
            // matching for assistant messages within a 30s window.
            if (prev.some((m) => m.id === newMsg.id)) return prev
            const newTime = new Date(newMsg.createdAt).getTime()
            const dupIdx = prev.findIndex(
              (m) =>
                m.id.startsWith('temp-') &&
                m.role === newMsg.role &&
                m.content === newMsg.content &&
                Math.abs(new Date(m.createdAt).getTime() - newTime) < 30000
            )
            if (dupIdx >= 0) {
              const next = [...prev]
              next[dupIdx] = newMsg
              return next
            }
            return [...prev, newMsg]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedConversationId, currentOrgId])

  // Optimistic send
  async function handleSendMessage(content: string) {
    if (!selectedConversationId) return

    // Optimistic append
    const tempId = `temp-${crypto.randomUUID()}`
    const tempMsg: ConversationMessage = {
      id: tempId,
      conversationId: selectedConversationId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempMsg])

    try {
      const res = await fetch(
        `/api/chat/conversations/${selectedConversationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, role: 'assistant' }),
        }
      )
      if (!res.ok) throw new Error('Failed to send')
      // Reload to get real message with server ID
      await fetchMessages(selectedConversationId)
    } catch {
      // Rollback on error
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    }
  }

  async function handleStatusChange(status: 'open' | 'closed') {
    if (!selectedConversationId) return
    try {
      await fetch(
        `/api/chat/conversations/${selectedConversationId}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      )
      await fetchConversations()
    } catch {
      // silently fail
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
      setSelectedConversationId(null)
      setMessages([])
      setIsMobileListVisible(true)
      await fetchConversations()
    } catch {
      // silently fail
    }
  }

  async function handleBotStatusToggle(conversationId: string, currentStatus: string) {
    if (botTogglingId) return // prevent concurrent toggles
    setBotTogglingId(conversationId)
    const optimisticStatus = currentStatus === 'active' ? 'paused' : 'active'
    setConversations((prev) =>
      prev.map((c) => c.id === conversationId ? { ...c, botStatus: optimisticStatus } : c)
    )
    const result = await toggleBotStatus(conversationId, currentStatus)
    if ('error' in result) {
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId ? { ...c, botStatus: currentStatus } : c)
      )
      toast.error('Failed to update bot status')
    }
    setBotTogglingId(null)
  }

  const selectedConversation =
    conversations.find((c) => c.id === selectedConversationId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Desktop layout */}
      <ResizablePanelGroup
        direction="horizontal"
        className="hidden md:flex h-full"
      >
        <ResizablePanel
          defaultSize={25}
          minSize={20}
          maxSize={40}
          className="min-w-[280px]"
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedConversationId}
            onSelect={setSelectedConversationId}
            onConversationUpdated={fetchConversations}
            onConversationDeleted={(id) => {
              if (selectedConversationId === id) {
                setSelectedConversationId(null)
                setMessages([])
              }
              fetchConversations()
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={75}>
          <ChatArea
            conversation={selectedConversation}
            messages={messages}
            isLoading={isMessagesLoading}
            onSendMessage={handleSendMessage}
            onStatusChange={handleStatusChange}
            onDelete={() =>
              selectedConversationId && handleDelete(selectedConversationId)
            }
            onBack={() => {}}
            onBotStatusToggle={(id, status) => handleBotStatusToggle(id, status)}
            isBotToggling={botTogglingId === selectedConversationId}
            agentMap={agentMap}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Mobile layout */}
      <div className="flex md:hidden relative flex-1 overflow-hidden">
        {/* List panel */}
        <div
          className={`absolute inset-0 transition-transform duration-300 ease-in-out ${
            isMobileListVisible ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedConversationId}
            onSelect={(id) => {
              setSelectedConversationId(id)
              setIsMobileListVisible(false)
            }}
            onConversationUpdated={fetchConversations}
            onConversationDeleted={(id) => {
              if (selectedConversationId === id) {
                setSelectedConversationId(null)
                setMessages([])
              }
              fetchConversations()
            }}
          />
        </div>

        {/* Detail panel */}
        <div
          className={`absolute inset-0 transition-transform duration-300 ease-in-out ${
            isMobileListVisible ? 'translate-x-full' : 'translate-x-0'
          }`}
        >
          <ChatArea
            conversation={selectedConversation}
            messages={messages}
            isLoading={isMessagesLoading}
            onSendMessage={handleSendMessage}
            onStatusChange={handleStatusChange}
            onDelete={() =>
              selectedConversationId && handleDelete(selectedConversationId)
            }
            onBack={() => setIsMobileListVisible(true)}
            onBotStatusToggle={(id, status) => handleBotStatusToggle(id, status)}
            isBotToggling={botTogglingId === selectedConversationId}
            agentMap={agentMap}
          />
        </div>
      </div>
    </div>
  )
}
