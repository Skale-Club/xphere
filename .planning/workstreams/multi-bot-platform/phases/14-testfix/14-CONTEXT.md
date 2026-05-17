# Phase 14: TESTFIX - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Mode:** auto (infrastructure phase — minimal context)

<domain>
## Phase Boundary

Restore a green test baseline by fixing 3 currently-failing tests in `tests/chat-persist.test.ts` (2 failures) and `tests/action-engine.test.ts` (1 failure: ACTN-02). Tests reference renamed tables and changed query shapes — fix the tests to match the current source code, do not change source code unless the test reveals a real bug.

</domain>

<decisions>
## Implementation Decisions

### Approach
- **D-01:** Tests are out-of-date relative to source code. Fix tests to match current implementation, not the other way around. The two assertion failures (`expected to be called with [chat_sessions]` and `expected to be called with [*, integrations(*)]`) are stale fixture expectations.
- **D-02:** The `persistMessage` test failure (`supabase.from(...).update is not a function`) is a mock construction issue — the test's mock supabase needs an `update()` method on the chained from() return.
- **D-03:** If during fix it turns out the tests reveal a real source bug (not just stale assertions), document the bug as a deferred issue and still fix the test. Source code changes are out of scope for this phase.

### Source files (DO NOT MODIFY)
- `src/lib/chat/persist.ts`
- `src/lib/action-engine/resolve-tool.ts` (or wherever resolveTool lives)

### Test files to fix
- `tests/chat-persist.test.ts` (TESTFIX-01)
- `tests/action-engine.test.ts` (TESTFIX-02)

### Claude's Discretion
- Exact mock method patterns (vi.fn() chaining)
- Whether to add additional assertions for safety once fixed

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing test utilities in tests/ directory follow vitest + vi.mock patterns
- Mock supabase pattern is established in other tests (e.g. meta-webhook tests, outbound-reply-routing test)

### Established Patterns
- Vitest 3.x, vi.fn() for mocks, vi.mock() for module mocks
- Tests use buildMockSupabase or inline chained mocks

### Integration Points
- These tests import from src/lib/chat/persist.ts and src/lib/action-engine/

</code_context>

<specifics>
## Specific Notes

Failures observed:
1. `chat-persist.test.ts` > ensureDbSession — expects from() called with 'chat_sessions' but isn't
2. `chat-persist.test.ts` > persistMessage — `supabase.from(...).update is not a function` (mock missing update method)
3. `action-engine.test.ts` > ACTN-02 — expects select() called with '*, integrations(*)' but isn't (likely query shape changed)

Read the actual source files first to see the current query shape, then update test expectations to match.

</specifics>

<deferred>
## Deferred Ideas

- Adding integration tests for ensureDbSession and persistMessage against a real DB (current tests are unit-only)
- Refactoring buildMockSupabase to a shared helper exported from a test util module

</deferred>

---

*Phase: 14-testfix*
*Context gathered: 2026-05-05*
