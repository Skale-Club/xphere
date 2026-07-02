'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database } from '@/types/database'
import * as core from '@/lib/foldering/core'
import type { FolderingContext } from '@/lib/foldering/core'

// Tool folders now live in the universal `folders` store (entity_type='tool').
// itemTable is '_legacy_tool_configs' (the tools-config table this module uses);
// the default itemFolderColumn 'folder_id' matches tool_configs.folder_id.
async function toolCtx(): Promise<FolderingContext> {
  return {
    supabase: await createClient(),
    entityType: 'tool',
    itemTable: '_legacy_tool_configs',
  }
}

// Adapt the core's ActionResult<void> to the legacy `{ error?: string } | void`
// shape that the tools UI (tools-table.tsx) branches on.
function toLegacy(res: { ok: true } | { ok: false; error: string }): { error?: string } | void {
  if (!res.ok) return { error: res.error }
}

export type ToolConfigWithIntegration = {
  id: string
  organization_id: string
  integration_id: string
  tool_name: string
  action_type: Database['public']['Enums']['action_type']
  config: unknown
  fallback_message: string
  is_active: boolean
  folder_id: string | null
  labels: string[]
  created_at: string
  integrations: {
    id: string
    name: string
    provider: string
  } | null
}

export type ToolFolder = {
  id: string
  org_id: string
  name: string
  parent_id: string | null
  position: number
  created_at: string
  updated_at: string
}

export async function getFolders(): Promise<ToolFolder[]> {
  const res = await core.listFolders(await toolCtx())
  if (!res.ok) return []
  return res.data as unknown as ToolFolder[]
}

export async function createFolder(
  name: string,
  parentId: string | null = null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const res = await core.createFolder(await toolCtx(), { name, parent_id: parentId })
  if (res.ok) revalidatePath('/workflows')
  return toLegacy(res)
}

export async function updateFolder(
  id: string,
  data: { name?: string; position?: number }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const ctx = await toolCtx()
  if (data.name !== undefined) {
    const res = await core.renameFolder(ctx, id, { name: data.name })
    if (!res.ok) return { error: res.error }
  }
  if (data.position !== undefined) {
    const { error } = await ctx.supabase
      .from('folders')
      .update({ position: data.position })
      .eq('id', id)
      .eq('entity_type', 'tool')
    if (error) return { error: error.message }
  }
  revalidatePath('/workflows')
}

export async function deleteFolder(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('folders').delete().eq('id', id).eq('entity_type', 'tool')
  if (error) return { error: error.message }
  revalidatePath('/workflows')
}

export async function deleteFolderWithTools(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Subfolder collection kept for parity with prior behavior; DB ON DELETE
  // CASCADE removes subfolders automatically.
  await supabase.from('folders').select('id').eq('entity_type', 'tool').eq('parent_id', id)

  const { error: folderError } = await supabase
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('entity_type', 'tool')

  if (folderError) return { error: folderError.message }
  revalidatePath('/workflows')
}

export async function getToolConfigs(): Promise<ToolConfigWithIntegration[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('_legacy_tool_configs')
    .select('*, integrations(id, name, provider)')
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return data as ToolConfigWithIntegration[]
}

export async function renameToolConfig(
  id: string,
  name: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('_legacy_tool_configs')
    .update({ tool_name: name })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') return { error: 'A tool with this name already exists for your organization.' }
    return { error: error.message }
  }
  revalidatePath('/workflows')
  revalidatePath(`/workflows/${id}`)
}

export async function deleteToolConfig(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('_legacy_tool_configs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/workflows')
}

export async function reorderFolders(orderedIds: string[]): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (orderedIds.length === 0) return
  const res = await core.reorderFolders(await toolCtx(), orderedIds)
  if (res.ok) revalidatePath('/workflows')
  return toLegacy(res)
}

export async function moveToolToFolder(
  toolId: string,
  folderId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('_legacy_tool_configs')
    .update({ folder_id: folderId })
    .eq('id', toolId)
  if (error) return { error: error.message }
  revalidatePath('/workflows')
}
