---
phase: 34-agent-runtime-skeleton-day-1-guardrails
plan: 05
subsystem: agent-runtime
tags: [agent-runtime, llm, invocations, ai-sdk, anthropic, orchestration]

# Dependency graph
requires:
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    plan: 03
    provides: types.ts + resolve-agent.ts + resolve-agent-tool.ts
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    plan: 04
    provides: guardrails.ts (all 5 cap-check functions)
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    plan: 01
    provides: ai@^6 ADOPT decision — generateText + dynamicTool pattern locked
provides:
  - invocations.ts with insertInvocationStart + updateInvocationEnd
  - run-agent.ts with full orchestration loop (runAgent entry point)
  - index.ts public API export
affects:
  - Phase 35 (web widget cutover — will import runAgent from '@/lib/agent-runtime')

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "dynamicTool({ inputSchema: jsonSchema<Record<string,unknown>>(...), execute }) for type-safe dynamic tools with ai@^6"
    - "generateText({ model: anthropic(model), tools, stopWhen: stepCountIs(N), abortSignal }) — ADOPT path"
    - "Two-phase DB write: insertInvocationStart (status=running) → updateInvocationEnd (finally block)"
    - "Tool denial: resolveAgentTool null → push denied_reason: tool_not_attached_to_agent to JSONB log, return synthesized message"
    - "process.env.ANTHROPIC_API_KEY set at runtime from decrypted org integration"

key-files:
  created:
    - src/lib/agent-runtime/invocations.ts
    - src/lib/agent-runtime/run-agent.ts
    - src/lib/agent-runtime/index.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "Used dynamicTool() instead of tool() for ToolSet — avoids TypeScript generic overload conflicts with Record<string,unknown> input schema"
  - "anthropic() provider reads ANTHROPIC_API_KEY env var; key is set per-invocation from decrypted org integration"
  - "maxOutputTokens (not maxTokens) for generateText CallSettings — ai@^6 uses different field name than Anthropic SDK direct"
  - "database.ts agent_invocations.Update was Record<string,never> (bug) — fixed to allow status/tokens/cost/duration updates"

metrics:
  duration: 45min
  completed: 2026-05-16
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 34 Plan 05: invocations.ts + run-agent.ts + index.ts Summary

**Full runAgent() orchestration loop with two-phase DB writes, AbortController timeout, ai@^6 generateText, dynamic tool guard, and KB scope injection — Phase 34 primary deliverable complete**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-05-16
- **Tasks:** 2/2
- **Files created:** 3
- **Files modified:** 1

## Accomplishments

### Task 1: invocations.ts

Created `src/lib/agent-runtime/invocations.ts` with two exported helpers:

- `insertInvocationStart()` — inserts `agent_invocations` row with `status='running'` before the LLM call, returns the UUID `invocationId`
- `updateInvocationEnd()` — updates the row with final status, tokens, cost (via `agent_model_pricing` join per D-34-15), and `duration_ms = Date.now() - startedAt`
- Both use `createServiceRoleClient()` to bypass RLS (auth INSERT/UPDATE is blocked for regular clients)
- Cost computation: `(tokensIn/1M * input_per_1m_usd) + (tokensOut/1M * output_per_1m_usd)` — null + structured warning log if no pricing row

Also fixed a bug in `src/types/database.ts`: `agent_invocations.Update` was `Record<string, never>` (preventing any `.update()` calls). Replaced with correct partial update shape covering all mutable fields.

### Task 2: run-agent.ts + index.ts

Created `src/lib/agent-runtime/run-agent.ts` implementing the full orchestration loop:

**Pre-INSERT guard sequence (no DB row written on denial):**
1. `checkKillSwitch(traceId)` — GATE-03, returns immediately if `AGENT_RUNTIME_ENABLED=false`
2. `resolveAgent()` — fetches agent + channel_overrides; returns error if not found
3. `is_active=false` check → `status='denied'` (D-34-13)
4. `allowed_channels` check → `status='denied'` (D-34-12)
5. `checkDelegationDepth(_depth, ...)` — delegation depth stub (D-34-10)
6. `checkDailyCostCap(orgId, agentId)` — async DB check (RUNTIME-07)

**KB scope injection (AGENT-05):**
- When `resolvedAgent.kbScope !== null && length > 0`: calls `queryKnowledge(userMessage, orgId, serviceClient)` and appends result to systemPrompt
- `kbScope === null` path (full org KB) skips the query in Phase 34

