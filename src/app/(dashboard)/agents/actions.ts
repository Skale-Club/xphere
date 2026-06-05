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
 * Returns only is_active=true agents | used by Channel Defaults dropdowns
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
 * Returns the channels with their currently-assigned agent_id.
 * Channels without an explicit default return null and do not auto-reply.
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
 * UPSERTs `agent_channel_defaults(org_id, channel, agent_id)` when agentId is provided,
 * or DELETEs the row when agentId is null (clears the default and disables
 * automatic replies for that channel).
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

// ─── Agent grouping: move + reorder (drives the sidebar tree) ──────────────────
//
// These return the `{ ok }` shape that DraggableTreeNav's TreeNavActions expects
// (moveItemToFolder / reorderItemsInFolder). Group CRUD lives in
// `_actions/groups.ts`; agents are typed so no `any` cast is needed here.

export async function moveAgentToGroup(
  agentId: string,
  groupId: string | null,
): Promise<{ ok: true; data: undefined } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()

  // Append at the end of the destination group by default.
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
    .not('tool_config_id', 'is', null)
  return {
    ...(agent as AgentRow),
    tool_ids: (tools ?? [])
      .map((t) => t.tool_config_id)
      .filter((id): id is string => Boolean(id)),
  }
}

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
 * surface the warning icon for inactive/missing integrations per TOOL-04.
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
 * Inserts a new agent row scoped to the active org. Returns { id } on success
 * or { error } on failure. TOOL-03: NEW agents are created with ZERO attached
 * tools | this function does NOT call setAgentTools even if input.tool_ids is
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
      return {
        error: 'An agent with this slug already exists for your organization.',
      }
    }
    return { error: error.message }
  }

  // TOOL-03: NEW agents start with zero attached tools. We do NOT call
  // setAgentTools here even if input.tool_ids is populated. The create page
  // enforces an empty tool_ids array (D-36-05 final paragraph). If a non-empty
  // array slips through, persist nothing | this is the deny-by-default safety net.

  revalidatePath('/agents')
  return { id: data.id }
}

/**
 * Updates an agent row + diffs its attached tools. NOT wrapped in a
 * transaction | if setAgentTools fails after the row update succeeded, the
 * form surfaces the recovery toast: "Tool changes failed | please retry
 * attaching tools on the form and save again." See plan 36-04 Deferred |
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
      group_id: input.group_id ?? null,
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

// ─── Prompt Version Types ─────────────────────────────────────────────────────

export interface PromptVersionListItem {
  id: string
  version: number
  system_prompt: string
  created_at: string
  created_by: string | null
  created_by_email: string | null   // joined from auth.users via service-role client
  is_active: boolean                // true when this is the agent's active_prompt_version_id
}

// ─── getPromptVersionHistory ──────────────────────────────────────────────────

/**
 * Returns all prompt versions for an agent, ordered by version DESC.
 * Includes is_active flag derived from agents.active_prompt_version_id.
 * Uses service-role client to join user email from auth.users.
 * RLS: the agent row must be accessible to the caller (org-scoped).
 */
export async function getPromptVersionHistory(
  agentId: string
): Promise<PromptVersionListItem[]> {
  const user = await getUser()
  if (!user) return []

  // Use createClient for RLS-gated agent fetch (confirm caller can see the agent)
  const supabase = await createClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('id, active_prompt_version_id')
    .eq('id', agentId)
    .single()
  if (!agent) return []

  // Use service-role to fetch versions + join user emails
  const { createServiceRoleClient } = await import('@/lib/supabase/admin')
  const adminClient = createServiceRoleClient()

  const { data: versions } = await adminClient
    .from('agent_prompt_versions')
    .select('id, version, system_prompt, created_at, created_by')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })

  if (!versions) return []

  // Collect unique created_by UUIDs for email lookup
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

// ─── savePromptDraft ──────────────────────────────────────────────────────────

/**
 * Saves a prompt edit as a DRAFT version row.
 * This does NOT change active_prompt_version_id | the prompt does not go live until Publish.
 *
 * Mechanism: UPDATE agents SET system_prompt = newPrompt, updated_by = userId.
 * This triggers `trg_agent_prompt_version_snapshot` which inserts a new agent_prompt_versions row.
 * active_prompt_version_id remains unchanged | the new version is a draft.
 *
 * Returns the new version id.
 */
export async function savePromptDraft(
  agentId: string,
  newPrompt: string
): Promise<{ versionId: string; version: number } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()

  // Set updated_by so the trigger can capture the author
  const { error: updateError } = await supabase
    .from('agents')
    .update({
      system_prompt: newPrompt,
      updated_by: user.id,
    })
    .eq('id', agentId)

  if (updateError) return { error: updateError.message }

  // Fetch the newly created version row (highest version for this agent)
  const { data: newVersion } = await supabase
    .from('agent_prompt_versions')
    .select('id, version')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (!newVersion) return { error: 'Version row not created by trigger | check migration 045' }

  revalidatePath(`/dashboard/agents/${agentId}`)
  revalidatePath(`/dashboard/agents/${agentId}/prompt-history`)
  return { versionId: newVersion.id, version: newVersion.version }
}

// ─── publishPromptVersion ─────────────────────────────────────────────────────

