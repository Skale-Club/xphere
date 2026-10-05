// Row -> view mappers shared by the GBP pages. Pure.

import type { Database } from '@/types/database'

type ChangeRow = Database['public']['Tables']['gbp_change_requests']['Row']

export const CHANGE_FIELDS =
  'id, command_type, status, actor_label, actor_type, created_at, completed_at, error_message, diff, rollback_of, target_ref, payload'

export function toChangeView(c: Pick<ChangeRow, 'id' | 'command_type' | 'status' | 'actor_label' | 'actor_type' | 'created_at' | 'completed_at' | 'error_message' | 'diff' | 'rollback_of'>) {
  return {
    id: c.id,
    commandType: c.command_type,
    status: c.status,
    actorLabel: c.actor_label,
    actorType: c.actor_type,
    createdAt: c.created_at,
    completedAt: c.completed_at,
    errorMessage: c.error_message,
    diff: (Array.isArray(c.diff) ? c.diff : []) as { field: string; before: unknown; after: unknown }[],
    rollbackOf: c.rollback_of,
  }
}
