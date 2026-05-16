'use server'

// Server actions for Phase 36 Agent CRUD Dashboard.
// - Plan 03 adds: getAgents, getActiveAgents, getChannelDefaults, setChannelDefault,
//   toggleAgentActive, softDeleteAgent
// - Plan 04 adds: getAgentById, createAgent, updateAgent, setAgentTools, getToolPickerData
//
// All actions use cached `getUser()` + `createClient()` from `@/lib/supabase/server`
// and rely on RLS via `(SELECT public.get_current_org_id())` for tenant scoping.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import type { AgentChannel } from '@/lib/agents/channels'
import type { AgentFormOutput } from '@/lib/agents/zod-schemas'

type AgentRow = Database['public']['Tables']['agents']['Row']

export interface AgentListItem extends AgentRow {
  tool_count: number
}

/**
 * Returns all org agents (active + inactive) ordered by created_at DESC,
 * each augmented with a `tool_count` derived from the agent_tools junction.
 * RLS auto-scopes to the active org.
 */
export async function getAgents(): Promise<AgentListItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*, agent_tools(count)')
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
 * Returns only is_active=true agents — used by Channel Defaults dropdowns
 * and (future) partner pickers. Inactive agents are excluded per D-36-08.
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

/**
 * Returns the 6 channels with their currently-assigned agent_id.
 * Channels without an explicit default return null (runtime falls back to Main Agent).
 */
export async function getChannelDefaults(): Promise<
  Record<AgentChannel, string | null>
> {
  const empty: Record<AgentChannel, string | null> = {
    web_widget: null,
    whatsapp: null,
    messenger: null,
    instagram: null,
    manychat: null,
    telegram: null,
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
 * UPSERTs `agent_channel_defaults(org_id, channel, agent_id)` when agentId is provided,
 * or DELETEs the row when agentId is null (clears the default; runtime falls back to
 * the seeded Main Agent).
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

/**
 * Flips agents.is_active. Used by the list-row Switch (optimistic UI in the
 * client; this server action persists the change). Per D-36-08, deactivating
 * an agent automatically excludes it from Channel Defaults dropdowns.
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
 * Soft-deletes an agent per D-36-07:
 *  1. Refuses if the target IS the Main Agent (orgs always need one).
 *  2. Refuses if no active Main Agent exists (no reassignment target).
 *  3. Reassigns any `agent_channel_defaults` rows pointing at this agent → Main Agent.
 *  4. Sets `is_active=false` on the target.
 *
 * Historical `agent_invocations` rows stay queryable (AGENT-10 requirement).
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
    return {
      error:
        'Cannot delete: no active Main Agent to reassign channel defaults to.',
    }
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

// ───────────────────────── Plan 04: form actions ─────────────────────────

export interface AgentWithToolIds extends AgentRow {
  tool_ids: string[]
}

/**
 * Returns a single agent row + the list of tool_config_ids currently attached
 * via agent_tools. RLS auto-scopes to the active org. Returns null if the
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
  return {
    ...(agent as AgentRow),
    tool_ids: (tools ?? []).map((t) => t.tool_config_id),
  }
}

export interface ToolPickerData {
  folders: Database['public']['Tables']['tool_folders']['Row'][]
  tools: Array<
    Database['public']['Tables']['tool_configs']['Row'] & {
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
 * surface the warning icon for inactive/missing integrations per TOOL-04.
 */
export async function getToolPickerData(): Promise<ToolPickerData> {
  const user = await getUser()
  if (!user) return { folders: [], tools: [] }
  const supabase = await createClient()
  const [foldersRes, toolsRes] = await Promise.all([
    supabase.from('tool_folders').select('*').order('name', { ascending: true }),
    supabase
      .from('tool_configs')
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
 * Inserts a new agent row scoped to the active org. Returns { id } on success
 * or { error } on failure. TOOL-03: NEW agents are created with ZERO attached
 * tools — this function does NOT call setAgentTools even if input.tool_ids is
 * populated. The form forces tool_ids=[] for create mode, but this is the
 * deny-by-default safety net.
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
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Insert']['channel_overrides'],
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return {
        error: 'An agent with this slug already exists for your organization.',
      }
    }
    return { error: error.message }
  }

  // TOOL-03: NEW agents start with zero attached tools. We do NOT call
  // setAgentTools here even if input.tool_ids is populated. The create page
  // enforces an empty tool_ids array (D-36-05 final paragraph). If a non-empty
  // array slips through, persist nothing — this is the deny-by-default safety net.

  revalidatePath('/agents')
  return { id: data.id }
}

/**
 * Updates an agent row + diffs its attached tools. NOT wrapped in a
 * transaction — if setAgentTools fails after the row update succeeded, the
 * form surfaces the recovery toast: "Tool changes failed — please retry
 * attaching tools on the form and save again." See plan 36-04 Deferred —
 * Phase 38 wraps both writes in an RPC.
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
      allowed_channels: input.allowed_channels,
      channel_overrides: input.channel_overrides as Database['public']['Tables']['agents']['Update']['channel_overrides'],
      updated_by: user.id,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return {
        error: 'An agent with this slug already exists for your organization.',
      }
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
 * Diffs current vs next tool selection. INSERTs only NEW pairs and DELETEs
 * only REMOVED pairs — NEVER UPDATEs existing rows. This preserves
 * `agent_tools.allowed_channels` for any tools that stay attached across the
 * save (Pitfall 5). New rows leave allowed_channels NULL (DB default = all
 * channels); per-tool channel scoping is a future surface.
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
  if (fetchError) return { error: fetchError.message }

  const currentSet = new Set((existing ?? []).map((r) => r.tool_config_id))
  const nextSet = new Set(selectedToolIds)
  const toAdd = [...nextSet].filter((id) => !currentSet.has(id))
  const toRemove = [...currentSet].filter((id) => !nextSet.has(id))

  if (toAdd.length > 0) {
    const { error } = await supabase.from('agent_tools').insert(
      toAdd.map((tool_config_id) => ({
        organization_id: orgId,
        agent_id: agentId,
        tool_config_id,
        // allowed_channels left undefined → DB default (NULL = all channels)
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
