// src/lib/flows/execute-agent-node.ts
// Shared executor for the workflow "Agent" flow node — used by both the async
// flow engine (engine.ts) and the synchronous executor (run-flow-sync.ts).
//
// Runs the real agent runtime (runAgent) with a server-initiated 'workflow'
// channel (stateless — no conversationId), passing the node's input as the
// user message, its system_prompt as extra instructions, and its max_steps as
// the per-call LLM step cap.

import { runAgent } from '@/lib/agent-runtime/run-agent'

export interface ExecuteAgentNodeArgs {
  orgId: string
  /** Optional — runtime falls back to the org's default agent when absent. */
  agentId?: string
  /** Already-interpolated message/objective for the agent. */
  userMessage: string
  /** Node-level extra instructions (system_prompt field). */
  instructions?: string
  /** Per-call LLM step cap (1–50). */
  maxSteps?: number
}

export async function executeAgentNode(
  args: ExecuteAgentNodeArgs,
): Promise<Record<string, unknown>> {
  const userMessage = args.userMessage?.trim()
    ? args.userMessage
    : 'Process this workflow step with the available context.'

  const result = await runAgent({
    orgId: args.orgId,
    agentId: args.agentId || undefined,
    channel: 'workflow',
    userMessage,
    extraInstructions: args.instructions,
    maxSteps: args.maxSteps,
    conversationId: undefined, // workflow context is stateless
    stream: false,
  })

  return {
    agent_response: result.text,
    status: result.status,
    invocation_id: result.invocationId,
    trace_id: result.traceId,
    tokens_in: result.usage.tokensIn,
    tokens_out: result.usage.tokensOut,
    error: result.errorDetail ?? null,
  }
}
