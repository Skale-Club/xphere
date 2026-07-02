'use server'

// Project spaces now live in the universal `folders` store (entity_type='project').
//
// Thin 'use server' wrappers around src/lib/foldering/core.ts; export names +
// return shapes preserved (ActionResult<ProjectSpaceRow>) so ProjectSubNav /
// new-space-button / layout consume them unchanged. Archive/delete keep bespoke
// cascades against `projects.space_id` (the core's cascade hardcodes 'folder_id',
// which does not match the projects item column) but read the folder rows from
// `folders` instead of the retired `project_spaces` table.
//
// All actions are org-scoped via RLS | the active org resolves through
// `get_current_org_id()`, so we never need to filter by org_id manually.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import * as core from '@/lib/foldering/core'
import type { FolderingContext } from '@/lib/foldering/core'
import type { ProjectSpaceRow } from '@/types/database'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

async function ctx(): Promise<FolderingContext> {
  return {
    supabase: await createClient(),
    entityType: 'project',
    itemTable: 'projects',
    itemFolderColumn: 'space_id',
  }
}

// Type-cast helper: Supabase doesn't have the `projects` table in the generated
// Database type, so archive/delete cascades cast via `any`. Folder reads use the
// typed `folders` client on the FolderingContext where possible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: Awaited<ReturnType<typeof createClient>>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listSpaces(): Promise<ActionResult<ProjectSpaceRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.listFolders(await ctx())
  if (!res.ok) return res
  return { ok: true, data: res.data as unknown as ProjectSpaceRow[] }
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

  const res = await core.createFolder(await ctx(), input)
  if (!res.ok) return res
  revalidatePath('/projects')
  return { ok: true, data: res.data as unknown as ProjectSpaceRow }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export async function renameSpace(
  id: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.renameFolder(await ctx(), id, input)
  if (res.ok) revalidatePath('/projects')
  return res
}

// ─── Update meta (color / icon) ───────────────────────────────────────────────

export async function updateSpaceMeta(
  id: string,
  input: { color?: string | null; icon?: string | null },
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.updateFolderMeta(await ctx(), id, input)
  if (res.ok) revalidatePath('/projects')
  return res
}

// ─── Reorder spaces (siblings) ────────────────────────────────────────────────

export async function reorderSpaces(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.reorderFolders(await ctx(), orderedIds)
  if (res.ok) revalidatePath('/projects')
  return res
}

// ─── Move space (re-parent) ───────────────────────────────────────────────────

export async function moveSpace(
  id: string,
  parent_id: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.moveFolder(await ctx(), id, parent_id)
  if (res.ok) revalidatePath('/projects')
  return res
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────
//
// Kept bespoke (NOT delegated to the core) because the projects item column is
// `space_id`, but core.archiveFolder / core.deleteFolder cascade items via a
// hardcoded `.in('folder_id', ...)`. Folder rows are read from `folders`
// (entity_type='project'); the `projects.space_id` cascades are preserved verbatim.

async function collectDescendantSpaceIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rootId: string,
): Promise<string[]> {
  const ids: string[] = [rootId]
  let frontier: string[] = [rootId]
  // Bounded loop | practical space trees are shallow; cap at 16 levels.
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const { data: children } = await db(supabase)
      .from('folders')
      .select('id')
      .eq('entity_type', 'project')
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
    .from('folders')
    .select('id')
    .eq('entity_type', 'project')
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
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('entity_type', 'project')

  if (sErr) return { ok: false, error: sErr.message }

  revalidatePath('/projects')
  return { ok: true, data: undefined }
}
