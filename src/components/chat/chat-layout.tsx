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
 *   - Messages (REST + polling)
 *   - Polling (POLL_CHAT_MS) for the open conversation's messages and for the
 *     inbox list: a cheap change probe, then a silent refetch of the current
 *     page when something changed. Paused while the tab is hidden.
 *   - Pin / priority / assign / bot-toggle mutations (optimistic)
 *   - Mobile drawer behaviour (list / chat / info, one column visible at a time)
 *   - Top-level filter state (status / assigned / channel) is owned here so the
 *     hook can refetch + reset to page 1 when the user changes a pill.
 *
 * The left/middle/right column components are presentational and receive
 * pre-computed state. Each poll reconciles any optimistic state with the
 * canonical DB.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

import {
  ConversationSummary,
  ConversationMessage,
  ConversationPriority,
  ConversationStatus,
  ConversationLabel,
} from '@/types/chat'
import {
  toggleBotStatus,
  pinConversation,
  starConversation,
  setConversationPriority,
  assignConversation,
  setConversationOperatorNamePrefix,
  listAgentDefaultChannels,
  listOrgMembers,
  listConversationLabels,
  resolveContactStartChannels,
  createContactConversation,
  prepareContactConversationForOpen,
  type OrgMember,
  type StartChannel,
} from '@/app/(dashboard)/inbox/actions'
import { updateProfile } from '@/app/(dashboard)/settings/profile/actions'
import { listInboxPhoneNumbers } from '@/app/(dashboard)/inbox/polling-actions'
import { pollFetchJson } from '@/lib/polling/fetch-json'
import { usePolling } from '@/hooks/use-polling'
import { POLL_CHAT_MS } from '@/lib/polling/intervals'
import { mergePolledMessages, resolveSentMessage } from '@/lib/chat/poll-merge'
import { UNREAD_REFRESH_EVENT } from '@/hooks/use-unread-count'
import {
  ConversationList,
  type ConversationFilterChange,
} from '@/components/chat/conversation-list'
import { ChatArea } from '@/components/chat/chat-area'
import { CommentsLayout } from '@/components/chat/comments/comments-layout'
import { ContactInfoPanel } from '@/components/chat/contact-info-panel'
import { usePaginatedConversations } from '@/hooks/use-paginated-conversations'
import { PushPermissionBanner } from '@/components/chat/push-permission-banner'
import { cn } from '@/lib/utils'
import { conversationChannelToAgentChannel } from '@/lib/agents/channel-map'
import { InboxTemplate } from '@/components/crm/entity-template'
import { matchesInboxStatusFilter } from '@/lib/chat/conversation-visibility'

const INBOX_MIN_WIDTH = 260
const INBOX_DEFAULT_WIDTH = 300
const INBOX_MAX_WIDTH = 420
const CHAT_MIN_WIDTH = 420
const MESSAGE_PAGE_SIZE = 30
/** Newest messages re-read on every poll of the open conversation. */
const MESSAGE_POLL_LIMIT = MESSAGE_PAGE_SIZE
/**
 * The inbox list is refetched when the change probe moves, and at least once
 * per this many polls even when it does not (an update that touches neither
 * `updated_at` nor `last_message_at`, or a delete).
 */
const INBOX_FULL_REFRESH_EVERY = 10

function agentSettingsHref(channel: string | null | undefined) {
  const agentChannel = conversationChannelToAgentChannel(channel)
  if (!agentChannel) return '/agents?settings=channels'
  return `/agents?settings=channels&channel=${agentChannel}`
}

function clampInboxWidth(width: number, maxWidth: number) {
  return Math.min(Math.max(width, INBOX_MIN_WIDTH), maxWidth)
}

function messagePreview(message: ConversationMessage): string {
  const content = message.content?.trim()
  if (content) return content

  const media = message.metadata?.media
  const first = Array.isArray(media) ? media[0] as { mime_type?: string; filename?: string } | undefined : undefined
  const mimeType = first?.mime_type ?? ''
  if (mimeType.startsWith('image/')) return 'Photo'
  if (mimeType.startsWith('audio/')) return 'Audio'
  if (mimeType.startsWith('video/')) return 'Video'
  if (first) return first.filename ? `File: ${first.filename}` : 'File'

  return ''
}

function contactDisplayName(contact: {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
}): string | null {
  return [contact.first_name?.trim(), contact.last_name?.trim()].filter(Boolean).join(' ')
    || contact.name?.trim()
    || null
}

