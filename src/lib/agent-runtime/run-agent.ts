// src/lib/agent-runtime/run-agent.ts
// Core orchestration loop for agent invocations.
// D-34-02: returns Promise<AgentRunResult> (plain object, NOT stream) for blocking path.
// D-35-01/D-35-09: returns ReadableStream<Uint8Array> (SSE-formatted) when opts.stream = true.
// D-34-09: wired into web widget route.ts in Phase 35 (CHAN-03).
//
// LLM call pattern: ADOPT ai@^6
// Blocking path: generateText from 'ai' + @ai-sdk/anthropic (locked in 34-01-SUMMARY.md)
// Streaming path: streamText from 'ai' + @ai-sdk/anthropic (locked in D-35-09)

import { generateText, streamText, dynamicTool, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { jsonSchema } from 'ai'
import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { queryKnowledge } from '@/lib/knowledge/query-knowledge'
import { executeAction } from '@/lib/action-engine/execute-action'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { createEncoder } from '@/lib/chat/stream/encoder'
import { persistMessage } from '@/lib/chat/persist'
import {
  checkKillSwitch,
  checkDelegationDepth,
  checkVisitedSet,
  checkLlmCallCount,
  checkTokenCap,
  checkDailyCostCap,
} from './guardrails'
import { resolveAgent } from './resolve-agent'
import { resolveAgentTool } from './resolve-agent-tool'
import {
  buildWorkflowTools,
  buildWorkflowSystemPromptSuffix,
} from './build-workflow-tools'
import { insertInvocationStart, updateInvocationEnd } from './invocations'
import {
  deriveIdempotencyKey,
  requiresIdempotency,
  checkIdempotency,
  recordIdempotency,
  hashToolArgs,
} from './idempotency'
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
  send_whatsapp_message: 'Send a WhatsApp message via Evolution Go',
  send_whatsapp_mention_all: 'Send a WhatsApp group message that mentions every participant',
}

// ---------------------------------------------------------------------------
// Handoff payload schema validation (DELEG-04, DELEG-05)
// ---------------------------------------------------------------------------
// Recursively scans all keys in the handoff payload and rejects any that match
// the forbidden pattern ^role$|^system$|^instructions?$ to prevent prompt injection
// across agent boundaries.

const FORBIDDEN_HANDOFF_KEYS_RE = /^role$|^system$|^instructions?$/

function validateHandoffKeys(obj: Record<string, unknown>, path = ''): string | null {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_HANDOFF_KEYS_RE.test(key)) {
      return `forbidden key "${key}" at ${path || 'root'} | prompt injection blocked`
    }
    const value = obj[key]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = validateHandoffKeys(value as Record<string, unknown>, `${path}.${key}`)
      if (nested) return nested
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// buildPartnerTools | inject call_partner_<slug> synthetic tools (DELEG-02, DELEG-03)
// ---------------------------------------------------------------------------
// Queries agent_partners for the current agentId, fetches partner slug+name,
// and returns dynamicTool entries that recursively invoke runAgentBlocking().
// Called from both runAgentBlocking and runAgentStreaming.

