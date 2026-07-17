---
phase: 131-chat-route-hardening
plan: 02
subsystem: security
tags: [ssrf, custom_webhook, url-guard, vitest, tdd]

# Dependency graph
requires:
  - phase: 131-chat-route-hardening (plan 01)
    provides: rate-limit.ts failMode extension + baseline test repair (no functional dependency, same phase wave ordering)
provides:
  - assertPublicHttpUrl SSRF guard wired into the custom_webhook executor
  - 7 executable, DNS-free SSRF regression tests for tests/custom-webhook.test.ts
affects: [131-03, future chat-route-hardening verification, any future org-authored outbound-fetch executor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSRF guard: await assertPublicHttpUrl(url) in try/catch, catch returns a sanitized single-line 'X blocked: ...' string instead of throwing, so tool-loop executors degrade gracefully"
    - "DNS-free SSRF tests using literal IPs (net.isIP fast path in url-guard.ts) for deterministic, non-flaky unit coverage"

key-files:
  created: []
  modified:
    - src/lib/custom-webhook/execute-webhook.ts
    - tests/custom-webhook.test.ts

key-decisions:
  - "Guard placed immediately after parseConfig() and before body-template/AbortController/fetch, exactly per plan spec"
  - "Rejection returns 'Webhook blocked: <sanitized guard message>' (never throws) — matches the existing no-throw-for-SSRF convention used by the flow http_request node and honors the executor's no-newline (Vapi) string convention via the existing sanitize() helper"
  - "http_request: prefix inside the reused guard's error message left as-is (cosmetic, per research recommendation) — not re-wrapped"
  - "TDD commits split into RED (test) then GREEN (feat) per tdd_execution convention, even though both were authored in the same task"

requirements-completed: [CHT-04]

# Metrics
duration: ~10min
completed: 2026-07-17
---

# Phase 131 Plan 02: custom_webhook SSRF Guard Summary

**Closed the last unguarded org-authored outbound fetch by wiring `assertPublicHttpUrl` into `executeWebhook`, with 7 new DNS-free unit tests proving metadata/loopback/RFC1918/localhost/non-http targets are blocked without ever calling fetch, while public IPs still proceed normally.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-17 (worktree created ~10:02 local)
- **Completed:** 2026-07-17T14:10:58Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- `src/lib/custom-webhook/execute-webhook.ts` now calls `await assertPublicHttpUrl(cfg.url)` before any fetch, closing CHT-04 (SSRF via org-authored `tool_config.config.url`)
- Guard rejection returns the executor's normal single-line `Webhook blocked: ...` string (never throws), reusing the file's existing `sanitize()` helper so the Vapi parser's no-newline convention holds
- Added `WEBHOOK-06: SSRF guard (CHT-04)` describe block to `tests/custom-webhook.test.ts` with 7 real, executable, DNS-free tests (metadata IP, loopback, RFC1918, localhost, non-http scheme, no-newline assertion, and public-IP pass-through)
- Left the 15 pre-existing `it.todo` stubs (WEBHOOK-01..05) untouched — out of this phase's scope
- Full production build (`npm run build`, includes widget bundles + `next build --webpack`) passes with no type errors

## Task Commits

Both halves of the TDD cycle for the single task were committed atomically in the `phase-131-02` worktree branch:

1. **Task 1 (RED): add failing SSRF guard tests** - `268e33fd` (test)
2. **Task 1 (GREEN): guard executeWebhook with assertPublicHttpUrl** - `556f4f98` (feat)

_No REFACTOR commit was needed — the minimal 10-line insertion required no cleanup pass._

**Plan metadata:** committed by the orchestrator after merge (this SUMMARY is not yet committed to the worktree at time of writing — see note below).

## Files Created/Modified
- `src/lib/custom-webhook/execute-webhook.ts` - added `assertPublicHttpUrl` import + the SSRF guard block (10 lines) immediately after `parseConfig(rawConfig)`, before the body/AbortController/fetch code; nothing else in the file changed
- `tests/custom-webhook.test.ts` - added imports (`afterEach`, `beforeEach`, `expect`, `vi`, `executeWebhook`) and the `WEBHOOK-06` describe block with 7 executable tests using `vi.stubGlobal('fetch', ...)` / `vi.unstubAllGlobals()`

## Decisions Made
- Followed the plan's exact code block for the guard insertion verbatim (comment text, try/catch shape, `sanitize(err instanceof Error ? err.message : 'invalid url')`)
- Split the single TDD task into two commits (RED test-only, then GREEN implementation) per the `tdd_execution` workflow convention, rather than one combined commit
- No architectural questions arose — the guard function's async/throwing contract and DNS-free literal-IP fast path (both documented in 131-RESEARCH.md) matched the plan's test design exactly, so all 7 tests were deterministic on first GREEN run

## Deviations from Plan

None - plan executed exactly as written. The guard block, import statement, and test list all match the plan's `<action>` and `<behavior>` sections verbatim; acceptance-criteria greps (import line, guard-call line, "Webhook blocked:" line, guard-before-fetch line ordering, `169.254.169.254` in tests, `it(` count ≥ 7) all passed on first check.

## Issues Encountered

**Worktree tooling (not a plan deviation, environment setup only):** `cmd /c mklink /J` failed silently under Git Bash's MSYS path mangling (the `/c` and `/J` flags were swallowed, spawning an interactive `cmd.exe` banner instead of running the command). Resolved by using `ln -s ../../node_modules node_modules` instead, which Git Bash resolves to a working NTFS symlink on this machine (Developer Mode / existing permissions allow it) — `node_modules/` is `.gitignore`d so this required no repo changes and is invisible to `git status`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CHT-04 fully satisfied: every org-authored outbound fetch in the chat/tool subsystem (both the flow `http_request` node and the legacy `custom_webhook` executor) now goes through `assertPublicHttpUrl`
- `tests/custom-webhook.test.ts` is green (7 passed, 15 todo, 0 failed) and `npm run build` passes; ready for the orchestrator to merge `phase-131-02` into the integration branch alongside the parallel agent's work
- No blockers identified for subsequent 131-xx plans

---
*Phase: 131-chat-route-hardening*
*Completed: 2026-07-17*
