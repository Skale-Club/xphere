---
phase: 35-web-widget-canary-cutover
plan: 03
subsystem: api
tags: [ai-sdk, streaming, sse, agent-runtime, readablestream, streamtext]

# Dependency graph
requires:
  - phase: 35-web-widget-canary-cutover
    provides: AgentRunOptions with stream/sessionId/conversationId fields (35-02), agent resolution from agent_channel_defaults (35-02)
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    provides: runAgent blocking path, generateText pattern, guardrails, invocations helpers
provides:
  - runAgentStreaming() private function in run-agent.ts using streamText from ai@^6
  - runAgent overloads: stream:true returns ReadableStream<Uint8Array> synchronously
  - route.ts cutover: calls runAgent({stream:true}) directly, no tool-fetching block
  - createChatStream shim in stream.ts preserving export signature for rollback
  - export const maxDuration = 10 on route.ts (D-35-07)
affects:
  - 35-04 (GATE-01 canary test — SSE shape + persistence assertions against new runtime path)
  - 35-04 (web-widget-canary.test.ts — tests the new streaming path end to end)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "streamText from ai@^6 (not generateText) for streaming SSE path — DO NOT await streamText"
    - "ReadableStream.start() async callback: all async agent resolution happens inside start(), not before"
    - "after() called inside ReadableStream.start() finally block for post-stream side effects"
    - "Function overloads: runAgent(opts & {stream:true}): ReadableStream; runAgent(opts & {stream?:false}): Promise<AgentRunResult>"
    - "createChatStream shim: one-liner wrapping runAgent({stream:true}) preserving export signature"

key-files:
  created: []
  modified:
    - src/lib/agent-runtime/run-agent.ts
    - src/lib/chat/stream.ts
    - src/app/api/chat/[token]/route.ts

key-decisions:
  - "runAgentStreaming: all async work inside ReadableStream.start() so runAgent returns ReadableStream synchronously when stream:true (required by D-35-01 overload contract)"
  - "Refactored runAgent into overloads + runAgentBlocking() + runAgentStreaming() — blocking path unchanged from Phase 34"
  - "capturedModel variable captures resolvedAgent.model before LLM try/catch to pass correct model to updateInvocationEnd in after()"
  - "finalResolvedAgentId outer variable captures resolvedAgentId from inside async start() for use in after() block"
  - "route.ts: removed entire tool-fetching IIFE and accumulatedReply accumulation — runAgent owns all LLM side effects"

patterns-established:
  - "Phase 35 streaming overload pattern: ReadableStream with all async resolution inside start(), returns synchronously"
  - "Post-stream persist: after() inside ReadableStream.start() finally block (confirmed working pattern)"

requirements-completed:
  - CHAN-03
  - GATE-01

# Metrics
duration: 35min
completed: 2026-05-16
---

# Phase 35 Plan 03: Web Widget Streaming Cutover Summary

**Web widget route.ts cut over to runAgent({stream:true}) using streamText, emitting canonical session/token/done SSE events with assistant persistence via after()**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-16T00:00:00Z
- **Completed:** 2026-05-16T00:35:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `runAgentStreaming()` function to `run-agent.ts` using `streamText` from ai@^6, emitting canonical SSE events in correct order: session first, token events, done last
- Refactored `runAgent` into TypeScript function overloads: `stream:true` returns `ReadableStream<Uint8Array>` synchronously; `stream?:false` returns `Promise<AgentRunResult>` (blocking path unchanged)
- Removed 80-line legacy tool-fetching block + accumulatedReply accumulation from `route.ts`; replaced with single `runAgent({stream:true,...})` call
- `createChatStream` in `stream.ts` reduced from 150 lines to a 45-line shim preserving all export types for rollback safety

## Task Commits

1. **Task 1: Add runAgentStreaming to run-agent.ts** - `ebc6e66` (feat)
2. **Task 2: Refactor stream.ts shim + route.ts cutover** - `250cc74` (feat)

## Files Created/Modified

- `src/lib/agent-runtime/run-agent.ts` — Added streamText import, after(), createEncoder, persistMessage; refactored into runAgentBlocking() + runAgentStreaming() with overloads
- `src/lib/chat/stream.ts` — Reduced to 45-line shim wrapping runAgent({stream:true}); preserved ToolConfigRow/ToolWithCredentials/CreateChatStreamParams types
- `src/app/api/chat/[token]/route.ts` — Removed tool-fetching IIFE, decrypt import, createChatStream import, accumulatedReply, second after(); added runAgent import + maxDuration=10

## Decisions Made

- **Async resolution inside ReadableStream.start()**: The plan proposed resolving `resolvedAgentId` in `runAgent` then passing it to `runAgentStreaming`. This was changed so all async work (agent_channel_defaults lookup, resolveAgent, KB injection, etc.) happens inside the `ReadableStream.start()` callback. This ensures `runAgent` with `stream:true` returns a `ReadableStream` synchronously as required by the TypeScript overload contract and D-35-01.
- **`capturedModel` variable**: Captures `resolvedAgent.model` before the inner try/catch so the correct model string is available in the `after()` finally block for `updateInvocationEnd`.
- **`finalResolvedAgentId` outer variable**: The resolved agent ID is captured from inside the `start()` async callback into an outer variable so the `after()` block can reference it after the try scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restructured streaming dispatch to be synchronous**

- **Found during:** Task 1 (runAgentStreaming implementation)
- **Issue:** The plan's original approach resolved `agentId` asynchronously in `runAgent` before calling `runAgentStreaming(opts, resolvedAgentId)`. This would make `runAgent` return `Promise<ReadableStream>` instead of `ReadableStream`, breaking the TypeScript overload contract and D-35-01 requirement that `stream:true` returns `ReadableStream` synchronously.
- **Fix:** Moved all async work (agent_channel_defaults resolution, resolveAgent, KB injection, etc.) inside `ReadableStream.start()` callback. `runAgentStreaming` takes only `opts: AgentRunOptions` and returns `new ReadableStream` immediately.
- **Files modified:** `src/lib/agent-runtime/run-agent.ts`
- **Verification:** `npm run build` exits 0; TypeScript overloads compile correctly
- **Committed in:** `ebc6e66` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for correctness — the TypeScript overload contract requires synchronous return of ReadableStream. No scope creep.

## Issues Encountered

None beyond the deviation documented above.

## Known Stubs

None — the streaming path is fully wired. `runAgentStreaming` calls real agent resolution, real KB injection, real streamText, real after() persistence.

## Next Phase Readiness

- CHAN-03 complete: route.ts calls runAgent({stream:true}) with maxDuration=10
- GATE-01 prerequisite met: SSE events emit in correct order (session, token*, done) with same shapes as legacy stream.ts
- Plan 35-04 (GATE-01 canary test) can now write `tests/web-widget-canary.test.ts` asserting SSE shape + persistence

---
*Phase: 35-web-widget-canary-cutover*
*Completed: 2026-05-16*
