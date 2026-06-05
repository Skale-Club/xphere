'use server'

// Project spaces (formerly "folders").
//
// CRUD for the `project_spaces` table plus cascade helpers (archive/delete).
// All actions are org-scoped via RLS | the active org resolves through
// `get_current_org_id()`, so we never need to filter by org_id manually.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { ProjectSpaceRow } from '@/types/database'

// Type-cast helper: Supabase doesn't have project tables in the generated Database type,
// so we cast via `any` and let the caller's return type guarantee correctness.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: Awaited<ReturnType<typeof createClient>>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listSpaces(): Promise<ActionResult<ProjectSpaceRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await db(supabase)
    .from('project_spaces')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as ProjectSpaceRow[] }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSpace(input: {
  name: string
  color?: string | null
  icon?: string | null
  parent_id?: string | null
}): Promise<ActionResult<ProjectSpaceRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Pick next position within siblings.
  const { data: siblings } = await db(supabase)
    .from('project_spaces')
    .select('position')
    .eq('parent_id', input.parent_id ?? (null as unknown as string))
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (siblings?.[0]?.position ?? -1) + 1

  const { data, error } = await db(supabase)
    .from('project_spaces')
    .insert({
      org_id: orgId as string,
      name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      parent_id: input.parent_id ?? null,
      position: nextPosition,
      created_by: user.id,
    })
    .select()
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, error: 'A space with this name already exists here.' }
    }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  revalidatePath('/projects')
  return { ok: true, data: data as ProjectSpaceRow }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export async function renameSpace(
  id: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('project_spaces')
    .update({ name })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'A space with this name already exists here.' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Update meta (color / icon) ───────────────────────────────────────────────

export async function updateSpaceMeta(
  id: string,
  input: { color?: string | null; icon?: string | null },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (input.color !== undefined) patch.color = input.color
  if (input.icon !== undefined) patch.icon = input.icon
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined }

  const { error } = await db(supabase)
    .from('project_spaces')
    .update(patch)
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Reorder spaces (siblings) ────────────────────────────────────────────────

export async function reorderSpaces(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    db(supabase).from('project_spaces').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r: { error: unknown }) => r.error)
  if (failed) return { ok: false, error: 'Failed to save space order.' }

  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Move space (re-parent) ───────────────────────────────────────────────────

export async function moveSpace(
  id: string,
  parent_id: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (parent_id === id) return { ok: false, error: 'cannot_nest_in_self' }

  const supabase = await createClient()
  const { error } = await db(supabase)
    .from('project_spaces')
    .update({ parent_id })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────

async function collectDescendantSpaceIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rootId: string,
): Promise<string[]> {
  const ids: string[] = [rootId]
  let frontier: string[] = [rootId]
  // Bounded loop | practical space trees are shallow; cap at 16 levels.
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const { data: children } = await db(supabase)
      .from('project_spaces')
      .select('id')
      .in('parent_id', frontier)
    const childIds = (children ?? []).map((c: { id: string }) => c.id)
    if (childIds.length === 0) break
    ids.push(...childIds)
    frontier = childIds
  }
  return ids
}

// ─── Archive space (cascade) ──────────────────────────────────────────────────

export async function archiveSpace(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const now = new Date().toISOString()
  const spaceIds = await collectDescendantSpaceIds(supabase, id)

  // Archive all projects nested anywhere inside.
  const { error: pErr } = await db(supabase)
    .from('projects')
    .update({ archived_at: now })
    .in('space_id', spaceIds)
    .is('deleted_at', null)
    .is('archived_at', null)

  if (pErr) return { ok: false, error: pErr.message }

  revalidatePath('/projects')
  return { ok: true, data: undefined }
}

// ─── Delete space ─────────────────────────────────────────────────────────────
//
// Soft-deletes projects inside (sets `deleted_at`) and hard-deletes the
// space rows themselves | spaces have no lifecycle of their own; the
// content lives in the trash, the empty space is gone.

export async function deleteSpace(
  id: string,
  opts: { cascadeChildren?: boolean } = {},
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: childRows } = await db(supabase)
    .from('project_spaces')
    .select('id')
    .eq('parent_id', id)
    .limit(1)

  if ((childRows ?? []).length > 0 && !opts.cascadeChildren) {
    return { ok: false, error: 'space_has_children' }
  }

  const spaceIds = await collectDescendantSpaceIds(supabase, id)
  const now = new Date().toISOString()

  // Soft-delete all projects inside (recursive).
  const { error: pErr } = await db(supabase)
    .from('projects')
    .update({ deleted_at: now })
    .in('space_id', spaceIds)
    .is('deleted_at', null)

  if (pErr) return { ok: false, error: pErr.message }

  // Hard-delete the space; ON DELETE CASCADE handles nested spaces.
  const { error: sErr } = await db(supabase)
    .from('project_spaces')
    .delete()
    .eq('id', id)

  if (sErr) return { ok: false, error: sErr.message }

  revalidatePath('/projects')
  return { ok: true, data: undefined }
}
