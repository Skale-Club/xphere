'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/crypto'
import type {
  ProjectRow,
  ProjectTaskRow,
  ProjectLabelRow,
  ProjectSavedViewRow,
  ProjectExecutionRunRow,
  ProjectMemberRow,
  ProjectContactRow,
  TaskPriority,
  ProjectTaskStep,
  ProjectValidationStatus,
  ProjectViewType,
} from '@/types/database'

export type AssigneeProfile = {
  user_id: string
  full_name: string | null
  email: string | null
}

export type TaskWithLabels = ProjectTaskRow & {
  labels: ProjectLabelRow[]
  subtask_count: number
  completed_subtask_count: number
  assignee: AssigneeProfile | null
  responsible: AssigneeProfile | null
}

export type DeliveryProjectTemplate = 'general' | 'website'

export type ProjectCrmContext = {
  account: {
    id: string
    name: string
    domain: string | null
    website: string | null
    avatar_url: string | null
  } | null
  opportunity: {
    id: string
    title: string
    value: number
    currency: string
    status: 'open' | 'won' | 'lost'
  } | null
  primaryContact: {
    id: string
    first_name: string | null
    last_name: string | null
    name: string | null
    email: string | null
    phone: string | null
  } | null
  contacts: Array<ProjectContactRow & {
    contact: {
      id: string
      first_name: string | null
      last_name: string | null
      name: string | null
      email: string | null
      phone: string | null
    } | null
  }>
  members: Array<ProjectMemberRow & {
    profile: AssigneeProfile | null
  }>
}

const DELIVERY_TEMPLATES: Record<DeliveryProjectTemplate, Array<{
  name: string
  description?: string
  subtasks?: string[]
}>> = {
  general: [
    { name: 'Kickoff', subtasks: ['Confirm scope', 'Confirm stakeholders', 'Confirm delivery timeline'] },
    { name: 'Execution', subtasks: ['Prepare deliverables', 'Internal review', 'Client review'] },
    { name: 'Handoff', subtasks: ['Final approval', 'Documentation', 'Delivery closeout'] },
  ],
  website: [
    { name: 'Kickoff', subtasks: ['Confirm website goals', 'Collect brand assets', 'Confirm sitemap'] },
    { name: 'Content and copy', subtasks: ['Collect existing copy', 'Draft page copy', 'Client copy approval'] },
    { name: 'Design', subtasks: ['Homepage direction', 'Inner page layouts', 'Responsive review'] },
    { name: 'Development', subtasks: ['Build core pages', 'Integrations and forms', 'Analytics setup'] },
    { name: 'QA and launch', subtasks: ['Cross-device QA', 'Client approval', 'Deploy and handoff'] },
  ],
}

