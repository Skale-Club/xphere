'use client'

/**
 * Redesigned 3-column chat inbox (v2.2 / SEED-011 + v2.2 page-based pagination).
 *
 *   ┌──────────────┬─────────────────────────┬──────────────┐
 *   │  Conv. list  │  Chat area (messages)   │  Contact info│
 *   │   320px      │  1fr                    │  360px       │
 *   └──────────────┴─────────────────────────┴──────────────┘
 *
 * Responsibilities owned here:
 *   - Page-based conversation fetch via `usePaginatedConversations` (30/page)
 *   - Messages (REST + realtime)
 *   - Realtime subscriptions for INSERT/UPDATE on conversations + messages,
 *     dispatched into the hook's prepend/upsert/remove helpers so the list
 *     stays coherent without a full refetch.
 *   - Typing indicator via Supabase Realtime broadcast (no DB writes)
 *   - Pin / priority / assign / bot-toggle mutations (optimistic)
 *   - Mobile drawer behaviour (list / chat / info, one column visible at a time)
 *   - Top-level filter state (status / assigned / channel) is owned here so the
 *     hook can refetch + reset to page 1 when the user changes a pill.
 *
 * The left/middle/right column components are presentational and receive
 * pre-computed state. Realtime UPDATE events from Supabase reconcile any
 * optimistic state with the canonical DB.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import {
  ConversationSummary,
  ConversationMessage,
  ConversationPriority,
  ConversationStatus,
} from '@/types/chat'
import {
  toggleBotStatus,
  pinConversation,
  starConversation,
  setConversationPriority,
  assignConversation,
  listOrgMembers,
  type OrgMember,
} from '@/app/(dashboard)/chat/actions'
import { createClient } from '@/lib/supabase/client'
import {
  ConversationList,
  type ConversationFilterChange,
} from '@/components/chat/conversation-list'
import { ChatArea } from '@/components/chat/chat-area'
import { ContactInfoPanel } from '@/components/chat/contact-info-panel'
import { usePaginatedConversations } from '@/hooks/use-paginated-conversations'
import { PushPermissionBanner } from '@/components/chat/push-permission-banner'
import { cn } from '@/lib/utils'

const INBOX_MIN_WIDTH = 260
const INBOX_DEFAULT_WIDTH = 300
const INBOX_MAX_WIDTH = 420
const CHAT_MIN_WIDTH = 420

function clampInboxWidth(width: number, maxWidth: number) {
  return Math.min(Math.max(width, INBOX_MIN_WIDTH), maxWidth)
}

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
    assignedUserId: (row.assigned_user_id as string | null) ?? null,
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
  }
}

interface ChatLayoutProps {
  currentOrgId: string | null
  currentUserId: string | null
  agentMap?: Record<string, string>
}

type MobileView = 'list' | 'chat' | 'info'

export function ChatLayout({ currentOrgId, currentUserId, agentMap }: ChatLayoutProps) {
  // ─────────── Filters (server-side) ───────────
  const [filters, setFilters] = useState<ConversationFilterChange>({
    status: null,
    assigned: null,
    channel: null,
  })

  // Stable filter setter | the list calls this from an effect, so we want to
  // ignore identical updates to prevent refetch loops.
  const handleFilterChange = useCallback((next: ConversationFilterChange) => {
    setFilters((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev
      return next
    })
  }, [])

  // ─────────── Paginated conversation feed ───────────
  const {
    conversations,
    pinned,
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNext,
    hasPrev,
    isInitialLoading,
    isPageLoading,
    error: listError,
    nextPage,
    prevPage,
    refresh: refreshConversations,
    prepend: prependConversation,
    upsert: upsertConversation,
    remove: removeConversation,
  } = usePaginatedConversations(filters)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [botTogglingId, setBotTogglingId] = useState<string | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [infoOpen, setInfoOpen] = useState(true)
  const [mobileView, setMobileView] = useState<MobileView>('list')
  const [isTyping, setIsTyping] = useState(false)
  const [inboxWidth, setInboxWidth] = useState(INBOX_DEFAULT_WIDTH)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedIdRef = useRef<string | null>(null)

  const getInboxMaxWidth = useCallback(() => {
    if (typeof window === 'undefined') return INBOX_MAX_WIDTH

    const infoPanelWidth =
      infoOpen && window.innerWidth >= 1024
        ? window.innerWidth >= 1280
          ? 340
          : 300
        : 0
    const available = window.innerWidth - infoPanelWidth - CHAT_MIN_WIDTH

    return Math.max(INBOX_MIN_WIDTH, Math.min(INBOX_MAX_WIDTH, available))
  }, [infoOpen])

  // Keep ref in sync (fetchMessages reads it to guard stale responses)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    const handleResize = () => {
      setInboxWidth((width) => clampInboxWidth(width, getInboxMaxWidth()))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [getInboxMaxWidth])

  // ───────────────────────── Data fetching ─────────────────────────

  const fetchMessages = useCallback(async (id: string) => {
    setIsMessagesLoading(true)
    try {
      const res = await fetch(`/api/chat/conversations/${id}/messages?includeInternal=true`)
      if (!res.ok) return
      const data = await res.json()
      if (selectedIdRef.current === id) {
        setMessages(data.messages ?? [])
      }
    } catch {
      // ignore
    } finally {
      setIsMessagesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    fetchMessages(selectedId)
  }, [selectedId, fetchMessages])

  // Fetch org members once for the assign dropdown
  useEffect(() => {
    listOrgMembers().then(setMembers).catch(() => setMembers([]))
  }, [])

  // ───────────────────────── Realtime: conversations ─────────────────────────

  useEffect(() => {
    if (!currentOrgId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`chat-inbox-conversations-${currentOrgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations', filter: `org_id=eq.${currentOrgId}` },
        (payload) => {
          const newConv = mapConversationRow(payload.new)
          prependConversation(newConv)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `org_id=eq.${currentOrgId}` },
        (payload) => {
          const updated = mapConversationRow(payload.new)
          upsertConversation(updated)
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conversations', filter: `org_id=eq.${currentOrgId}` },
        (payload) => {
          const oldId = (payload.old as { id?: string })?.id
          if (oldId) removeConversation(oldId)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentOrgId, prependConversation, upsertConversation, removeConversation])

  // ───────────────────────── Realtime: messages ─────────────────────────

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
          const newMsg = mapMessageRow(payload.new)
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
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedId, currentOrgId])

  // ───────────────────────── Realtime: typing broadcast ─────────────────────────
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

  // ───────────────────────── Mutations ─────────────────────────

  const handleInboxResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()

      const startX = event.clientX
      const startWidth = inboxWidth
      const maxWidth = getInboxMaxWidth()
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        const nextWidth = startWidth + moveEvent.clientX - startX
        setInboxWidth(clampInboxWidth(nextWidth, maxWidth))
      }

      const handleUp = () => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [getInboxMaxWidth, inboxWidth],
  )

  const handleInboxResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? -16 : 16
      setInboxWidth((width) => clampInboxWidth(width + delta, getInboxMaxWidth()))
    },
    [getInboxMaxWidth],
  )

  async function handleSendMessage(content: string) {
    if (!selectedId) return
    const tempId = `temp-${crypto.randomUUID()}`
    const tempMsg: ConversationMessage = {
      id: tempId,
      conversationId: selectedId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempMsg])
    try {
      const res = await fetch(`/api/chat/conversations/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, role: 'assistant' }),
      })
      if (!res.ok) throw new Error('Failed to send')
      await fetchMessages(selectedId)
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error('Failed to send message')
    }
  }

  async function handleStatusChange(status: ConversationStatus) {
    if (!selectedId) return
    try {
      await fetch(`/api/chat/conversations/${selectedId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      // Realtime UPDATE will reconcile the list | no manual refetch needed.
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
      if (selectedId === id) {
        setSelectedId(null)
        setMessages([])
        setMobileView('list')
      }
      removeConversation(id)
    } catch {
      // ignore
    }
  }

  async function handleBotToggle(conversationId: string, currentStatus: string) {
    if (botTogglingId) return
    setBotTogglingId(conversationId)
    const optimistic = currentStatus === 'active' ? 'paused' : 'active'
    const current = findVisibleConversation(conversationId)
    if (current) {
      upsertConversation({ ...current, botStatus: optimistic })
    }
    const result = await toggleBotStatus(conversationId, currentStatus)
    if ('error' in result) {
      if (current) {
        upsertConversation({ ...current, botStatus: currentStatus })
      }
      toast.error('Failed to update bot status')
    }
    setBotTogglingId(null)
  }

  async function handlePinToggle(id: string, pinnedNext: boolean) {
    const current = findVisibleConversation(id)
    if (current) {
      upsertConversation({ ...current, pinned: pinnedNext })
    }
    const res = await pinConversation(id, pinnedNext)
    if ('error' in res) {
      toast.error('Could not pin conversation')
      if (current) {
        upsertConversation({ ...current, pinned: !pinnedNext })
      }
    } else {
      // Pin/unpin flips a row between the pinned and unpinned buckets | the
      // optimistic upsert removes it from the source bucket, but only a
      // refetch can put it back in the destination bucket with proper sort.
      refreshConversations()
    }
  }

  async function handleStarToggle(id: string, starredNext: boolean) {
    const current = findVisibleConversation(id)
    if (current) {
      upsertConversation({ ...current, starred: starredNext })
    }
    const res = await starConversation(id, starredNext)
    if ('error' in res) {
      toast.error('Could not update starred')
      if (current) {
        upsertConversation({ ...current, starred: !starredNext })
      }
    } else if (filters.starred) {
      refreshConversations()
    }
  }

  async function handlePriorityCycle(id: string, next: ConversationPriority) {
    const current = findVisibleConversation(id)
    const previousPriority = current?.priority ?? 'normal'
    if (current) {
      upsertConversation({ ...current, priority: next })
    }
    const res = await setConversationPriority(id, next)
    if ('error' in res) {
      toast.error('Could not update priority')
      if (current) {
        upsertConversation({ ...current, priority: previousPriority })
      }
    }
  }

  async function handleAssign(id: string, userId: string | null) {
    const current = findVisibleConversation(id)
    const previous = current?.assignedUserId ?? null
    if (current) {
      upsertConversation({ ...current, assignedUserId: userId })
    }
    const res = await assignConversation(id, userId)
    if ('error' in res) {
      toast.error('Could not assign conversation')
      if (current) {
        upsertConversation({ ...current, assignedUserId: previous })
      }
    } else {
      toast.success(userId ? 'Conversation assigned' : 'Conversation unassigned')
    }
  }

  // ───────────────────────── Derived ─────────────────────────

  // Selected conversation may be in either bucket on the current page.
  const selected =
    conversations.find((c) => c.id === selectedId) ??
    pinned.find((c) => c.id === selectedId) ??
    null

  // Helper for optimistic mutations: lookup across both buckets.
  const findVisibleConversation = useCallback(
    (id: string): ConversationSummary | undefined => {
      return conversations.find((c) => c.id === id) ?? pinned.find((c) => c.id === id)
    },
    [conversations, pinned],
  )

  // ───────────────────────── Render ─────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary">
      <PushPermissionBanner />
      {/* Desktop | 3-column grid */}
      <div className="hidden md:flex h-full min-h-0 w-full overflow-hidden">
        <div className="h-full min-h-0 shrink-0 overflow-hidden" style={{ width: inboxWidth }}>
          <ConversationList
            conversations={conversations}
            pinned={pinned}
            selectedId={selectedId}
            currentUserId={currentUserId}
            isLoading={isInitialLoading}
            isPageLoading={isPageLoading}
            loadError={listError}
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
            hasNext={hasNext}
            hasPrev={hasPrev}
            onNextPage={nextPage}
            onPrevPage={prevPage}
            onRetry={refreshConversations}
            onFilterChange={handleFilterChange}
            onSelect={(id) => {
              setSelectedId(id)
              void fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
            }}
            onConversationUpdated={refreshConversations}
            onConversationDeleted={(id) => {
              if (selectedId === id) {
                setSelectedId(null)
                setMessages([])
              }
              removeConversation(id)
            }}
            onPin={handlePinToggle}
            onStar={handleStarToggle}
          />
        </div>
        <button
          type="button"
          aria-label="Resize inbox"
          title="Resize inbox"
          onPointerDown={handleInboxResizeStart}
          onKeyDown={handleInboxResizeKeyDown}
          className="group relative z-20 h-full w-1 -ml-px shrink-0 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-accent/70 group-focus-visible:bg-accent" />
        </button>
        <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          <ChatArea
            conversation={selected}
            messages={messages}
            isLoading={isMessagesLoading}
            isTyping={isTyping}
            onSendMessage={handleSendMessage}
            onTyping={broadcastTyping}
            onStatusChange={handleStatusChange}
            onDelete={() => selectedId && handleDelete(selectedId)}
            onBack={() => {}}
            onBotStatusToggle={handleBotToggle}
            isBotToggling={botTogglingId === selectedId}
            onPinToggle={handlePinToggle}
            onStarToggle={handleStarToggle}
            onPriorityCycle={handlePriorityCycle}
            onAssign={handleAssign}
            members={members}
            infoPanelOpen={infoOpen}
            onToggleInfoPanel={() => setInfoOpen((v) => !v)}
            agentMap={agentMap}
          />
        </div>
        {infoOpen && (
          // Below lg (1024px) we hide the info panel to keep the chat column
          // readable | user can still toggle it via the chat header button
          // which re-renders when viewport widens enough.
          <div className="hidden lg:flex h-full min-h-0 shrink-0 overflow-hidden lg:w-[300px] xl:w-[340px] flex-col">
            {selected && (() => {
              const botOn = selected.botStatus === 'active'
              const toggling = botTogglingId === selected.id
              return (
                <div className="shrink-0 border-l border-b border-border-subtle bg-bg-secondary/40 px-4 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        botOn ? 'bg-warning animate-pulse' : 'bg-success',
                      )}
                      aria-hidden
                    />
                    <span className="text-[11.5px] text-text-secondary truncate">
                      {botOn ? 'Bot is replying' : 'Manual mode'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBotToggle(selected.id, selected.botStatus)}
                    disabled={toggling}
                    className="text-[11.5px] font-medium text-accent hover:text-accent/80 shrink-0 disabled:opacity-50"
                  >
                    {botOn ? 'Pause' : 'Resume bot'}
                  </button>
                </div>
              )
            })()}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ContactInfoPanel
                contactId={selected?.contactId ?? null}
                conversationId={selected?.id ?? null}
                fallbackName={selected?.visitorName ?? null}
                fallbackPhone={selected?.visitorPhone ?? null}
                fallbackEmail={selected?.visitorEmail ?? null}
                onCollapse={() => setInfoOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile | single-column with drawer-style navigation */}
      <div className="md:hidden flex h-full min-h-0 w-full overflow-hidden">
        {mobileView === 'list' && (
          <div className="h-full min-h-0 w-full">
            <ConversationList
              conversations={conversations}
              pinned={pinned}
              selectedId={selectedId}
              currentUserId={currentUserId}
              isLoading={isInitialLoading}
              isPageLoading={isPageLoading}
              loadError={listError}
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              totalPages={totalPages}
              hasNext={hasNext}
              hasPrev={hasPrev}
              onNextPage={nextPage}
              onPrevPage={prevPage}
              onRetry={refreshConversations}
              onFilterChange={handleFilterChange}
              onSelect={(id) => {
                setSelectedId(id)
                setMobileView('chat')
                // SEED-035: mark as read when conversation opens
                void fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
              }}
              onConversationUpdated={refreshConversations}
              onConversationDeleted={(id) => {
                if (selectedId === id) {
                  setSelectedId(null)
                  setMessages([])
                }
                removeConversation(id)
              }}
              onPin={handlePinToggle}
              onStar={handleStarToggle}
            />
          </div>
        )}
        {mobileView === 'chat' && (
          <div className="h-full min-h-0 w-full">
            <ChatArea
              conversation={selected}
              messages={messages}
              isLoading={isMessagesLoading}
              isTyping={isTyping}
              onSendMessage={handleSendMessage}
              onTyping={broadcastTyping}
              onStatusChange={handleStatusChange}
              onDelete={() => selectedId && handleDelete(selectedId)}
              onBack={() => setMobileView('list')}
              onBotStatusToggle={handleBotToggle}
              isBotToggling={botTogglingId === selectedId}
              onPinToggle={handlePinToggle}
              onStarToggle={handleStarToggle}
              onPriorityCycle={handlePriorityCycle}
              onAssign={handleAssign}
              members={members}
              infoPanelOpen={false}
              onToggleInfoPanel={() => setMobileView('info')}
              agentMap={agentMap}
            />
          </div>
        )}
        {mobileView === 'info' && (
          <div className="h-full min-h-0 w-full">
            <ContactInfoPanel
              contactId={selected?.contactId ?? null}
              fallbackName={selected?.visitorName ?? null}
              fallbackPhone={selected?.visitorPhone ?? null}
              fallbackEmail={selected?.visitorEmail ?? null}
              onClose={() => setMobileView('chat')}
            />
          </div>
        )}
      </div>
    </div>
  )
}
