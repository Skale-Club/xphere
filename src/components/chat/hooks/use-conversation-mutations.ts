'use client'

/**
 * useConversationMutations | optimistic conversation-level actions.
 *
 * Extracted from ChatLayout. Every handler follows the same shape: apply an
 * optimistic upsert, call the server action, and reconcile (roll back on error
 * or refetch when the change crosses a bucket boundary).
 *
 * Why refs instead of closures: the returned handlers are passed down to the
 * (memoized) conversation cards. If they changed identity on every render — as
 * they did when defined inline in the layout — the cards' `onPin` prop would
 * differ each render and bust the memo, re-rendering the whole list on every
 * unrelated state change (typing indicator, incoming message, etc.). Reading
 * the latest conversations/filters/selection through refs keeps the handlers
 * stable for the component's lifetime.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type {
  ConversationSummary,
  ConversationPriority,
  ConversationStatus,
} from '@/types/chat'
import {
  toggleBotStatus,
  pinConversation,
  starConversation,
  setConversationPriority,
  assignConversation,
} from '@/app/(dashboard)/inbox/actions'
import { conversationChannelToAgentChannel } from '@/lib/agents/channel-map'

interface UseConversationMutationsParams {
  selectedId: string | null
  /** Whether the current filter set restricts to starred conversations. */
  starredFilter: boolean | null | undefined
  agentDefaultChannels: Set<string> | null
  conversations: ConversationSummary[]
  pinned: ConversationSummary[]
  upsertConversation: (c: ConversationSummary) => void
  removeConversation: (id: string) => void
  refreshConversations: () => void
  /** Clears selection/messages when the currently-open conversation is deleted. */
  onConversationRemoved: (id: string) => void
}

export interface UseConversationMutationsResult {
  botTogglingId: string | null
  handleStatusChange: (status: ConversationStatus) => Promise<void>
  handleDelete: (id: string) => Promise<void>
  handleBotToggle: (conversationId: string, currentStatus: string) => Promise<void>
  handlePinToggle: (id: string, pinnedNext: boolean) => Promise<void>
  handleStarToggle: (id: string, starredNext: boolean) => Promise<void>
  handlePriorityCycle: (id: string, next: ConversationPriority) => Promise<void>
  handleAssign: (id: string, userId: string | null) => Promise<void>
}

export function useConversationMutations({
  selectedId,
  starredFilter,
  agentDefaultChannels,
  conversations,
  pinned,
  upsertConversation,
  removeConversation,
  refreshConversations,
  onConversationRemoved,
}: UseConversationMutationsParams): UseConversationMutationsResult {
  const [botTogglingId, setBotTogglingId] = useState<string | null>(null)

  // Latest-value refs so the handlers below can stay referentially stable.
  const selectedIdRef = useRef(selectedId)
  const starredFilterRef = useRef(starredFilter)
  const agentDefaultChannelsRef = useRef(agentDefaultChannels)
  const conversationsRef = useRef(conversations)
  const pinnedRef = useRef(pinned)
  const botTogglingRef = useRef(false)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    starredFilterRef.current = starredFilter
  }, [starredFilter])
  useEffect(() => {
    agentDefaultChannelsRef.current = agentDefaultChannels
  }, [agentDefaultChannels])
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])
  useEffect(() => {
    pinnedRef.current = pinned
  }, [pinned])

  const findVisibleConversation = useCallback(
    (id: string): ConversationSummary | undefined =>
      conversationsRef.current.find((c) => c.id === id) ??
      pinnedRef.current.find((c) => c.id === id),
    [],
  )

  const handleStatusChange = useCallback(async (status: ConversationStatus) => {
    const id = selectedIdRef.current
    if (!id) return
    try {
      await fetch(`/api/chat/conversations/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      // Realtime UPDATE will reconcile the list | no manual refetch needed.
    } catch {
      // ignore
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
        onConversationRemoved(id)
        removeConversation(id)
      } catch {
        // ignore
      }
    },
    [onConversationRemoved, removeConversation],
  )

  const handleBotToggle = useCallback(
    async (conversationId: string, currentStatus: string) => {
      if (botTogglingRef.current) return
      const current = findVisibleConversation(conversationId)
      const channel = current?.channel
      const agentChannel = conversationChannelToAgentChannel(channel)
      const hasAgent = agentChannel
        ? agentDefaultChannelsRef.current?.has(agentChannel) !== false
        : false
      if (currentStatus !== 'active' && !hasAgent) {
        toast.error(`No AI agent is configured for ${channel ?? 'this channel'}.`)
        return
      }
      botTogglingRef.current = true
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
      botTogglingRef.current = false
      setBotTogglingId(null)
    },
    [findVisibleConversation, upsertConversation],
  )

  const handlePinToggle = useCallback(
    async (id: string, pinnedNext: boolean) => {
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
    },
    [findVisibleConversation, upsertConversation, refreshConversations],
  )

  const handleStarToggle = useCallback(
    async (id: string, starredNext: boolean) => {
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
      } else if (starredFilterRef.current) {
        refreshConversations()
      }
    },
    [findVisibleConversation, upsertConversation, refreshConversations],
  )

  const handlePriorityCycle = useCallback(
    async (id: string, next: ConversationPriority) => {
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
    },
    [findVisibleConversation, upsertConversation],
  )

  const handleAssign = useCallback(
    async (id: string, userId: string | null) => {
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
    },
    [findVisibleConversation, upsertConversation],
  )

  return {
    botTogglingId,
    handleStatusChange,
    handleDelete,
    handleBotToggle,
    handlePinToggle,
    handleStarToggle,
    handlePriorityCycle,
    handleAssign,
  }
}
