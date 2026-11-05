import type { ConversationMessage } from '@/types/chat'

/** An optimistic bubble is matched to the real message within this window. */
export const TEMP_MESSAGE_MATCH_WINDOW_MS = 30_000

export interface PolledMessagesMerge {
  /** The merged list. Identical to `prev` (same reference) when nothing changed. */
  next: ConversationMessage[]
  /** Messages that were not on screen before (including ones that replaced an optimistic bubble). */
  inserted: ConversationMessage[]
  changed: boolean
}

function differs(a: ConversationMessage, b: ConversationMessage): boolean {
  return (
    a.content !== b.content ||
    (a.channel ?? null) !== (b.channel ?? null) ||
    (a.email_delivery_status ?? null) !== (b.email_delivery_status ?? null) ||
    JSON.stringify(a.metadata ?? null) !== JSON.stringify(b.metadata ?? null)
  )
}

/**
 * Merge the newest page of messages (as returned by the messages route, oldest
 * first) into the thread on screen. This is what the Realtime INSERT/UPDATE
 * handlers did, applied to a polled window:
 *
 *   - a message already on screen (same id) is updated in place when its
 *     content, metadata (e.g. delivery status) or channel changed;
 *   - an unknown message that matches an optimistic `temp-` bubble (same role
 *     and content, within 30s) replaces that bubble;
 *   - any other unknown message is appended;
 *   - messages that are on screen but missing from the polled window are left
 *     alone (older pages loaded with "load more" stay put).
 */
export function mergePolledMessages(
  prev: ConversationMessage[],
  polled: ConversationMessage[],
): PolledMessagesMerge {
  let next = prev
  const inserted: ConversationMessage[] = []
  const ensureCopy = () => {
    if (next === prev) next = [...prev]
  }

  for (const message of polled) {
    const idx = next.findIndex((m) => m.id === message.id)
    if (idx >= 0) {
      if (differs(next[idx], message)) {
        ensureCopy()
        next[idx] = { ...next[idx], ...message }
      }
      continue
    }

    const time = new Date(message.createdAt).getTime()
    const tempIdx = next.findIndex(
      (m) =>
        m.id.startsWith('temp-') &&
        m.role === message.role &&
        m.content === message.content &&
        Math.abs(new Date(m.createdAt).getTime() - time) < TEMP_MESSAGE_MATCH_WINDOW_MS,
    )
    ensureCopy()
    if (tempIdx >= 0) next[tempIdx] = message
    else next.push(message)
    inserted.push(message)
  }

  return { next, inserted, changed: next !== prev }
}

/**
 * Resolve an optimistic bubble once the POST response carries the real message.
 * A poll may already have inserted that message (by id, or by taking over the
 * temp bubble), in which case the temp bubble is dropped instead of being
 * replaced, so the message never shows twice. Returns `prev` itself when
 * there is no temp bubble left to resolve.
 */
export function resolveSentMessage(
  prev: ConversationMessage[],
  tempId: string,
  real: ConversationMessage,
): ConversationMessage[] {
  const tempIdx = prev.findIndex((m) => m.id === tempId)
  if (tempIdx < 0) return prev // a poll already swapped it for the real message
  const next = [...prev]
  if (prev.some((m) => m.id === real.id)) {
    next.splice(tempIdx, 1)
    return next
  }
  next[tempIdx] = real
  return next
}
