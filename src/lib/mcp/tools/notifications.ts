// MCP tools for in-app notifications.
//
// Notifications are user-scoped — the OAuth flow gives us user_id, the legacy
// bearer flow doesn't. For legacy tokens we return org-wide notifications
// instead, which is the broader (and still safe) interpretation.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const notificationsTools: McpToolDef[] = [
  {
    name: 'notifications_list',
    title: 'List notifications',
    description: 'List recent notifications for the authenticated user (OAuth flow) or all org notifications (legacy bearer flow). Optional unread filter.',
    area: 'general_xphere',
    inputSchema: z.object({
      unread_only: z.boolean().optional(),
      limit: z.number().int().positive().max(200).optional(),
    }).strict(),
    handler: async ({ unread_only, limit = 50 }, { auth }) => {
      let q = db()
        .from('notifications')
        .select('id, user_id, type, payload, read_at, created_at')
        .eq('org_id', auth.orgId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (auth.userId) q = q.eq('user_id', auth.userId)
      if (unread_only) q = q.is('read_at', null)
      const { data } = await q
      return { notifications: data ?? [] }
    },
  },
  {
    name: 'notifications_count_unread',
    title: 'Count unread notifications',
    description: 'Returns the number of unread notifications for the authenticated user (or org-wide on legacy bearer flow).',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      let q = db()
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
        .is('read_at', null)
      if (auth.userId) q = q.eq('user_id', auth.userId)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'notifications_mark_read',
    title: 'Mark notifications as read',
    description: 'Mark a specific notification or all unread notifications as read.',
    area: 'general_xphere',
    inputSchema: z.object({
      notification_id: z.string().uuid().optional(),
    }).strict(),
    handler: async ({ notification_id }, { auth }) => {
      const supabase = db()
      const now = new Date().toISOString()
      let q = supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('org_id', auth.orgId)
        .is('read_at', null)
      if (notification_id) q = q.eq('id', notification_id)
      if (auth.userId) q = q.eq('user_id', auth.userId)
      const { error, count } = await q.select('id', { count: 'exact', head: true })
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: count ?? 0 }
    },
  },
]