async function buildPartnerTools(params: {
  agentId: string
  orgId: string
  channel: import('./types').AgentChannel
  _depth: number
  visitedAgentIds: Set<string>
  delegationChain: string[]
  parentInvocationId: string
  traceId: string
  serviceClient: ReturnType<typeof createServiceRoleClient>
  emit?: (obj: object) => void
}): Promise<Record<string, ReturnType<typeof dynamicTool>>> {
  const {
    agentId, orgId, channel, _depth, visitedAgentIds, delegationChain,
    parentInvocationId, traceId, serviceClient, emit,
  } = params

  // Fetch partner rows with partner agent slug + name
  const { data: partners } = await serviceClient
    .from('agent_partners')
    .select(`
      invocation_description,
      partner_agent:agents!agent_partners_partner_agent_id_fkey (
        id,
        slug,
        name
      )
    `)
    .eq('agent_id', agentId)

  if (!partners || partners.length === 0) return {}

  const partnerTools: Record<string, ReturnType<typeof dynamicTool>> = {}

  for (const partner of partners) {
    const partnerAgent = partner.partner_agent as { id: string; slug: string; name: string } | null
    if (!partnerAgent) continue

    const toolName = `call_partner_${partnerAgent.slug}`
    const capturedPartner = { ...partnerAgent }
    const capturedDescription = partner.invocation_description

    partnerTools[toolName] = dynamicTool({
      description: capturedDescription,
      inputSchema: jsonSchema<Record<string, unknown>>({
        type: 'object',
        additionalProperties: true,
        description: 'Structured handoff payload: { from_agent, intent, extracted_params, summary, recent_messages }',
      }),
      execute: async (args: unknown) => {
        const handoffArgs = (args as Record<string, unknown>) ?? {}

        // DELEG-05: Validate handoff payload | reject forbidden keys
        const validationError = validateHandoffKeys(handoffArgs)
        if (validationError) {
          console.warn(JSON.stringify({
            event: 'delegation_handoff_rejected',
            reason: validationError,
            partnerSlug: capturedPartner.slug,
            traceId,
          }))
          return `Delegation blocked: ${validationError}`
        }

        // DELEG-06: Visited-set check BEFORE recursing
        const cycleCheck = checkVisitedSet(visitedAgentIds, capturedPartner.id, orgId)
        if (cycleCheck) return cycleCheck

        // RUNTIME-04: Depth check
        const depthDenial = checkDelegationDepth(_depth + 1, orgId, capturedPartner.id)
        if (depthDenial) return depthDenial

        const updatedVisited = new Set([...visitedAgentIds, agentId])
        const updatedChain = [...delegationChain, agentId]

        // Build userMessage from validated handoff (DELEG-04: structured, not raw history)
        const handoffMessage = JSON.stringify({
          _delegation_handoff: true,
          from_agent: (handoffArgs.from_agent as string) ?? 'unknown',
          intent: (handoffArgs.intent as string) ?? '',
          extracted_params: (handoffArgs.extracted_params as Record<string, unknown>) ?? {},
          summary: (handoffArgs.summary as string) ?? '',
          recent_messages: ((handoffArgs.recent_messages as Array<{ role: string; content: string }>) ?? []).slice(-3),
        })

        // Emit partner_start SSE event (streaming path only | DELEG-08)
        if (emit) {
          emit({ event: 'partner_start', partnerName: capturedPartner.name, description: capturedDescription })
        }

        // DELEG-03: Recursive invocation | always blocking (partner returns a string result)
        let partnerReply = ''
        try {
          const partnerResult = await runAgentBlocking({
            orgId,
            agentId: capturedPartner.id,
            channel,
            userMessage: handoffMessage,
            mode: 'production',
            _depth: _depth + 1,
            parentInvocationId,
            _visitedAgentIds: updatedVisited,
            _delegationChain: updatedChain,
          })
          partnerReply = partnerResult.text || partnerResult.errorDetail || 'Partner did not respond'
        } catch (err) {
          partnerReply = 'Partner agent invocation failed'
          console.error(JSON.stringify({ event: 'partner_invocation_failed', partnerSlug: capturedPartner.slug, error: String(err), traceId }))
        }

        // Emit partner_done SSE event (streaming path only | DELEG-08)
        if (emit) {
          emit({ event: 'partner_done', partnerName: capturedPartner.name })
        }

        return partnerReply
      },
    })
  }

  return partnerTools
}

// ---------------------------------------------------------------------------
// runAgent | function overloads (D-35-01)
// ---------------------------------------------------------------------------

export function runAgent(opts: AgentRunOptions & { stream: true }): ReadableStream<Uint8Array>
export function runAgent(opts: AgentRunOptions & { stream?: false }): Promise<AgentRunResult>
export function runAgent(opts: AgentRunOptions): ReadableStream<Uint8Array> | Promise<AgentRunResult>
export function runAgent(opts: AgentRunOptions): ReadableStream<Uint8Array> | Promise<AgentRunResult> {
  // Streaming path dispatch (D-35-09) | returns synchronously
  if (opts.stream) {
    return runAgentStreaming(opts)
  }
  // Blocking path | returns Promise<AgentRunResult>
  return runAgentBlocking(opts)
}

// ---------------------------------------------------------------------------
// runAgentBlocking | blocking path (generateText) | Phase 34, unchanged
// ---------------------------------------------------------------------------

