'use client'

/**
 * useContactOpen | resolves which conversation to show when the inbox is opened
 * deep-linked to a contact/conversation, and holds the "off-page" fallback.
 *
 * Extracted from ChatLayout. Owns three race-guarded effects:
 *   1. Fallback summary fetch — when the selected conversation isn't on the
 *      currently-loaded page of the list, fetch it directly so the chat area
 *      renders it instead of the "pick a conversation" empty state.
 *   2. /chat?contact=ID with an existing conversation — hydrate contact fields
 *      and force manual mode via prepareContactConversationForOpen.
 *   3. /chat?contact=ID with NO conversation — resolve the best real channel and
 *      create+open a thread (falling back to a 'manual' placeholder).
 *
 * `fetchedConversation` and its setter are returned because the layout also
 * reconciles it from realtime UPDATEs, optimistic previews, and contact edits.
 */

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { ConversationSummary } from '@/types/chat'
import {
  resolveContactStartChannels,
  createContactConversation,
  reopenContactWhatsappConversation,
  prepareContactConversationForOpen,
  type StartChannel,
} from '@/app/(dashboard)/chat/actions'

interface UseContactOpenParams {
  initialContactId: string | null
  initialConversationId: string | null
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  conversations: ConversationSummary[]
  pinned: ConversationSummary[]
  upsertConversation: (c: ConversationSummary) => void
  refreshConversations: () => void
}

export interface UseContactOpenResult {
  fetchedConversation: ConversationSummary | null
  setFetchedConversation: React.Dispatch<React.SetStateAction<ConversationSummary | null>>
  isStartingConversation: boolean
}

export function useContactOpen({
  initialContactId,
  initialConversationId,
  selectedId,
  setSelectedId,
  conversations,
  pinned,
  upsertConversation,
  refreshConversations,
}: UseContactOpenParams): UseContactOpenResult {
  // Holds the selected conversation's summary when it is NOT on the currently
  // loaded page of the list (e.g. arriving via /chat?contact=ID for an older
  // conversation). Without this, `selected` would resolve to null and the chat
  // area would fall back to the "pick a conversation" empty state.
  const [fetchedConversation, setFetchedConversation] =
    useState<ConversationSummary | null>(null)
  // True while auto-creating a conversation for a contact that has none yet.
  const [isStartingConversation, setIsStartingConversation] = useState(false)
  const startAttemptedRef = useRef(false)

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
  }, [initialContactId, initialConversationId, setSelectedId, upsertConversation])

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
        // First, reuse/reopen an existing WhatsApp thread (any provider, even
        // closed) so contacts who already messaged are reachable — and so
        // Zernio/GHL (which can't cold-start) still work.
        const reopened = await reopenContactWhatsappConversation(initialContactId)
        if (cancelled) return
        if ('conversation' in reopened && reopened.conversation) {
          setFetchedConversation(reopened.conversation)
          setSelectedId(reopened.conversation.id)
          refreshConversations()
          return
        }

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
  }, [initialContactId, initialConversationId, selectedId, setSelectedId, refreshConversations])

  return { fetchedConversation, setFetchedConversation, isStartingConversation }
}
