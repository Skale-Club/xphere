---
phase: 40-agent-observability-dashboard
plan: 40-01
subsystem: observability
tags: [supabase, server-actions, agent-invocations, typescript]

requires:
  - phase: 34
    provides: agent_invocations table with cost_usd, duration_ms, tool_calls, conversation_id
provides:
  - src/lib/agent-runtime/observability.ts with 5 exported server actions
  - Extended persistMessage() with optional metadata parameter
  - runAgentStreaming() passes agent_id + invocation_id in assistant message metadata

affects: [phase-40-02, phase-40-03, phase-40-04, phase-40-05]

tech-stack:
  added: []
  patterns: [server-actions, RLS-scoped queries, tree-building from flat parent_id rows]

key-files:
  created: [src/lib/agent-runtime/observability.ts]
  modified: [src/lib/chat/persist.ts, src/lib/agent-runtime/run-agent.ts]

key-decisions:
  - "getOrgCostTicker uses rpc('get_current_org_id') then fetches org row — same pattern as guardrails.ts"
  - "Percentiles computed in JS (sorted array + index math) — avoids raw SQL RPC complexity"
  - "buildTree() shared between getConversationDelegationTree and getInvocationDelegationTree"
  - "AgentInvocationStatus cast needed for .eq('status', ...) due to Supabase type strictness"

patterns-established:
  - "Observability actions follow same auth pattern as calls/actions.ts: getUser() + createClient()"
  - "RawInvocationRow type + as unknown as cast for nested Supabase join result"

## Self-Check: PASSED
