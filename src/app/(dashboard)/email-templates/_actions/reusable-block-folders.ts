'use server'

// v3.4 — Section templates (reusable_email_blocks) join the universal folders
// store under entity_type='reusable_email_block'. Thin 'use server' wrappers over
// src/lib/foldering/core.ts, mirroring _actions/folders.ts (the email_template
// wrapper). Auth + revalidatePath stay here; CRUD/move/reorder live in the core.
//
// deleteFolder is custom: reusable_email_blocks has no soft-delete lifecycle
// (no deleted_at/archived_at), so instead of the core's item-tombstoning we just
// delete the folder row — the FK `folder_id … on delete set null` re-homes its
// blocks to Unfiled and `parent_id … on delete cascade` removes child folders.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import * as core from '@/lib/foldering/core'
import type { FolderingContext, FolderRow, ActionResult } from '@/lib/foldering/core'

export type ReusableBlockFolderRow = FolderRow

async function ctx(): Promise<FolderingContext> {
  return {
    supabase: await createClient(),
    entityType: 'reusable_email_block',
    itemTable: 'reusable_email_blocks',
  }
}

const REVALIDATE = '/settings/email-templates'

export async function listFolders(): Promise<ActionResult<ReusableBlockFolderRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  return core.listFolders(await ctx())
}

export async function createFolder(input: {
  name: string
  color?: string | null
  icon?: string | null
  parent_id?: string | null
}): Promise<ActionResult<ReusableBlockFolderRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.createFolder(await ctx(), input)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}

export async function renameFolder(id: string, input: { name: string }): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.renameFolder(await ctx(), id, input)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}

export async function updateFolderMeta(
  id: string,
  input: { color?: string | null; icon?: string | null },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.updateFolderMeta(await ctx(), id, input)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}

export async function reorderFolders(orderedIds: string[]): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.reorderFolders(await ctx(), orderedIds)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}

export async function moveFolder(id: string, parent_id: string | null): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.moveFolder(await ctx(), id, parent_id)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}

export async function deleteFolder(
  id: string,
  opts: { cascadeChildren?: boolean } = {},
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: childRows } = await supabase
    .from('folders')
    .select('id')
    .eq('entity_type', 'reusable_email_block')
    .eq('parent_id', id)
    .limit(1)

  if ((childRows ?? []).length > 0 && !opts.cascadeChildren) {
    return { ok: false, error: 'folder_has_children' }
  }

  const { error } = await supabase
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('entity_type', 'reusable_email_block')

  if (error) return { ok: false, error: error.message }
  revalidatePath(REVALIDATE)
  return { ok: true, data: undefined }
}

export async function moveReusableBlockToFolder(
  blockId: string,
  folderId: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.moveItemToFolder(await ctx(), blockId, folderId)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}

export async function reorderReusableBlocksInFolder(
  _folderId: string | null,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  const res = await core.reorderItemsInFolder(await ctx(), _folderId, orderedIds)
  if (res.ok) revalidatePath(REVALIDATE)
  return res
}
