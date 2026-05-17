# Phase 15: REFACTOR - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Mode:** auto

<domain>
## Phase Boundary

Decompose `src/lib/chat/stream.ts` (480 LOC) and `src/components/chat/chat-area.tsx` (408 LOC) into single-concern modules. The decomposition is purely structural — exported public API of `stream.ts` is unchanged, ChatArea renders identically. No behavioral changes anywhere. Tests and the live widget continue to work without modification.

</domain>

<decisions>
## Implementation Decisions

### stream.ts decomposition (480 → ~5 files, each <200 LOC)
- **D-01:** Create `src/lib/chat/stream/` subdirectory with these modules:
  - `encoder.ts` — `createEncoder()` SSE helper (~10 LOC)
  - `tool-schemas.ts` — `buildOpenAiTools()` + `buildAnthropicTools()` + the shared `TOOL_SCHEMAS` map (~120 LOC, consolidates the duplicated TOOL_SCHEMAS const that exists in both build functions)
  - `openrouter.ts` — `streamOpenRouter()` async function + its `StreamOpenRouterParams` type (~120 LOC)
  - `anthropic.ts` — `streamAnthropic()` async function + its params type (~120 LOC)
  - Keep `src/lib/chat/stream.ts` as the public entry — exports `createChatStream`, `CreateChatStreamParams`, `ToolWithCredentials`, `ToolConfigRow`. Imports the stream sub-modules. Stays under 100 LOC.

- **D-02:** Public API unchanged — `createChatStream(params)` is the only public entry. Type exports stay where they are. Callers of stream.ts (the route handler) need zero changes.

- **D-03:** The duplicated `TOOL_SCHEMAS` constant in both buildOpenAiTools and buildAnthropicTools is unified into a single shared constant in `tool-schemas.ts` — this is a side-benefit of the split, not a behavior change.

### chat-area.tsx decomposition (408 → 4 components, each <150 LOC)
- **D-04:** Create components in `src/components/chat/chat-area/` subdirectory:
  - `chat-header.tsx` — `ChatHeader` component (channel icon + label + account name + bot status badge + pause/resume button)
  - `message-list.tsx` — `MessageList` component (scrolling message bubbles, scroll-to-bottom logic)
  - `message-banner.tsx` — `MessageBanner` component (24h amber warning banner)
  - `message-composer.tsx` — `MessageComposer` component (input form + send handler)

- **D-05:** Keep `src/components/chat/chat-area.tsx` as the composer/orchestrator — imports the 4 sub-components, owns the SSE subscription/state, passes props down. Stays under 150 LOC.

- **D-06:** Component prop contracts: each sub-component receives only what it needs. No prop drilling shortcuts (e.g. don't pass the whole conversation everywhere — pass the specific fields). Use existing types from `src/types/chat.ts`.

- **D-07:** Render output must be visually identical — class names, DOM hierarchy, ARIA attributes preserved. No styling changes.

### Verification approach
- **D-08:** Existing test suite (especially meta-inbox tests) must pass unchanged — they assert on the rendered DOM. If a test breaks, it means we changed behavior; fix the refactor, not the test.
- **D-09:** `npm run build` must pass — TypeScript catches breaking signature changes.
- **D-10:** Manual smoke test via dev server (mentioned in checkpoint) — open `/chat`, verify no visual regression.

### Claude's Discretion
- Exact naming of internal helper functions kept inside sub-modules
- Whether to add a barrel export (index.ts) in chat-area/ subdirectory — defer to executor judgement
- Internal types of stream sub-modules can be tightened during the split

</decisions>

<canonical_refs>
## Canonical References

### Files Being Refactored
- `src/lib/chat/stream.ts` (current 480 LOC — read fully to understand the cuts)
- `src/components/chat/chat-area.tsx` (current 408 LOC — read fully)

### Callers (must keep working — DO NOT modify their imports' signatures)
- `src/app/api/chat/[token]/route.ts` — calls `createChatStream`
- `src/components/chat/admin-chat-layout.tsx` — uses ChatArea component

### Existing Patterns
- `src/components/settings/platform-settings-form.tsx` — example of a small focused client component (good reference for size target)
- `src/components/chat/conversation-list.tsx` — example of state-rich client component using existing hooks

</canonical_refs>

<code_context>
## Existing Code Insights

### stream.ts current structure
- Lines 1-50: imports, constants, types
- Lines 51-55: createEncoder helper (will move to encoder.ts)
- Lines 60-162: buildAnthropicTools + buildOpenAiTools (duplicate TOOL_SCHEMAS — will unify in tool-schemas.ts)
- Lines 164-262: createChatStream (stays as entry — references streamOpenRouter and streamAnthropic)
- Lines 264-380 approx: streamOpenRouter (will move to openrouter.ts)
- Lines 380-480 approx: streamAnthropic (will move to anthropic.ts)

### chat-area.tsx current structure (to investigate during planning)
- Header section (channel icon + label + account name + bot toggle button)
- Message list with scroll-to-bottom
- 24h warning banner (between messages and input)
- Send form (input + button)
- SSE subscription / state management
- Probably some helpers and event handlers mixed in

### Constraints
- Tests assert on rendered DOM — no class name changes
- Existing widget continues to use createChatStream — public API unchanged
- TypeScript strict mode — types must continue to compile

</code_context>

<specifics>
## Specific Notes

- The shared `TOOL_SCHEMAS` constant currently duplicated in both buildOpenAiTools and buildAnthropicTools is the most obvious code smell and should be deduplicated as part of the split.
- chat-area.tsx 24h banner condition uses string comparison (`channelMetadata?.window_expired === 'true'`) — preserve exactly.
- Pause/Resume button uses Tooltip + lucide Pause/Play icons — preserve.

</specifics>

<deferred>
## Deferred Ideas

- Pluggable LLM provider registry (so adding a new provider doesn't require touching createChatStream) — listed as future requirement
- Virtualized message list for very long conversations
- Extracting the SSE subscription into a custom hook (`useChatStream`) — could be a follow-up but adds scope creep
- Splitting the route handler `/api/chat/[token]/route.ts` (this phase only refactors stream.ts and chat-area.tsx)

</deferred>

---

*Phase: 15-refactor*
*Context gathered: 2026-05-05*
