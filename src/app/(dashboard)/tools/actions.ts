'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Database, Json } from '@/types/database'

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
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tool_folders')
    .select('*')
    .order('position', { ascending: true })
  if (error || !data) return []
  return data as ToolFolder[]
}

export async function createFolder(
  name: string,
  parentId: string | null = null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }
  const { error } = await supabase.from('tool_folders').insert({
    org_id: orgId,
    name,
    parent_id: parentId,
    position: 0,
  })
  if (error) return { error: error.message }
  revalidatePath('/tools')
}

export async function updateFolder(
  id: string,
  data: { name?: string; position?: number }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('tool_folders')
    .update(data)
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/tools')
}

export async function deleteFolder(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('tool_folders').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/tools')
}

export async function deleteFolderWithTools(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Collect subfolder IDs (max 2 levels enforced by product — no recursion needed)
  const { data: subfolders } = await supabase
    .from('tool_folders')
    .select('id')
    .eq('parent_id', id)

  const subfolderIds = (subfolders ?? []).map((s: { id: string }) => s.id)
  const folderIds = [id, ...subfolderIds]

  // Delete all tool_configs in this folder and its subfolders
  const { error: toolsError } = await supabase
    .from('tool_configs')
    .delete()
    .in('folder_id', folderIds)

  if (toolsError) return { error: toolsError.message }

  // Delete the folder — DB ON DELETE CASCADE removes subfolders automatically
  const { error: folderError } = await supabase
    .from('tool_folders')
    .delete()
    .eq('id', id)

  if (folderError) return { error: folderError.message }
  revalidatePath('/tools')
}

export async function createToolConfig(data: {
  toolName: string
  actionType: string
  integrationId: string
  fallbackMessage: string
  config?: Record<string, unknown>
  folder_id?: string | null
  labels?: string[]
}): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: member, error: memberError } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()

  if (memberError || !member) return { error: 'No organization found for this user.' }

  const { error } = await supabase.from('tool_configs').insert({
    organization_id: member.organization_id,
    tool_name: data.toolName,
    action_type: data.actionType as Database['public']['Enums']['action_type'],
    ...(data.integrationId && data.integrationId.length > 0
      ? { integration_id: data.integrationId }
      : {}),
    fallback_message: data.fallbackMessage,
    config: (data.config ?? {}) as Json,
    folder_id: data.folder_id ?? null,
    labels: data.labels ?? [],
  })

  if (error) {
    if (error.code === '23505') {
      return { error: 'A tool with this name already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/tools')
}

export async function updateToolConfig(
  id: string,
  data: {
    toolName: string
    actionType: string
    integrationId: string
    fallbackMessage: string
    config?: Record<string, unknown>
    folder_id?: string | null
    labels?: string[]
  }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('tool_configs')
    .update({
      tool_name: data.toolName,
      action_type: data.actionType as Database['public']['Enums']['action_type'],
      ...(data.integrationId && data.integrationId.length > 0
        ? { integration_id: data.integrationId }
        : {}),
      fallback_message: data.fallbackMessage,
      config: (data.config ?? {}) as Json,
      folder_id: data.folder_id ?? null,
      labels: data.labels ?? [],
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'A tool with this name already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/tools')
}

export async function getToolConfigs(): Promise<ToolConfigWithIntegration[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tool_configs')
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
    .from('tool_configs')
    .update({ tool_name: name })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') return { error: 'A tool with this name already exists for your organization.' }
    return { error: error.message }
  }
  revalidatePath('/tools')
  revalidatePath(`/tools/${id}`)
}

export async function deleteToolConfig(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase.from('tool_configs').delete().eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/tools')
}

export async function reorderFolders(orderedIds: string[]): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (orderedIds.length === 0) return
  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    supabase.from('tool_folders').update({ position: index }).eq('id', id)
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { error: 'Failed to save folder order.' }
  revalidatePath('/tools')
}

export async function moveToolToFolder(
  toolId: string,
  folderId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('tool_configs')
    .update({ folder_id: folderId })
    .eq('id', toolId)
  if (error) return { error: error.message }
  revalidatePath('/tools')
}
