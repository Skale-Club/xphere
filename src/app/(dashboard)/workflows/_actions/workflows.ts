'use server'

// SEED-038: Workflow lifecycle actions (folders, archive, trash).
//
// These complement the editor-side actions in
// `flows/_actions/workflows.ts`. They cover folder assignment, reordering,
// and the soft-archive / soft-delete lifecycle exposed in the main list.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import * as core from '@/lib/foldering/core'
import type { FolderingContext } from '@/lib/foldering/core'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

// Phase 115 (UFE-03): the two folder-touching actions below delegate to the
// universal foldering core, bound to entity_type='workflow' + item table 'workflows'.
async function folderCtx(): Promise<FolderingContext> {
  return {
    supabase: await createClient(),
    entityType: 'workflow',
    itemTable: 'workflows',
  }
}

// ─── Move workflow into a folder (or to "Unfiled") ───────────────────────────

export async function moveWorkflowToFolder(
  workflowId: string,
  folderId: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.moveItemToFolder(await folderCtx(), workflowId, folderId)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Reorder within a folder ─────────────────────────────────────────────────

export async function reorderWorkflowsInFolder(
  _folderId: string | null,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.reorderItemsInFolder(await folderCtx(), _folderId, orderedIds)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Archive / unarchive ─────────────────────────────────────────────────────

export async function renameWorkflow(
  workflowId: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Workflow name is required.' }
  if (name.length > 120) return { ok: false, error: 'Workflow name must be 120 characters or fewer.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('workflows')
    .update({ name })
    .eq('id', workflowId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/workflows')
  revalidatePath('/workflows/flows')
  revalidatePath(`/workflows/${workflowId}`)
  revalidatePath(`/workflows/flows/${workflowId}`)
  return { ok: true, data: undefined }
}

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
