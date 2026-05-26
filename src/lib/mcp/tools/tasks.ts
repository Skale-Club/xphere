// MCP tools for the platform-wide Tasks table + Bookings read.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const EntityType = z.enum(['contact', 'opportunity', 'account'])

export const tasksTools: McpToolDef[] = [
  {
    name: 'tasks_count',
    title: 'Count tasks',
    description:
      'Returns the total number of tasks in the current org, optionally filtered by entity, status or assignee. Use this to answer "how many tasks do I have".',
    area: 'general_xphere',
    inputSchema: z.object({
      entity_type: EntityType.optional(),
      entity_id: z.string().uuid().optional(),
      status: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
    }).strict(),
    handler: async ({ entity_type, entity_id, status, assigned_to }, { auth }) => {
      let q = db()
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', auth.orgId)
      if (entity_type) q = q.eq('entity_type', entity_type)
      if (entity_id) q = q.eq('entity_id', entity_id)
      if (status) q = q.eq('status', status)
      if (assigned_to) q = q.eq('assigned_to', assigned_to)
      const { count, error } = await q
      if (error) return { error: 'count_failed', detail: error.message }
      return { count: count ?? 0 }
    },
  },
  {
    name: 'tasks_list',
    title: 'List tasks',
    description:
      'List tasks scoped by entity (contact/opportunity/account) or status. Newest first.',
    area: 'general_xphere',
    inputSchema: z.object({
      entity_type: EntityType.optional(),
      entity_id: z.string().uuid().optional(),
      status: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
      limit: z.number().int().positive().max(200).optional(),
    }).strict(),
    handler: async ({ entity_type, entity_id, status, assigned_to, limit = 50 }, { auth }) => {
      let q = db()
        .from('tasks')
        .select('id, title, description, due_date, priority, status, assigned_to, entity_type, entity_id, created_at')
        .eq('org_id', auth.orgId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (entity_type) q = q.eq('entity_type', entity_type)
      if (entity_id) q = q.eq('entity_id', entity_id)
      if (status) q = q.eq('status', status)
      if (assigned_to) q = q.eq('assigned_to', assigned_to)
      const { data } = await q
      return { tasks: data ?? [] }
    },
  },
  {
    name: 'tasks_create',
    title: 'Create task',
    description: 'Create a new task. Optionally link to a CRM entity.',
    area: 'general_xphere',
    inputSchema: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      due_date: z.string().optional(),
      priority: z.string().optional(),
      assigned_to: z.string().uuid().optional(),
      entity_type: EntityType.optional(),
      entity_id: z.string().uuid().optional(),
    }).strict().refine(
      (v) => !v.entity_type || !!v.entity_id,
      { message: 'entity_id is required when entity_type is provided' },
    ),
    handler: async (input, { auth }) => {
      const { data, error } = await db()
        .from('tasks')
        .insert({
          org_id: auth.orgId,
          title: input.title,
          description: input.description ?? null,
          due_date: input.due_date ?? null,
          priority: input.priority ?? 'normal',
          status: 'pending',
          assigned_to: input.assigned_to ?? null,
          entity_type: input.entity_type ?? null,
          entity_id: input.entity_id ?? null,
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'tasks_update',
    title: 'Update task',
    description: 'Patch task fields. Only supplied fields are changed.',
    area: 'general_xphere',
    inputSchema: z.object({
      task_id: z.string().uuid(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      due_date: z.string().nullable().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      assigned_to: z.string().uuid().nullable().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const { task_id, ...patch } = input
      if (Object.keys(patch).length === 0) {
        return { error: 'no_fields', detail: 'no fields to update' }
      }
      const { error } = await db()
        .from('tasks')
        .update(patch)
        .eq('id', task_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
  {
    name: 'bookings_list',
    title: 'List bookings',
    description: 'List recent calendar bookings.',
    area: 'general_xphere',
    inputSchema: z.object({
      status: z.enum(['confirmed', 'cancelled', 'no_show']).optional(),
      contact_id: z.string().uuid().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    handler: async ({ status, contact_id, limit = 30 }, { auth }) => {
      let q = db()
        .from('bookings')
        .select('id, event_type_id, booker_name, booker_email, booker_phone, start_at, end_at, status, linked_contact_id, notes, created_at')
        .eq('org_id', auth.orgId)
        .order('start_at', { ascending: false })
        .limit(limit)
      if (status) q = q.eq('status', status)
      if (contact_id) q = q.eq('linked_contact_id', contact_id)
      const { data } = await q
      return { bookings: data ?? [] }
    },
  },
]