// Type-cast helper: Supabase doesn't have projects tables in the generated Database type,
// so we cast via `any` and let the caller's return type guarantee correctness.
function db(supabase: Awaited<ReturnType<typeof createClient>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function getProjects(
  opts: { includeArchived?: boolean; includeDeleted?: boolean } = {},
): Promise<ProjectRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  let q = db(supabase).from('projects').select('*')
  if (!opts.includeDeleted) q = q.is('deleted_at', null)
  if (!opts.includeArchived) q = q.is('archived_at', null)
  const { data } = await q
    .order('position', { ascending: true })
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

export async function createProject(input: {
  name: string
  description?: string
  color?: string
  account_id?: string | null
  source_opportunity_id?: string | null
  primary_contact_id?: string | null
}): Promise<ProjectRow | null> {
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

export async function getProjectCrmContext(projectId: string): Promise<ProjectCrmContext> {
  const user = await getUser()
  if (!user) {
    return { account: null, opportunity: null, primaryContact: null, contacts: [], members: [] }
  }

  const supabase = await createClient()
  const { data: project } = await db(supabase)
    .from('projects')
    .select('account_id, source_opportunity_id, primary_contact_id')
    .eq('id', projectId)
    .maybeSingle()

  const p = project as Pick<ProjectRow, 'account_id' | 'source_opportunity_id' | 'primary_contact_id'> | null

  const [{ data: account }, { data: opportunity }, { data: primaryContact }, { data: contacts }, { data: members }] =
    await Promise.all([
      p?.account_id
        ? db(supabase)
            .from('accounts')
            .select('id, name, domain, website, avatar_url')
            .eq('id', p.account_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      p?.source_opportunity_id
        ? db(supabase)
            .from('opportunities')
            .select('id, title, value, currency, status')
            .eq('id', p.source_opportunity_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      p?.primary_contact_id
        ? db(supabase)
            .from('contacts')
            .select('id, first_name, last_name, name, email, phone')
            .eq('id', p.primary_contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db(supabase)
        .from('project_contacts')
        .select('*, contact:contacts(id, first_name, last_name, name, email, phone)')
        .eq('project_id', projectId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true }),
      db(supabase)
        .from('project_members')
        .select('*')
        .eq('project_id', projectId)
        .order('is_owner', { ascending: false })
        .order('created_at', { ascending: true }),
    ])

  const profiles = await listProjectAssignees()
  const profileMap = new Map(profiles.map((profile) => [profile.user_id, profile]))

  return {
    account: account ?? null,
    opportunity: opportunity
      ? {
          ...opportunity,
          value: Number(opportunity.value ?? 0),
        }
      : null,
    primaryContact: primaryContact ?? null,
    contacts: (contacts ?? []) as ProjectCrmContext['contacts'],
    members: ((members ?? []) as ProjectMemberRow[]).map((member) => ({
      ...member,
      profile: profileMap.get(member.user_id) ?? null,
    })),
  }
}

export async function createDeliveryProjectFromOpportunity(input: {
  opportunityId: string
  template?: DeliveryProjectTemplate
  name?: string
}): Promise<{ projectId?: string; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: opportunity, error: oppError } = await db(supabase)
    .from('opportunities')
    .select('id, org_id, title, value, currency, status, account_id, contact_id, assigned_to')
    .eq('id', input.opportunityId)
    .maybeSingle()

  if (oppError) return { error: oppError.message }
  if (!opportunity) return { error: 'Opportunity not found.' }

  const opp = opportunity as {
    id: string
    org_id: string
    title: string
    value: number | string | null
    currency: string
    status: 'open' | 'won' | 'lost'
    account_id: string | null
    contact_id: string | null
    assigned_to: string | null
  }

  const { data: existing } = await db(supabase)
    .from('projects')
    .select('id')
    .eq('source_opportunity_id', opp.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing?.id) return { projectId: existing.id }

  const { data: account } = opp.account_id
    ? await db(supabase).from('accounts').select('name').eq('id', opp.account_id).maybeSingle()
    : { data: null }

  const projectName = input.name?.trim() || `Delivery - ${account?.name ?? opp.title}`
  const template = input.template ?? 'website'
  const tasks = DELIVERY_TEMPLATES[template] ?? DELIVERY_TEMPLATES.general

  const { data: project, error: projectError } = await db(supabase)
    .from('projects')
    .insert({
      org_id: opp.org_id,
      name: projectName,
      description: `Delivery project generated from opportunity "${opp.title}".`,
      color: '#6366f1',
      account_id: opp.account_id,
      source_opportunity_id: opp.id,
      primary_contact_id: opp.contact_id,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (projectError || !project?.id) return { error: projectError?.message ?? 'Project creation failed.' }

  const projectId = project.id as string

  const { data: opportunityContacts } = await db(supabase)
    .from('opportunity_contacts')
    .select('contact_id, is_primary')
    .eq('opportunity_id', opp.id)

  const contactIds = new Map<string, boolean>()
  if (opp.contact_id) contactIds.set(opp.contact_id, true)
  for (const row of (opportunityContacts ?? []) as { contact_id: string; is_primary: boolean }[]) {
    contactIds.set(row.contact_id, row.is_primary || contactIds.get(row.contact_id) === true)
  }

  if (contactIds.size > 0) {
    await db(supabase).from('project_contacts').insert(
      Array.from(contactIds.entries()).map(([contact_id, is_primary]) => ({
        org_id: opp.org_id,
        project_id: projectId,
        contact_id,
        role: is_primary ? 'Primary stakeholder' : 'Stakeholder',
        is_primary,
        created_by: user.id,
      })),
    )
  }

  if (opp.assigned_to) {
    await db(supabase).from('project_members').insert({
      org_id: opp.org_id,
      project_id: projectId,
      user_id: opp.assigned_to,
      role: 'Project owner',
      is_owner: true,
      created_by: user.id,
    })
  }

  for (const task of tasks) {
    const { data: parent } = await db(supabase)
      .from('project_tasks')
      .insert({
        org_id: opp.org_id,
        project_id: projectId,
        name: task.name,
        description: task.description ?? null,
        step: 'todo',
        priority: 'medium',
        assignee_id: opp.assigned_to,
        responsible_id: opp.assigned_to,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (parent?.id && task.subtasks?.length) {
      await db(supabase).from('project_tasks').insert(
        task.subtasks.map((name) => ({
          org_id: opp.org_id,
          project_id: projectId,
          parent_task_id: parent.id,
          name,
          step: 'todo',
          priority: 'medium',
          assignee_id: opp.assigned_to,
          responsible_id: opp.assigned_to,
          created_by: user.id,
        })),
      )
    }
  }

  await db(supabase).from('opportunity_activities').insert({
    org_id: opp.org_id,
    opportunity_id: opp.id,
    type: 'note',
    content: `Delivery project created: ${projectName}`,
    metadata: { project_id: projectId },
    created_by: user.id,
  })

  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${opp.id}`)

  return { projectId }
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

  // Attach people profiles by fetching org members once and mapping by user_id.
  const personIds = new Set(
    taskList
      .flatMap((t) => [t.assignee_id, t.responsible_id])
      .filter(Boolean) as string[],
  )
  const personMap = new Map<string, AssigneeProfile>()
  if (personIds.size > 0) {
    const members = await listProjectAssignees()
    for (const m of members) {
      if (personIds.has(m.user_id)) personMap.set(m.user_id, m)
    }
  }

  return taskList.map((t) => ({
    ...t,
    labels: labelMap.get(t.id) ?? [],
    subtask_count: subtaskCountMap.get(t.id)?.total ?? 0,
    completed_subtask_count: subtaskCountMap.get(t.id)?.completed ?? 0,
    assignee: t.assignee_id ? personMap.get(t.assignee_id) ?? null : null,
    responsible: t.responsible_id ? personMap.get(t.responsible_id) ?? null : null,
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
    .is('archived_at', null)
    .is('deleted_at', null)
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

  let assignee: AssigneeProfile | null = null
  let responsible: AssigneeProfile | null = null
  if (t.assignee_id || t.responsible_id) {
    const members = await listProjectAssignees()
    assignee = t.assignee_id
      ? members.find((m) => m.user_id === t.assignee_id) ?? null
      : null
    responsible = t.responsible_id
      ? members.find((m) => m.user_id === t.responsible_id) ?? null
      : null
  }

  return {
    ...t,
    labels,
    subtask_count: (subtasksAll as { id: string; completed: boolean }[])?.length ?? 0,
    completed_subtask_count: (subtasksAll as { id: string; completed: boolean }[])?.filter((s) => s.completed).length ?? 0,
    assignee,
    responsible,
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
  start_time?: string
  end_time?: string
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

export async function archiveTask(id: string, projectId: string): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase)
    .from('project_tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  revalidatePath(`/projects/${projectId}`)
}

export async function unarchiveTask(id: string, projectId: string): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase)
    .from('project_tasks')
    .update({ archived_at: null })
    .eq('id', id)
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
// Assignees
// ---------------------------------------------------------------------------

export async function updateTaskAssignee(
  taskId: string,
  projectId: string,
  assigneeId: string | null,
): Promise<void> {
  const user = await getUser()
  if (!user) return
  const supabase = await createClient()
  await db(supabase).from('project_tasks').update({ assignee_id: assigneeId }).eq('id', taskId)
  revalidatePath(`/projects/${projectId}`)
}

export async function listProjectAssignees(): Promise<AssigneeProfile[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return []
  const { data } = await supabase.rpc('get_org_member_profiles', {
    p_org_id: orgId,
    p_page: 1,
    p_per_page: 100,
  })
  return ((data ?? []) as { user_id: string; full_name: string | null; email: string | null }[])
    .map((m) => ({ user_id: m.user_id, full_name: m.full_name, email: m.email }))
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

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface TaskDependency {
  task_id: string
  depends_on_id: string
  dependency_rule: string
  depends_on_name: string
  depends_on_step: string
  depends_on_completed: boolean
  depends_on_validation_status: string
  is_blocking: boolean
}

export async function getTaskDependencies(taskId: string): Promise<TaskDependency[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data: deps } = await db(supabase)
    .from('project_task_dependencies')
    .select('task_id, depends_on_id, dependency_rule')
    .eq('task_id', taskId)
  if (!deps?.length) return []
  const depIds = (deps as { task_id: string; depends_on_id: string; dependency_rule: string }[]).map((d) => d.depends_on_id)
  const { data: tasks } = await db(supabase)
    .from('project_tasks')
    .select('id, name, step, completed, validation_status')
    .in('id', depIds)
  const taskMap = new Map<string, { name: string; step: string; completed: boolean; validation_status: string }>()
  for (const t of (tasks as { id: string; name: string; step: string; completed: boolean; validation_status: string }[]) ?? []) {
    taskMap.set(t.id, t)
  }
  return (deps as { task_id: string; depends_on_id: string; dependency_rule: string }[]).map((d) => {
    const parent = taskMap.get(d.depends_on_id)
    const rule = d.dependency_rule
    const isBlocking =
      rule === 'after_done' ? !(parent?.completed) :
      rule === 'after_delivered' ? !(parent?.step === 'done') :
      !(parent?.validation_status === 'approved')
    return {
      task_id: d.task_id,
      depends_on_id: d.depends_on_id,
      dependency_rule: rule,
      depends_on_name: parent?.name ?? 'Unknown task',
      depends_on_step: parent?.step ?? '',
      depends_on_completed: parent?.completed ?? false,
      depends_on_validation_status: parent?.validation_status ?? '',
      is_blocking: isBlocking,
    }
  })
}

// ─── Project folders + lifecycle (R08) ─────────────────────────────────────────
//
// Ported from src/app/(dashboard)/workflows/_actions/workflows.ts.
// Projects have no `is_active` column, so archive/trash do not require a guard.

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ─── Move project into a space (or to "Unfiled") ─────────────────────────────

export async function moveProjectToSpace(
  projectId: string,
  spaceId: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Append at the end of the destination by default.
  const { data: tail } = await db(supabase)
    .from('projects')
    .select('position')
    .eq('space_id', spaceId as unknown as string)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (tail?.[0]?.position ?? -1) + 1

  const { error } = await db(supabase)
    .from('projects')
    .update({ space_id: spaceId, position: nextPosition })
    .eq('id', projectId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Reorder within a folder ──────────────────────────────────────────────────

export async function reorderProjectsInSpace(
  _spaceId: string | null,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    db(supabase).from('projects').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r: { error: unknown }) => r.error)
  if (failed) return { ok: false, error: 'Failed to save project order.' }

  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Archive / unarchive ──────────────────────────────────────────────────────

export async function archiveProject(
  projectId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', projectId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

export async function unarchiveProject(
  projectId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('projects')
    .update({ archived_at: null })
    .eq('id', projectId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Trash (soft delete) / restore / hard delete ─────────────────────────────

export async function softDeleteProject(
  projectId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', projectId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  revalidatePath('/projects/trash')
  return { ok: true, data: undefined }
}

export async function restoreProjectFromTrash(
  projectId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('projects')
    .update({ deleted_at: null })
    .eq('id', projectId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  revalidatePath('/projects/trash')
  return { ok: true, data: undefined }
}

export async function hardDeleteProject(
  projectId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Defence in depth: only allow hard delete on rows already in trash.
  const { data: row, error: readErr } = await db(supabase)
    .from('projects')
    .select('deleted_at')
    .eq('id', projectId)
    .single()

  if (readErr || !row) return { ok: false, error: 'not_found' }
  if (!row.deleted_at) return { ok: false, error: 'must_be_in_trash' }

  const { error } = await db(supabase)
    .from('projects')
    .delete()
    .eq('id', projectId)
    .not('deleted_at', 'is', null)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects/trash')
  return { ok: true, data: undefined }
}

export async function emptyProjectsTrash(): Promise<ActionResult<{ count: number }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data: rows } = await db(supabase)
    .from('projects')
    .select('id')
    .eq('org_id', orgId as string)
    .not('deleted_at', 'is', null)

  const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id)
  if (ids.length === 0) return { ok: true, data: { count: 0 } }

  const { error } = await db(supabase)
    .from('projects')
    .delete()
    .in('id', ids)
    .not('deleted_at', 'is', null)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects/trash')
  return { ok: true, data: { count: ids.length } }
}
