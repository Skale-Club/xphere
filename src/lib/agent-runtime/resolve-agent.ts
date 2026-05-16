// src/lib/agent-runtime/resolve-agent.ts
// Resolves an agent row + applies channel_overrides for the invocation channel.
// D-34-06: reads system_prompt from agent_prompt_versions (never from agents.system_prompt directly).
// D-34-11: channel_overrides deep-merge (system_prompt suffix-append; model/temp/tokens/history replace).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { AgentChannel, ResolvedAgent } from './types'

export async function resolveAgent(
  agentId: string,
  orgId: string,
  channel: AgentChannel
): Promise<ResolvedAgent | null> {
  const supabase = createServiceRoleClient()

  // Fetch agent + active prompt version in one query (D-34-06: join via active_prompt_version_id)
  const { data: agent, error } = await supabase
    .from('agents')
    .select(`
      id,
      name,
      model,
      max_history,
      fallback_message,
      allowed_channels,
      channel_overrides,
      is_active,
      system_prompt,
      active_prompt_version_id,
      kb_scope,
      agent_prompt_versions!agents_active_prompt_version_id_fkey (
        id,
        system_prompt
      )
    `)
    .eq('id', agentId)
    .eq('organization_id', orgId)
    .single()

  if (error || !agent) return null

  // D-34-06: use active version prompt; fallback to agents.system_prompt with structured warning
  const promptVersionRow = Array.isArray(agent.agent_prompt_versions)
    ? agent.agent_prompt_versions[0]
    : agent.agent_prompt_versions

  let baseSystemPrompt: string
  if (promptVersionRow?.system_prompt) {
    baseSystemPrompt = promptVersionRow.system_prompt
  } else {
    console.warn(
      JSON.stringify({
        event: 'agent_prompt_version_missing',
        agentId,
        orgId,
        fallback: 'agents.system_prompt',
      })
    )
    baseSystemPrompt = agent.system_prompt ?? ''
  }

  // D-34-11: apply channel_overrides — JSONB keyed by channel name
  const overrides = (agent.channel_overrides as Record<string, Record<string, unknown>> | null) ?? {}
  const channelOverride = overrides[channel] ?? {}

  // system_prompt: suffix-append only (NOT replace) — D-34-11
  const systemPrompt = channelOverride.system_prompt
    ? `${baseSystemPrompt}\n\n${channelOverride.system_prompt}`
    : baseSystemPrompt

  // model: replace if present in override
  const model = typeof channelOverride.model === 'string'
    ? channelOverride.model
    : agent.model

  // temperature: replace if present in override (column does not exist in DB — override-only)
  const temperature = typeof channelOverride.temperature === 'number'
    ? channelOverride.temperature
    : undefined

  // max_tokens: replace if present in override (column does not exist in DB — override-only with default)
  const maxTokens = typeof channelOverride.max_tokens === 'number'
    ? channelOverride.max_tokens
    : 1024

  // max_history: replace if present in override
  const maxHistory = typeof channelOverride.max_history === 'number'
    ? channelOverride.max_history
    : (agent.max_history ?? 20)

  return {
    agentId: agent.id,
    orgId,
    name: agent.name,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    maxHistory,
    fallbackMessage: agent.fallback_message ?? "I can't help with that right now — let me transfer you to a human.",
    allowedChannels: (agent.allowed_channels ?? []) as AgentChannel[],
    isActive: agent.is_active ?? false,
    kbScope: (agent.kb_scope as string[] | null) ?? null,
  }
}
