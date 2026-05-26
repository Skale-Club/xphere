// MCP tools for the Projects module.
// Ported from the legacy /api/mcp/projects/route.ts | logic unchanged, only
// the surface area moves to MCP tool defs with Zod schemas.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const Empty = z.object({}).strict()

export const projectsTools: McpToolDef[] = [
  {
    name: 'projects_list_projects',
    title: 'List projects',
    description: 'List all projects in the current org.',
    area: 'projects',
    inputSchema: Empty,
    handler: async (_input, { auth }) => {
      const { data } = await db()
        .from('projects')
        .select('*')
        .eq('org_id', auth.orgId)
        .order('created_at', { ascending: false })
      return { projects: data ?? [] }
    },
  },
  {
    name: 'projects_get_project',
    title: 'Get project',
    description: 'Fetch a single project by id.',
    area: 'projects',
    inputSchema: z.object({ project_id: z.string().uuid() }).strict(),
    handler: async ({ project_id }, { auth }) => {
      const { data } = await db()
        .from('projects')
        .select('*')
        .eq('id', project_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'projects_list_tasks',
    title: 'List tasks',
    description: 'List tasks of a project. Pass include_subtasks=true to include child tasks.',
    area: 'projects',
    inputSchema: z.object({
      project_id: z.string().uuid(),
      include_subtasks: z.boolean().optional(),
    }).strict(),
    handler: async ({ project_id, include_subtasks }, { auth }) => {
      const supabase = db()
      let query = supabase
        .from('project_tasks')
        .select('*')
        .eq('project_id', project_id)
        .eq('org_id', auth.orgId)
      if (!include_subtasks) query = query.is('parent_task_id', null)
      const { data } = await query.order('created_at', { ascending: true })
      return { tasks: data ?? [] }
    },
  },
  {
    name: 'projects_get_task',
    title: 'Get task with subtasks and comments',
    description: 'Fetch a task including its subtasks and comments.',
    area: 'projects',
    inputSchema: z.object({ task_id: z.string().uuid() }).strict(),
    handler: async ({ task_id }, { auth }) => {
      const supabase = db()
      const [{ data: task }, { data: subtasks }, { data: comments }] = await Promise.all([
        supabase.from('project_tasks').select('*').eq('id', task_id).eq('org_id', auth.orgId).maybeSingle(),
        supabase.from('project_tasks').select('*').eq('parent_task_id', task_id).eq('org_id', auth.orgId),
        supabase.from('project_task_comments').select('*').eq('task_id', task_id).eq('org_id', auth.orgId).order('created_at'),
      ])
      if (!task) return { error: 'not_found', status: 404 }
      return { ...task, subtasks: subtasks ?? [], comments: comments ?? [] }
    },
  },
  {
    name: 'projects_list_execution_runs',
    title: 'List execution runs',
    description: 'List execution runs for a task, newest first.',
    area: 'projects',
    inputSchema: z.object({ task_id: z.string().uuid() }).strict(),
    handler: async ({ task_id }, { auth }) => {
      const { data } = await db()
        .from('project_execution_runs')
        .select('*')
        .eq('task_id', task_id)
        .eq('org_id', auth.orgId)
        .order('created_at', { ascending: false })
      return { runs: data ?? [] }
    },
  },
  {
    name: 'projects_update_task',
    title: 'Update task',
    description: 'Update task fields. Pass only the fields you want to change.',
    area: 'projects',
    inputSchema: z.object({
      task_id: z.string().uuid(),
      step: z.string().optional(),
      completed: z.boolean().optional(),
      validation_status: z.string().optional(),
      execution_status: z.string().optional(),
      ai_context: z.string().optional(),
      start_date: z.string().nullable().optional(),
      end_date: z.string().nullable().optional(),
      start_time: z.string().nullable().optional(),
      end_time: z.string().nullable().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const patch: Record<string, unknown> = { last_agent_update: new Date().toISOString() }
      if (input.step !== undefined) patch.step = input.step
      if (input.completed !== undefined) {
        patch.completed = input.completed
        patch.completed_at = input.completed ? new Date().toISOString() : null
      }
      if (input.validation_status !== undefined) patch.validation_status = input.validation_status
      if (input.execution_status !== undefined) patch.execution_status = input.execution_status
      if (input.ai_context !== undefined) patch.ai_context = input.ai_context
      if (input.start_date !== undefined) patch.start_date = input.start_date
      if (input.end_date !== undefined) patch.end_date = input.end_date
      if (input.start_time !== undefined) patch.start_time = input.start_time
      if (input.end_time !== undefined) patch.end_time = input.end_time

      const { error } = await db().from('project_tasks').update(patch).eq('id', input.task_id).eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
  {
    name: 'projects_add_comment',
    title: 'Add comment to task',
    description: 'Adds a comment to a task as the AI agent.',
    area: 'projects',
    inputSchema: z.object({
      task_id: z.string().uuid(),
      content: z.string().min(1),
    }).strict(),
    handler: async ({ task_id, content }, { auth }) => {
      const { data, error } = await db()
        .from('project_task_comments')
        .insert({
          task_id,
          org_id: auth.orgId,
          content: content.trim(),
          author: auth.actor,
          author_type: 'ai_agent',
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'projects_create_execution_run',
    title: 'Create execution run',
    description: 'Start a new execution run on a task.',
    area: 'projects',
    inputSchema: z.object({
      task_id: z.string().uuid(),
      executor_name: z.string().optional(),
      environment: z.string().optional(),
    }).strict(),
    handler: async ({ task_id, executor_name, environment }, { auth }) => {
      const { data, error } = await db()
        .from('project_execution_runs')
        .insert({
          task_id,
          org_id: auth.orgId,
          executor_name: executor_name ?? auth.actor,
          executor_type: 'ai_agent',
          environment: environment ?? 'other',
          status: 'running',
          start_time: new Date().toISOString(),
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
      return data
    },
  },
  {
    name: 'projects_update_execution_run',
    title: 'Update execution run',
    description: 'Mark an execution run as completed/failed and record duration.',
    area: 'projects',
    inputSchema: z.object({
      run_id: z.string().uuid(),
      task_id: z.string().uuid(),
      status: z.string(),
      result: z.string().optional(),
      notes: z.string().optional(),
    }).strict(),
    handler: async ({ run_id, status, result, notes }, { auth }) => {
      const supabase = db()
      const { data: run } = await supabase
        .from('project_execution_runs')
        .select('start_time')
        .eq('id', run_id)
        .eq('org_id', auth.orgId)
        .single()
      const endTime = new Date()
      const startTime = run?.start_time ? new Date(run.start_time) : endTime
      const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 600) / 100

      const { error } = await supabase.from('project_execution_runs').update({
        status,
        result: result ?? null,
        notes: notes ?? null,
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
      }).eq('id', run_id).eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
  {
    name: 'projects_update_validation_status',
    title: 'Update validation status',
    description: 'Updates a task\'s validation status (e.g., approved, pending).',
    area: 'projects',
    inputSchema: z.object({
      task_id: z.string().uuid(),
      status: z.string(),
    }).strict(),
    handler: async ({ task_id, status }, { auth }) => {
      const patch: Record<string, unknown> = {
        validation_status: status,
        last_human_review: new Date().toISOString(),
      }
      if (status === 'approved') patch.needs_validation = false
      const { error } = await db().from('project_tasks').update(patch).eq('id', task_id).eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { updated: true }
    },
  },
]