async function readSendFailure(res: Response): Promise<string> {
  const fallback = `Failed to send message (${res.status})`
  try {
    const data = await res.json() as { message?: unknown; error?: unknown }
    const message = typeof data.message === 'string' ? data.message.trim() : ''
    if (message) return message

    const error = typeof data.error === 'string' ? data.error.trim() : ''
    if (!error) return fallback

    const friendly: Record<string, string> = {
      channel_not_configured: 'This channel is not connected or is inactive.',
      channel_not_sendable: 'This channel is not configured for outbound messages.',
      email_no_recipient: 'This conversation has no recipient email address.',
      email_send_failed: 'Email provider rejected the message.',
      ghl_channel_not_configured: 'GHL is not connected for this location.',
      ghl_send_failed: 'GHL rejected the message.',
      meta_no_recipient: 'This conversation has no Meta recipient ID.',
      meta_send_failed: 'Meta rejected the message.',
      sms_media_not_supported: 'SMS attachments are not supported yet.',
      sms_no_recipient: 'This conversation has no recipient phone number.',
      sms_send_failed: 'Twilio rejected the SMS.',
      token_revoked: 'The Meta token was revoked or expired. Reconnect the channel.',
      wa_no_recipient: 'This WhatsApp conversation has no recipient phone number or chat ID.',
      wa_not_configured: 'WhatsApp is not connected for this organization.',
      wa_send_failed: 'WhatsApp rejected the message.',
    }

    return friendly[error] ?? error.replaceAll('_', ' ')
  } catch {
    return fallback
  }
}

interface ChatLayoutProps {
  currentOrgId: string | null
  currentUserId: string | null
  /** Operator's display name (profile full_name) — used by the name-prefix feature. */
  currentUserName?: string
  agentMap?: Record<string, string>
  initialConversationId?: string | null
  initialContactId?: string | null
  hasCommentsChannel?: boolean
}

type MobileView = 'list' | 'chat' | 'info'

