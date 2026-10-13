// Task tools.

import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'
import { scheduleXpotTaskSync } from '@/lib/xpot/task-sync'

const MAX_ROWS = 50

async function queryTasks(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const status = input.status as 'todo' | 'in_progress' | 'done' | 'cancelled' | undefined
  const priority = input.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined
  const limit = Math.min(Number(input.limit ?? 25), MAX_ROWS)

  let query = ctx.supabase
    .from('tasks')
    .select('id, title, due_date, priority, status, assigned_to, entity_type, entity_id, created_at')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)

  const { data, error } = await query
  if (error) return { success: false, error: error.message }
  return { success: true, data: { tasks: data, count: data?.length ?? 0 } }
}

async function getTask(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const { data, error } = await ctx.supabase
    .from('tasks').select('*').eq('id', id).maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `task ${id} not found` }
  return { success: true, data }
}

async function createTask(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const title = input.title as string | undefined
  if (!title) return { success: false, error: 'title required' }
  const { data, error } = await ctx.supabase
    .from('tasks')
    .insert({
      org_id: ctx.orgId,
      title,
      description: (input.description as string | undefined) ?? null,
      due_date: (input.due_date as string | undefined) ?? null,
      priority: (input.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined) ?? 'medium',
      status: 'todo' as const,
      entity_type: (input.entity_type as 'contact' | 'account' | 'opportunity' | undefined) ?? null,
      entity_id: (input.entity_id as string | undefined) ?? null,
      created_by: ctx.userId,
    })
    .select('id, title, due_date, status')
    .single()
  if (error) return { success: false, error: error.message }
  scheduleXpotTaskSync()
  return { success: true, data }
}

async function updateTask(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const patch: Record<string, unknown> = {}
  for (const k of ['title', 'description', 'due_date', 'priority', 'status']) {
    if (input[k] !== undefined) patch[k] = input[k]
  }
  if (Object.keys(patch).length === 0) return { success: false, error: 'no fields to update' }
  const { data, error } = await ctx.supabase
    .from('tasks').update(patch).eq('id', id)
    .select('id, title, status').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `task ${id} not found` }
  scheduleXpotTaskSync()
  return { success: true, data }
}

async function completeTask(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = input.id as string
  if (!id) return { success: false, error: 'id required' }
  const { data, error } = await ctx.supabase
    .from('tasks').update({ status: 'done' as const }).eq('id', id)
    .select('id, title, status').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: `task ${id} not found` }
  scheduleXpotTaskSync()
  return { success: true, data }
}

export const taskTools: CopilotToolRegistry = {
  query_tasks: {
    mode: 'read',
    definition: {
      name: 'query_tasks',
      description: 'List tasks, optionally filtered by status (todo|in_progress|done|cancelled) or priority (low|medium|high|urgent).',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          limit: { type: 'number' },
        },
      },
    },
    handler: queryTasks,
  },
  get_task: {
    mode: 'read',
    definition: {
      name: 'get_task',
      description: 'Fetch a single task by id.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: getTask,
  },
  create_task: {
    mode: 'write',
    definition: {
      name: 'create_task',
      description: 'Create a task. Optionally link to a CRM entity (contact/account/opportunity).',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          due_date: { type: 'string', description: 'ISO timestamp' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          entity_type: { type: 'string', enum: ['contact', 'account', 'opportunity'] },
          entity_id: { type: 'string' },
        },
        required: ['title'],
      },
    },
    handler: createTask,
  },
  update_task: {
    mode: 'write',
    definition: {
      name: 'update_task',
      description: 'Patch a task (title, due_date, priority, status…).',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          due_date: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled'] },
        },
        required: ['id'],
      },
    },
    handler: updateTask,
  },
  complete_task: {
    mode: 'write',
    definition: {
      name: 'complete_task',
      description: 'Mark a task as done.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: completeTask,
  },
}
