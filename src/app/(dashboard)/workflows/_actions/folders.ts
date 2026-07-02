'use server'

// Phase 115 (UFE-03): Workflow folders now live in the universal `folders` store.
//
// These are thin 'use server' wrappers around src/lib/foldering/core.ts, bound to
// entity_type='workflow' + item table 'workflows'. Export names, signatures, and
// return shapes are preserved so the sub-nav (workflow-sub-nav.tsx) and
// new-folder-button consume them unchanged. Auth + revalidatePath stay here;
// the CRUD/cascade logic lives once in the core.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import * as core from '@/lib/foldering/core'
import type { FolderingContext, FolderRow, ActionResult } from '@/lib/foldering/core'

// Preserved for downstream `import type { WorkflowFolderRow }`; the `folders` Row is a
// structural superset of the old legacy folder Row.
export type WorkflowFolderRow = FolderRow

async function ctx(): Promise<FolderingContext> {
  return {
    supabase: await createClient(),
    entityType: 'workflow',
    itemTable: 'workflows',
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listFolders(): Promise<ActionResult<WorkflowFolderRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  return core.listFolders(await ctx())
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

  const res = await core.createFolder(await ctx(), input)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export async function renameFolder(
  id: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.renameFolder(await ctx(), id, input)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Update meta (color / icon) ───────────────────────────────────────────────

export async function updateFolderMeta(
  id: string,
  input: { color?: string | null; icon?: string | null },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.updateFolderMeta(await ctx(), id, input)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Reorder folders (siblings) ───────────────────────────────────────────────

export async function reorderFolders(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.reorderFolders(await ctx(), orderedIds)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Move folder (re-parent) ──────────────────────────────────────────────────

export async function moveFolder(
  id: string,
  parent_id: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.moveFolder(await ctx(), id, parent_id)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Archive folder (cascade) ─────────────────────────────────────────────────

export async function archiveFolder(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.archiveFolder(await ctx(), id)
  if (res.ok) revalidatePath('/workflows')
  return res
}

// ─── Delete folder ────────────────────────────────────────────────────────────

export async function deleteFolder(
  id: string,
  opts: { cascadeChildren?: boolean } = {},
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.deleteFolder(await ctx(), id, opts)
  if (res.ok) revalidatePath('/workflows')
  return res
}
