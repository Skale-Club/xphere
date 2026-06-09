'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

export interface PromptVersionListItem {
  id: string
  version: number
  system_prompt: string
  created_at: string
  created_by: string | null
  created_by_email: string | null
  is_active: boolean
}

/**
 * Returns all prompt versions for an agent, ordered by version DESC.
 * Includes is_active flag derived from agents.active_prompt_version_id.
 * Uses service-role client to join user email from auth.users.
 */
export async function getPromptVersionHistory(
  agentId: string
): Promise<PromptVersionListItem[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('id, active_prompt_version_id')
    .eq('id', agentId)
    .single()
  if (!agent) return []

  const { createServiceRoleClient } = await import('@/lib/supabase/admin')
  const adminClient = createServiceRoleClient()

  const { data: versions } = await adminClient
    .from('agent_prompt_versions')
    .select('id, version, system_prompt, created_at, created_by')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })

  if (!versions) return []

  const userIds = [...new Set(versions.map((v) => v.created_by).filter(Boolean) as string[])]
  const userEmailMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: { users } } = await adminClient.auth.admin.listUsers()
    for (const u of users ?? []) {
      if (userIds.includes(u.id)) {
        userEmailMap[u.id] = u.email ?? u.id
      }
    }
  }

  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    system_prompt: v.system_prompt,
    created_at: v.created_at,
    created_by: v.created_by,
    created_by_email: v.created_by ? (userEmailMap[v.created_by] ?? v.created_by) : null,
    is_active: v.id === agent.active_prompt_version_id,
  }))
}

/**
 * Saves a prompt edit as a DRAFT version row via the DB trigger
 * `trg_agent_prompt_version_snapshot`. Does NOT change active_prompt_version_id.
 */
export async function savePromptDraft(
  agentId: string,
  newPrompt: string
): Promise<{ versionId: string; version: number } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()

  const { error: updateError } = await supabase
    .from('agents')
    .update({ system_prompt: newPrompt, updated_by: user.id })
    .eq('id', agentId)

  if (updateError) return { error: updateError.message }

  const { data: newVersion } = await supabase
    .from('agent_prompt_versions')
    .select('id, version')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (!newVersion) return { error: 'Version row not created by trigger — check migration 045' }

  revalidatePath(`/agents/${agentId}`)
  revalidatePath(`/agents/${agentId}/prompt-history`)
  return { versionId: newVersion.id, version: newVersion.version }
}

/**
 * Promotes a version to production by updating agents.active_prompt_version_id.
 * The version row is NEVER mutated (immutable invariant).
 */
export async function publishPromptVersion(
  agentId: string,
  versionId: string
): Promise<void | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()

  const { data: version } = await supabase
    .from('agent_prompt_versions')
    .select('id, agent_id')
    .eq('id', versionId)
    .eq('agent_id', agentId)
    .single()

  if (!version) return { error: 'Version not found or does not belong to this agent' }

  const { error } = await supabase
    .from('agents')
    .update({ active_prompt_version_id: versionId, updated_by: user.id })
    .eq('id', agentId)

  if (error) return { error: error.message }

  revalidatePath(`/agents/${agentId}`)
  revalidatePath(`/agents/${agentId}/prompt-history`)
}

/**
 * Rollback: activates a prior version. Semantically identical to
 * publishPromptVersion but named separately for clarity in UI.
 */
export async function activatePromptVersion(
  agentId: string,
  versionId: string
): Promise<void | { error: string }> {
  return publishPromptVersion(agentId, versionId)
}
