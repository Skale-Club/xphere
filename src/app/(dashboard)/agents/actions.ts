'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import type { AgentChannel } from '@/lib/agents/channels'
import type { AgentFormOutput } from '@/lib/agents/zod-schemas'
import { setAgentTools, getToolPickerData } from './_actions/tools'

// Re-export sub-module functions so consumers can import from a single path
export { setAgentTools, getToolPickerData }

type AgentRow = Database['public']['Tables']['agents']['Row']

export interface AgentListItem extends AgentRow {
  tool_count: number
}

export interface AgentWithToolIds extends AgentRow {
  tool_ids: string[]
}

// ─── Agent list ───────────────────────────────────────────────────────────────

/**
 * Returns all org agents (active + inactive) ordered by position then
 * created_at. Each row is augmented with a `tool_count` from agent_tools.
 */
export async function getAgents(): Promise<AgentListItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*, agent_tools(count)')
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map((a) => {
    const { agent_tools: rel, ...rest } = a as AgentRow & {
      agent_tools: { count: number }[]
    }
    return { ...(rest as AgentRow), tool_count: rel?.[0]?.count ?? 0 }
  })
}

/**
 * Returns only is_active=true agents — used by Channel Defaults dropdowns.
 */
export async function getActiveAgents(): Promise<
  Pick<AgentRow, 'id' | 'name' | 'slug'>[]
> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('agents')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('name', { ascending: true })
  return data ?? []
}

// ─── Channel defaults ─────────────────────────────────────────────────────────

/**
 * Returns the channels with their currently-assigned agent_id.
 * Channels without an explicit default return null.
 */
export async function getChannelDefaults(): Promise<
  Record<AgentChannel, string | null>
> {
  const empty: Record<AgentChannel, string | null> = {
    web_widget: null,
    sms: null,
    whatsapp: null,
    messenger: null,
    instagram: null,
    manychat: null,
    telegram: null,
    zernio: null,
    workflow: null,
  }
  const user = await getUser()
  if (!user) return empty
  const supabase = await createClient()
  const { data } = await supabase
    .from('agent_channel_defaults')
    .select('channel, agent_id')
  if (!data) return empty
  const result = { ...empty }
  for (const row of data) {
    result[row.channel as AgentChannel] = row.agent_id
  }
  return result
}

/**
 * UPSERTs the channel default when agentId is provided, DELETEs when null.
 */
export async function setChannelDefault(
  channel: AgentChannel,
  agentId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  if (agentId === null) {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .delete()
      .eq('channel', channel)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .upsert(
        { organization_id: orgId, channel, agent_id: agentId },
        { onConflict: 'organization_id,channel' }
      )
    if (error) return { error: error.message }
  }
  revalidatePath('/agents')
}

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

/**
 * Returns a single agent row + attached tool_config_ids. Returns null if the
 * agent is missing or out of scope.
 */
export async function getAgentById(
  id: string
): Promise<AgentWithToolIds | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!agent) return null
  const { data: tools } = await supabase
    .from('agent_tools')
    .select('tool_config_id')
    .eq('agent_id', id)
    .not('tool_config_id', 'is', null)
  return {
    ...(agent as AgentRow),
    tool_ids: (tools ?? [])
      .map((t) => t.tool_config_id)
      .filter((id): id is string => Boolean(id)),
  }
}

/**
 * Inserts a new agent row. TOOL-03: new agents start with zero attached tools
 * regardless of input.tool_ids — deny-by-default safety net.
 */
export async function createAgent(
  input: AgentFormOutput
): Promise<{ error?: string; id?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data, error } = await supabase
    .from('agents')
    .insert({
      organization_id: orgId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      system_prompt: input.system_prompt,
      model: input.model,
      fallback_message: input.fallback_message,
      max_history: input.max_history,
      temperature: input.temperature ?? null,
      max_tokens: input.max_tokens ?? null,
      is_active: input.is_active,
      group_id: input.group_id ?? null,
      position: 0,
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Insert']['channel_overrides'],
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'An agent with this slug already exists for your organization.' }
    }
    return { error: error.message }
  }

  revalidatePath('/agents')
  return { id: data.id }
}

/**
 * Updates an agent row + diffs its attached tools.
 */
export async function updateAgent(
  id: string,
  input: AgentFormOutput
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('agents')
    .update({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      system_prompt: input.system_prompt,
      model: input.model,
      fallback_message: input.fallback_message,
      max_history: input.max_history,
      temperature: input.temperature ?? null,
      max_tokens: input.max_tokens ?? null,
      is_active: input.is_active,
      group_id: input.group_id ?? null,
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Update']['channel_overrides'],
      updated_by: user.id,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'An agent with this slug already exists for your organization.' }
    }
    return { error: error.message }
  }

  const toolsResult = await setAgentTools(id, input.tool_ids)
  if (toolsResult && 'error' in toolsResult && toolsResult.error) {
    return { error: toolsResult.error }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
}

/**
 * Flips agents.is_active. Deactivating an agent excludes it from Channel
 * Defaults dropdowns.
 */
export async function toggleAgentActive(
  id: string,
  active: boolean
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('agents')
    .update({ is_active: active, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/agents')
}

/**
 * Soft-deletes an agent:
 *  1. Refuses if the target IS the Main Agent.
 *  2. Refuses if no active Main Agent exists.
 *  3. Reassigns any channel defaults pointing at this agent → Main Agent.
 *  4. Sets is_active=false on the target.
 */
export async function softDeleteAgent(
  id: string
): Promise<{ error?: string; reassignedCount?: number } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data: mainAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', 'Main Agent')
    .eq('is_active', true)
    .maybeSingle()
  if (!mainAgent) {
    return { error: 'Cannot delete: no active Main Agent to reassign channel defaults to.' }
  }
  if (mainAgent.id === id) {
    return { error: 'Cannot delete the Main Agent.' }
  }

  const { data: reassigned, error: reassignError } = await supabase
    .from('agent_channel_defaults')
    .update({ agent_id: mainAgent.id })
    .eq('agent_id', id)
    .select('id')
  if (reassignError) return { error: reassignError.message }

  const { error } = await supabase
    .from('agents')
    .update({ is_active: false, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/agents')
  return { reassignedCount: reassigned?.length ?? 0 }
}

// ─── Ordering ─────────────────────────────────────────────────────────────────

export async function moveAgentToGroup(
  agentId: string,
  groupId: string | null,
): Promise<{ ok: true; data: undefined } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  const { data: tail } = await supabase
    .from('agents')
    .select('position')
    .eq('group_id', groupId as unknown as string)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = (tail?.[0]?.position ?? -1) + 1

  const { error } = await supabase
    .from('agents')
    .update({ group_id: groupId, position: nextPosition })
    .eq('id', agentId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/agents')
  return { ok: true, data: undefined }
}

export async function reorderAgentsInGroup(
  _groupId: string | null,
  orderedIds: string[],
): Promise<{ ok: true; data: undefined } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (orderedIds.length === 0) return { ok: true, data: undefined }

  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    supabase.from('agents').update({ position: index }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { ok: false, error: 'Failed to save agent order.' }

  revalidatePath('/agents')
  return { ok: true, data: undefined }
}
