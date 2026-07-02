// Phase 114 (UFE-02): universal foldering core.
//
// Plain async functions (NOT 'use server') implementing the full folder + item
// organization contract against the shared `public.folders` table, parameterized
// by entity_type + item table. Per-module 'use server' wrappers (phases 115-117)
// bind a FolderingContext and call these; the core carries the ONE copy of the
// CRUD/cascade/move/reorder logic. No cache-revalidation, no auth here — the
// wrapper supplies an already-authenticated supabase client, and Next.js cache
// concerns (path revalidation) stay entirely in the 'use server' wrappers.
//
// Extracted (generalized) from src/app/(dashboard)/workflows/_actions/folders.ts
// + workflows.ts. Every folder query is scoped by `.eq('entity_type', ...)` so
// one org's workflow folders never collide with its email_template folders. Item
// writes target the dynamic `ctx.itemTable` — the generated Supabase types can't
// resolve a runtime table name, so the item-table query builder (and only it) is
// cast to `any`; folder queries stay fully typed.

import type { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type FolderEntityType = 'workflow' | 'project' | 'tool' | 'email_template'
export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>
export type FolderRow = Database['public']['Tables']['folders']['Row']

export interface FolderingContext {
  supabase: SupabaseServerClient
  entityType: FolderEntityType
  /** Item table whose rows carry the folder-linkage column + position, e.g. 'workflows'. */
  itemTable: string
  /**
   * Name of the folder-linkage column on `itemTable`. Defaults to 'folder_id'.
   * Projects override this with 'space_id' (projects.space_id). Workflows, Tools,
   * and Email keep the default.
   */
  itemFolderColumn?: string
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const DUPLICATE_MESSAGE = 'A folder with this name already exists here.'

/** The dynamic item-table query builder. Its runtime name (`ctx.itemTable`)
 *  cannot be resolved by the generated types, so this is the single narrow
 *  escape hatch — confined to the `.from(itemTable)` builder, never results. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemTable(ctx: FolderingContext): any {
  return ctx.supabase.from(ctx.itemTable as never)
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listFolders(
  ctx: FolderingContext,
): Promise<ActionResult<FolderRow[]>> {
  const { data, error } = await ctx.supabase
    .from('folders')
    .select('*')
    .eq('entity_type', ctx.entityType)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as FolderRow[] }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createFolder(
  ctx: FolderingContext,
  input: {
    name: string
    color?: string | null
    icon?: string | null
    parent_id?: string | null
  },
): Promise<ActionResult<FolderRow>> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const { data: orgId } = await ctx.supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const {
    data: { user },
  } = await ctx.supabase.auth.getUser()

  // Pick next position within siblings (scoped by entity_type + parent).
  const { data: siblings } = await ctx.supabase
    .from('folders')
    .select('position')
    .eq('entity_type', ctx.entityType)
    .eq('parent_id', input.parent_id ?? (null as unknown as string))
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (siblings?.[0]?.position ?? -1) + 1

  const { data, error } = await ctx.supabase
    .from('folders')
    .insert({
      org_id: orgId as string,
      entity_type: ctx.entityType,
      name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      parent_id: input.parent_id ?? null,
      position: nextPosition,
      created_by: user?.id ?? null,
    })
    .select()
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, error: DUPLICATE_MESSAGE }
    }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  return { ok: true, data: data as FolderRow }
}

// ─── Rename ───────────────────────────────────────────────────────────────────

export async function renameFolder(
  ctx: FolderingContext,
  id: string,
  input: { name: string },
): Promise<ActionResult<void>> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name_required' }

  const { error } = await ctx.supabase
    .from('folders')
    .update({ name })
    .eq('id', id)
    .eq('entity_type', ctx.entityType)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: DUPLICATE_MESSAGE }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true, data: undefined }
}

// ─── Update meta (color / icon) ───────────────────────────────────────────────

export async function updateFolderMeta(
  ctx: FolderingContext,
  id: string,
  input: { color?: string | null; icon?: string | null },
): Promise<ActionResult<void>> {
  const patch: { color?: string | null; icon?: string | null } = {}
  if (input.color !== undefined) patch.color = input.color
  if (input.icon !== undefined) patch.icon = input.icon
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined }

  const { error } = await ctx.supabase
    .from('folders')
    .update(patch)
    .eq('id', id)
    .eq('entity_type', ctx.entityType)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

// ─── Reorder folders (siblings) ───────────────────────────────────────────────

export async function reorderFolders(
  ctx: FolderingContext,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const updates = orderedIds.map((id, index) =>
    ctx.supabase
      .from('folders')
      .update({ position: index })
      .eq('id', id)
      .eq('entity_type', ctx.entityType),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { ok: false, error: 'Failed to save folder order.' }

  return { ok: true, data: undefined }
}

// ─── Move folder (re-parent) ──────────────────────────────────────────────────

export async function moveFolder(
  ctx: FolderingContext,
  id: string,
  parent_id: string | null,
): Promise<ActionResult<void>> {
  if (parent_id === id) return { ok: false, error: 'cannot_nest_in_self' }

  const { error } = await ctx.supabase
    .from('folders')
    .update({ parent_id })
    .eq('id', id)
    .eq('entity_type', ctx.entityType)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

// ─── Cascade helpers ──────────────────────────────────────────────────────────

async function collectDescendantFolderIds(
  ctx: FolderingContext,
  rootId: string,
): Promise<string[]> {
  const ids: string[] = [rootId]
  let frontier: string[] = [rootId]
  // Bounded loop | practical folder trees are shallow; cap at 16 levels.
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const { data: children } = await ctx.supabase
      .from('folders')
      .select('id')
      .eq('entity_type', ctx.entityType)
      .in('parent_id', frontier)
    const childIds = (children ?? []).map((c: { id: string }) => c.id)
    if (childIds.length === 0) break
    ids.push(...childIds)
    frontier = childIds
  }
  return ids
}

// ─── Archive folder (cascade) ─────────────────────────────────────────────────

export async function archiveFolder(
  ctx: FolderingContext,
  id: string,
): Promise<ActionResult<void>> {
  const now = new Date().toISOString()
  const folderIds = await collectDescendantFolderIds(ctx, id)

  // Archive all items nested anywhere inside. Item lifecycle columns
  // (archived_at / is_active / deleted_at) are assumed to exist on the item
  // table when a module actually invokes archive; this phase only defines it.
  const { error } = await itemTable(ctx)
    .update({ archived_at: now, is_active: false })
    .in('folder_id', folderIds)
    .is('deleted_at', null)
    .is('archived_at', null)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

// ─── Delete folder ────────────────────────────────────────────────────────────
//
// Soft-deletes items inside (sets `deleted_at`) and hard-deletes the folder
// rows themselves | folders have no lifecycle of their own; the content lives
// in the trash, the empty folder is gone.

export async function deleteFolder(
  ctx: FolderingContext,
  id: string,
  opts: { cascadeChildren?: boolean } = {},
): Promise<ActionResult<void>> {
  const { data: childRows } = await ctx.supabase
    .from('folders')
    .select('id')
    .eq('entity_type', ctx.entityType)
    .eq('parent_id', id)
    .limit(1)

  if ((childRows ?? []).length > 0 && !opts.cascadeChildren) {
    return { ok: false, error: 'folder_has_children' }
  }

  const folderIds = await collectDescendantFolderIds(ctx, id)
  const now = new Date().toISOString()

  // Soft-delete all items inside (recursive).
  const { error: itemErr } = await itemTable(ctx)
    .update({ deleted_at: now })
    .in('folder_id', folderIds)
    .is('deleted_at', null)

  if (itemErr) return { ok: false, error: itemErr.message }

  // Hard-delete the folder; ON DELETE CASCADE handles nested folders.
  const { error: fErr } = await ctx.supabase
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('entity_type', ctx.entityType)

  if (fErr) return { ok: false, error: fErr.message }

  return { ok: true, data: undefined }
}

// ─── Move item into a folder (or to "Unfiled") ───────────────────────────────

export async function moveItemToFolder(
  ctx: FolderingContext,
  itemId: string,
  folderId: string | null,
): Promise<ActionResult<void>> {
  const col = ctx.itemFolderColumn ?? 'folder_id'

  // Append at the end of the destination by default.
  const { data: tail } = await itemTable(ctx)
    .select('position')
    .eq(col, folderId as unknown as string)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = ((tail?.[0]?.position as number | undefined) ?? -1) + 1

  const { error } = await itemTable(ctx)
    .update({ [col]: folderId, position: nextPosition })
    .eq('id', itemId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

// ─── Reorder items within a folder ───────────────────────────────────────────

export async function reorderItemsInFolder(
  ctx: FolderingContext,
  _folderId: string | null,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const updates = orderedIds.map((id, index) =>
    itemTable(ctx).update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r: { error: unknown }) => r.error)
  if (failed) return { ok: false, error: 'Failed to save item order.' }

  return { ok: true, data: undefined }
}