**Post-INSERT execution:**
7. `insertInvocationStart()` → `invocationId`
8. `checkTokenCap(historyTokenEstimate, ...)` — token estimation via `Math.ceil(JSON.stringify(historyWindow).length / 4)`
9. AbortController with `AGENT_TURN_TIMEOUT_MS` (default 8s) — signal passed to `generateText`
10. `generateText` with `dynamicTool` ToolSet built from `agent_tools` DB rows, `stopWhen: stepCountIs(MAX_LLM_CALLS_PER_TURN)`
11. Per-tool: `resolveAgentTool(agentId, toolName, channel)` guard — null → synthesize `'Tool not available to this agent'` + log `denied_reason: 'tool_not_attached_to_agent'`
12. `updateInvocationEnd()` in `finally` block (always runs, even on abort/error)

**index.ts:** `export { runAgent } from './run-agent'` — Phase 35 imports from `'@/lib/agent-runtime'`

## Task Commits

1. **Task 1: invocations.ts + database.ts fix** — `221c73b` (feat)
2. **Task 2: run-agent.ts + index.ts** — `5c224b8` (feat)

## Files Created/Modified

- `src/lib/agent-runtime/invocations.ts` — new: insertInvocationStart + updateInvocationEnd
- `src/lib/agent-runtime/run-agent.ts` — new: runAgent() full orchestration loop
- `src/lib/agent-runtime/index.ts` — new: public API export
- `src/types/database.ts` — fix: agent_invocations.Update Record<string,never> → correct partial shape

## Decisions Made

- **dynamicTool over tool():** ai@^6 `tool()` has strict overload resolution that rejects `Record<string,unknown>` parameters. `dynamicTool({ inputSchema: jsonSchema<Record<string,unknown>>(...), execute })` accepts `execute: ToolExecuteFunction<unknown, unknown>` — no overload conflicts. The LLM sees the same JSON schema either way.
- **maxOutputTokens not maxTokens:** ai@^6 `generateText` CallSettings uses `maxOutputTokens` (not `maxTokens` from the direct Anthropic SDK). Caught during build verification.
- **ANTHROPIC_API_KEY set at runtime:** `@ai-sdk/anthropic` reads `ANTHROPIC_API_KEY` env var. The key is fetched from the org's `integrations` table, decrypted, and set on `process.env` before the generateText call. This is server-only code and never runs in browser context.
- **database.ts Update type fix (Rule 1 - Bug):** `agent_invocations.Update: Record<string, never>` is a schema type generation bug — it would make `supabase.from('agent_invocations').update(...)` a TypeScript error. Fixed by replacing with the correct partial update shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed agent_invocations.Update type in database.ts**
- **Found during:** Task 1 (first build attempt)
- **Issue:** `agent_invocations.Update` was typed as `Record<string, never>` — TypeScript would reject any `.update()` call on the table
- **Fix:** Replaced with partial update shape for all mutable columns (status, assistant_reply, tokens_in, tokens_out, cost_usd, duration_ms, tool_calls, partner_calls, model, error_detail)
- **Files modified:** `src/types/database.ts`
- **Commit:** `221c73b`

**2. [Rule 1 - Bug] Used dynamicTool instead of tool() for ToolSet**
- **Found during:** Task 2 (second build attempt)
- **Issue:** ai@^6 `tool()` generic overloads reject `Record<string,unknown>` parameters when building dynamic ToolSets — TypeScript selects the `Tool<never, never>` overload
- **Fix:** Replaced `tool({ parameters: z.record(z.unknown()), execute })` with `dynamicTool({ inputSchema: jsonSchema<Record<string,unknown>>(...), execute })` which accepts `ToolExecuteFunction<unknown, unknown>`
- **Files modified:** `src/lib/agent-runtime/run-agent.ts`
- **Commit:** `5c224b8`

**3. [Rule 1 - Bug] maxOutputTokens not maxTokens in generateText**
- **Found during:** Task 2 (tsc check)
- **Issue:** Plan specified `maxTokens` but ai@^6 `generateText` CallSettings field is `maxOutputTokens`
- **Fix:** Changed to `maxOutputTokens: resolvedAgent.maxTokens`
- **Commit:** `5c224b8`

## Known Stubs

None — all invocation paths are wired:
- Kill switch → immediate return (no DB write)
- Denied calls → immediate return (no DB write)
- Normal path → INSERT at start + UPDATE in finally
- Tool denial → synthesized tool-result message, logged in tool_calls JSONB

## Self-Check: PASSED

| Check | Result |
|---|---|
| `src/lib/agent-runtime/invocations.ts` exists | FOUND |
| `src/lib/agent-runtime/run-agent.ts` exists | FOUND |
| `src/lib/agent-runtime/index.ts` exists | FOUND |
| `34-05-SUMMARY.md` exists | FOUND |
| Commit `221c73b` (invocations.ts) | FOUND |
| Commit `5c224b8` (run-agent.ts + index.ts) | FOUND |
| `npm run build` exits 0 | PASSED |
