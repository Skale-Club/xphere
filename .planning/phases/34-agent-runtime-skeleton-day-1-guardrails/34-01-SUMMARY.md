---
phase: 34-agent-runtime-skeleton-day-1-guardrails
plan: 01
subsystem: infra
tags: [ai-sdk, anthropic, vercel-ai-sdk, llm, spike]

# Dependency graph
requires:
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    provides: Research + locked decisions (34-RESEARCH.md, 34-CONTEXT.md)
provides:
  - ai@6.0.184 installed in package.json with @ai-sdk/anthropic@3.0.78
  - Documented ADOPT decision in 34-RESEARCH.md under ## ai@^6 Spike Decision
  - Wave 2/3 LLM call pattern locked: generateText from 'ai' with @ai-sdk/anthropic
affects:
  - 34-02 (migration plan)
  - 34-03 (types + guardrails)
  - 34-04 (run-agent.ts core loop — must use generateText from 'ai')
  - 34-05 (tests)

# Tech tracking
tech-stack:
  added:
    - ai@6.0.184 (Vercel AI SDK v6)
    - "@ai-sdk/anthropic@3.0.78"
  patterns:
    - "generateText({ model, tools, stopWhen: stepCountIs(N), abortSignal }) for agent LLM calls"
    - "tool({ description, parameters, execute }) for wrapping executeAction in ≤2 files"
    - "usage.inputTokens / usage.outputTokens map to tokens_in / tokens_out"

key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - .planning/phases/34-agent-runtime-skeleton-day-1-guardrails/34-RESEARCH.md

key-decisions:
  - "ADOPT ai@^6 — all 5 friction points passed; abortSignal forwarded, stopWhen/stepCountIs caps steps, tool() wrapping stays in ≤2 files, no openai version conflict, usage shape maps cleanly"
  - "OpenRouter path keeps existing openai ^6.33.0 with baseURL override — no @ai-sdk/openai needed in Phase 34"
  - "generateText stopWhen: stepCountIs(AGENT_MAX_LLM_CALLS_PER_TURN) is the v6 equivalent of maxSteps"

patterns-established:
  - "Spike-first: lock framework decisions before parallel wave execution begins"
  - "ai@^6 tool wrapping: define ToolSet dynamically in run-agent.ts; execute() calls resolveAgentTool + executeAction"

requirements-completed:
  - RUNTIME-01

# Metrics
duration: 12min
completed: 2026-05-16
---

# Phase 34 Plan 01: ai@^6 Spike Decision Summary

**Adopted Vercel AI SDK v6 (ai@6.0.184 + @ai-sdk/anthropic@3.0.78): all friction points passed, generateText/stopWhen/abortSignal pattern locked for Wave 2/3 run-agent.ts**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-16T~start
- **Completed:** 2026-05-16
- **Tasks:** 1/1
- **Files modified:** 3

## Accomplishments

- Installed `ai@6.0.184` and `@ai-sdk/anthropic@3.0.78` — no version conflicts with existing `openai ^6.33.0`
- Confirmed all 5 D-34-01 friction points pass: abortSignal propagation, step count cap, tool wrapping file count, OpenRouter compat, usage shape
- Appended ADOPT decision with full rationale to `34-RESEARCH.md` under `## ai@^6 Spike Decision`
- `npm run build` exits 0 — no TypeScript errors introduced by the new packages
- Wave 2/3 plan executors now have a definitive answer: use `generateText` from `'ai'` with `@ai-sdk/anthropic` provider

## Spike Friction Point Results

| Friction Point | Result | Evidence |
|---|---|---|
| AbortSignal propagation | PASS | `@ai-sdk/anthropic` dist: `abortSignal: options.abortSignal` forwarded to Anthropic stream |
| Step count cap (maxSteps replacement) | PASS | `stopWhen: stepCountIs(N)` exported from `ai` — `stepCountIs` in type defs |
| Tool wrapping ≤2 files | PASS | `tool({ description, parameters, execute })` self-contained in run-agent.ts |
| OpenRouter compat (no version conflict) | PASS | `@ai-sdk/anthropic` has no `@ai-sdk/openai` dep; existing `openai ^6.33.0` untouched |
| usage shape maps to AgentRunResult | PASS | `usage.inputTokens` / `usage.outputTokens` → `tokens_in` / `tokens_out` |

## Task Commits

1. **Task 1: Run ai@^6 spike and lock adoption decision** - `82bddb8` (feat)

## Files Created/Modified

- `package.json` — added `ai@^6.0.184` and `@ai-sdk/anthropic@^3.0.78` under dependencies
- `package-lock.json` — updated lockfile (9 packages added)
- `.planning/phases/34-agent-runtime-skeleton-day-1-guardrails/34-RESEARCH.md` — appended `## ai@^6 Spike Decision` section

## Decisions Made

- **ADOPT ai@^6:** Every adoption criterion from D-34-01 is satisfied. No reject criterion triggered.
- **OpenRouter stays on `openai ^6.33.0`:** The ai SDK does not require `@ai-sdk/openai` for the Anthropic path. Phase 34 only ships Anthropic via `@ai-sdk/anthropic`. Adding `@ai-sdk/openai` for OpenRouter is a Wave 2/3 optional improvement, not required.
- **`stopWhen: stepCountIs(N)` is the v6 `maxSteps` equivalent:** In ai@^6, the `maxSteps` parameter was removed and replaced with the `stopWhen` API. `stepCountIs(AGENT_MAX_LLM_CALLS_PER_TURN)` provides the same behavior.

## Deviations from Plan

None — plan executed exactly as written. All 5 friction points checked, decision documented, build verified.

## Issues Encountered

None. The spike was clean: install succeeded, types are compatible, build passes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Wave 2 (34-02: migration plan) and Wave 3 (34-03 through 34-05) can now proceed in parallel
- run-agent.ts (Wave 3) must import `generateText` from `'ai'` and use `anthropic` provider from `@ai-sdk/anthropic`
- Tool wrapping pattern: `tool({ description, parameters, execute: async (args) => { const config = await resolveAgentTool(agentId, toolName); ... return executeAction(...) } })`
- AbortController pattern: `generateText({ ..., abortSignal: controller.signal, stopWhen: stepCountIs(MAX_LLM_CALLS_PER_TURN) })`

---
*Phase: 34-agent-runtime-skeleton-day-1-guardrails*
*Completed: 2026-05-16*
