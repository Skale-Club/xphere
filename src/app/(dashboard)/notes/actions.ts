'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database, CrmEntityType } from '@/types/database'

export type NoteRow = Database['public']['Tables']['notes']['Row']

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

const entityTypes = ['contact', 'account', 'opportunity'] as const

const noteCreateSchema = z.object({
  title: z.string().max(255).nullable().optional(),
  content: z.string().min(1).max(50000),
  pinned: z.boolean().default(false),
  entity_type: z.enum(entityTypes).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
})

const noteUpdateSchema = noteCreateSchema.partial()

const noteFiltersSchema = z.object({
  entity_type: z.enum(entityTypes).optional(),
  entity_id: z.string().uuid().optional(),
  search: z.string().optional(),
  pinned: z.boolean().optional(),
})

export type NoteCreateInput = z.input<typeof noteCreateSchema>
export type NoteUpdateInput = z.input<typeof noteUpdateSchema>
export type NoteFilters = z.input<typeof noteFiltersSchema>

// ─── createNote ───────────────────────────────────────────────────────────────

export async function createNote(
  input: NoteCreateInput,
): Promise<ActionResult<NoteRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = noteCreateSchema.safeParse(input)
  if (!parsed.success) return err('validation_error', parsed.error.issues)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('no_active_org')

  const { data, error } = await supabase
    .from('notes')
    .insert({
      ...parsed.data,
      org_id: orgId,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return err(error.message)

  revalidatePath('/notes')
  return ok(data)
}

// ─── updateNote ───────────────────────────────────────────────────────────────

export async function updateNote(
  id: string,
  input: NoteUpdateInput,
): Promise<ActionResult<NoteRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = noteUpdateSchema.safeParse(input)
  if (!parsed.success) return err('validation_error', parsed.error.issues)

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notes')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  if (!data) return err('not_found')

  revalidatePath('/notes')
  return ok(data)
}

// ─── deleteNote ───────────────────────────────────────────────────────────────

export async function deleteNote(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const supabase = await createClient()

  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) return err(error.message)

  revalidatePath('/notes')
  return ok(undefined)
}

// ─── getNotes ─────────────────────────────────────────────────────────────────

export async function getNotes(
  filters: Partial<NoteFilters> = {},
): Promise<ActionResult<NoteRow[]>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = noteFiltersSchema.safeParse(filters)
  if (!parsed.success) return err('validation_error', parsed.error.issues)

  const f = parsed.data
  const supabase = await createClient()

  let query = supabase
    .from('notes')
    .select('*')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (f.entity_type) query = query.eq('entity_type', f.entity_type)
  if (f.entity_id) query = query.eq('entity_id', f.entity_id)
  if (f.pinned !== undefined) query = query.eq('pinned', f.pinned)
  if (f.search) {
    const escaped = f.search.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
  }

  const { data, error } = await query
  if (error) return err(error.message)

  return ok(data ?? [])
}

// ─── toggleNotePin ────────────────────────────────────────────────────────────

export async function toggleNotePin(id: string): Promise<ActionResult<NoteRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const supabase = await createClient()

  const { data: current, error: fetchError } = await supabase
    .from('notes')
    .select('pinned')
    .eq('id', id)
    .single()

  if (fetchError || !current) return err(fetchError?.message ?? 'not_found')

  const { data, error } = await supabase
    .from('notes')
    .update({ pinned: !current.pinned, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message)
  if (!data) return err('not_found')

  revalidatePath('/notes')
  return ok(data)
}
