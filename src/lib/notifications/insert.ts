import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type NotificationType = 'new_conversation' | 'missed_call' | 'flow_failed'

/**
 * Fan-out helper: inserts one notification row per target user.
 * Uses service-role key — bypasses RLS. Safe to call from webhook handlers.
 *
 * @param orgId        - Organization that owns this event
 * @param type         - Notification type (NOTIF-04 D-02)
 * @param payload      - Event-specific data (conversation_id, call_log_id, action_log_id, etc.)
 * @param userIds      - Explicit target user IDs; if omitted, fans out to all org members
 */
export async function insertNotification(
  orgId: string,
  type: NotificationType,
  payload: Record<string, unknown> = {},
  userIds?: string[],
): Promise<void> {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )

    let targetUserIds = userIds ?? []

    if (targetUserIds.length === 0) {
      const { data: members, error: membersError } = await supabase
        .from('org_members')
        .select('user_id')
        .eq('organization_id', orgId)
      if (membersError || !members || members.length === 0) return
      targetUserIds = members.map((m) => m.user_id)
    }

    if (targetUserIds.length === 0) return

    const rows = targetUserIds.map((userId) => ({
      org_id: orgId,
      user_id: userId,
      type,
      payload: payload as import('@/types/database').Json,
    }))

    const { error } = await supabase.from('notifications').insert(rows)
    if (error) {
      console.error('[notifications/insert] Insert error:', error.message)
    }
  } catch (err) {
    console.error('[notifications/insert] Unexpected error:', err)
  }
}
