'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/rbac/server'
import type { Database, TaskPriority, TaskStatus, CrmEntityType } from '@/types/database'

export type TaskRow = Database['public']['Tables']['tasks']['Row']

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

function err(error: string, details?: unknown): ActionResult<never> {
  return { ok: false, error, details }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const taskPriorities = ['low', 'medium', 'high', 'urgent'] as const
const taskStatuses = ['todo', 'in_progress', 'done', 'cancelled'] as const
const entityTypes = ['contact', 'account', 'opportunity'] as const

const taskCreateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(taskPriorities).default('medium'),
  status: z.enum(taskStatuses).default('todo'),
  assigned_to: z.string().uuid().nullable().optional(),
  entity_type: z.enum(entityTypes).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
})

const taskUpdateSchema = taskCreateSchema.partial()

const taskFiltersSchema = z.object({
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  assigned_to: z.string().uuid().optional(),
  entity_type: z.enum(entityTypes).optional(),
  entity_id: z.string().uuid().optional(),
  due_before: z.string().optional(),
  due_after: z.string().optional(),
  q: z.string().optional(),
})

export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>
export type TaskFilters = z.infer<typeof taskFiltersSchema>

// ─── createTask ───────────────────────────────────────────────────────────────

export async function createTask(
  input: TaskCreateInput,
): Promise<ActionResult<TaskRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const perm = await requirePermission('tasks.manage')
  if (!perm.ok) return err('forbidden')

  const parsed = taskCreateSchema.safeParse(input)
  if (!parsed.success) return err('validation_error', parsed.error.issues)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('no_active_org')

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      ...parsed.data,
      org_id: orgId,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return err(error.message)

  revalidatePath('/tasks')
  return ok(data)
}

// ─── updateTask ───────────────────────────────────────────────────────────────

export async function updateTask(
  id: string,
  input: TaskUpdateInput,
): Promise<ActionResult<TaskRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const perm = await requirePermission('tasks.manage')
  if (!perm.ok) return err('forbidden')

  const parsed = taskUpdateSchema.safeParse(input)
  if (!parsed.success) return err('validation_error', parsed.error.issues)

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tasks')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  if (!data) return err('not_found')

  revalidatePath('/tasks')
  return ok(data)
}

// ─── deleteTask ───────────────────────────────────────────────────────────────

export async function deleteTask(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const perm = await requirePermission('tasks.manage')
  if (!perm.ok) return err('forbidden')

  const supabase = await createClient()

  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) return err(error.message)

  revalidatePath('/tasks')
  return ok(undefined)
}

// ─── getTasks ─────────────────────────────────────────────────────────────────

export async function getTasks(
  filters: Partial<TaskFilters> = {},
): Promise<ActionResult<TaskRow[]>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = taskFiltersSchema.safeParse(filters)
  if (!parsed.success) return err('validation_error', parsed.error.issues)

  const f = parsed.data
  const supabase = await createClient()

  let query = supabase.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })

  if (f.status) query = query.eq('status', f.status)
  if (f.priority) query = query.eq('priority', f.priority)
  if (f.assigned_to) query = query.eq('assigned_to', f.assigned_to)
  if (f.entity_type) query = query.eq('entity_type', f.entity_type)
  if (f.entity_id) query = query.eq('entity_id', f.entity_id)
  if (f.due_before) query = query.lte('due_date', f.due_before)
  if (f.due_after) query = query.gte('due_date', f.due_after)
  if (f.q) {
    const escaped = f.q.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.ilike('title', `%${escaped}%`)
  }

  const { data, error } = await query
  if (error) return err(error.message)

  return ok(data ?? [])
}

// ─── getContactsForPicker ─────────────────────────────────────────────────────

export type ContactOption = {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
}

export async function getContactsForPicker(): Promise<ContactOption[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, name, phone, email')
    .order('first_name', { ascending: true, nullsFirst: false })
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true, nullsFirst: false })
    .limit(300)
  return (data ?? []) as ContactOption[]
}

// ─── toggleTaskDone ───────────────────────────────────────────────────────────

export async function toggleTaskDone(id: string): Promise<ActionResult<TaskRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const perm = await requirePermission('tasks.manage')
  if (!perm.ok) return err('forbidden')

  const supabase = await createClient()

  const { data: current, error: fetchError } = await supabase
    .from('tasks')
    .select('status')
    .eq('id', id)
    .single()

  if (fetchError || !current) return err(fetchError?.message ?? 'not_found')

  const nextStatus: TaskStatus = current.status === 'done' ? 'todo' : 'done'

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  if (!data) return err('not_found')

  revalidatePath('/tasks')
  return ok(data)
}
