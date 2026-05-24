'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/crypto'
import type { ProjectRow, ProjectTaskRow, ProjectLabelRow, ProjectSavedViewRow, ProjectExecutionRunRow, TaskPriority, ProjectTaskStep, ProjectValidationStatus, ProjectViewType } from '@/types/database'

export type TaskWithLabels = ProjectTaskRow & {
  labels: ProjectLabelRow[]
  subtask_count: number
  completed_subtask_count: number
}

// Type-cast helper: Supabase doesn't have projects tables in the generated Database type,
// so we cast via `any` and let the caller's return type guarantee correctness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<ProjectRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
  return (data as ProjectRow[]) ?? []
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()
  return (data as ProjectRow) ?? null
}

export async function createProject(input: { name: string; description?: string; color?: string }): Promise<ProjectRow | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null
  const { data, error } = await db(supabase)
    .from('projects')
    .insert({ ...input, org_id: orgId, created_by: user.id })
    .select()
    .single()
  if (error) throw error
  revalidatePath('/projects')
  return data as ProjectRow
}

export async function updateProject(id: string, input: Partial<Pick<ProjectRow, 'name' | 'description' | 'color'>>): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase).from('projects').update(input).eq('id', id)
  revalidatePath('/projects')
  revalidatePath(`/projects/${id}`)
}

export async function deleteProject(id: string): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase).from('projects').delete().eq('id', id)
  revalidatePath('/projects')
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function getProjectTasks(projectId: string): Promise<TaskWithLabels[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data: tasks } = await db(supabase)
    .from('project_tasks')
    .select('*')
    .eq('project_id', projectId)
    .is('parent_task_id', null)
    .order('created_at', { ascending: true })

  if (!tasks) return []

  const taskList = tasks as ProjectTaskRow[]
  const taskIds = taskList.map((t) => t.id)

  const [{ data: labelJoins }, { data: subtasks }] = await Promise.all([
    db(supabase)
      .from('project_task_labels')
      .select('task_id, project_labels(*)')
      .in('task_id', taskIds),
    db(supabase)
      .from('project_tasks')
      .select('id, parent_task_id, completed')
      .in('parent_task_id', taskIds),
  ])

  const labelMap = new Map<string, ProjectLabelRow[]>()
  for (const join of (labelJoins as { task_id: string; project_labels: ProjectLabelRow | null }[]) ?? []) {
    if (!labelMap.has(join.task_id)) labelMap.set(join.task_id, [])
    if (join.project_labels) labelMap.get(join.task_id)!.push(join.project_labels)
  }

  const subtaskCountMap = new Map<string, { total: number; completed: number }>()
  for (const sub of (subtasks as { id: string; parent_task_id: string | null; completed: boolean }[]) ?? []) {
    const pid = sub.parent_task_id!
    if (!subtaskCountMap.has(pid)) subtaskCountMap.set(pid, { total: 0, completed: 0 })
    const counts = subtaskCountMap.get(pid)!
    counts.total++
    if (sub.completed) counts.completed++
  }

  return taskList.map((t) => ({
    ...t,
    labels: labelMap.get(t.id) ?? [],
    subtask_count: subtaskCountMap.get(t.id)?.total ?? 0,
    completed_subtask_count: subtaskCountMap.get(t.id)?.completed ?? 0,
  }))
}

export async function getSubtasks(parentTaskId: string): Promise<ProjectTaskRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('project_tasks')
    .select('*')
    .eq('parent_task_id', parentTaskId)
    .order('created_at', { ascending: true })
  return (data as ProjectTaskRow[]) ?? []
}

export async function getTask(id: string): Promise<TaskWithLabels | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()

  const { data: task } = await db(supabase)
    .from('project_tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (!task) return null

  const { data: labelJoins } = await db(supabase)
    .from('project_task_labels')
    .select('task_id, project_labels(*)')
    .eq('task_id', id)

  const { data: subtasksAll } = await db(supabase)
    .from('project_tasks')
    .select('id, completed')
    .eq('parent_task_id', id)

  const labels = ((labelJoins as { task_id: string; project_labels: ProjectLabelRow | null }[]) ?? [])
    .map((j) => j.project_labels)
    .filter(Boolean) as ProjectLabelRow[]

  const t = task as ProjectTaskRow

  return {
    ...t,
    labels,
    subtask_count: (subtasksAll as { id: string; completed: boolean }[])?.length ?? 0,
    completed_subtask_count: (subtasksAll as { id: string; completed: boolean }[])?.filter((s) => s.completed).length ?? 0,
  }
}

export async function createTask(input: {
  project_id: string
  name: string
  step?: ProjectTaskStep
  priority?: TaskPriority
  parent_task_id?: string
  description?: string
  responsible_id?: string
  start_date?: string
  end_date?: string
  ai_context?: string
  expected_deliverable?: string
  validation_criteria?: string
}): Promise<ProjectTaskRow | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null
  const { data, error } = await db(supabase)
    .from('project_tasks')
    .insert({ ...input, org_id: orgId, created_by: user.id })
    .select()
    .single()
  if (error) throw error
  revalidatePath(`/projects/${input.project_id}`)
  return data as ProjectTaskRow
}

export async function updateTask(
  id: string,
  projectId: string,
  input: Partial<Omit<ProjectTaskRow, 'id' | 'org_id' | 'project_id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase).from('project_tasks').update(input).eq('id', id)
  revalidatePath(`/projects/${projectId}`)
}

