import type { ConversationStatus } from '@/types/chat'

/**
 * Mirrors the inbox_entries RPC status contract for client-side Realtime events.
 * With no explicit status filter, archived conversations stay out of the Inbox.
 * The filter may list several statuses, comma-separated; any of them matches.
 */
export function matchesInboxStatusFilter(
  status: ConversationStatus,
  statusFilter: string | null | undefined,
): boolean {
  if (!statusFilter) return status !== 'closed'
  return statusFilter.split(',').map((s) => s.trim()).includes(status)
}
