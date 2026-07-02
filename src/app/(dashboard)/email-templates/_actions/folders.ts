'use server'

// Phase 117 (UFE-06): Email-template folders live in the universal `folders` store.
// Thin 'use server' wrappers over src/lib/foldering/core.ts, bound to
// entity_type='email_template' + item table 'email_templates'. Mirrors
// src/app/(dashboard)/workflows/_actions/folders.ts (post-115 core-delegation form).
// Auth + revalidatePath stay here; the CRUD/cascade/move/reorder logic lives once
// in the core.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import * as core from '@/lib/foldering/core'
import type { FolderingContext, FolderRow, ActionResult } from '@/lib/foldering/core'

export type EmailTemplateFolderRow = FolderRow

async function ctx(): Promise<FolderingContext> {
  return {
    supabase: await createClient(),
    entityType: 'email_template',
    itemTable: 'email_templates',
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listFolders(): Promise<ActionResult<EmailTemplateFolderRow[]>> {
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
}): Promise<ActionResult<EmailTemplateFolderRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.createFolder(await ctx(), input)
  if (res.ok) revalidatePath('/settings/email-templates')
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
  if (res.ok) revalidatePath('/settings/email-templates')
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
  if (res.ok) revalidatePath('/settings/email-templates')
  return res
}

// ─── Reorder folders (siblings) ───────────────────────────────────────────────

export async function reorderFolders(
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.reorderFolders(await ctx(), orderedIds)
  if (res.ok) revalidatePath('/settings/email-templates')
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
  if (res.ok) revalidatePath('/settings/email-templates')
  return res
}

// ─── Archive folder (cascade) ─────────────────────────────────────────────────

export async function archiveFolder(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.archiveFolder(await ctx(), id)
  if (res.ok) revalidatePath('/settings/email-templates')
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
  if (res.ok) revalidatePath('/settings/email-templates')
  return res
}

// ─── Move template into a folder (or to "Unfiled") ────────────────────────────

export async function moveTemplateToFolder(
  templateId: string,
  folderId: string | null,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.moveItemToFolder(await ctx(), templateId, folderId)
  if (res.ok) revalidatePath('/settings/email-templates')
  return res
}

// ─── Reorder templates within a folder ────────────────────────────────────────

export async function reorderTemplatesInFolder(
  _folderId: string | null,
  orderedIds: string[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const res = await core.reorderItemsInFolder(await ctx(), _folderId, orderedIds)
  if (res.ok) revalidatePath('/settings/email-templates')
  return res
}
