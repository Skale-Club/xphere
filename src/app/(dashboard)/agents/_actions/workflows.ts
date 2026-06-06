'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { AgentChannel } from '@/lib/agents/channels'

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
 * Returns the workflows attached to the agent via `agent_tools.workflow_id`.
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

/**
 * Returns org workflows that can be attached as agent tools:
 * kind in ('tool','flow'), is_active=true, tool_name set, not already attached.
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
 * Attach a workflow to an agent. agent_tools rows are XOR —
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
    if (error.code === '23505') {
      return { error: 'Workflow is already attached to this agent.' }
    }
    return { error: error.message }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${agentId}`)
}

/**
 * Detach a workflow from an agent (removes the agent_tools row).
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
