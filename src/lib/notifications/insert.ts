import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type NotificationType = 'new_conversation' | 'missed_call' | 'flow_failed' | 'new_message' | 'incoming_call'

export interface InsertNotificationOptions {
  /**
   * When true, await the web-push fan-out instead of firing it in the
   * background. Default false preserves the original fire-and-forget
   * behavior (correct for request/response handlers that shouldn't be
   * blocked by push delivery). Callers running inside Next.js `after()` —
   * where the runtime may tear down once the callback resolves — should pass
   * true so the push fan-out isn't cut off mid-flight (e.g. incoming-call
   * pushes to a backgrounded PWA).
   */
  waitForPush?: boolean
}

/**
 * Fan-out helper: inserts one notification row per target user.
 * Uses service-role key | bypasses RLS. Safe to call from webhook handlers.
 *
 * @param orgId        - Organization that owns this event
 * @param type         - Notification type (NOTIF-04 D-02)
 * @param payload      - Event-specific data (conversation_id, call_log_id, action_log_id, etc.)
 * @param userIds      - Explicit target user IDs; if omitted, fans out to all org members
 * @param options      - See InsertNotificationOptions
 */
export async function insertNotification(
  orgId: string,
  type: NotificationType,
  payload: Record<string, unknown> = {},
  userIds?: string[],
  options?: InsertNotificationOptions,
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

    const { data: inserted, error } = await supabase
      .from('notifications')
      .insert(rows)
      .select('id, user_id')
    if (error) {
      console.error('[notifications/insert] Insert error:', error.message)
      return
    }

    // Fan out push notifications. By default fire-and-forget so callers
    // aren't blocked; `waitForPush` opts into awaiting it (see
    // InsertNotificationOptions).
    if (inserted && inserted.length > 0) {
      const rows = inserted as { id: string; user_id: string }[]
      if (options?.waitForPush) {
        await sendPushNotifications(rows)
      } else {
        void sendPushNotifications(rows)
      }
    }
  } catch (err) {
    console.error('[notifications/insert] Unexpected error:', err)
  }
}

async function sendPushNotifications(rows: { id: string; user_id: string }[]): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return

  await Promise.all(
    rows.map(async (row) => {
      try {
        await fetch(`${supabaseUrl}/functions/v1/push-sender`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ user_id: row.user_id, notification_id: row.id }),
        })
      } catch (err) {
        console.error('[notifications/insert] push-sender invoke error:', err)
      }
    }),
  )
}