export async function moveTask(id: string, projectId: string, step: ProjectTaskStep): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  const patch: Partial<ProjectTaskRow> = { step }
  if (step === 'done') {
    patch.completed = true
    patch.completed_at = new Date().toISOString()
  } else {
    patch.completed = false
    patch.completed_at = null
  }
  await db(supabase).from('project_tasks').update(patch).eq('id', id)
  revalidatePath(`/projects/${projectId}`)
}

export async function deleteTask(id: string, projectId: string): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase).from('project_tasks').delete().eq('id', id)
  revalidatePath(`/projects/${projectId}`)
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export async function getProjectLabels(projectId: string): Promise<ProjectLabelRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('project_labels')
    .select('*')
    .eq('project_id', projectId)
    .order('name', { ascending: true })
  return (data as ProjectLabelRow[]) ?? []
}

export async function createLabel(input: { project_id: string; name: string; color?: string }): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return
  await db(supabase).from('project_labels').insert({ ...input, org_id: orgId })
  revalidatePath(`/projects/${input.project_id}`)
}

export async function setTaskValidationStatus(
  id: string,
  projectId: string,
  status: ProjectValidationStatus
): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  const patch: Partial<ProjectTaskRow> = {
    validation_status: status,
    last_human_review: new Date().toISOString(),
  }
  if (status === 'approved') patch.needs_validation = false
  await db(supabase).from('project_tasks').update(patch).eq('id', id)
  revalidatePath(`/projects/${projectId}`)
}

// ---------------------------------------------------------------------------
// Saved Views
// ---------------------------------------------------------------------------

export async function getDefaultSavedView(projectId: string): Promise<ProjectSavedViewRow | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('project_saved_views')
    .select('*')
    .eq('project_id', projectId)
    .eq('owner_id', user.id)
    .eq('is_default', true)
    .eq('scope', 'personal')
    .maybeSingle()
  return data ?? null
}

export async function upsertDefaultSavedView(
  projectId: string,
  viewType: ProjectViewType,
): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()

  const { data: existing } = await db(supabase)
    .from('project_saved_views')
    .select('id')
    .eq('project_id', projectId)
    .eq('owner_id', user.id)
    .eq('is_default', true)
    .eq('scope', 'personal')
    .maybeSingle()

  if (existing) {
    await db(supabase)
      .from('project_saved_views')
      .update({ view_type: viewType, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    const { data: orgData } = await supabase.rpc('get_current_org_id')
    await db(supabase).from('project_saved_views').insert({
      project_id: projectId,
      owner_id: user.id,
      org_id: orgData,
      name: 'Default',
      view_type: viewType,
      scope: 'personal',
      is_default: true,
      filters: {},
      sorting: {},
    })
  }
}

// ---------------------------------------------------------------------------
// Execution Runs
// ---------------------------------------------------------------------------

export async function getExecutionRuns(taskId: string): Promise<ProjectExecutionRunRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('project_execution_runs')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  return (data as ProjectExecutionRunRow[]) ?? []
}

export async function startRun(taskId: string, projectId: string): Promise<ProjectExecutionRunRow | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null
  const { data, error } = await db(supabase)
    .from('project_execution_runs')
    .insert({
      task_id: taskId,
      org_id: orgId,
      executor_name: user.email ?? user.id,
      executor_type: 'human',
      environment: 'manual',
      status: 'running',
      start_time: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  revalidatePath(`/projects/${projectId}`)
  return data as ProjectExecutionRunRow
}

export async function stopRun(runId: string, taskId: string, projectId: string): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()

  const { data: run } = await db(supabase)
    .from('project_execution_runs')
    .select('start_time')
    .eq('id', runId)
    .single()

  const endTime = new Date()
  const startTime = run?.start_time ? new Date(run.start_time) : endTime
  const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60000

  await db(supabase)
    .from('project_execution_runs')
    .update({
      end_time: endTime.toISOString(),
      duration_minutes: Math.round(durationMinutes * 100) / 100,
      status: 'delivered',
    })
    .eq('id', runId)

  revalidatePath(`/projects/${projectId}`)
}

// ---------------------------------------------------------------------------
// MCP Token
// ---------------------------------------------------------------------------

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'xph_'
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

export interface McpTokenInfo {
  prefix: string
  masked: string
}

export async function getMcpToken(): Promise<McpTokenInfo | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('project_mcp_tokens')
    .select('token_prefix')
    .maybeSingle()
  if (!data) return null
  const prefix = data.token_prefix as string
  return { prefix, masked: `${prefix.slice(0, 12)}••••••••••••` }
}

export async function getDecryptedMcpToken(): Promise<string | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await db(supabase)
    .from('project_mcp_tokens')
    .select('token_hash')
    .maybeSingle()
  if (!data?.token_hash) return null
  try {
    return await decrypt(data.token_hash as string)
  } catch {
    return null
  }
}

export async function rotateOrCreateMcpToken(): Promise<McpTokenInfo | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const token = generateToken()
  const encrypted = await encrypt(token)
  const prefix = token.slice(0, 12)

  const { data: existing } = await db(supabase)
    .from('project_mcp_tokens')
    .select('id')
    .maybeSingle()

  if (existing) {
    await db(supabase)
      .from('project_mcp_tokens')
      .update({ token_hash: encrypted, token_prefix: prefix, rotated_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await db(supabase)
      .from('project_mcp_tokens')
      .insert({ org_id: orgId, token_hash: encrypted, token_prefix: prefix, active: true })
  }

  return { prefix, masked: `${prefix}••••••••••••` }
}
