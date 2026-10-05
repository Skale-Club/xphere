import type { ConversationStatus } from '@/types/chat'

/**
 * Mirrors the inbox_entries RPC status contract for client-side Realtime events.
 * With no explicit status filter, archived conversations stay out of the Inbox.
 */
export function matchesInboxStatusFilter(
  status: ConversationStatus,
  statusFilter: string | null | undefined,
): boolean {
  return statusFilter ? status === statusFilter : status !== 'closed'
}
