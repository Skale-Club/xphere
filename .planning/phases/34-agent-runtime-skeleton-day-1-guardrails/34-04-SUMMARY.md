---
phase: 34
plan: 04
subsystem: agent-runtime.guardrails
tags: [guardrails, kill-switch, cost-cap, rate-limiting, safety]
dependency-graph:
  requires: [34-01, 34-02]
  provides:
    - src/lib/agent-runtime/guardrails.ts (5 cap-check functions)
  affects:
    - Plan 34-05 (run-agent.ts imports all 5 guard functions)
    - Plan 34-06 (unit tests for each guard)
tech-stack:
  added: []
  patterns:
    - createServiceRoleClient() for async DB reads (no user session in runtime)
    - Structured JSON log on guardrail trip (console.warn → Vercel logs)
    - Null-return pattern (returns null on pass, denial payload on trip)
key-files:
  created:
    - src/lib/agent-runtime/guardrails.ts
  modified: []
---

# Plan 34-04 Summary — guardrails.ts (All 5 Cap Checks)

## What shipped

`src/lib/agent-runtime/guardrails.ts` — 201 lines, 5 exported functions:

### checkKillSwitch(traceId) → AgentRunResult | null (RUNTIME-09 / GATE-03)
Reads `AGENT_RUNTIME_ENABLED` env var. Returns `{ status: 'skipped', errorDetail: 'AGENT_RUNTIME_ENABLED=false' }` if disabled; null if enabled. Called FIRST in runAgent() before any DB writes.

### checkDelegationDepth(depth, orgId, agentId) → string | null (RUNTIME-04)
Phase 34 stub — always receives `depth=0` (top-level calls only). Returns synthetic message `'Delegation depth exceeded — answer from current agent'` when `depth >= AGENT_MAX_DELEGATION_DEPTH` (default 2). Phase 38 activates by passing `depth=ctx._depth+1` on recursive calls.

### checkLlmCallCount(callCount, fallbackMessage, orgId, agentId) → string | null (RUNTIME-05)
Trips when `callCount >= AGENT_MAX_LLM_CALLS_PER_TURN` (default 6). Returns `fallbackMessage` (agent's configured fallback). run-agent.ts increments callCount each LLM call.

### checkTokenCap(cumulativeTokens, orgId, agentId) → string | null (RUNTIME-06)
Trips when `cumulativeTokens >= AGENT_MAX_CONV_TOKENS` (default 200000). Returns static message `'conversation length exceeded — please start a new chat'`.

### checkDailyCostCap(orgId, agentId) → Promise<string | null> (RUNTIME-07)
Async. Reads `organizations.daily_cost_cap_usd_override` (nullable — falls back to `AGENT_DAILY_COST_CAP_USD`, default $50). Sums `cost_usd` from `agent_invocations` WHERE `created_at >= NOW() - INTERVAL 24h` for the org. Returns denial string if over cap.

## Env vars honored
- `AGENT_RUNTIME_ENABLED` (default: 'true')
- `AGENT_MAX_DELEGATION_DEPTH` (default: '2')
- `AGENT_MAX_LLM_CALLS_PER_TURN` (default: '6')
- `AGENT_MAX_CONV_TOKENS` (default: '200000')
- `AGENT_DAILY_COST_CAP_USD` (default: '50.00')

## Decisions honored
- D-34-08: kill switch is Phase 34 scope; rate-limiting is Vercel edge layer
- D-34-10: delegation depth guard is a stub (Phase 38 activates recursion)
- D-34-05: `daily_cost_cap_usd_override` nullable column read correctly (NULL → env default)

## Notes
Agent hit a socket disconnect after committing `guardrails.ts` (commit `e12225c`) but before writing this SUMMARY.md. SUMMARY written by orchestrator from direct file inspection. `npm run build` exits 0 post-merge.

## Requirements addressed
RUNTIME-04, RUNTIME-05, RUNTIME-06, RUNTIME-07, RUNTIME-08, RUNTIME-09, GATE-03
