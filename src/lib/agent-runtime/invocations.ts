// src/lib/agent-runtime/invocations.ts
// INSERT-at-start and UPDATE-at-end helpers for agent_invocations table.
// D-34-03: two-phase write (running → final status).
// RLS explicitly blocks authenticated INSERT | must use service-role client.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import type { AgentChannel } from './types'

export interface InvocationStartParams {
  organizationId: string
  agentId: string
  traceId: string
  channel: AgentChannel
  depth: number
  mode: 'production' | 'playground'
  userMessage: string
  model: string
  conversationId?: string
  sessionId?: string
  parentInvocationId?: string
}

export interface InvocationEndParams {
  invocationId: string
  agentId: string
  model: string
  status: 'success' | 'error' | 'aborted' | 'skipped'
  assistantReply: string
  tokensIn: number
  tokensOut: number
  toolCallsJson: Json[]
  errorDetail?: string
  startedAt: number // Date.now() timestamp at invocation start
}

// INSERT with status='running' at the START of runAgent().
// Returns the new row's UUID (invocationId) for use in updateInvocationEnd().
export async function insertInvocationStart(
  params: InvocationStartParams
): Promise<string> {
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('agent_invocations')
    .insert({
      organization_id: params.organizationId,
      agent_id: params.agentId,
      trace_id: params.traceId,
      channel: params.channel,
      depth: params.depth,
      mode: params.mode,
      status: 'running',
      user_message: params.userMessage,
      model: params.model,
      ...(params.conversationId ? { conversation_id: params.conversationId } : {}),
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      ...(params.parentInvocationId ? { parent_invocation_id: params.parentInvocationId } : {}),
    })
    .select('id')
    .single()

  if (error) {
    console.error(
      JSON.stringify({
        event: 'invocation_insert_failed',
        error: error.message,
        traceId: params.traceId,
        agentId: params.agentId,
        orgId: params.organizationId,
      })
    )
    // Return a placeholder | the invocation proceeds even if logging fails
    return 'insert-failed'
  }

  return data.id
}

// UPDATE at the END of runAgent() | fills cost, tokens, latency, final status.
// D-34-15: cost computed here via agent_model_pricing join.
export async function updateInvocationEnd(
  params: InvocationEndParams
): Promise<void> {
  const supabase = createServiceRoleClient()

  // Compute cost via agent_model_pricing (D-34-15)
  let costUsd: number | null = null
  if (params.tokensIn > 0 || params.tokensOut > 0) {
    const { data: pricing } = await supabase
      .from('agent_model_pricing')
      .select('input_per_1m_usd, output_per_1m_usd')
      .eq('model', params.model)
      .maybeSingle()

    if (pricing) {
      costUsd =
        (params.tokensIn / 1_000_000) * Number(pricing.input_per_1m_usd) +
        (params.tokensOut / 1_000_000) * Number(pricing.output_per_1m_usd)
    } else {
      console.warn(
        JSON.stringify({
          event: 'agent_model_pricing_missing',
          model: params.model,
          agentId: params.agentId,
        })
      )
    }
  }

  const durationMs = Date.now() - params.startedAt

  const { error } = await supabase
    .from('agent_invocations')
    .update({
      status: params.status,
      assistant_reply: params.assistantReply,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      cost_usd: costUsd,
      duration_ms: durationMs,
      tool_calls: params.toolCallsJson,
      ...(params.errorDetail ? { error_detail: params.errorDetail } : {}),
    })
    .eq('id', params.invocationId)

  if (error) {
    console.error(
      JSON.stringify({
        event: 'invocation_update_failed',
        error: error.message,
        invocationId: params.invocationId,
      })
    )
  }
}
