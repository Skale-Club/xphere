---
phase: 34-agent-runtime-skeleton-day-1-guardrails
verified: 2026-05-16T10:00:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 34: Agent Runtime Skeleton + Day-1 Guardrails — Verification Report

**Phase Goal:** A single `runAgent(ctx, opts)` entry point in `src/lib/agent-runtime/` is the only way chat-side code invokes an LLM; every cost, loop, timeout, and kill-switch guard ships in this phase (not later); every invocation writes exactly one `agent_invocations` row with full cost/latency/trace data; the `ai@^6` adoption decision is locked here via spike.

**Verified:** 2026-05-16T10:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `runAgent(ctx, opts)` is the single entry point exported from `src/lib/agent-runtime/index.ts` | VERIFIED | `index.ts` exports only `runAgent` from `./run-agent`; no Vapi or channel handler was modified to call LLM directly |
| 2 | All four cost/safety caps (depth, LLM calls, tokens, daily cost) are enforced and non-deferred | VERIFIED | `guardrails.ts` exports all 5 check functions; each is called in `run-agent.ts` in the correct sequence; all 5 env vars have documented defaults |
| 3 | Per-turn AbortController (8s) + GATE-03 kill switch (response within 1s) both ship | VERIFIED | `run-agent.ts` constructs `AbortController` with `setTimeout(AGENT_TURN_TIMEOUT_MS)`; `checkKillSwitch` is the first call in `runAgent`; kill switch test measured 4ms response |
| 4 | Every `runAgent` call writes exactly one `agent_invocations` row (INSERT at start, UPDATE at end) | VERIFIED | `insertInvocationStart` (status=`running`) and `updateInvocationEnd` are both called; `updateInvocationEnd` is in the `finally` block guaranteeing execution even on error/abort |
| 5 | `resolveAgentTool` exists and is independent of `resolveTool` in action-engine | VERIFIED | `src/lib/agent-runtime/resolve-agent-tool.ts` exports `resolveAgentTool`; the only import from `action-engine` in the runtime is `executeAction` (not `resolveTool`) |
| 6 | `ai@^6` adoption decision is documented and locked with no "undecided" state | VERIFIED | `34-RESEARCH.md` contains `## ai@^6 Spike Decision` with `Result: ADOPT`; `package.json` has `"ai": "^6.0.184"` and `"@ai-sdk/anthropic": "^3.0.78"`; `run-agent.ts` imports `generateText` from `'ai'` |
| 7 | All 4 test files pass green (44 tests total) | VERIFIED | `npx vitest run` exits 0 — 4 passed files, 44 passed tests, 0 failures |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/agent-runtime/index.ts` | Exports `runAgent` as public API | VERIFIED | Exports `runAgent` from `./run-agent` and types from `./types` |
| `src/lib/agent-runtime/run-agent.ts` | Core orchestration loop with all 5 guards wired | VERIFIED | 472 lines; all guards called in order: kill-switch → resolve → is_active → allowed_channels → depth → cost → KB → INSERT → token → AbortController → LLM loop → finally UPDATE |
| `src/lib/agent-runtime/guardrails.ts` | 5 exported cap functions | VERIFIED | Exports: `checkKillSwitch`, `checkDelegationDepth`, `checkLlmCallCount`, `checkTokenCap`, `checkDailyCostCap`; all emit `guardrail_tripped` structured log |
| `src/lib/agent-runtime/invocations.ts` | INSERT-at-start + UPDATE-at-end helpers | VERIFIED | Exports `insertInvocationStart` (inserts with `status: 'running'`) and `updateInvocationEnd` (computes cost via `agent_model_pricing` join); `updateInvocationEnd` always called from `finally` block |
| `src/lib/agent-runtime/resolve-agent.ts` | Resolves agent + applies channel_overrides per D-34-06/D-34-11 | VERIFIED | JOINs `agent_prompt_versions!agents_active_prompt_version_id_fkey`; applies channel_overrides with system_prompt suffix-append logic; includes `kb_scope` |
| `src/lib/agent-runtime/resolve-agent-tool.ts` | Agent-scoped tool resolver separate from `resolveTool` | VERIFIED | Queries `agent_tools` junction; checks per-tool `allowed_channels`; does NOT import from `src/lib/action-engine/` |
| `src/lib/agent-runtime/types.ts` | All shared TypeScript contracts (6 types) | VERIFIED | Exports `AgentChannel`, `AgentRunResult`, `AgentRunContext`, `AgentRunOptions`, `ResolvedAgent`, `ResolvedToolConfig`; `AgentRunResult.status` is `'success' \| 'error' \| 'aborted' \| 'denied' \| 'skipped'`; `AgentRunContext._depth` present |
| `supabase/migrations/042_org_daily_cost_cap.sql` | Adds `daily_cost_cap_usd_override` + `'running'` enum value | VERIFIED | Contains `ALTER TYPE public.agent_invocation_status ADD VALUE IF NOT EXISTS 'running'` and `ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS daily_cost_cap_usd_override NUMERIC(8,2) NULL` |
| `tests/agent-runtime-guardrails.test.ts` | Unit tests for all 5 guardrail functions | VERIFIED | 19 test cases; covers kill-switch (enabled/disabled/unset), depth (0/1/2/3 vs cap=2), LLM call count (5/6/7 vs cap=6), token cap (below/at/above), daily cost cap (per-org override + default) |
| `tests/agent-runtime-kill-switch.test.ts` | GATE-03 timing test | VERIFIED | 6 test cases; asserts `elapsed < 1000ms`, `status='skipped'`, `insertInvocationStart` not called, `resolveAgent` not called when disabled |
| `tests/agent-runtime-invocations.test.ts` | DB write unit tests | VERIFIED | 13 test cases; asserts `status: 'running'` on insert, cost formula (D-34-15), `duration_ms >= 0`, graceful null cost on missing pricing row |
| `tests/agent-runtime-integration.test.ts` | Full runAgent() integration against real Supabase | VERIFIED | 6 test cases against live Supabase + Phase 33 Main Agent; covers RUNTIME-01/02, RUNTIME-10 row finalization, RUNTIME-04 depth stub, RUNTIME-09 kill switch, AGENT-10 inactive agent, AGENT-05 KB scope path |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `run-agent.ts` | `guardrails.ts` | `import { checkKillSwitch, checkDelegationDepth, ... }` | WIRED | All 5 guard functions imported and called in correct sequence |
| `run-agent.ts` | `agent_invocations` table | `invocations.ts insertInvocationStart / updateInvocationEnd` | WIRED | INSERT at step 8; UPDATE in `finally` block at step 13; one row per invocation guaranteed |
| `run-agent.ts` | LLM (ai@^6 `generateText`) | `AbortController.signal` passed to `generateText({ abortSignal })` | WIRED | `controller.signal` forwarded; `stopWhen: stepCountIs(MAX_LLM_CALLS_PER_TURN)` caps loop |
| `run-agent.ts` | `resolveAgentTool` | Called inside `dynamicTool.execute()` for every tool call | WIRED | Gate check before `executeAction`; denial synthesizes `'tool_not_attached_to_agent'` result back to LLM with `denied: true` in `toolCallsLog` |
| `resolve-agent.ts` | `agent_prompt_versions` (DB) | `JOIN agents ON active_prompt_version_id = agent_prompt_versions.id` (D-34-06) | WIRED | Uses Supabase foreign key hint `agent_prompt_versions!agents_active_prompt_version_id_fkey` |
| `resolve-agent-tool.ts` | `agent_tools JOIN tool_configs` (DB) | `service-role client query` | WIRED | Queries `agent_tools` with `!inner` join on `tool_configs`; checks `allowed_channels` per-tool |
| `guardrails.ts` | `organizations.daily_cost_cap_usd_override` | `checkDailyCostCap` service-role query | WIRED | Reads `daily_cost_cap_usd_override` from org row; falls back to `AGENT_DAILY_COST_CAP_USD` env default |
| `guardrails.ts` | `agent_invocations` (24h cost sum) | SELECT with `gte('created_at', ...)` | WIRED | Sums `cost_usd` from last 24h; uses `24 * 60 * 60 * 1000` window |
| `src/lib/agent-runtime/` | Vapi paths (`src/app/api/vapi/`) | NOT connected (D-34-09) | VERIFIED ABSENT | No file in `src/app/api/vapi/` was modified in Phase 34; `resolveTool` not imported anywhere in `src/lib/agent-runtime/` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `run-agent.ts` | `resolvedAgent` | `resolveAgent()` → Supabase `agents` JOIN `agent_prompt_versions` | Yes — live DB query | FLOWING |
| `run-agent.ts` | `invocationId` | `insertInvocationStart()` → Supabase INSERT returning `id` | Yes — real UUID from DB | FLOWING |
| `run-agent.ts` | `finalText`, `tokensIn`, `tokensOut` | `generateText()` from `ai@^6` (real LLM call) | Yes — real LLM; gracefully falls to `error` if API key absent | FLOWING |
| `invocations.ts` | `costUsd` | `agent_model_pricing` query + D-34-15 formula | Yes — real pricing row; null if model not found (logged) | FLOWING |
| `guardrails.ts` | `dailyTotal` | `agent_invocations` SUM query (24h window) | Yes — real DB aggregation | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Kill switch responds within 1s when `AGENT_RUNTIME_ENABLED=false` | `npx vitest run tests/agent-runtime-kill-switch.test.ts` | Elapsed: 4ms (measured in test) | PASS |
| `checkDelegationDepth(3, ...)` with cap=2 returns denial string | vitest agent-runtime-guardrails | Returns `'Delegation depth exceeded — answer from current agent'` | PASS |
| `insertInvocationStart` sends `status: 'running'` | vitest agent-runtime-invocations | Captured insert payload matches `{ status: 'running' }` | PASS |
| Integration: `_depth=3` returns `status='denied'` with `invocationId=''` | vitest agent-runtime-integration (RUNTIME-04) | PASS against real Supabase | PASS |
| Integration: `is_active=false` returns `status='denied'` with `invocationId=''` | vitest agent-runtime-integration (AGENT-10) | PASS against real Supabase | PASS |
| Build passes with no TypeScript errors | `npm run build` | Build completes with all routes rendered | PASS |
| 44 tests pass across all 4 test files | `npx vitest run` (all 4 files) | 4 passed files, 44 passed tests, 0 failures | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RUNTIME-01 | 34-03, 34-05 | `src/lib/agent-runtime/` exports `runAgent()` as single entry point | SATISFIED | `index.ts` exports `runAgent`; no other LLM entry point exists |
| RUNTIME-02 | 34-03, 34-05 | `AgentRunContext` carries identity + internal tracking fields | SATISFIED | `types.ts` has `orgId`, `agentId`, `channel`, `conversationId`, `traceId`, `_depth`, `mode` |
| RUNTIME-03 | 34-03, 34-05 | Runtime resolves agent + applies `channel_overrides` before LLM call | SATISFIED | `resolveAgent()` handles JOIN + deep-merge; called in step 3 before any LLM call |
| RUNTIME-04 | 34-04, 34-05, 34-06 | `MAX_DELEGATION_DEPTH=2` enforced; stub returns synthetic message | SATISFIED | `checkDelegationDepth` tested; integration test with `_depth=3` returns `denied` |
| RUNTIME-05 | 34-04, 34-05, 34-06 | `MAX_LLM_CALLS_PER_TURN=6` enforced via `stopWhen: stepCountIs(N)` | SATISFIED | `stepCountIs(MAX_LLM_CALLS_PER_TURN)` passed to `generateText`; belt-and-suspenders `checkLlmCallCount` before loop |
| RUNTIME-06 | 34-04, 34-05, 34-06 | Per-conversation token cap (200K default) | SATISFIED | `checkTokenCap` called with estimated history tokens; tested in guardrails suite |
| RUNTIME-07 | 34-02, 34-04, 34-05, 34-06 | Per-org daily $ cap with `organizations.daily_cost_cap_usd_override` override | SATISFIED | Migration 042 adds column; `checkDailyCostCap` reads it; tested with both null and non-null override |
| RUNTIME-08 | 34-05, 34-06 | AbortController with 8s budget; partial reply persisted with `status='aborted'` | SATISFIED | `AbortController` + `setTimeout(AGENT_TURN_TIMEOUT_MS)`; catch block handles `AbortError` → `finalStatus='aborted'` |
| RUNTIME-09 | 34-04, 34-05, 34-06 | Kill switch `AGENT_RUNTIME_ENABLED=false` → 503-graceful within 1s | SATISFIED | `checkKillSwitch` is first call in `runAgent`; GATE-03 test measured 4ms; unit + integration tests pass |
| RUNTIME-10 | 34-05, 34-06 | Exactly one `agent_invocations` row per call; child rows for partner calls | SATISFIED | INSERT at step 8; UPDATE in `finally`; integration test verifies row status != `'running'` after completion |
| AGENT-04 | 34-03, 34-05, 34-06 | `model_primary` / `model_fallback` — runtime uses `agents.model` | SATISFIED | `resolveAgent` returns `model` from agent row (or channel override); D-34-04 defers fallback model to Phase 36 |
| AGENT-05 | 34-03, 34-05, 34-06 | `kb_scope` — runtime calls `queryKnowledge` when non-null | SATISFIED | `run-agent.ts` step 7b checks `resolvedAgent.kbScope !== null`; integration test sets `kb_scope=['test-tag']` and confirms non-denied result |
| AGENT-06 | 34-03, 34-05, 34-06 | `allowed_channels` — runtime refuses non-allowed channel | SATISFIED | Step 5 checks `!resolvedAgent.allowedChannels.includes(channel)` → `status='denied'`; no invocation row written |
| AGENT-07 | 34-03, 34-05, 34-06 | `channel_overrides` deep-merge at invocation time | SATISFIED | `resolveAgent` applies suffix-append for `system_prompt`, replacement for `model`/`temperature`/`max_tokens`/`max_history` |
| AGENT-10 | 34-03, 34-05, 34-06 | `is_active=false` refuses invocation | SATISFIED | Step 4 returns `status='denied'`, `errorDetail='agent_inactive'`; integration test confirms with real DB update |
| TOOL-05 | 34-03, 34-06 | `resolveAgentTool` exists alongside unchanged `resolveTool` | SATISFIED | `resolve-agent-tool.ts` is new; `resolveTool` last modified in commit `e034e64` (Phase 2, not Phase 34) |
| TOOL-06 | 34-05, 34-06 | Unattached tool calls refused with `denied_reason: 'tool_not_attached_to_agent'` | SATISFIED | `resolveAgentTool` returns null → `toolCallsLog.push({ denied: true, denied_reason: 'tool_not_attached_to_agent' })`; returns `'Tool not available to this agent'` to LLM |
| GATE-03 | 34-04, 34-05, 34-06 | Kill switch flip → 503-graceful within 1s | SATISFIED | Kill switch unit test: 4ms elapsed; integration test: 2ms elapsed; `insertInvocationStart` not called (verified via mock assertion) |

All 18 requirement IDs accounted for. No orphaned requirements.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `run-agent.ts:255` | `process.env.ANTHROPIC_API_KEY = anthropicKey` — mutates process env at runtime | INFO | Safe in Node.js server-only context; flagged for Phase 35 when OpenRouter path is added — a per-request env mutation should be replaced with passing the key to the `anthropic()` provider constructor directly |
| `run-agent.ts:237` | `checkLlmCallCount(0, ...)` — belt-and-suspenders check before loop with `callCount=0` (always passes) | INFO | Not a bug — the real cap is enforced by `stopWhen: stepCountIs(N)` inside `generateText`; the manual check is dead code at `callCount=0` but doesn't block correctness |

Neither pattern is a blocker. The `process.env` mutation is a known pattern in this codebase (serverless context) and doesn't affect correctness or security in Phase 34 scope.

---

### Human Verification Required

#### 1. Migration 042 applied to remote Supabase

**Test:** Run in Supabase SQL editor:
```sql
SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'agent_invocation_status' ORDER BY enumsortorder;

SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'organizations' AND column_name = 'daily_cost_cap_usd_override';
```
**Expected:** `'running'` present in enum; `daily_cost_cap_usd_override | numeric | YES` column exists.
**Why human:** Cannot verify remote Supabase schema from code inspection. The Plan 02 SUMMARY states migration was applied and human-verified at plan time (checkpoint task in 34-02-PLAN.md). Integration tests pass against real Supabase without TypeScript errors on `daily_cost_cap_usd_override`, which confirms the column exists in the DB.

---

### Gaps Summary

No gaps found. All 7 observable truths verified, all 12 artifacts exist and are substantive and wired, all 18 requirement IDs satisfied. The build passes clean. The 44-test suite passes with 0 failures against both mocked and real Supabase. Vapi paths are confirmed untouched (last modification in pre-Phase-34 commits). `resolveTool` was not imported or modified in the agent-runtime module.

The phase delivers exactly what the goal states:
- `runAgent()` is the single LLM entry point
- All 5 guards (kill-switch, depth, LLM-call-count, token-cap, daily-cost-cap) ship in Phase 34
- Every invocation writes one `agent_invocations` row (INSERT `running` → UPDATE final)
- `ai@^6` adoption locked: ADOPT, documented in `34-RESEARCH.md`, implemented in `run-agent.ts`

---

_Verified: 2026-05-16T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
