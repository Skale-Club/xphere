// MCP tools for conversation labels.
// Tables: conversation_labels (org_id) + conversation_label_assignments (junction).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export const conversationLabelsTools: McpToolDef[] = [
  {
    name: 'conversation_labels_list',
    title: 'List conversation labels',
    description: 'List all conversation labels in the current org, ordered by position.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const { data } = await db()
        .from('conversation_labels')
        .select('id, name, color, position, created_at')
        .eq('org_id', auth.orgId)
        .order('position', { ascending: true })
      return { labels: data ?? [] }
    },
  },
  {
    name: 'conversation_labels_create',
    title: 'Create conversation label',
    description: 'Create a new conversation label.',
    area: 'general_xphere',
    inputSchema: z.object({
      name: z.string().min(1).max(64),
      color: z.string().optional(),
    }).strict(),
    handler: async ({ name, color }, { auth }) => {
      const { data, error } = await db()
        .from('conversation_labels')
        .insert({
          org_id: auth.orgId,
          name: name.trim(),
          color: color ?? '#6366F1',
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'conversation_labels_assign',
    title: 'Assign label to conversation',
    description: 'Attach a label to a conversation.',
    area: 'general_xphere',
    inputSchema: z.object({
      conversation_id: z.string().uuid(),
      label_id: z.string().uuid(),
    }).strict(),
    handler: async ({ conversation_id, label_id }, { auth }) => {
      const supabase = db()
      // Verify both belong to the org before inserting.
      const [{ data: conv }, { data: label }] = await Promise.all([
        supabase.from('conversations').select('id').eq('id', conversation_id).eq('org_id', auth.orgId).maybeSingle(),
        supabase.from('conversation_labels').select('id').eq('id', label_id).eq('org_id', auth.orgId).maybeSingle(),
      ])
      if (!conv) return { error: 'not_found', detail: 'conversation not found in this org', status: 404 }
      if (!label) return { error: 'not_found', detail: 'label not found in this org', status: 404 }

      const { error } = await supabase
        .from('conversation_label_assignments')
        .upsert({ conversation_id, label_id }, { onConflict: 'conversation_id,label_id' })
      if (error) return { error: 'assign_failed', detail: error.message }
      return { assigned: true }
    },
  },
  {
    name: 'conversation_labels_unassign',
    title: 'Unassign label from conversation',
    description: 'Remove a label from a conversation.',
    area: 'general_xphere',
    inputSchema: z.object({
      conversation_id: z.string().uuid(),
      label_id: z.string().uuid(),
    }).strict(),
    handler: async ({ conversation_id, label_id }, { auth }) => {
      const supabase = db()
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversation_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!conv) return { error: 'not_found', status: 404 }

      const { error } = await supabase
        .from('conversation_label_assignments')
        .delete()
        .eq('conversation_id', conversation_id)
        .eq('label_id', label_id)
      if (error) return { error: 'delete_failed', detail: error.message }
      return { unassigned: true }
    },
  },
]
