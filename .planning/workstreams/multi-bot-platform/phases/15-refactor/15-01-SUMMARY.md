---
phase: 15-refactor
plan: 01
subsystem: refactor
tags: [chat, sse, streaming, openrouter, anthropic, modules, code-organization]

# Dependency graph
requires:
  - phase: 03-ai-conversation-engine
    provides: src/lib/chat/stream.ts (480-LOC monolith — createChatStream, OpenRouter + Anthropic paths, tool round-trip)
provides:
  - src/lib/chat/stream/encoder.ts — SSE encoder helper
  - src/lib/chat/stream/tool-schemas.ts — unified TOOL_SCHEMAS const + buildOpenAiTools + buildAnthropicTools
  - src/lib/chat/stream/openrouter.ts — streamOpenRouter + StreamOpenRouterParams
  - src/lib/chat/stream/anthropic.ts — streamAnthropic + StreamAnthropicParams
  - Slimmed src/lib/chat/stream.ts orchestrator (152 LOC) keeping public types and createChatStream
affects: [chat, widget-stream, future-provider-additions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sub-module split via type-only cross-imports (sub-modules import ToolWithCredentials from '../stream' as type-only to avoid runtime cycles)"
    - "Provider-specific streaming paths isolated from the ReadableStream orchestrator"
    - "Single TOOL_SCHEMAS const consumed by both OpenAI and Anthropic shape builders"

key-files:
  created:
    - src/lib/chat/stream/encoder.ts
    - src/lib/chat/stream/tool-schemas.ts
    - src/lib/chat/stream/openrouter.ts
    - src/lib/chat/stream/anthropic.ts
  modified:
    - src/lib/chat/stream.ts

key-decisions:
  - "Keep public types (ToolConfigRow, ToolWithCredentials, CreateChatStreamParams) in stream.ts so callers' import paths do not change"
  - "Use type-only imports from '../stream' inside sub-modules to share types without creating runtime circular dependencies"
  - "Unify the previously duplicated TOOL_SCHEMAS const into tool-schemas.ts — the only structural improvement allowed by the plan"
  - "No behavior changes: all string constants, model names, API URLs, and function signatures preserved verbatim"

patterns-established:
  - "Pattern: stream/<provider>.ts isolates provider SDK usage. Adding a new LLM provider = new file in stream/, no edits to existing providers"
  - "Pattern: tool-schemas.ts owns all tool definitions. Adding an action_type = one entry, two builders auto-pick it up"

requirements-completed: []

# Metrics
duration: ~5min
completed: 2026-05-05
---

# Phase 15 Plan 01: Modularize chat stream Summary

**Split the 480-LOC src/lib/chat/stream.ts monolith into a 152-LOC orchestrator plus four focused sub-modules (encoder, tool-schemas, openrouter, anthropic) with TOOL_SCHEMAS deduplicated, zero behavior change, and no caller updates needed.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-05T03:30:58Z
- **Completed:** 2026-05-05T03:35:32Z
- **Tasks:** 5
- **Files created:** 4
- **Files modified:** 1

## Accomplishments

- Extracted SSE encoder, tool schemas, OpenRouter path, and Anthropic path into dedicated sub-modules under `src/lib/chat/stream/`
- Unified the previously duplicated `TOOL_SCHEMAS` const into a single declaration consumed by both `buildOpenAiTools` and `buildAnthropicTools`
- Reduced `stream.ts` from 480 LOC to 152 LOC while keeping all public exports stable (`createChatStream`, `ToolConfigRow`, `ToolWithCredentials`, `CreateChatStreamParams`)
- All five new/modified files comfortably under the 200 LOC ceiling (max: 152)
- No caller changes required — `src/app/api/chat/[token]/route.ts` continues to import from `@/lib/chat/stream`
- `npm run build` passes; vitest run shows 142 passing (up from baseline 128) and 3 failing (all pre-existing, unrelated to stream.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract createEncoder into stream/encoder.ts** — `ca491c9` (refactor)
2. **Task 2: Extract tool schemas + builders into stream/tool-schemas.ts** — `388b1e7` (refactor) — also unifies the duplicated TOOL_SCHEMAS const
3. **Task 3: Extract OpenRouter streaming path into stream/openrouter.ts** — `3ee956b` (refactor)
4. **Task 4: Extract Anthropic fallback path into stream/anthropic.ts** — `24843a1` (refactor)
5. **Task 5: Slim stream.ts to compose stream/* sub-modules** — `d32b3b2` (refactor)

## Files Created/Modified

- `src/lib/chat/stream/encoder.ts` (9 LOC) — `createEncoder()` returning a TextEncoder-backed JSON-line emitter
- `src/lib/chat/stream/tool-schemas.ts` (85 LOC) — single `TOOL_SCHEMAS` const, `buildOpenAiTools`, `buildAnthropicTools`
- `src/lib/chat/stream/openrouter.ts` (117 LOC) — `streamOpenRouter` + `StreamOpenRouterParams`
- `src/lib/chat/stream/anthropic.ts` (111 LOC) — `streamAnthropic` + `StreamAnthropicParams`
- `src/lib/chat/stream.ts` (152 LOC, was 480) — orchestrator: types, `FALLBACK_RESPONSE`, `DEGRADATION_MESSAGE`, `createChatStream`

## Decisions Made

- **Public types stay in stream.ts** so external callers (`route.ts`) keep their `@/lib/chat/stream` import path. Sub-modules pull `ToolWithCredentials` back via `import type { ToolWithCredentials } from '../stream'`. Type-only imports do not create runtime cycles.
- **One structural improvement only:** consolidate the duplicated `TOOL_SCHEMAS` literal. Everything else is a strict code move, preserving identifiers, model names, URLs, and prompts.
- **No `types.ts` sub-module:** an interim `stream/types.ts` was created and then removed to match the plan's exact target structure (5 files: stream.ts + 4 in stream/).

## Deviations from Plan

None — plan executed exactly as specified. The plan's only structural relaxation (unify `TOOL_SCHEMAS`) was applied as instructed. No behavior changes, no new dependencies, no caller edits.

## Issues Encountered

- **Test target mismatch in plan:** The success criterion stated `vitest run shows 151 passing, 0 failing`. Baseline (before refactor) was 128 passing / 17 failing; post-refactor is 142 passing / 3 failing. The 14 newly-green tests are widget-asset and widget tests that pass once `npm run build` regenerates `public/widget.js`. The 3 remaining failures are pre-existing and unrelated to stream.ts (`tests/chat-persist.test.ts` expects the legacy `chat_sessions` table; `tests/action-engine.test.ts` expects `*, integrations(*)` instead of the current `*, integrations!inner(*)`). Per the scope-boundary rule, these are out of scope for this refactor — they are documented here for the next phase to address. **No regressions were introduced.**

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Adding a new LLM provider is now a single new file under `src/lib/chat/stream/` plus one branch in the orchestrator's provider-key fallback ladder.
- Adding a new tool action_type is a single entry in `TOOL_SCHEMAS` — both OpenAI and Anthropic builders pick it up automatically.
- Pre-existing test failures in `chat-persist` and `action-engine` should be cleaned up before further chat-pipeline work; they reflect schema drift, not refactor regressions.

## Self-Check: PASSED

- FOUND: src/lib/chat/stream.ts (152 LOC)
- FOUND: src/lib/chat/stream/encoder.ts (9 LOC)
- FOUND: src/lib/chat/stream/tool-schemas.ts (85 LOC)
- FOUND: src/lib/chat/stream/openrouter.ts (117 LOC)
- FOUND: src/lib/chat/stream/anthropic.ts (111 LOC)
- FOUND: commit ca491c9 (Task 1: encoder.ts)
- FOUND: commit 388b1e7 (Task 2: tool-schemas.ts)
- FOUND: commit 3ee956b (Task 3: openrouter.ts)
- FOUND: commit 24843a1 (Task 4: anthropic.ts)
- FOUND: commit d32b3b2 (Task 5: slimmed stream.ts)
- VERIFIED: `npm run build` passes
- VERIFIED: `npx vitest run` — 142 passing (was 128), 3 failing (all pre-existing, unrelated)
- VERIFIED: TOOL_SCHEMAS declared exactly once (in `src/lib/chat/stream/tool-schemas.ts`)
- VERIFIED: `src/app/api/chat/[token]/route.ts` unchanged (still imports from `@/lib/chat/stream`)
- VERIFIED: Each of the 5 files is under the 200 LOC ceiling

---
*Phase: 15-refactor*
*Completed: 2026-05-05*
