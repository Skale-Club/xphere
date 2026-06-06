// src/lib/agent-runtime/guardrails.ts
// All Phase 34 cost/safety caps. Each function is pure (or reads DB) | no side effects.
// run-agent.ts calls these at the appropriate points in the orchestration loop.
// RUNTIME-04, RUNTIME-05, RUNTIME-06, RUNTIME-07, RUNTIME-08, RUNTIME-09, GATE-03

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'
import type { AgentRunResult } from './types'

// ---------------------------------------------------------------------------
// Cap constants (read from env with documented defaults)
// ---------------------------------------------------------------------------

function getMaxDelegationDepth(): number {
  return parseInt(process.env.AGENT_MAX_DELEGATION_DEPTH ?? '2', 10)
}

function getMaxLlmCallsPerTurn(): number {
  return parseInt(process.env.AGENT_MAX_LLM_CALLS_PER_TURN ?? '6', 10)
}

function getMaxConvTokens(): number {
  return parseInt(process.env.AGENT_MAX_CONV_TOKENS ?? '200000', 10)
}

function getDefaultDailyCostCapUsd(): number {
  return parseFloat(process.env.AGENT_DAILY_COST_CAP_USD ?? '50.00')
}

// ---------------------------------------------------------------------------
// RUNTIME-09 / GATE-03: Kill switch
// ---------------------------------------------------------------------------
// Returns an AgentRunResult with status='skipped' if kill switch is active.
// Returns null if runtime is enabled (ok to proceed).
// Call this FIRST in runAgent(), before any DB writes or LLM calls.

export function checkKillSwitch(traceId: string): AgentRunResult | null {
  const enabled = process.env.AGENT_RUNTIME_ENABLED !== 'false'
  if (enabled) return null

  createLogger({ traceId }).warn('guardrail_tripped', { cap: 'kill_switch' })

  return {
    text: 'Service temporarily unavailable',
    usage: { tokensIn: 0, tokensOut: 0 },
    invocationId: '',
    traceId,
    status: 'skipped',
    errorDetail: 'AGENT_RUNTIME_ENABLED=false',
  }
}

// ---------------------------------------------------------------------------
// RUNTIME-04: Delegation depth guard (stub for Phase 38)
// ---------------------------------------------------------------------------
// Returns a synthetic denial string if depth has reached the cap.
// Returns null if depth is within limit.
// In Phase 34, _depth is always 0 (top-level). Phase 38 increments for recursive calls.

export function checkDelegationDepth(
  depth: number,
  orgId: string,
  agentId: string
): string | null {
  const cap = getMaxDelegationDepth()
  if (depth < cap) return null

  createLogger({ orgId, agentId }).warn('guardrail_tripped', { cap: 'delegation_depth', value: depth, limit: cap })

  return 'Delegation depth exceeded | answer from current agent'
}

// ---------------------------------------------------------------------------
// DELEG-06: Visited-set loop detection
// ---------------------------------------------------------------------------
// Returns a denial string if the agentId is already in the visited set (cycle detected).
// Returns null if the agent has not been invoked yet in this delegation chain.
// Complementary to checkDelegationDepth | visited-set catches A→B→A cycles even within budget.

export function checkVisitedSet(
  visitedAgentIds: Set<string>,
  agentId: string,
  orgId: string
): string | null {
  if (!visitedAgentIds.has(agentId)) return null

  createLogger({ orgId, agentId }).warn('guardrail_tripped', { cap: 'delegation_cycle', visitedSet: Array.from(visitedAgentIds) })

  return 'Cycle detected | answer from current agent'
}

// ---------------------------------------------------------------------------
// RUNTIME-05: LLM call count guard (MAX_LLM_CALLS_PER_TURN)
// ---------------------------------------------------------------------------
// Returns fallbackMessage if callCount has reached the cap.
// Returns null if within limit.
// run-agent.ts increments callCount each time it calls the LLM.

export function checkLlmCallCount(
  callCount: number,
  fallbackMessage: string,
  orgId: string,
  agentId: string
): string | null {
  const cap = getMaxLlmCallsPerTurn()
  if (callCount < cap) return null

  createLogger({ orgId, agentId }).warn('guardrail_tripped', { cap: 'max_llm_calls_per_turn', value: callCount, limit: cap })

  return fallbackMessage
}

// ---------------------------------------------------------------------------
// RUNTIME-06: Per-conversation token cap
// ---------------------------------------------------------------------------
// Returns a denial string if cumulativeTokens has reached the cap.
// Returns null if within limit.
// run-agent.ts passes the total tokens used across the conversation history.

export function checkTokenCap(
  cumulativeTokens: number,
  orgId: string,
  agentId: string
): string | null {
  const cap = getMaxConvTokens()
  if (cumulativeTokens < cap) return null

  createLogger({ orgId, agentId }).warn('guardrail_tripped', { cap: 'max_conv_tokens', value: cumulativeTokens, limit: cap })

  return 'conversation length exceeded | please start a new chat'
}

// ---------------------------------------------------------------------------
// RUNTIME-07: Per-org daily cost cap
// ---------------------------------------------------------------------------
// Async: reads organizations.daily_cost_cap_usd_override (per-org override, D-34-05)
// and sums cost_usd from agent_invocations last 24h.
// Returns a denial string if over cap; null if within limit.
// Call this AFTER inserting the invocation row (so the current invocation doesn't
// double-count | it hasn't been updated with cost yet).

export async function checkDailyCostCap(
  orgId: string,
  agentId: string
): Promise<string | null> {
  const supabase = createServiceRoleClient()

  // Fetch per-org override (may be null → use env default)
  const { data: org } = await supabase
    .from('organizations')
    .select('daily_cost_cap_usd_override')
    .eq('id', orgId)
    .single()

  const capUsd =
    (org?.daily_cost_cap_usd_override !== null && org?.daily_cost_cap_usd_override !== undefined)
      ? Number(org.daily_cost_cap_usd_override)
      : getDefaultDailyCostCapUsd()

  // Sum today's cost (last 24h) for this org | exclude playground runs (PLAY-04)
  const { data: costRow } = await supabase
    .from('agent_invocations')
    .select('cost_usd')
    .eq('organization_id', orgId)
    .eq('mode', 'production')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .not('cost_usd', 'is', null)

  const dailyTotal = (costRow ?? []).reduce(
    (sum, row) => sum + (Number(row.cost_usd) || 0),
    0
  )

  if (dailyTotal < capUsd) return null

  createLogger({ orgId, agentId }).warn('guardrail_tripped', { cap: 'daily_cost_cap_usd', value: dailyTotal, limit: capUsd })

  return 'Daily cost limit reached | service temporarily restricted'
}