async function runAgentBlocking(opts: AgentRunOptions): Promise<AgentRunResult> {
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
    _visitedAgentIds,
    _delegationChain,
  } = opts

  // Phase 38: Initialize visited set and delegation chain (DELEG-06, DELEG-07)
  const visitedAgentIds = _visitedAgentIds ?? new Set<string>()
  const delegationChain = _delegationChain ?? []

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

  // Step 2: Kill switch check | before any DB writes or LLM calls (GATE-03 / RUNTIME-09)
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

  // Step 4: is_active check (D-34-13) | denied, no invocation row
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

  // Step 5: allowed_channels check (D-34-12) | denied, no invocation row.
  // The 'workflow' channel is server-initiated (a flow agent node), not a public
  // channel — bypass the gate so any active agent can run inside a workflow
  // without the operator having to opt the agent into a channel.
  if (channel !== 'workflow' && !resolvedAgent.allowedChannels.includes(channel)) {
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

  // Step 6: Delegation depth check (D-34-10 | Phase 38 activates recursion)
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

  // Step 6b: Visited-set loop detection (DELEG-06 | Phase 38)
  const visitedDenial = checkVisitedSet(visitedAgentIds, resolvedAgentId, orgId)
  if (visitedDenial) {
    return {
      text: visitedDenial,
      usage: { tokensIn: 0, tokensOut: 0 },
      invocationId: '',
      traceId,
      status: 'denied',
      errorDetail: 'delegation_cycle',
    }
  }
  // Add current agent to visited set and chain before proceeding
  visitedAgentIds.add(resolvedAgentId)
  const currentChain = [...delegationChain, resolvedAgentId]

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

  // Step 7b: KB injection | ALWAYS query knowledge (null kbScope = full org KB, matching legacy stream.ts)
  // D-35-02: unconditional call before LLM | kbScope field preserved on ResolvedAgent for future Phase 37 use
  let systemPrompt = resolvedAgent.systemPrompt
  const FALLBACK_KB_RESPONSE = "I don't have information about that in my knowledge base."
  try {
    const kbClient = createServiceRoleClient()
    const kbContext = await queryKnowledge(userMessage, orgId, kbClient)
    if (kbContext && kbContext !== FALLBACK_KB_RESPONSE) {
      systemPrompt = `${systemPrompt}\n\nRelevant knowledge base content:\n${kbContext}`
    }
    // Per-invocation extra instructions (workflow agent node passes its own prompt).
    if (opts.extraInstructions?.trim()) {
      systemPrompt = `${systemPrompt}\n\n${opts.extraInstructions.trim()}`
    }
  } catch {
    // KB failure is non-fatal | continue without context (matches stream.ts behavior)
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

  // Step 9: Token cap check | estimate history tokens (RUNTIME-06)
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

      // Get Anthropic API key | Phase 34 supports Anthropic only (ADOPT path)
      // OpenRouter path is deferred to Phase 35 (ai SDK @ai-sdk/openai)
      // Resolution: org key → platform key (managed by super admin at /admin/settings)
      let anthropicKey = await getProviderKey('anthropic', orgId, serviceClient)
      if (!anthropicKey) {
        const { getPlatformSetting } = await import('@/lib/platform-settings')
        anthropicKey = await getPlatformSetting('ANTHROPIC_API_KEY')
      }
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
          _legacy_tool_configs!inner (
            tool_name,
            action_type,
            config
          )
        `)
        .eq('agent_id', resolvedAgentId)
        .eq('_legacy_tool_configs.is_active', true)

      // Build ai@^6 ToolSet dynamically using dynamicTool()
      // dynamicTool accepts execute: ToolExecuteFunction<unknown, unknown> | no overload conflicts
      const toolSet: Record<string, ReturnType<typeof dynamicTool>> = {}

      // Phase 38 IDEMP-03: tool call index counter (incremented per tool call for idempotency key)
      let toolCallIndex = 0

      for (const row of agentToolRows ?? []) {
        const tc = (row as Record<string, unknown>)._legacy_tool_configs as {
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
        const capturedActionType = actionType

        toolSet[capturedToolName] = dynamicTool({
          description,
          // Accept any JSON object as input | actual schema enforcement is by the LLM
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: 'object',
            additionalProperties: true,
          }),
          execute: async (args: unknown) => {
            const toolArgs = (args as Record<string, unknown>) ?? {}
            const currentToolCallIndex = toolCallIndex++

            // D-34-14: Gate every tool call through resolveAgentTool
            const resolvedTool = await resolveAgentTool(resolvedAgentId, capturedToolName, channel)
            if (!resolvedTool) {
              // Denied | log and synthesize denial result (D-34-14)
              toolCallsLog.push({
                name: capturedToolName,
                args: JSON.parse(JSON.stringify(toolArgs)) as Json,
                denied: true,
                denied_reason: 'tool_not_attached_to_agent',
              })
              return 'Tool not available to this agent'
            }

            // DELEG-07: Intersection authorization | verify ALL agents in delegation chain
            // have this tool attached before allowing execution
            if (currentChain.length > 1) {
              for (const chainAgentId of currentChain.slice(0, -1)) {
                const chainToolCheck = await resolveAgentTool(chainAgentId, capturedToolName, channel)
                if (!chainToolCheck) {
                  const denialEntry = {
                    name: capturedToolName,
                    args: JSON.parse(JSON.stringify(toolArgs)) as Json,
                    denied: true,
                    denied_reason: 'intersection_excludes_tool',
                    chain: currentChain,
                    blocking_agent: chainAgentId,
                  }
                  toolCallsLog.push(denialEntry)
                  console.warn(JSON.stringify({
                    event: 'intersection_authz_denied',
                    tool: capturedToolName,
                    chainAgentId,
                    chain: currentChain,
                    traceId,
                  }))
                  return `Tool execution denied: delegation chain agent ${chainAgentId} does not have permission for ${capturedToolName}`
                }
              }
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

            // IDEMP-02/03: Idempotency check for side-effecting tools
            const idempotencyNeeded = requiresIdempotency(capturedActionType, resolvedTool.config)
            let idempotencyKey = ''

            if (idempotencyNeeded && invocationId && invocationId !== 'insert-failed') {
              idempotencyKey = deriveIdempotencyKey(invocationId, currentToolCallIndex)
              const cachedResponse = await checkIdempotency(orgId, idempotencyKey)
              if (cachedResponse !== null) {
                // Cache hit | return without re-executing
                toolCallsLog.push({
                  name: capturedToolName,
                  args: JSON.parse(JSON.stringify(toolArgs)) as Json,
                  result: cachedResponse,
                  denied: false,
                  idempotency_cache_hit: true,
                  tool_call_index: currentToolCallIndex,
                })
                return cachedResponse
              }
            }

            // Execute the action via execute-action dispatcher
            let result = ''
            try {
              result = await executeAction(
                // Legacy tool_config path | actionType is always a real
                // action_type, never the synthetic 'run_flow' used for
                // workflow-sourced tools (those are handled by
                // build-workflow-tools.ts and never enter this branch).
                resolvedTool.actionType as Exclude<typeof resolvedTool.actionType, 'run_flow'>,
                toolArgs,
                { apiKey, locationId },
                {
                  organizationId: orgId,
                  supabase: serviceClient,
                  toolConfig: resolvedTool.config,
                  integrationProvider: resolvedTool.integrationProvider ?? undefined,
                  delegationChain: currentChain,
                }
              )
              // Persist idempotency record after successful execution
              if (idempotencyNeeded && idempotencyKey && invocationId && invocationId !== 'insert-failed') {
                await recordIdempotency({
                  organizationId: orgId,
                  agentInvocationId: invocationId,
                  idempotencyKey,
                  toolName: capturedToolName,
                  requestHash: hashToolArgs(toolArgs),
                  response: result,
                })
              }
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
              tool_call_index: currentToolCallIndex,
            })

            return result
          },
        })
      }

      // SEED-033: workflow tools (kind='tool' or kind='flow') attached via
      // agent_tools.workflow_id. Injected alongside legacy tool_configs.
      const workflowToolsResult = await buildWorkflowTools({
        agentId: resolvedAgentId,
        orgId,
        channel,
        currentChain,
        invocationId,
        traceId,
        conversationId,
        serviceClient,
        toolCallsLog,
        getNextToolCallIndex: () => toolCallIndex++,
      })
      Object.assign(toolSet, workflowToolsResult.toolSet)

      // Append "## Available Workflows" block to the system prompt only when
      // there is at least one workflow tool to mention.
      if (workflowToolsResult.summaries.length > 0) {
        systemPrompt = `${systemPrompt}${buildWorkflowSystemPromptSuffix(workflowToolsResult.summaries)}`
      }

      // DELEG-02: Inject synthetic partner tools for each configured partner agent
      const partnerTools = await buildPartnerTools({
        agentId: resolvedAgentId,
        orgId,
        channel,
        _depth,
        visitedAgentIds,
        delegationChain: currentChain,
        parentInvocationId: invocationId,
        traceId,
        serviceClient,
        // No emit in blocking path | SSE events only in streaming path
      })
      Object.assign(toolSet, partnerTools)

      // Build message array for the LLM
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...historyWindow.slice(-resolvedAgent.maxHistory),
        { role: 'user', content: userMessage },
      ]

      // Call LLM via ai@^6 generateText (ADOPT path | locked in 34-01-SUMMARY.md)
      // stopWhen: stepCountIs caps the LLM→tool→LLM loop at MAX_LLM_CALLS_PER_TURN
      const llmResult = await generateText({
        model: anthropic(resolvedAgent.model),
        system: systemPrompt,
        messages,
        tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
        stopWhen: stepCountIs(
          opts.maxSteps ? Math.min(50, Math.max(1, opts.maxSteps)) : MAX_LLM_CALLS_PER_TURN,
        ),
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

// ---------------------------------------------------------------------------
// runAgentStreaming | streaming path (D-35-01, D-35-09)
// Returns a ReadableStream<Uint8Array> that emits SSE-formatted JSON lines.
// All async agent resolution happens INSIDE the ReadableStream.start() callback
// so the function returns synchronously as required by D-35-01.
// ---------------------------------------------------------------------------

function runAgentStreaming(
  opts: AgentRunOptions,
): ReadableStream<Uint8Array> {
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
    _visitedAgentIds,
    _delegationChain,
  } = opts

  // Phase 38: Initialize visited set and delegation chain (DELEG-06, DELEG-07)
  const visitedAgentIds = _visitedAgentIds ?? new Set<string>()
  const delegationChain = _delegationChain ?? []

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encode = createEncoder()
      const emit = (obj: object) => controller.enqueue(encode(obj))

      // GATE-01: session event MUST be first
      emit({ event: 'session', sessionId })

      const traceId = crypto.randomUUID()
      const startedAt = Date.now()

      let accumulatedText = ''
      let finalStatus: 'success' | 'error' | 'aborted' | 'skipped' = 'success'
      let tokensIn = 0
      let tokensOut = 0
      let errorDetail: string | undefined
      const toolCallsLog: Json[] = []
      let invocationId = ''
      let capturedModel = 'unknown'
      let finalResolvedAgentId = opts.agentId ?? ''

      try {
        // Resolve agentId from agent_channel_defaults when not explicitly provided (D-35-06)
        let resolvedAgentId = opts.agentId
        if (!resolvedAgentId) {
          const defaultClient = createServiceRoleClient()
          const { data: defaultRow } = await defaultClient
            .from('agent_channel_defaults')
            .select('agent_id')
            .eq('organization_id', orgId)
            .eq('channel', channel)
            .single()

          resolvedAgentId = defaultRow?.agent_id ?? undefined
          if (!resolvedAgentId) {
            console.error(
              JSON.stringify({ event: 'no_agent_for_channel', orgId, channel })
            )
            emit({ event: 'token', text: "I'm unable to process your request right now." })
            emit({ event: 'done' })
            controller.close()
            return
          }
        }

        // Capture for use in after() block outside this try scope
        finalResolvedAgentId = resolvedAgentId

        // Kill switch check
        const killSwitchResult = checkKillSwitch(traceId)
        if (killSwitchResult) {
          emit({ event: 'token', text: killSwitchResult.text })
          emit({ event: 'done' })
          controller.close()
          return
        }

        // Resolve agent + channel overrides
        const resolvedAgent = await resolveAgent(resolvedAgentId, orgId, channel)
        if (!resolvedAgent || !resolvedAgent.isActive) {
          const fallback = resolvedAgent?.fallbackMessage ?? "I'm unable to process your request right now."
          emit({ event: 'token', text: fallback })
          emit({ event: 'done' })
          controller.close()
          return
        }

        capturedModel = resolvedAgent.model

        // allowed_channels check
        if (!resolvedAgent.allowedChannels.includes(channel)) {
          emit({ event: 'token', text: resolvedAgent.fallbackMessage })
          emit({ event: 'done' })
          controller.close()
          return
        }

        // Daily cost cap check
        const costCapDenial = await checkDailyCostCap(orgId, resolvedAgentId)
        if (costCapDenial) {
          emit({ event: 'token', text: costCapDenial })
          emit({ event: 'done' })
          controller.close()
          return
        }

        // Phase 38 DELEG-06: Visited-set loop detection
        const visitedDenialStream = checkVisitedSet(visitedAgentIds, resolvedAgentId, orgId)
        if (visitedDenialStream) {
          emit({ event: 'token', text: visitedDenialStream })
          emit({ event: 'done' })
          controller.close()
          return
        }
        // Add current agent to visited set and chain
        visitedAgentIds.add(resolvedAgentId)
        const currentChain = [...delegationChain, resolvedAgentId]

        // KB injection | UNCONDITIONAL (GATE-01: matches legacy stream.ts behavior)
        let systemPrompt = resolvedAgent.systemPrompt
        const FALLBACK_KB_RESPONSE = "I don't have information about that in my knowledge base."
        try {
          const kbClient = createServiceRoleClient()
          const kbContext = await queryKnowledge(userMessage, orgId, kbClient)
          if (kbContext && kbContext !== FALLBACK_KB_RESPONSE) {
            systemPrompt = `${systemPrompt}\n\nRelevant knowledge base content:\n${kbContext}`
          }
        } catch {
          // KB failure non-fatal
        }

        // Update conversation with agent_id (D-35-05 | new conversations need agent association)
        if (conversationId) {
          const convClient = createServiceRoleClient()
          await convClient
            .from('conversations')
            .update({ agent_id: resolvedAgentId })
            .eq('id', conversationId)
        }

        // Token cap estimate
        const cumulativeHistoryTokens = Math.ceil(JSON.stringify(historyWindow).length / 4)
        const tokenCapDenial = checkTokenCap(cumulativeHistoryTokens, orgId, resolvedAgentId)
        if (tokenCapDenial) {
          emit({ event: 'token', text: tokenCapDenial })
          emit({ event: 'done' })
          controller.close()
          finalStatus = 'skipped'
          errorDetail = 'token_cap_exceeded'
          // invocationId is '' | no row written for early guards
          return
        }

        // INSERT invocation row
        invocationId = await insertInvocationStart({
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

        // AbortController (RUNTIME-08)
        const abortController = new AbortController()
        const timeoutId = setTimeout(() => abortController.abort(), AGENT_TURN_TIMEOUT_MS)

        try {
          // Build Anthropic API key | org first, platform fallback
          const serviceClient = createServiceRoleClient()
          let anthropicKey = await getProviderKey('anthropic', orgId, serviceClient)
          if (!anthropicKey) {
            const { getPlatformSetting } = await import('@/lib/platform-settings')
            anthropicKey = await getPlatformSetting('ANTHROPIC_API_KEY', serviceClient)
          }
          if (!anthropicKey) throw new Error('no_anthropic_key')
          process.env.ANTHROPIC_API_KEY = anthropicKey

          // Pre-fetch agent tools
          const { data: agentToolRows } = await serviceClient
            .from('agent_tools')
            .select(`_legacy_tool_configs!inner (tool_name, action_type, config)`)
            .eq('agent_id', resolvedAgentId)
            .eq('_legacy_tool_configs.is_active', true)

          // DELEG-08: Check delegation_visibility for this org before building partner tools
          const { data: orgVisRow } = await serviceClient
            .from('organizations')
            .select('delegation_visibility')
            .eq('id', orgId)
            .single()
          const delegationVisible = (orgVisRow?.delegation_visibility ?? 'visible') === 'visible'

          // Build ToolSet (same logic as blocking path)
          const toolSet: Record<string, ReturnType<typeof dynamicTool>> = {}

          // Phase 38 IDEMP-03: tool call index counter
          let toolCallIndex = 0

          for (const row of agentToolRows ?? []) {
            const tc = (row as Record<string, unknown>)._legacy_tool_configs as { tool_name: string; action_type: string; config: Json } | null
            if (!tc) continue
            const toolName = tc.tool_name
            const actionType = tc.action_type
            const toolConfigJson = tc.config
            const description =
              (typeof toolConfigJson === 'object' && toolConfigJson !== null && !Array.isArray(toolConfigJson) &&
               typeof (toolConfigJson as Record<string, unknown>).description === 'string'
                ? (toolConfigJson as Record<string, unknown>).description as string
                : null) ?? (ACTION_DESCRIPTIONS[actionType] ?? `Execute ${toolName}`)
            const capturedToolName = toolName
            const capturedActionType = actionType

            toolSet[capturedToolName] = dynamicTool({
              description,
              inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object', additionalProperties: true }),
              execute: async (args: unknown) => {
                const toolArgs = (args as Record<string, unknown>) ?? {}
                const currentToolCallIndex = toolCallIndex++
                const resolvedTool = await resolveAgentTool(resolvedAgentId!, capturedToolName, channel)
                if (!resolvedTool) {
                  toolCallsLog.push({ name: capturedToolName, args: JSON.parse(JSON.stringify(toolArgs)) as Json, denied: true, denied_reason: 'tool_not_attached_to_agent' })
                  return 'Tool not available to this agent'
                }
                // DELEG-07: Intersection authorization
                if (currentChain.length > 1) {
                  for (const chainAgentId of currentChain.slice(0, -1)) {
                    const chainToolCheck = await resolveAgentTool(chainAgentId, capturedToolName, channel)
                    if (!chainToolCheck) {
                      toolCallsLog.push({ name: capturedToolName, args: JSON.parse(JSON.stringify(toolArgs)) as Json, denied: true, denied_reason: 'intersection_excludes_tool', chain: currentChain, blocking_agent: chainAgentId })
                      console.warn(JSON.stringify({ event: 'intersection_authz_denied', tool: capturedToolName, chainAgentId, chain: currentChain }))
                      return `Tool execution denied: delegation chain agent ${chainAgentId} does not have permission for ${capturedToolName}`
                    }
                  }
                }
                let apiKey = ''
                let locationId = ''
                if (resolvedTool.credentialsEncrypted) {
                  try {
                    const { decrypt } = await import('@/lib/crypto')
                    const decrypted = await decrypt(resolvedTool.credentialsEncrypted)
                    const parsed = JSON.parse(decrypted) as Record<string, unknown>
                    apiKey = (parsed.apiKey as string) ?? ''
                    locationId = (parsed.locationId as string) ?? ''
                  } catch { /* credential decrypt failed */ }
                }
                // IDEMP-02/03: Idempotency check for side-effecting tools
                const idempotencyNeededStream = requiresIdempotency(capturedActionType, resolvedTool.config)
                let idempotencyKeyStream = ''
                if (idempotencyNeededStream && invocationId && invocationId !== 'insert-failed') {
                  idempotencyKeyStream = deriveIdempotencyKey(invocationId, currentToolCallIndex)
                  const cachedResponse = await checkIdempotency(orgId, idempotencyKeyStream)
                  if (cachedResponse !== null) {
                    toolCallsLog.push({ name: capturedToolName, args: JSON.parse(JSON.stringify(toolArgs)) as Json, result: cachedResponse, denied: false, idempotency_cache_hit: true, tool_call_index: currentToolCallIndex })
                    return cachedResponse
                  }
                }
                let result = ''
                try {
                  result = await executeAction(
                    // SEED-033: legacy tool_config path only; 'run_flow' is
                    // handled separately in build-workflow-tools.ts.
                    resolvedTool.actionType as Exclude<typeof resolvedTool.actionType, 'run_flow'>,
                    toolArgs,
                    { apiKey, locationId },
                    { organizationId: orgId, supabase: serviceClient, toolConfig: resolvedTool.config, integrationProvider: resolvedTool.integrationProvider ?? undefined, delegationChain: currentChain },
                  )
                  if (idempotencyNeededStream && idempotencyKeyStream && invocationId && invocationId !== 'insert-failed') {
                    await recordIdempotency({ organizationId: orgId, agentInvocationId: invocationId, idempotencyKey: idempotencyKeyStream, toolName: capturedToolName, requestHash: hashToolArgs(toolArgs), response: result })
                  }
                } catch { result = 'Tool execution failed' }
                toolCallsLog.push({ name: capturedToolName, args: JSON.parse(JSON.stringify(toolArgs)) as Json, result, denied: false, tool_call_index: currentToolCallIndex })
                return result
              },
            })
          }

          // SEED-033: workflow tools (kind='tool' or kind='flow') attached
          // via agent_tools.workflow_id, same as the blocking path.
          const workflowToolsStream = await buildWorkflowTools({
            agentId: resolvedAgentId!,
            orgId,
            channel,
            currentChain,
            invocationId,
            traceId,
            conversationId,
            serviceClient,
            toolCallsLog,
            getNextToolCallIndex: () => toolCallIndex++,
          })
          Object.assign(toolSet, workflowToolsStream.toolSet)
          if (workflowToolsStream.summaries.length > 0) {
            systemPrompt = `${systemPrompt}${buildWorkflowSystemPromptSuffix(workflowToolsStream.summaries)}`
          }

          // DELEG-02: Inject synthetic partner tools for each configured partner agent
          const partnerToolsStream = await buildPartnerTools({
            agentId: resolvedAgentId!,
            orgId,
            channel,
            _depth,
            visitedAgentIds,
            delegationChain: currentChain,
            parentInvocationId: invocationId,
            traceId,
            serviceClient,
            emit: delegationVisible ? emit : undefined,
          })
          Object.assign(toolSet, partnerToolsStream)

          // Build messages
          const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
            ...historyWindow.slice(-resolvedAgent.maxHistory),
            { role: 'user', content: userMessage },
          ]

          // Call LLM via streamText (D-35-09 | DO NOT await streamText)
          const result = streamText({
            model: anthropic(resolvedAgent.model),
            system: systemPrompt,
            messages,
            tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
            stopWhen: stepCountIs(MAX_LLM_CALLS_PER_TURN),
            abortSignal: abortController.signal,
            ...(resolvedAgent.temperature !== undefined ? { temperature: resolvedAgent.temperature } : {}),
            maxOutputTokens: resolvedAgent.maxTokens,
            onFinish: (event) => {
              tokensIn = event.totalUsage?.inputTokens ?? 0
              tokensOut = event.totalUsage?.outputTokens ?? 0
            },
          })

          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              emit({ event: 'token', text: part.text })
              accumulatedText += part.text
            } else if (part.type === 'tool-input-start') {
              emit({ event: 'tool_call', name: part.toolName })
            } else if (part.type === 'error') {
              finalStatus = 'error'
              errorDetail = String(part.error)
            }
          }

        } catch (err) {
          const error = err as Error
          if (error.name === 'AbortError') {
            finalStatus = 'aborted'
            errorDetail = 'turn_timeout'
          } else if (error.message === 'no_anthropic_key') {
            finalStatus = 'error'
            errorDetail = 'no_anthropic_key'
            accumulatedText = resolvedAgent.fallbackMessage
            emit({ event: 'token', text: resolvedAgent.fallbackMessage })
          } else {
            finalStatus = 'error'
            errorDetail = String(err)
            accumulatedText = resolvedAgent.fallbackMessage
            emit({ event: 'token', text: resolvedAgent.fallbackMessage })
          }
        } finally {
          clearTimeout(timeoutId)
        }

        emit({ event: 'done' })

      } catch (err) {
        emit({ event: 'token', text: "An error occurred. Please try again." })
        emit({ event: 'done' })
        finalStatus = 'error'
        errorDetail = String(err)
      } finally {
        controller.close()

        // Post-stream side effects via after() (D-35-03)
        after(async () => {
          try {
            if (conversationId && accumulatedText) {
              await persistMessage({
                dbSessionId: conversationId,
                orgId,
                role: 'assistant',
                content: accumulatedText,
                metadata: {
                  agent_id: finalResolvedAgentId || undefined,
                  invocation_id: invocationId || undefined,
                },
              })
            }
            if (invocationId && invocationId !== '') {
              await updateInvocationEnd({
                invocationId,
                agentId: finalResolvedAgentId,
                model: capturedModel,
                status: finalStatus,
                assistantReply: accumulatedText,
                tokensIn,
                tokensOut,
                toolCallsJson: toolCallsLog,
                errorDetail,
                startedAt,
              })
            }
          } catch (err) {
            console.error('[runAgent/stream] post-stream persist failed:', err)
          }
        })
      }
    },
  })
}
