export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { validateMcpToken, writeAuditLog } from '@/lib/projects/mcp-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: ReturnType<typeof createServiceRoleClient>) { return supabase as any }

function ok(data: unknown) {
  return Response.json({ ok: true, data })
}

function err(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status })
}

export async function POST(request: Request) {
  const auth = await validateMcpToken(request.headers.get('authorization'))
  if (!auth) return err('Unauthorized', 401)

  let body: { action: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON')
  }

  const { action, params = {} } = body
  const { orgId, actor } = auth
  const supabase = createServiceRoleClient()

  // ── READ ACTIONS ─────────────────────────────────────────────────────────

  if (action === 'list_projects') {
    const { data } = await db(supabase).from('projects').select('*').eq('org_id', orgId).order('created_at', { ascending: false })
    return ok(data ?? [])
  }

  if (action === 'get_project') {
    const { project_id } = params as { project_id: string }
    if (!project_id) return err('project_id required')
    const { data } = await db(supabase).from('projects').select('*').eq('id', project_id).eq('org_id', orgId).single()
    if (!data) return err('Not found', 404)
    return ok(data)
  }

  if (action === 'list_tasks') {
    const { project_id, include_subtasks } = params as { project_id: string; include_subtasks?: boolean }
    if (!project_id) return err('project_id required')
    const query = db(supabase).from('project_tasks').select('*').eq('project_id', project_id).eq('org_id', orgId)
    if (!include_subtasks) query.is('parent_task_id', null)
    const { data } = await query.order('created_at', { ascending: true })
    return ok(data ?? [])
  }

  if (action === 'get_task') {
    const { task_id } = params as { task_id: string }
    if (!task_id) return err('task_id required')
    const [{ data: task }, { data: subtasks }, { data: comments }] = await Promise.all([
      db(supabase).from('project_tasks').select('*').eq('id', task_id).eq('org_id', orgId).single(),
      db(supabase).from('project_tasks').select('*').eq('parent_task_id', task_id).eq('org_id', orgId),
      db(supabase).from('project_task_comments').select('*').eq('task_id', task_id).eq('org_id', orgId).order('created_at'),
    ])
    if (!task) return err('Not found', 404)
    return ok({ ...task, subtasks: subtasks ?? [], comments: comments ?? [] })
  }

  if (action === 'list_execution_runs') {
    const { task_id } = params as { task_id: string }
    if (!task_id) return err('task_id required')
    const { data } = await db(supabase).from('project_execution_runs').select('*').eq('task_id', task_id).eq('org_id', orgId).order('created_at', { ascending: false })
    return ok(data ?? [])
  }

  // ── WRITE ACTIONS ─────────────────────────────────────────────────────────

  if (action === 'update_task') {
    const {
      task_id,
      step,
      completed,
      validation_status,
      execution_status,
      ai_context,
      start_date,
      end_date,
      start_time,
      end_time,
    } = params as {
      task_id: string
      step?: string
      completed?: boolean
      validation_status?: string
      execution_status?: string
      ai_context?: string
      start_date?: string | null
      end_date?: string | null
      start_time?: string | null
      end_time?: string | null
    }
    if (!task_id) return err('task_id required')

    const patch: Record<string, unknown> = { last_agent_update: new Date().toISOString() }
    if (step !== undefined) patch.step = step
    if (completed !== undefined) { patch.completed = completed; patch.completed_at = completed ? new Date().toISOString() : null }
    if (validation_status !== undefined) patch.validation_status = validation_status
    if (execution_status !== undefined) patch.execution_status = execution_status
    if (ai_context !== undefined) patch.ai_context = ai_context
    if (start_date !== undefined) patch.start_date = start_date
    if (end_date !== undefined) patch.end_date = end_date
    if (start_time !== undefined) patch.start_time = start_time
    if (end_time !== undefined) patch.end_time = end_time

    const { error } = await db(supabase).from('project_tasks').update(patch).eq('id', task_id).eq('org_id', orgId)
    if (error) {
      await writeAuditLog(orgId, actor, action, task_id, 'failed', error.message)
      return err('Update failed')
    }
    await writeAuditLog(orgId, actor, action, task_id, 'success')
    return ok({ updated: true })
  }

  if (action === 'add_comment') {
    const { task_id, content } = params as { task_id: string; content: string }
    if (!task_id || !content?.trim()) return err('task_id and content required')

    const { data, error } = await db(supabase)
      .from('project_task_comments')
      .insert({ task_id, org_id: orgId, content: content.trim(), author: actor, author_type: 'ai_agent' })
      .select()
      .single()
    if (error) {
      await writeAuditLog(orgId, actor, action, task_id, 'failed', error.message)
      return err('Failed to add comment')
    }
    await writeAuditLog(orgId, actor, action, task_id, 'success')
    return ok(data)
  }

  if (action === 'create_execution_run') {
    const { task_id, executor_name, environment } = params as { task_id: string; executor_name?: string; environment?: string }
    if (!task_id) return err('task_id required')

    const { data, error } = await db(supabase)
      .from('project_execution_runs')
      .insert({
        task_id,
        org_id: orgId,
        executor_name: executor_name ?? actor,
        executor_type: 'ai_agent',
        environment: environment ?? 'other',
        status: 'running',
        start_time: new Date().toISOString(),
      })
      .select()
      .single()
    if (error) {
      await writeAuditLog(orgId, actor, action, task_id, 'failed', error.message)
      return err('Failed to create execution run')
    }
    await writeAuditLog(orgId, actor, action, task_id, 'success')
    return ok(data)
  }

  if (action === 'update_execution_run') {
    const { run_id, task_id, status, result, notes } = params as {
      run_id: string
      task_id: string
      status: string
      result?: string
      notes?: string
    }
    if (!run_id || !task_id || !status) return err('run_id, task_id and status required')

    const { data: run } = await db(supabase).from('project_execution_runs').select('start_time').eq('id', run_id).eq('org_id', orgId).single()
    const endTime = new Date()
    const startTime = run?.start_time ? new Date(run.start_time) : endTime
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 600) / 100

    const { error } = await db(supabase).from('project_execution_runs').update({
      status,
      result: result ?? null,
      notes: notes ?? null,
      end_time: endTime.toISOString(),
      duration_minutes: durationMinutes,
    }).eq('id', run_id).eq('org_id', orgId)

    if (error) {
      await writeAuditLog(orgId, actor, action, task_id, 'failed', error.message)
      return err('Failed to update execution run')
    }
    await writeAuditLog(orgId, actor, action, task_id, 'success')
    return ok({ updated: true })
  }

  if (action === 'update_validation_status') {
    const { task_id, status } = params as { task_id: string; status: string }
    if (!task_id || !status) return err('task_id and status required')

    const patch: Record<string, unknown> = {
      validation_status: status,
      last_human_review: new Date().toISOString(),
    }
    if (status === 'approved') patch.needs_validation = false

    const { error } = await db(supabase).from('project_tasks').update(patch).eq('id', task_id).eq('org_id', orgId)
    if (error) {
      await writeAuditLog(orgId, actor, action, task_id, 'failed', error.message)
      return err('Failed to update validation status')
    }
    await writeAuditLog(orgId, actor, action, task_id, 'success')
    return ok({ updated: true })
  }

  return err(`Unknown action: ${action}`)
}

export async function GET() {
  return Response.json({
    endpoint: 'Xphere Projects MCP',
    version: '1.0',
    actions: [
      'list_projects', 'get_project', 'list_tasks', 'get_task', 'list_execution_runs',
      'update_task', 'add_comment', 'create_execution_run', 'update_execution_run', 'update_validation_status',
    ],
  })
}
