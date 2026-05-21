'use server'

// SEED-038: Workflow folders.
//
// CRUD for the `workflow_folders` table plus cascade helpers (archive/delete).
// All actions are org-scoped via RLS | the active org resolves through
// `get_current_org_id()`, so we never need to filter by org_id manually.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type WorkflowFolderRow = Database['public']['Tables']['workflow_folders']['Row']

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listFolders(): Promise<ActionResult<WorkflowFolderRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workflow_folders')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as WorkflowFolderRow[] }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createFolder(input: {
  name: string
  color?: string | null
  icon?: string | null
  parent_id?: string | null
}): Promise<ActionResult<WorkflowFolderRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Pick next position within siblings.
  const { data: siblings } = await supabase
    .from('workflow_folders')
    .select('position')
    .eq('parent_id', input.parent_id ?? (null as unknown as string))
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (siblings?.[0]?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('workflow_folders')
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
      return { ok: false, error: 'A folder with this name already exists here.' }
    }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  revalidatePath('/workflows')
  return { ok: true, data: data as WorkflowFolderRow }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export async function renameFolder(
  id: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('workflow_folders')
    .update({ name })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'A folder with this name already exists here.' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Update meta (color / icon) ───────────────────────────────────────────────

export async function updateFolderMeta(
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

  const { error } = await supabase
    .from('workflow_folders')
    .update(patch)
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Reorder folders (siblings) ───────────────────────────────────────────────

export async function reorderFolders(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    supabase.from('workflow_folders').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { ok: false, error: 'Failed to save folder order.' }

  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Move folder (re-parent) ──────────────────────────────────────────────────

export async function moveFolder(
  id: string,
  parent_id: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (parent_id === id) return { ok: false, error: 'cannot_nest_in_self' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('workflow_folders')
    .update({ parent_id })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────

async function collectDescendantFolderIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rootId: string,
): Promise<string[]> {
  const ids: string[] = [rootId]
  let frontier: string[] = [rootId]
  // Bounded loop | practical folder trees are shallow; cap at 16 levels.
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const { data: children } = await supabase
      .from('workflow_folders')
      .select('id')
      .in('parent_id', frontier)
    const childIds = (children ?? []).map((c: { id: string }) => c.id)
    if (childIds.length === 0) break
    ids.push(...childIds)
    frontier = childIds
  }
  return ids
}

// ─── Archive folder (cascade) ─────────────────────────────────────────────────

export async function archiveFolder(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const now = new Date().toISOString()
  const folderIds = await collectDescendantFolderIds(supabase, id)

  // Archive all workflows nested anywhere inside.
  const { error: wErr } = await supabase
    .from('workflows')
    .update({ archived_at: now, is_active: false })
    .in('folder_id', folderIds)
    .is('deleted_at', null)
    .is('archived_at', null)

  if (wErr) return { ok: false, error: wErr.message }

  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Delete folder ────────────────────────────────────────────────────────────
//
// Soft-deletes workflows inside (sets `deleted_at`) and hard-deletes the
// folder rows themselves | folders have no lifecycle of their own; the
// content lives in the trash, the empty folder is gone.

export async function deleteFolder(
  id: string,
  opts: { cascadeChildren?: boolean } = {},
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: childRows } = await supabase
    .from('workflow_folders')
    .select('id')
    .eq('parent_id', id)
    .limit(1)

  if ((childRows ?? []).length > 0 && !opts.cascadeChildren) {
    return { ok: false, error: 'folder_has_children' }
  }

  const folderIds = await collectDescendantFolderIds(supabase, id)
  const now = new Date().toISOString()

  // Soft-delete all workflows inside (recursive).
  const { error: wErr } = await supabase
    .from('workflows')
    .update({ deleted_at: now })
    .in('folder_id', folderIds)
    .is('deleted_at', null)

  if (wErr) return { ok: false, error: wErr.message }

  // Hard-delete the folder; ON DELETE CASCADE handles nested folders.
  const { error: fErr } = await supabase
    .from('workflow_folders')
    .delete()
    .eq('id', id)

  if (fErr) return { ok: false, error: fErr.message }

  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}
