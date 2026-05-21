'use server'

// SEED-038: Workflow lifecycle actions (folders, archive, trash).
//
// These complement the editor-side actions in
// `flows/_actions/workflows.ts`. They cover folder assignment, reordering,
// and the soft-archive / soft-delete lifecycle exposed in the main list.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// ─── Move workflow into a folder (or to "Unfiled") ───────────────────────────

export async function moveWorkflowToFolder(
  workflowId: string,
  folderId: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Append at the end of the destination by default.
  const { data: tail } = await supabase
    .from('workflows')
    .select('position')
    .eq('folder_id', folderId as unknown as string)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (tail?.[0]?.position ?? -1) + 1

  const { error } = await supabase
    .from('workflows')
    .update({ folder_id: folderId, position: nextPosition })
    .eq('id', workflowId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Reorder within a folder ─────────────────────────────────────────────────

export async function reorderWorkflowsInFolder(
  _folderId: string | null,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    supabase.from('workflows').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { ok: false, error: 'Failed to save workflow order.' }

  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Archive / unarchive ─────────────────────────────────────────────────────

export async function archiveWorkflow(
  workflowId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Guard: refuse to archive a workflow that is currently active
  const { data: row } = await supabase
    .from('workflows')
    .select('is_active')
    .eq('id', workflowId)
    .single()

  if (row?.is_active) {
    return { ok: false, error: 'Deactivate the workflow before archiving it.' }
  }

  const { error } = await supabase
    .from('workflows')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', workflowId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

export async function unarchiveWorkflow(
  workflowId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('workflows')
    .update({ archived_at: null })
    .eq('id', workflowId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  return { ok: true, data: undefined }
}

// ─── Trash (soft delete) / restore / hard delete ─────────────────────────────

export async function softDeleteWorkflow(
  workflowId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Guard: refuse to trash a workflow that is currently active
  const { data: row } = await supabase
    .from('workflows')
    .select('is_active')
    .eq('id', workflowId)
    .single()

  if (row?.is_active) {
    return { ok: false, error: 'Deactivate the workflow before moving it to trash.' }
  }

  const { error } = await supabase
    .from('workflows')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', workflowId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  revalidatePath('/workflows/trash')
  return { ok: true, data: undefined }
}

export async function restoreWorkflowFromTrash(
  workflowId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('workflows')
    .update({ deleted_at: null })
    .eq('id', workflowId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows')
  revalidatePath('/workflows/trash')
  return { ok: true, data: undefined }
}

export async function hardDeleteWorkflow(
  workflowId: string,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Defence in depth: only allow hard delete on rows already in trash.
  const { data: row, error: readErr } = await supabase
    .from('workflows')
    .select('deleted_at')
    .eq('id', workflowId)
    .single()

  if (readErr || !row) return { ok: false, error: 'not_found' }
  if (!row.deleted_at) return { ok: false, error: 'must_be_in_trash' }

  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', workflowId)
    .not('deleted_at', 'is', null)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows/trash')
  return { ok: true, data: undefined }
}

export async function emptyTrash(): Promise<ActionResult<{ count: number }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data: rows } = await supabase
    .from('workflows')
    .select('id')
    .eq('org_id', orgId as string)
    .not('deleted_at', 'is', null)

  const ids = (rows ?? []).map((r: { id: string }) => r.id)
  if (ids.length === 0) return { ok: true, data: { count: 0 } }

  const { error } = await supabase
    .from('workflows')
    .delete()
    .in('id', ids)
    .not('deleted_at', 'is', null)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/workflows/trash')
  return { ok: true, data: { count: ids.length } }
}