/**
 * Promotes a draft version to production by updating agents.active_prompt_version_id.
 * The version row is NEVER mutated (immutable invariant).
 * This makes the runtime immediately use the new prompt.
 */
export async function publishPromptVersion(
  agentId: string,
  versionId: string
): Promise<void | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()

  // Verify the version belongs to this agent
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

  revalidatePath(`/dashboard/agents/${agentId}`)
  revalidatePath(`/dashboard/agents/${agentId}/prompt-history`)
}

// ─── activatePromptVersion ────────────────────────────────────────────────────

/**
 * Rollback: activates a prior version (any version, not necessarily the latest).
 * Updates agents.active_prompt_version_id | version row is NEVER mutated.
 * Semantically identical to publishPromptVersion but named separately for clarity in UI.
 */
export async function activatePromptVersion(
  agentId: string,
  versionId: string
): Promise<void | { error: string }> {
  // Delegate to publish | same DB operation
  return publishPromptVersion(agentId, versionId)
}

/**
 * Diffs current vs next tool selection. INSERTs only NEW pairs and DELETEs
 * only REMOVED pairs | NEVER UPDATEs existing rows. This preserves
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

// ─── SEED-033: workflow attachment server actions ─────────────────────────────

export interface AttachedWorkflow {
  id: string
  workflow_id: string
  tool_name: string | null
  name: string
  kind: 'tool' | 'flow'
  is_active: boolean
  health_blocked: boolean
  allowed_channels: AgentChannel[] | null
}

/**
 * Returns the workflows attached to the agent via `agent_tools.workflow_id`.
 * Used by the agent edit page to render workflow tool rows alongside the
 * legacy tool_configs picker.
 */
export async function getAgentWorkflows(
  agentId: string,
): Promise<AttachedWorkflow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agent_tools')
    .select(`
      id,
      workflow_id,
      allowed_channels,
      workflows!inner ( id, name, tool_name, kind, is_active, health_blocked )
    `)
    .eq('agent_id', agentId)
    .not('workflow_id', 'is', null)
  if (error || !data) return []
  return data.map((row) => {
    const wf = row.workflows as {
      id: string
      name: string
      tool_name: string | null
      kind: 'tool' | 'flow'
      is_active: boolean
      health_blocked: boolean
    }
    return {
      id: row.id as string,
      workflow_id: row.workflow_id as string,
      tool_name: wf.tool_name,
      name: wf.name,
      kind: wf.kind,
      is_active: wf.is_active,
      health_blocked: wf.health_blocked,
      allowed_channels: (row.allowed_channels as AgentChannel[] | null) ?? null,
    }
  })
}

export interface WorkflowPickerItem {
  id: string
  tool_name: string
  name: string
  description: string | null
  kind: 'tool' | 'flow'
  is_active: boolean
  health_blocked: boolean
}

/**
 * Returns the workflows in the org that can be attached as agent tools:
 * kind in ('tool','flow'), is_active=true, and tool_name set. Filtered to
 * those the agent does NOT already have attached.
 */
export async function getAvailableWorkflowsForAgent(
  agentId: string,
): Promise<WorkflowPickerItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const [allRes, attachedRes] = await Promise.all([
    supabase
      .from('workflows')
      .select('id, tool_name, name, description, kind, is_active, health_blocked')
      .in('kind', ['tool', 'flow'])
      .eq('is_active', true)
      .not('tool_name', 'is', null)
      .order('name', { ascending: true }),
    supabase
      .from('agent_tools')
      .select('workflow_id')
      .eq('agent_id', agentId)
      .not('workflow_id', 'is', null),
  ])
  const attachedIds = new Set(
    (attachedRes.data ?? [])
      .map((r) => r.workflow_id as string | null)
      .filter((id): id is string => Boolean(id)),
  )
  return (allRes.data ?? [])
    .filter((w) => !attachedIds.has(w.id as string))
    .map((w) => ({
      id: w.id as string,
      tool_name: w.tool_name as string,
      name: w.name as string,
      description: (w.description as string | null) ?? null,
      kind: w.kind as 'tool' | 'flow',
      is_active: w.is_active as boolean,
      health_blocked: w.health_blocked as boolean,
    }))
}

/**
 * Attach a workflow to an agent. Per SEED-033, agent_tools rows are XOR |
 * tool_config_id is left NULL when workflow_id is set.
 */
export async function attachWorkflowToAgent(
  agentId: string,
  workflowId: string,
  allowedChannels?: AgentChannel[],
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { error } = await supabase.from('agent_tools').insert({
    organization_id: orgId,
    agent_id: agentId,
    workflow_id: workflowId,
    tool_config_id: null,
    allowed_channels: allowedChannels ?? null,
  })

  if (error) {
    // Unique-index hit (workflow already attached to this agent)
    if (error.code === '23505') {
      return { error: 'Workflow is already attached to this agent.' }
    }
    return { error: error.message }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${agentId}`)
}

/**
 * Detach a workflow from an agent (removes the agent_tools row identified by
 * agent_id + workflow_id).
 */
export async function detachWorkflowFromAgent(
  agentId: string,
  workflowId: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('agent_tools')
    .delete()
    .eq('agent_id', agentId)
    .eq('workflow_id', workflowId)

  if (error) return { error: error.message }

  revalidatePath('/agents')
  revalidatePath(`/agents/${agentId}`)
}
