// src/lib/agent-runtime/resolve-agent-tool.ts
// Sibling resolver to resolveTool(orgId, toolName) in src/lib/action-engine/.
// D-34-07: resolveTool() is NOT modified; this is a NEW function for agent-scoped authorization.
// Queries agent_tools junction to verify tool is attached to the agent + allowed on the channel.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { AgentChannel, ResolvedToolConfig } from './types'

export async function resolveAgentTool(
  agentId: string,
  toolName: string,
  channel: AgentChannel
): Promise<ResolvedToolConfig | null> {
  const supabase = createServiceRoleClient()

  // Join agent_tools -> tool_configs -> integrations (service-role to bypass RLS)
  const { data, error } = await supabase
    .from('agent_tools')
    .select(`
      allowed_channels,
      tool_configs!inner (
        id,
        tool_name,
        action_type,
        config,
        is_active,
        integration_id,
        integrations (
          provider,
          encrypted_api_key
        )
      )
    `)
    .eq('agent_id', agentId)
    .eq('tool_configs.tool_name', toolName)
    .eq('tool_configs.is_active', true)
    .maybeSingle()

  if (error || !data) return null

  const tc = data.tool_configs as {
    id: string
    tool_name: string
    action_type: string
    config: unknown
    is_active: boolean
    integration_id: string | null
    integrations?: { provider: string; encrypted_api_key: string } | null
  }

  // Check per-tool channel restriction (agent_tools.allowed_channels)
  // null = all channels allowed; non-null array = must include the invocation channel
  if (data.allowed_channels !== null && Array.isArray(data.allowed_channels)) {
    if (!(data.allowed_channels as string[]).includes(channel)) {
      return null
    }
  }

  return {
    toolConfigId: tc.id,
    toolName: tc.tool_name,
    actionType: tc.action_type as ResolvedToolConfig['actionType'],
    config: tc.config as ResolvedToolConfig['config'],
    integrationId: tc.integration_id,
    integrationProvider: (tc.integrations?.provider ?? null) as ResolvedToolConfig['integrationProvider'],
    credentialsEncrypted: tc.integrations?.encrypted_api_key ?? null,
  }
}
