'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface ToolPickerData {
  folders: Database['public']['Tables']['tool_folders']['Row'][]
  tools: Array<
    Database['public']['Tables']['_legacy_tool_configs']['Row'] & {
      integration: {
        id: string | null
        name: string | null
        is_active: boolean | null
      } | null
    }
  >
}

/**
 * Returns folder list + active tool_configs joined to their integration
 * (id/name/is_active). The picker uses the joined integration shape to
 * surface the warning icon for inactive/missing integrations.
 */
export async function getToolPickerData(): Promise<ToolPickerData> {
  const user = await getUser()
  if (!user) return { folders: [], tools: [] }
  const supabase = await createClient()
  const [foldersRes, toolsRes] = await Promise.all([
    supabase.from('tool_folders').select('*').order('name', { ascending: true }),
    supabase
      .from('_legacy_tool_configs')
      .select('*, integration:integrations(id, name, is_active)')
      .eq('is_active', true)
      .order('tool_name', { ascending: true }),
  ])
  return {
    folders: foldersRes.data ?? [],
    tools: (toolsRes.data ?? []) as ToolPickerData['tools'],
  }
}

/**
 * Diffs current vs next tool selection. INSERTs only NEW pairs and DELETEs
 * only REMOVED pairs — NEVER UPDATEs existing rows. This preserves
 * `agent_tools.allowed_channels` for tools that stay attached across the save.
 * New rows leave allowed_channels NULL (DB default = all channels).
 */
export async function setAgentTools(
  agentId: string,
  selectedToolIds: string[]
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data: existing, error: fetchError } = await supabase
    .from('agent_tools')
    .select('tool_config_id')
    .eq('agent_id', agentId)
    .not('tool_config_id', 'is', null)
  if (fetchError) return { error: fetchError.message }

  const currentSet = new Set(
    (existing ?? [])
      .map((r) => r.tool_config_id)
      .filter((id): id is string => Boolean(id)),
  )
  const nextSet = new Set(selectedToolIds)
  const toAdd = [...nextSet].filter((id) => !currentSet.has(id))
  const toRemove = [...currentSet].filter((id) => !nextSet.has(id))

  if (toAdd.length > 0) {
    const { error } = await supabase.from('agent_tools').insert(
      toAdd.map((tool_config_id) => ({
        organization_id: orgId,
        agent_id: agentId,
        tool_config_id,
      }))
    )
    if (error) return { error: error.message }
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('agent_tools')
      .delete()
      .eq('agent_id', agentId)
      .in('tool_config_id', toRemove)
    if (error) return { error: error.message }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${agentId}`)
}
