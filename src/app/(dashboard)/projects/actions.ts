'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { ProjectRow, ProjectTaskRow, ProjectLabelRow, TaskPriority, ProjectTaskStep, ProjectValidationStatus } from '@/types/database'

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