export function ChatLayout({
  currentOrgId,
  currentUserId,
  currentUserName = '',
  agentMap,
  initialConversationId = null,
  initialContactId = null,
  hasCommentsChannel = false,
}: ChatLayoutProps) {
  // ─────────── Inbox tab (Chat vs Comments) ───────────
  const [inboxTab, setInboxTab] = useState<'chat' | 'comments'>('chat')

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
    silentRefresh: silentRefreshConversations,
    upsert: upsertConversation,
    remove: removeConversation,
  } = usePaginatedConversations(filters)

  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId)
  // Holds the selected conversation's summary when it is NOT on the currently
  // loaded page of the list (e.g. arriving via /chat?contact=ID for an older
  // conversation). Without this, `selected` would resolve to null and the chat
  // area would fall back to the "pick a conversation" empty state.
  const [fetchedConversation, setFetchedConversation] =
    useState<ConversationSummary | null>(null)
  // True while auto-creating a conversation for a contact that has none yet.
  const [isStartingConversation, setIsStartingConversation] = useState(false)
  const startAttemptedRef = useRef(false)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false)
  const [botTogglingId, setBotTogglingId] = useState<string | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [orgLabels, setOrgLabels] = useState<Array<{ id: string; name: string; color: string }>>([])
  // Labels assigned to the currently-selected conversation (SEED-035 picker).
  const [conversationLabels, setConversationLabels] = useState<ConversationLabel[]>([])
  const [agentDefaultChannels, setAgentDefaultChannels] = useState<Set<string> | null>(null)
  const [phoneNumbers, setPhoneNumbers] = useState<Array<{ id: string; label: string; e164: string }>>([])
  const [infoOpen, setInfoOpen] = useState(true)
  const [mobileView, setMobileView] = useState<MobileView>('list')
  const [inboxWidth, setInboxWidth] = useState(INBOX_DEFAULT_WIDTH)
  const selectedIdRef = useRef<string | null>(null)
  // Latest messages (for poll side effects) and the conversation whose first
  // page has loaded (polling waits for it so the initial load is not mistaken
  // for a burst of new messages).
  const messagesRef = useRef<ConversationMessage[]>([])
  const messagesLoadedForRef = useRef<string | null>(null)
  const fetchedConversationRef = useRef<ConversationSummary | null>(null)

  const findVisibleConversation = useCallback(
    (id: string): ConversationSummary | undefined => {
      return conversations.find((c) => c.id === id) ?? pinned.find((c) => c.id === id)
    },
    [conversations, pinned],
  )

  const updateConversationPreview = useCallback((message: ConversationMessage) => {
    const preview = messagePreview(message)
    if (!preview) return

    const applyPreview = (conversation: ConversationSummary): ConversationSummary => ({
      ...conversation,
      lastMessage: preview,
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
      channel: message.channel ?? conversation.channel,
    })

    const current = findVisibleConversation(message.conversationId)
    if (current) upsertConversation(applyPreview(current))

    setFetchedConversation((prev) => {
      if (!prev || prev.id !== message.conversationId) return prev
      return applyPreview(prev)
    })
  }, [findVisibleConversation, upsertConversation])

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
        messagesLoadedForRef.current = id
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
    messagesLoadedForRef.current = null
    fetchMessages(selectedId)
  }, [selectedId, fetchMessages])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    fetchedConversationRef.current = fetchedConversation
  }, [fetchedConversation])

  // When the selected conversation isn't on the currently-loaded page of the
  // list, fetch its summary directly so the chat area can render it instead of
  // showing the "pick a conversation" empty state.
  useEffect(() => {
    if (!selectedId) {
      setFetchedConversation(null)
      return
    }
    const inList =
      conversations.some((c) => c.id === selectedId) ||
      pinned.some((c) => c.id === selectedId)
    if (inList) {
      // The list holds the canonical row — drop any stale fetched copy.
      setFetchedConversation((prev) => (prev ? null : prev))
      return
    }
    if (initialContactId && initialConversationId === selectedId) {
      // The contact-open preparation effect below owns this fetch/update so it
      // cannot race with a stale detail response that still says bot active.
      return
    }
    if (fetchedConversation?.id === selectedId) return
    let cancelled = false
    fetch(`/api/chat/conversations/${selectedId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.conversation) return
        setFetchedConversation(data.conversation as ConversationSummary)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedId, conversations, pinned, fetchedConversation, initialContactId, initialConversationId])

  // Arriving via /chat?contact=ID with an existing conversation selected by
  // the server is still an operator-initiated open. Hydrate the contact fields
  // and force manual mode so the composer is usable immediately.
  useEffect(() => {
    if (!initialContactId || !initialConversationId) return

    let cancelled = false
    prepareContactConversationForOpen(initialConversationId, initialContactId)
      .then((result) => {
        if (cancelled || !('conversation' in result)) return
        setFetchedConversation(result.conversation)
        setSelectedId(result.conversation.id)
        upsertConversation(result.conversation)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [initialContactId, initialConversationId, upsertConversation])

  // Arriving via /chat?contact=ID for a contact with NO existing conversation:
  // resolve the best real channel (SMS if phone+Twilio, else fall back to a
  // 'manual'/"Direct" placeholder) and create+open it so the operator can chat.
  useEffect(() => {
    if (!initialContactId || initialConversationId || selectedId) return
    if (startAttemptedRef.current) return
    startAttemptedRef.current = true

    let cancelled = false
    setIsStartingConversation(true)
    ;(async () => {
      try {
        const res = await resolveContactStartChannels(initialContactId)
        let channel: StartChannel | 'manual' = 'manual'
        if ('options' in res) {
          // Highest-priority available real channel (options are pre-ordered).
          const available = res.options.find((o) => o.available)
          if (available) channel = available.channel
        }
        let created = await createContactConversation(initialContactId, channel)
        // If the real channel couldn't be created (e.g. integration/schema not
        // ready), still give the operator an inbox via the 'manual' placeholder.
        if (!('conversation' in created) && channel !== 'manual') {
          created = await createContactConversation(initialContactId, 'manual')
        }
        if (cancelled) return
        if ('conversation' in created) {
          setFetchedConversation(created.conversation)
          setSelectedId(created.conversation.id)
          refreshConversations()
        } else {
          toast.error(created.error || 'Could not start a conversation')
        }
      } catch {
        if (!cancelled) toast.error('Could not start a conversation')
      } finally {
        if (!cancelled) setIsStartingConversation(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialContactId, initialConversationId, selectedId, refreshConversations])

  // Fetch org members once for the assign dropdown
  useEffect(() => {
    listOrgMembers().then(setMembers).catch(() => setMembers([]))
  }, [])

  // Fetch the org's conversation labels once, for the FilterPanel + label picker.
  useEffect(() => {
    fetch('/api/chat/labels')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setOrgLabels(data?.labels ?? []))
      .catch(() => setOrgLabels([]))
  }, [])

  // Fetch the labels assigned to the selected conversation whenever it changes.
  useEffect(() => {
    if (!selectedId) {
      setConversationLabels([])
      return
    }
    let cancelled = false
    setConversationLabels([])
    listConversationLabels(selectedId)
      .then((labels) => {
        if (!cancelled) setConversationLabels(labels)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // Fetch channels that have an AI agent configured. Conversations on channels
  // without a default agent can still be handled manually, but the bot cannot
  // be resumed because there is nothing to invoke.
  useEffect(() => {
    listAgentDefaultChannels()
      .then((channels) => setAgentDefaultChannels(new Set(channels)))
      .catch(() => setAgentDefaultChannels(new Set()))
  }, [])

  // Fetch active Twilio numbers for the phone filter
  useEffect(() => {
    listInboxPhoneNumbers()
      .then((numbers) => setPhoneNumbers(numbers))
      .catch(() => {})
  }, [])

  // ───────────────────────── Polling: conversations ─────────────────────────

  // Tracks last known lastMessageAt per conversation to detect new inbounds.
  const lastMessageAtMapRef = useRef<Map<string, string | null>>(new Map())

  // Seed the map from the initial conversation load so the first UPDATE after
  // page load doesn't falsely fire as "new message" for pre-existing messages.
  useEffect(() => {
    for (const c of [...conversations, ...pinned]) {
      if (!lastMessageAtMapRef.current.has(c.id)) {
        lastMessageAtMapRef.current.set(c.id, c.lastMessageAt ?? null)
      }
    }
  }, [conversations, pinned])

  // Poll the inbox (replaces the Realtime INSERT/UPDATE/DELETE subscriptions on
  // conversations). A cheap probe runs every POLL_CHAT_MS; the full, joined
  // page is refetched silently when the probe moves (and every
  // INBOX_FULL_REFRESH_EVERY polls regardless). The server applies the status
  // filter, so archived/closed rows drop out and new rows appear by themselves.
  const inboxPollRef = useRef<{ signature: string | null; ticksSinceRefresh: number }>({
    signature: null,
    ticksSinceRefresh: 0,
  })
  const pollInbox = useCallback(async () => {
    const state = inboxPollRef.current
    const { signature } = await pollFetchJson<{ signature: string }>('/api/poll/inbox-signature')
    state.ticksSinceRefresh += 1
    const moved = signature !== state.signature
    if (!moved && state.ticksSinceRefresh < INBOX_FULL_REFRESH_EVERY) return

    const page = await silentRefreshConversations()
    // A filter/page change took over: keep the old baseline so we poll again.
    if (!page) return
    state.signature = signature
    state.ticksSinceRefresh = 0

    // New message in a conversation we already knew about, and it is not the
    // open one -> mark unread + browser notification (same as the old UPDATE
    // handler). Brand-new rows only seed the map, as the INSERT handler did.
    let sawNewMessage = false
    for (const conversation of [...page.pinned, ...page.conversations]) {
      const known = lastMessageAtMapRef.current.has(conversation.id)
      const previous = lastMessageAtMapRef.current.get(conversation.id) ?? null
      const latest = conversation.lastMessageAt ?? null
      lastMessageAtMapRef.current.set(conversation.id, latest)
      if (!known || !latest || latest === previous) continue
      sawNewMessage = true
      if (conversation.id === selectedIdRef.current) continue

      upsertConversation({ ...conversation, isUnread: true })
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted' &&
        !document.hasFocus()
      ) {
        const name =
          conversation.contactName ?? conversation.visitorName ?? conversation.visitorPhone ?? 'New message'
        const notif = new Notification(name, {
          body: conversation.lastMessage ?? '',
          icon: '/api/pwa/icons/192',
          tag: `msg-${conversation.id}`,
        })
        notif.addEventListener('click', () => {
          window.focus()
          setSelectedId(conversation.id)
          notif.close()
        })
      }
    }
    // Let the sidebar badge catch up without waiting for its own poll.
    if (sawNewMessage) window.dispatchEvent(new Event(UNREAD_REFRESH_EVENT))

    // The open conversation may live outside the loaded page (opened by link):
    // keep its header/summary fresh too.
    const openId = selectedIdRef.current
    const detached = fetchedConversationRef.current
    if (openId && detached && detached.id === openId) {
      const res = await fetch(`/api/chat/conversations/${openId}`)
      if (res.ok) {
        const data = await res.json()
        const fresh = data?.conversation as ConversationSummary | undefined
        if (fresh && selectedIdRef.current === openId) {
          setFetchedConversation((prev) =>
            prev && prev.id === openId
              ? {
                  ...prev,
                  ...fresh,
                  channelAccountName: fresh.channelAccountName ?? prev.channelAccountName,
                  contactName: fresh.contactName ?? prev.contactName,
                  contactAvatarUrl: fresh.contactAvatarUrl ?? prev.contactAvatarUrl,
                  contactVerified: fresh.contactVerified || prev.contactVerified,
                }
              : prev,
          )
        }
      }
    }
  }, [silentRefreshConversations, upsertConversation])

  usePolling(pollInbox, {
    intervalMs: POLL_CHAT_MS,
    enabled: Boolean(currentOrgId),
    immediate: false,
  })

  const handleConversationStatusChanged = useCallback(
    (id: string, nextStatus: ConversationStatus) => {
      if (!matchesInboxStatusFilter(nextStatus, filters.status)) {
        removeConversation(id)
        return
      }
      refreshConversations()
    },
    [filters.status, refreshConversations, removeConversation],
  )

  // ───────────────────────── Polling: messages ─────────────────────────

  // Poll the newest page of the open thread (replaces the Realtime INSERT and
  // UPDATE subscriptions on conversation_messages). New messages are appended
  // or swapped in for the optimistic bubble, in-place changes (delivery status)
  // are applied; see mergePolledMessages.
  const pollMessages = useCallback(async () => {
    const id = selectedIdRef.current
    // Wait for the first page so the initial load is not read as new traffic.
    if (!id || messagesLoadedForRef.current !== id) return
    const res = await fetch(
      `/api/chat/conversations/${id}/messages?includeInternal=true&limit=${MESSAGE_POLL_LIMIT}`,
    )
    if (!res.ok) throw new Error(`messages poll failed (${res.status})`)
    const data = await res.json() as { messages?: ConversationMessage[] }
    if (selectedIdRef.current !== id) return
    const polled = data.messages ?? []

    // Side effects are derived from the last rendered thread; the state update
    // itself merges into the live state, so optimistic sends are never lost.
    const { inserted } = mergePolledMessages(messagesRef.current, polled)
    setMessages((prev) => mergePolledMessages(prev, polled).next)
    if (inserted.length === 0) return
    for (const message of inserted) updateConversationPreview(message)
    // Keep the actively-open thread marked read as inbound messages arrive, so
    // the sidebar Chat badge doesn't tick up for a conversation the operator is
    // already watching. (The invalidate trigger clears the read row on each
    // inbound message.)
    if (inserted.some((m) => m.role === 'user')) {
      void fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' })
        .then(() => window.dispatchEvent(new Event(UNREAD_REFRESH_EVENT)))
        .catch(() => {})
    }
  }, [updateConversationPreview])

  usePolling(pollMessages, {
    intervalMs: POLL_CHAT_MS,
    enabled: Boolean(selectedId && currentOrgId),
    immediate: false,
  })

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

  async function handleSendMessage(
    content: string,
    opts?: {
      channel?: string
      conversationId?: string
      subject?: string
      signatureId?: string | null
      media?: Array<{ url: string; mime_type: string; size?: number; filename?: string }>
      deliveryOverride?: 'evolution_manual_escape'
    },
  ) {
    if (!selectedId) return
    const targetId = opts?.conversationId ?? selectedId
    const isCurrentThread = targetId === selectedId
    // crypto.randomUUID is only available in secure contexts (HTTPS). Fall back
    // to a time+random string so the optimistic bubble works everywhere.
    const tempId = `temp-${
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }`
    const tempMsg: ConversationMessage = {
      id: tempId,
      conversationId: targetId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      channel: opts?.channel ?? null,
      ...(opts?.media?.length ? { metadata: { media: opts.media } } : {}),
    }
    if (isCurrentThread) setMessages((prev) => [...prev, tempMsg])
    updateConversationPreview(tempMsg)
    const previousMessages = isCurrentThread ? messages : []
    try {
      const selectedConv = findVisibleConversation(targetId)
      const res = await fetch(`/api/chat/conversations/${targetId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          role: 'assistant',
          channel: opts?.channel,
          subject: opts?.subject,
          signature_id: opts?.signatureId,
          media: opts?.media,
          delivery_override: opts?.deliveryOverride,
          operator_prefix: Boolean(selectedConv?.operatorNamePrefix),
        }),
      })
      if (!res.ok) throw new Error(await readSendFailure(res))
      const data = await res.json().catch(() => null)
      if (data?.message) updateConversationPreview(data.message as ConversationMessage)
      // Swap the optimistic temp bubble for the real message from the response.
      // This avoids calling fetchMessages (which blanks + replaces the entire array
      // and causes a visible flash/spinner). The next messages poll finds the same
      // message and dedupes it by id.
      if (isCurrentThread && data?.message) {
        setMessages((prev) => resolveSentMessage(prev, tempId, data.message as ConversationMessage))
      }
      // Cross-thread: switching selectedId triggers the fetchMessages useEffect automatically.
      if (!isCurrentThread) setSelectedId(targetId)
    } catch (err) {
      if (isCurrentThread) setMessages((prev) => prev.filter((m) => m.id !== tempId))
      const latest = previousMessages[previousMessages.length - 1]
      if (latest?.conversationId === targetId) updateConversationPreview(latest)
      const message = err instanceof Error ? err.message : 'Failed to send message'
      toast.error(message)
      throw err
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
      // Reconcile the list now instead of waiting for the next poll.
      void silentRefreshConversations().catch(() => {})
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
    const current = findVisibleConversation(conversationId)
    const channel = current?.channel
    const agentChannel = conversationChannelToAgentChannel(channel)
    const hasAgent = agentChannel ? agentDefaultChannels?.has(agentChannel) !== false : false
    if (currentStatus !== 'active' && !hasAgent) {
      toast.error(`No AI agent is configured for ${channel ?? 'this channel'}.`)
      return
    }
    setBotTogglingId(conversationId)
    const optimistic = currentStatus === 'active' ? 'paused' : 'active'
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

  async function handleOperatorNamePrefixToggle(id: string, enabled: boolean) {
    const current = findVisibleConversation(id)
    if (current) {
      upsertConversation({ ...current, operatorNamePrefix: enabled })
    }
    const res = await setConversationOperatorNamePrefix(id, enabled)
    if ('error' in res) {
      toast.error('Could not update operator name prefix setting')
      if (current) {
        upsertConversation({ ...current, operatorNamePrefix: !enabled })
      }
    }
  }

  // Operator display name (profile full_name) used by the name-prefix feature.
  // Editable from the composer gear popover; persists to the auth profile.
  const [operatorName, setOperatorName] = useState(currentUserName)

  async function handleOperatorNameSave(name: string) {
    const previous = operatorName
    setOperatorName(name)
    const res = await updateProfile({ full_name: name })
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save name')
      setOperatorName(previous)
      return
    }
    toast.success('Name updated')
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

  // SEED-035: mutate the labels assigned to the selected conversation. Only
  // the selected thread's picker is mounted, so `id` always matches
  // `selectedId` — the guard just keeps this safe against a stale callback.
  function handleLabelsChange(id: string, labels: ConversationLabel[]) {
    if (id !== selectedId) return
    setConversationLabels(labels)
  }

  // ───────────────────────── Derived ─────────────────────────

  // Selected conversation may be in either bucket on the current page, or — when
  // it lives on a page we haven't loaded — in the directly-fetched fallback.
  // Bumped on every saved contact edit so ChatArea re-resolves reachable
  // channels — adding an email/phone in the INFO panel surfaces Email/SMS/
  // WhatsApp in the composer without reopening the conversation.
  const [contactEditNonce, setContactEditNonce] = useState(0)

  const handleContactUpdated = useCallback((contact: {
    id: string
    first_name: string | null
    last_name: string | null
    name: string | null
    phone: string | null
    email: string | null
    avatar_url: string | null
  }) => {
    const name = contactDisplayName(contact)
    const apply = (conversation: ConversationSummary): ConversationSummary => {
      if (conversation.contactId !== contact.id) return conversation
      return {
        ...conversation,
        contactName: name,
        visitorPhone: contact.phone ?? conversation.visitorPhone,
        visitorEmail: contact.email ?? conversation.visitorEmail,
        contactAvatarUrl: contact.avatar_url ?? conversation.contactAvatarUrl,
      }
    }

    for (const conversation of [...conversations, ...pinned]) {
      if (conversation.contactId === contact.id) upsertConversation(apply(conversation))
    }
    setFetchedConversation((prev) => (prev ? apply(prev) : prev))
    setContactEditNonce((n) => n + 1)
  }, [conversations, pinned, upsertConversation])

  const selected =
    conversations.find((c) => c.id === selectedId) ??
    pinned.find((c) => c.id === selectedId) ??
    (fetchedConversation && fetchedConversation.id === selectedId
      ? fetchedConversation
      : null)

  const selectedBotAgentAvailable = selected
    ? agentDefaultChannels?.has(conversationChannelToAgentChannel(selected.channel) ?? '') !== false
    : false
  const infoPanelContactId: string | null = selected
    ? (selected.contactId ?? null)
    : selectedId
      ? null
      : (initialContactId ?? null)
  const infoPanelConversationId = selected?.id ?? selectedId ?? null
  const infoPanelKey = `${infoPanelConversationId ?? 'none'}:${infoPanelContactId ?? 'unregistered'}`

  const visibleConversations = useMemo(() => {
    if (!selected) return conversations
    const alreadyVisible =
      conversations.some((c) => c.id === selected.id) ||
      pinned.some((c) => c.id === selected.id)
    if (alreadyVisible) return conversations
    return [selected, ...conversations].slice(0, pageSize)
  }, [conversations, pageSize, pinned, selected])

  // ───────────────────────── Render ─────────────────────────

  return (
    <InboxTemplate className="overflow-hidden bg-bg-primary">
      <PushPermissionBanner />

      {/* Comments tab — full-width two-panel layout */}
      {inboxTab === 'comments' && currentOrgId && (
        <CommentsLayout
          orgId={currentOrgId}
          inboxTab={inboxTab}
          onTabChange={setInboxTab}
          hasCommentsChannel={hasCommentsChannel}
        />
      )}

      {/* Chat tab — Desktop | 3-column grid */}
      <div className={inboxTab === 'comments' ? 'hidden' : 'hidden md:flex h-full min-h-0 w-full overflow-hidden'}>
        <div className="h-full min-h-0 shrink-0 overflow-hidden" style={{ width: inboxWidth }}>
          <ConversationList
            conversations={visibleConversations}
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
              const conv = findVisibleConversation(id)
              if (conv?.isUnread) {
                upsertConversation({ ...conv, isUnread: false })
                // Drop the sidebar Chat badge on the same tick; the
                // the next unread-count poll reconciles the true count.
                window.dispatchEvent(new Event('xphere:unread-decrement'))
              }
              void fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
            }}
            onConversationUpdated={handleConversationStatusChanged}
            onConversationDeleted={(id) => {
              if (selectedId === id) {
                setSelectedId(null)
                setMessages([])
              }
              removeConversation(id)
            }}
            onPin={handlePinToggle}
            onStar={handleStarToggle}
            orgLabels={orgLabels}
            members={members}
            phoneNumbers={phoneNumbers}
            hasCommentsChannel={hasCommentsChannel}
            inboxTab={inboxTab}
            onTabChange={setInboxTab}
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
            onSendMessage={handleSendMessage}
            onStatusChange={handleStatusChange}
            onDelete={() => selectedId && handleDelete(selectedId)}
            onBack={() => {}}
            onBotStatusToggle={handleBotToggle}
            isBotToggling={botTogglingId === selectedId}
            onPinToggle={handlePinToggle}
            onStarToggle={handleStarToggle}
            onPriorityCycle={handlePriorityCycle}
            onAssign={handleAssign}
            orgLabels={orgLabels}
            onLabelsChange={handleLabelsChange}
            selectedLabels={conversationLabels}
            members={members}
            infoPanelOpen={infoOpen}
            onToggleInfoPanel={() => setInfoOpen((v) => !v)}
            agentMap={agentMap}
            botAgentAvailable={selectedBotAgentAvailable}
            emptyContactId={!selectedId ? initialContactId : null}
            isStartingConversation={isStartingConversation}
            onLoadMore={loadMoreMessages}
            hasMore={hasMoreMessages}
            isLoadingMore={isLoadingMoreMessages}
            onOperatorNamePrefixToggle={handleOperatorNamePrefixToggle}
            operatorName={operatorName}
            onOperatorNameSave={handleOperatorNameSave}
            contactEditNonce={contactEditNonce}
          />
        </div>
        {infoOpen && (
          // Below lg (1024px) we hide the info panel to keep the chat column
          // readable | user can still toggle it via the chat header button
          // which re-renders when viewport widens enough.
          <div className="hidden lg:flex h-full min-h-0 shrink-0 overflow-hidden lg:w-[300px] xl:w-[340px] flex-col">
            {selected && (() => {
              const botAgentAvailable =
                agentDefaultChannels?.has(conversationChannelToAgentChannel(selected.channel) ?? '') !== false
              const botOn = botAgentAvailable && selected.botStatus === 'active'
              const toggling = botTogglingId === selected.id
              return (
                <div className="shrink-0 border-l border-b border-border-subtle bg-bg-secondary/40 px-4 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        !botAgentAvailable ? 'bg-warning' : botOn ? 'bg-success animate-pulse' : 'bg-success',
                      )}
                      aria-hidden
                    />
                    <span className="text-[11.5px] text-text-secondary truncate">
                      {!botAgentAvailable ? 'No AI agent configured' : botOn ? 'Bot is replying' : 'Manual mode'}
                    </span>
                  </div>
                  {botAgentAvailable ? (
                    <button
                      type="button"
                      onClick={() => handleBotToggle(selected.id, selected.botStatus)}
                      disabled={toggling}
                      className="text-[11.5px] font-medium text-accent hover:text-accent/80 shrink-0 disabled:opacity-50"
                    >
                      {botOn ? 'Pause' : 'Resume bot'}
                    </button>
                  ) : (
                    <Link
                      href={agentSettingsHref(selected.channel)}
                      className="shrink-0 rounded-full border border-warning/30 bg-[var(--warning-muted)] px-2 py-0.5 text-[11px] font-medium text-warning transition-colors hover:border-warning/50 hover:bg-warning/15"
                    >
                      Bot disabled
                    </Link>
                  )}
                </div>
              )
            })()}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ContactInfoPanel
                key={infoPanelKey}
                contactId={infoPanelContactId}
                conversationId={infoPanelConversationId}
                fallbackName={selected?.visitorName ?? null}
                fallbackPhone={selected?.visitorPhone ?? null}
                fallbackEmail={selected?.visitorEmail ?? null}
                onContactUpdated={handleContactUpdated}
                onCollapse={() => setInfoOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile | single-column with drawer-style navigation */}
      <div className={inboxTab === 'comments' ? 'hidden' : 'md:hidden flex h-full min-h-0 w-full overflow-hidden'}>
        {mobileView === 'list' && (
          <div className="h-full min-h-0 w-full">
            <ConversationList
              conversations={visibleConversations}
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
                const conv = findVisibleConversation(id)
                if (conv?.isUnread) {
                  upsertConversation({ ...conv, isUnread: false })
                  window.dispatchEvent(new Event('xphere:unread-decrement'))
                }
                // SEED-035: mark as read when conversation opens
                void fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
              }}
              onConversationUpdated={handleConversationStatusChanged}
              onConversationDeleted={(id) => {
                if (selectedId === id) {
                  setSelectedId(null)
                  setMessages([])
                }
                removeConversation(id)
              }}
              onPin={handlePinToggle}
              onStar={handleStarToggle}
              orgLabels={orgLabels}
              members={members}
              phoneNumbers={phoneNumbers}
              hasCommentsChannel={hasCommentsChannel}
              inboxTab={inboxTab}
              onTabChange={setInboxTab}
            />
          </div>
        )}
        {mobileView === 'chat' && (
          <div className="h-full min-h-0 w-full">
            <ChatArea
              conversation={selected}
              messages={messages}
              isLoading={isMessagesLoading}
                onSendMessage={handleSendMessage}
                onStatusChange={handleStatusChange}
              onDelete={() => selectedId && handleDelete(selectedId)}
              onBack={() => setMobileView('list')}
              onBotStatusToggle={handleBotToggle}
              isBotToggling={botTogglingId === selectedId}
              onPinToggle={handlePinToggle}
              onStarToggle={handleStarToggle}
              onPriorityCycle={handlePriorityCycle}
              onAssign={handleAssign}
              orgLabels={orgLabels}
              onLabelsChange={handleLabelsChange}
              selectedLabels={conversationLabels}
              members={members}
              infoPanelOpen={false}
              onToggleInfoPanel={() => setMobileView('info')}
              agentMap={agentMap}
              botAgentAvailable={selectedBotAgentAvailable}
              emptyContactId={!selectedId ? initialContactId : null}
              isStartingConversation={isStartingConversation}
              onLoadMore={loadMoreMessages}
              hasMore={hasMoreMessages}
              isLoadingMore={isLoadingMoreMessages}
              onOperatorNamePrefixToggle={handleOperatorNamePrefixToggle}
              operatorName={operatorName}
              onOperatorNameSave={handleOperatorNameSave}
              contactEditNonce={contactEditNonce}
            />
          </div>
        )}
        {mobileView === 'info' && (
          <div className="h-full min-h-0 w-full">
            <ContactInfoPanel
              key={infoPanelKey}
              contactId={infoPanelContactId}
              conversationId={infoPanelConversationId}
              fallbackName={selected?.visitorName ?? null}
              fallbackPhone={selected?.visitorPhone ?? null}
              fallbackEmail={selected?.visitorEmail ?? null}
              onContactUpdated={handleContactUpdated}
              onClose={() => setMobileView('chat')}
            />
          </div>
        )}
      </div>
    </InboxTemplate>
  )
}
