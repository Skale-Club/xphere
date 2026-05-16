// src/lib/agent-runtime/run-agent.ts
// Core orchestration loop for agent invocations.
// D-34-02: returns Promise<AgentRunResult> (plain object, NOT stream).
// D-34-09: NOT wired into any live channel handler in Phase 34 — Phase 35 job.
//
// LLM call pattern: ADOPT ai@^6 (generateText from 'ai' + @ai-sdk/anthropic)
// Decision locked in 34-01-SUMMARY.md.

import { generateText, dynamicTool, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { jsonSchema } from 'ai'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { queryKnowledge } from '@/lib/knowledge/query-knowledge'
import { executeAction } from '@/lib/action-engine/execute-action'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import {
  checkKillSwitch,
  checkDelegationDepth,
  checkLlmCallCount,
  checkTokenCap,
  checkDailyCostCap,
} from './guardrails'
import { resolveAgent } from './resolve-agent'
import { resolveAgentTool } from './resolve-agent-tool'
import { insertInvocationStart, updateInvocationEnd } from './invocations'
import type { AgentRunOptions, AgentRunResult } from './types'
import type { Json } from '@/types/database'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_TURN_TIMEOUT_MS = parseInt(
  process.env.AGENT_TURN_TIMEOUT_MS ?? '8000',
  10
)
const MAX_LLM_CALLS_PER_TURN = parseInt(
  process.env.AGENT_MAX_LLM_CALLS_PER_TURN ?? '6',
  10
)

// ---------------------------------------------------------------------------
// Tool description lookup (action_type → default description)
// ---------------------------------------------------------------------------

const ACTION_DESCRIPTIONS: Record<string, string> = {
  create_contact: 'Create a new contact in the CRM',
  get_availability: 'Check available appointment slots',
  create_appointment: 'Book an appointment',
  send_sms: 'Send an SMS message',
  knowledge_base: 'Search the knowledge base for information',
  custom_webhook: 'Trigger a custom webhook action',
  manychat_set_field: 'Set a ManyChat custom field',
  manychat_add_tag: 'Add a tag to a ManyChat subscriber',
  manychat_trigger_flow: 'Trigger a ManyChat flow',
  manychat_send_message: 'Send a message via ManyChat',
  google_contacts_create: 'Create a Google Contact',
  google_contacts_update: 'Update a Google Contact',
  google_contacts_find: 'Find a Google Contact',
  google_contacts_delete: 'Delete a Google Contact',
}

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const {
    orgId,
    channel,
    userMessage,
    conversationId,
    sessionId,
    historyWindow = [],
    mode = 'production',
    _depth = 0,
    parentInvocationId,
  } = opts

  // Resolve agentId from agent_channel_defaults when not explicitly provided (D-35-06)
  let resolvedAgentId = opts.agentId
  if (!resolvedAgentId) {
    const defaultClient = createServiceRoleClient()
    const { data: defaultRow } = await defaultClient
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', opts.orgId)
      .eq('channel', opts.channel)
      .single()

    resolvedAgentId = defaultRow?.agent_id ?? undefined
    if (!resolvedAgentId) {
      console.error(
        JSON.stringify({ event: 'no_agent_for_channel', orgId: opts.orgId, channel: opts.channel })
      )
      return {
        text: "I'm unable to process your request right now.",
        usage: { tokensIn: 0, tokensOut: 0 },
        invocationId: '',
        traceId: crypto.randomUUID(),
        status: 'error',
        errorDetail: 'no_agent_for_channel',
      }
    }
  }

  // Step 1: Generate traceId
  const traceId = crypto.randomUUID()

  // Step 2: Kill switch check — before any DB writes or LLM calls (GATE-03 / RUNTIME-09)
  const killSwitchResult = checkKillSwitch(traceId)
  if (killSwitchResult) return killSwitchResult

  // Step 3: Resolve agent row + apply channel_overrides
  const resolvedAgent = await resolveAgent(resolvedAgentId, orgId, channel)
  if (!resolvedAgent) {
    console.error(
      JSON.stringify({ event: 'agent_resolve_failed', agentId: resolvedAgentId, orgId, channel, traceId })
    )
    return {
      text: "I'm unable to process your request right now.",
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId: '',
      traceId,
      status: 'error',
      errorDetail: 'agent_not_found',
    }
  }

  // Step 4: is_active check (D-34-13) — denied, no invocation row
  if (!resolvedAgent.isActive) {
    console.warn(
      JSON.stringify({ event: 'agent_inactive_denied', agentId: resolvedAgentId, orgId, traceId })
    )
    return {
      text: resolvedAgent.fallbackMessage,
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId: '',
      traceId,
      status: 'denied',
      errorDetail: 'agent_inactive',
    }
  }

  // Step 5: allowed_channels check (D-34-12) — denied, no invocation row
  if (!resolvedAgent.allowedChannels.includes(channel)) {
    console.warn(
      JSON.stringify({
        event: 'channel_denied',
        channel,
        allowedChannels: resolvedAgent.allowedChannels,
        agentId: resolvedAgentId,
        orgId,
        traceId,
      })
    )
    return {
      text: resolvedAgent.fallbackMessage,
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId: '',
      traceId,
      status: 'denied',
      errorDetail: 'channel_not_allowed',
    }
  }

  // Step 6: Delegation depth check (D-34-10 stub — Phase 38 activates recursion)
  const depthDenial = checkDelegationDepth(_depth, orgId, resolvedAgentId)
  if (depthDenial) {
    return {
      text: depthDenial,
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId: '',
      traceId,
      status: 'denied',
      errorDetail: 'delegation_depth_exceeded',
    }
  }

  // Step 7: Daily cost cap check (D-34-05 / RUNTIME-07)
  const costCapDenial = await checkDailyCostCap(orgId, resolvedAgentId)
  if (costCapDenial) {
    return {
      text: costCapDenial,
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId: '',
      traceId,
      status: 'denied',
      errorDetail: 'daily_cost_cap_exceeded',
    }
  }

  // Step 7b: KB injection — ALWAYS query knowledge (null kbScope = full org KB, matching legacy stream.ts)
  // D-35-02: unconditional call before LLM — kbScope field preserved on ResolvedAgent for future Phase 37 use
  let systemPrompt = resolvedAgent.systemPrompt
  const FALLBACK_KB_RESPONSE = "I don't have information about that in my knowledge base."
  try {
    const kbClient = createServiceRoleClient()
    const kbContext = await queryKnowledge(userMessage, orgId, kbClient)
    if (kbContext && kbContext !== FALLBACK_KB_RESPONSE) {
      systemPrompt = `${systemPrompt}\n\nRelevant knowledge base content:\n${kbContext}`
    }
  } catch {
    // KB failure is non-fatal — continue without context (matches stream.ts behavior)
  }

  // Step 8: INSERT invocation row with status='running' (D-34-03)
  const startedAt = Date.now()
  const invocationId = await insertInvocationStart({
    organizationId: orgId,
    agentId: resolvedAgentId,
    traceId,
    channel,
    depth: _depth,
    mode,
    userMessage,
    model: resolvedAgent.model,
    conversationId,
    sessionId,
    parentInvocationId,
  })

  // Step 9: Token cap check — estimate history tokens (RUNTIME-06)
  const cumulativeHistoryTokens = Math.ceil(
    JSON.stringify(historyWindow).length / 4
  )
  const tokenCapDenial = checkTokenCap(cumulativeHistoryTokens, orgId, resolvedAgentId)
  if (tokenCapDenial) {
    await updateInvocationEnd({
      invocationId,
      agentId: resolvedAgentId,
      model: resolvedAgent.model,
      status: 'skipped',
      assistantReply: tokenCapDenial,
      tokensIn: 0,
      tokensOut: 0,
      toolCallsJson: [],
      errorDetail: 'token_cap_exceeded',
      startedAt,
    })
    return {
      text: tokenCapDenial,
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId,
      traceId,
      status: 'skipped',
      errorDetail: 'token_cap_exceeded',
    }
  }

  // Step 10: Create AbortController with 8s budget (RUNTIME-08)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TURN_TIMEOUT_MS)

  // Accumulated state across the LLM call
  const toolCallsLog: Json[] = []
  let finalText = ''
  let tokensIn = 0
  let tokensOut = 0
  let finalStatus: 'success' | 'error' | 'aborted' | 'skipped' = 'success'
  let errorDetail: string | undefined

  try {
    // Step 11: Belt-and-suspenders LLM call count check before calling generateText
    // (stopWhen: stepCountIs(N) handles the loop cap inside the SDK)
    const callCountCheck = checkLlmCallCount(0, resolvedAgent.fallbackMessage, orgId, resolvedAgentId)
    if (callCountCheck) {
      finalText = callCountCheck
      finalStatus = 'skipped'
      errorDetail = 'max_llm_calls_exceeded'
    } else {
      const serviceClient = createServiceRoleClient()

      // Get Anthropic API key — Phase 34 supports Anthropic only (ADOPT path)
      // OpenRouter path is deferred to Phase 35 (ai SDK @ai-sdk/openai)
      const anthropicKey = await getProviderKey('anthropic', orgId, serviceClient)
      if (!anthropicKey) {
        throw new Error('no_anthropic_key')
      }

      // Set ANTHROPIC_API_KEY for the @ai-sdk/anthropic provider
      // The provider reads this env var at model instantiation time
      // This is safe for server-only code (never runs in browser context)
      process.env.ANTHROPIC_API_KEY = anthropicKey

      // Pre-fetch the agent's attached tools to build the ToolSet
      const { data: agentToolRows } = await serviceClient
        .from('agent_tools')
        .select(`
          tool_configs!inner (
            tool_name,
            action_type,
            config
          )
        `)
        .eq('agent_id', resolvedAgentId)
        .eq('tool_configs.is_active', true)

      // Build ai@^6 ToolSet dynamically using dynamicTool()
      // dynamicTool accepts execute: ToolExecuteFunction<unknown, unknown> — no overload conflicts
      const toolSet: Record<string, ReturnType<typeof dynamicTool>> = {}

      for (const row of agentToolRows ?? []) {
        const tc = row.tool_configs as {
          tool_name: string
          action_type: string
          config: Json
        } | null
        if (!tc) continue

        const toolName = tc.tool_name
        const actionType = tc.action_type
        const toolConfigJson = tc.config

        // Use custom description from tool config JSON if provided
        const description =
          (typeof toolConfigJson === 'object' &&
            toolConfigJson !== null &&
            !Array.isArray(toolConfigJson) &&
            typeof (toolConfigJson as Record<string, unknown>).description === 'string'
            ? (toolConfigJson as Record<string, unknown>).description as string
            : null) ?? (ACTION_DESCRIPTIONS[actionType] ?? `Execute ${toolName}`)

        // Capture loop vars for closure
        const capturedToolName = toolName

        toolSet[capturedToolName] = dynamicTool({
          description,
          // Accept any JSON object as input — actual schema enforcement is by the LLM
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: 'object',
            additionalProperties: true,
          }),
          execute: async (args: unknown) => {
            const toolArgs = (args as Record<string, unknown>) ?? {}

            // D-34-14: Gate every tool call through resolveAgentTool
            const resolvedTool = await resolveAgentTool(resolvedAgentId, capturedToolName, channel)
            if (!resolvedTool) {
              // Denied — log and synthesize denial result (D-34-14)
              toolCallsLog.push({
                name: capturedToolName,
                args: JSON.parse(JSON.stringify(toolArgs)) as Json,
                denied: true,
                denied_reason: 'tool_not_attached_to_agent',
              })
              return 'Tool not available to this agent'
            }

            // Decrypt credentials if present
            let apiKey = ''
            let locationId = ''
            if (resolvedTool.credentialsEncrypted) {
              try {
                const { decrypt } = await import('@/lib/crypto')
                const decrypted = await decrypt(resolvedTool.credentialsEncrypted)
                const parsed = JSON.parse(decrypted) as Record<string, unknown>
                apiKey = (parsed.apiKey as string) ?? ''
                locationId = (parsed.locationId as string) ?? ''
              } catch {
                console.error(
                  JSON.stringify({
                    event: 'credential_decrypt_failed',
                    toolName: capturedToolName,
                    agentId: resolvedAgentId,
                    traceId,
                  })
                )
              }
            }

            // Execute the action via execute-action dispatcher
            let result = ''
            try {
              result = await executeAction(
                resolvedTool.actionType,
                toolArgs,
                { apiKey, locationId },
                {
                  organizationId: orgId,
                  supabase: serviceClient,
                  toolConfig: resolvedTool.config,
                  integrationProvider: resolvedTool.integrationProvider ?? undefined,
                }
              )
            } catch (err) {
              result = 'Tool execution failed'
              console.error(
                JSON.stringify({
                  event: 'tool_execute_failed',
                  toolName: capturedToolName,
                  agentId: resolvedAgentId,
                  traceId,
                  error: String(err),
                })
              )
            }

            // Log successful tool call
            toolCallsLog.push({
              name: capturedToolName,
              args: JSON.parse(JSON.stringify(toolArgs)) as Json,
              result,
              denied: false,
            })

            return result
          },
        })
      }

      // Build message array for the LLM
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...historyWindow.slice(-resolvedAgent.maxHistory),
        { role: 'user', content: userMessage },
      ]

      // Call LLM via ai@^6 generateText (ADOPT path — locked in 34-01-SUMMARY.md)
      // stopWhen: stepCountIs caps the LLM→tool→LLM loop at MAX_LLM_CALLS_PER_TURN
      const llmResult = await generateText({
        model: anthropic(resolvedAgent.model),
        system: systemPrompt,
        messages,
        tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
        stopWhen: stepCountIs(MAX_LLM_CALLS_PER_TURN),
        abortSignal: controller.signal,
        ...(resolvedAgent.temperature !== undefined
          ? { temperature: resolvedAgent.temperature }
          : {}),
        maxOutputTokens: resolvedAgent.maxTokens,
      })

      finalText = llmResult.text
      tokensIn = llmResult.usage.inputTokens ?? 0
      tokensOut = llmResult.usage.outputTokens ?? 0
    }
  } catch (err) {
    const error = err as Error
    if (error.name === 'AbortError') {
      // Timeout-triggered abort (RUNTIME-08)
      console.warn(
        JSON.stringify({
          event: 'agent_turn_aborted',
          agentId: resolvedAgentId,
          orgId,
          traceId,
          reason: 'timeout',
        })
      )
      finalStatus = 'aborted'
      errorDetail = 'turn_timeout'
    } else if (error.message === 'no_anthropic_key') {
      console.error(
        JSON.stringify({ event: 'no_anthropic_key', agentId: resolvedAgentId, orgId, traceId })
      )
      finalStatus = 'error'
      errorDetail = 'no_anthropic_key'
      finalText = resolvedAgent.fallbackMessage
    } else {
      console.error(
        JSON.stringify({
          event: 'runAgent_error',
          agentId: resolvedAgentId,
          orgId,
          traceId,
          error: String(err),
        })
      )
      finalStatus = 'error'
      errorDetail = String(err)
      finalText = resolvedAgent.fallbackMessage
    }
  } finally {
    clearTimeout(timeoutId)

    // Step 13: UPDATE invocation row with final state (D-34-03)
    await updateInvocationEnd({
      invocationId,
      agentId: resolvedAgentId,
      model: resolvedAgent.model,
      status: finalStatus,
      assistantReply: finalText,
      tokensIn,
      tokensOut,
      toolCallsJson: toolCallsLog,
      errorDetail,
      startedAt,
    })
  }

  // Step 14: Return AgentRunResult (D-34-02)
  return {
    text: finalText,
    usage: { tokensIn, tokensOut },
    invocationId,
    traceId,
    status: finalStatus,
    ...(errorDetail ? { errorDetail } : {}),
  }
}
