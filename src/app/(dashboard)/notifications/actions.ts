'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type NotificationRow = Database['public']['Tables']['notifications']['Row']

export async function fetchNotifications(): Promise<NotificationRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return []
  return data ?? []
}

export async function markNotificationRead(id: string): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('read_at', null)
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}

/**
 * Notifications newer than `since` (an ISO string exactly as returned in a
 * previous row's `created_at`, so no precision is lost), oldest last. Used by
 * the bell's poll: one small indexed query instead of re-reading the list.
 * With `since = null` it behaves like `fetchNotifications`.
 */
export async function fetchNotificationsSince(since: string | null): Promise<NotificationRow[]> {
  if (!since) return fetchNotifications()
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return []
  return data ?? []
}
