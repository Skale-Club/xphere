---
phase: 133-signed-context-identity-pinning
plan: 03
subsystem: widget
tags: [widget, esbuild, same-origin-fetch, hmac-context, sse, vitest]

# Dependency graph
requires:
  - phase: 133-signed-context-identity-pinning (133-01, 133-02)
    provides: "verifyCommerceContext + writeCommerceContext (server-side verify/pin core); chat route commerce_context schema + fail-soft verify+pin block"
provides:
  - "Widget captures data-context-endpoint from currentScript and threads it through initWidget -> buildPanel"
  - "ensureContext() lazy same-origin fetch (credentials:'same-origin', never apiBase-prefixed), local exp-only decode, cache-until-exp, fail-soft"
  - "commerce_context conditionally added to the chat POST body only when a token is cached/fetched"
  - "window.Opps.setContext(token) public API"
  - "commerce/cart_created SSE handling clears the cache to force re-fetch on next send"
  - "Rebuilt + tracked public/widget.js (un-ignored from .gitignore)"
  - "tests/widget.test.ts baseline-repaired (pageUrl + ?u= assertions) — 11/11 green"
affects: [134-cart-write-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Widget-side token cache pattern: module-local cachedToken/cachedExp inside buildPanel, decode-only (atob + JSON.parse on the base64url payload segment) for exp — never verifies HMAC client-side"
    - "Conditional POST field via object spread: ...(value ? { field: value } : {}) keeps exact-body test assertions stable when the optional feature is inactive"

key-files:
  created: []
  modified:
    - tests/widget.test.ts
    - src/widget/index.ts
    - public/widget.js
    - public/widget-test.html
    - .gitignore

key-decisions:
  - "Un-ignored public/widget.js in .gitignore (previously untracked as a build artifact since April) so it can be committed per this plan's explicit must_haves/success_criteria; reviews-widget.js stays ignored (out of scope, not required by tests)"
  - "Task 3's manual browser checkpoint (real same-origin cookie-backed context fetch) deferred to E2E dev-wiring, since jsdom cannot exercise a real host-page same-origin fetch with httpOnly cookies and no live stack (xphere+stuscle) is available in this execution context"

requirements-completed: [CTX-03]

# Metrics
duration: 13min
completed: 2026-07-17
---

# Phase 133 Plan 03: Widget Context Forwarding Summary

**Widget lazily fetches a same-origin `data-context-endpoint` token (cache-until-exp, decode-only), forwards it as `commerce_context` only when present, exposes `Opps.setContext`, and clears its cache on a `cart_created` SSE event — rebuilt `public/widget.js` committed.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-17T17:00:00Z
- **Completed:** 2026-07-17T17:13:00Z
- **Tasks:** 2 automated (Task 3 checkpoint deferred to E2E, documented below)
- **Files modified:** 5

## Accomplishments
- Repaired the 2 pre-existing stale assertions in `tests/widget.test.ts` (config-fetch `?u=` and chat POST `pageUrl`) so the harness reflects the already-shipped widget behavior — unblocking a clean baseline for the Phase 133 change (Wave-0 baseline repair, unrelated to CTX-03 itself).
- Threaded `data-context-endpoint` from `document.currentScript` through `initWidget` → `buildPanel`.
- Added `ensureContext()`: same-origin fetch against the host page (`credentials: 'same-origin'`, never prefixed with `apiBase`), local-only `exp` decode (no client-side HMAC verification), cache-until-`exp` with a 5s skew buffer, fail-soft (never blocks chat) on any error.
- `sendMessage`'s POST body now includes `commerce_context` only when `ensureContext()` returns a token — kept fully conditional via object spread so the existing exact-body assertion in `tests/widget.test.ts` stays green.
- Exposed `window.Opps.setContext(token)` to let the host page push a token directly (decodes exp locally, same cache).
- Added a `commerce`/`cart_created` branch in the SSE `onEvent` handler that clears the cache, forcing a re-fetch on the next send (the event itself ships in Phase 134).
- Extended `public/widget-test.html` with `data-context-endpoint="/api/chat-context"` and a manual context-forwarding checklist.
- `npm run build:widget` succeeds; rebuilt `public/widget.js` committed (un-ignored from `.gitignore`, which had untracked it as a pure build artifact since April — this plan's success criteria require it committed for `tests/widget.test.ts` to have something to read from disk in a fresh checkout).
- `npm run build` (full production build incl. typecheck + `build:widget` + `build:reviews-widget` + `next build --webpack` + `postbuild` service-worker verify) passes clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave-0 baseline repair of tests/widget.test.ts** - `6b8e3b55` (test)
2. **Task 2: Widget context fetch/forward + Opps.setContext + build:widget commit** - `292285d9` (feat)
3. **Task 3: Manual browser smoke test** - deferred to E2E, not executed this session (see below)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `tests/widget.test.ts` - repaired the 2 stale assertions (config-fetch `?u=<pageUrl>`, chat POST `pageUrl` field) to match shipped widget behavior; still 11/11 green after the Task 2 widget change
- `src/widget/index.ts` - `_contextEndpoint` capture, `initWidget`/`buildPanel` threading, `SSEEvent.action?`, `ensureContext`/`setContext`/`b64urlToJson` cache helpers, conditional `commerce_context` POST field, `commerce`/`cart_created` cache-clear branch, `window.Opps.setContext`
- `public/widget.js` - rebuilt via `npm run build:widget` (esbuild, IIFE, minified); now tracked in git
- `public/widget-test.html` - added `data-context-endpoint` to the script tag + a manual context-forwarding checklist
- `.gitignore` - removed the `public/widget.js` ignore rule (kept `public/reviews-widget.js` ignored)

## Decisions Made
- **Un-ignoring `public/widget.js`:** the file had been deliberately untracked in an April 2026 chore commit ("Generated by esbuild on every build — no need to track it"). This plan's `must_haves.truths`, task acceptance criteria, and success criteria all explicitly and repeatedly require the rebuilt bundle to be **committed** (and `tests/widget.test.ts` reads `public/widget.js` from disk via `readFileSync`, throwing a clear error if it's missing — a fresh checkout without a manual `build:widget` step would break the test). Reconciled by removing only the `public/widget.js` line from `.gitignore` (not `public/reviews-widget.js`, which is unaffected by this plan) and committing the rebuilt file. Production deploys still rebuild it fresh via the `build` script regardless of what's tracked, so this does not change deploy behavior — it only makes local/CI test runs deterministic without a manual build step.
- **`cart_created` guarded by string comparison only:** per the plan's explicit interface guidance, the widget checks `evt.event === 'commerce' && evt.action === 'cart_created'` — the event itself is emitted by Phase 134's cart-write tools, not this plan. The check is inert (never fires) until that phase ships, by design.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Un-ignored `public/widget.js` in `.gitignore` to satisfy the plan's explicit "committed" requirement**
- **Found during:** Task 2 (rebuild + commit `public/widget.js`)
- **Issue:** `public/widget.js` was untracked (gitignored since an April 2026 "chore: ignore build artifact" commit); `git add` silently skips ignored files, so the plan's must_haves/success_criteria ("the rebuilt public/widget.js is committed") could not be satisfied without touching `.gitignore`.
- **Fix:** Removed the `public/widget.js` line from `.gitignore` (left `public/reviews-widget.js` ignored — out of scope), then `git add`'d and committed the rebuilt bundle.
- **Files modified:** `.gitignore`, `public/widget.js`
- **Verification:** `git status --short` showed `A  public/widget.js` before commit; `git show --stat` on the Task 2 commit confirms the file is now tracked.
- **Committed in:** `292285d9` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the plan's own explicit, repeated instruction to commit the rebuilt widget bundle. No scope creep — `public/reviews-widget.js` (a sibling build artifact, out of scope for this plan) remains gitignored.

## Issues Encountered

**Task 3 (manual browser checkpoint) not executed — deferred to E2E, per plan's explicit `<critical>` instruction.**

The plan's `<critical>` block explicitly directs: *"The manual checkpoint (widget-test.html forwarding) is DEFERRED to E2E (no live stack). Treat it as: extend public/widget-test.html for manual verification, document the checkpoint as deferred in the SUMMARY ... and complete the plan on the strength of build:widget + the green repaired jsdom test. Do NOT block waiting for human input."*

This execution environment has no live stack — no running xphere dev server, and no stuscle storefront serving `/api/chat-context` (that route is built in the separate stuscle GSD project, not yet wired for cross-repo E2E per 133-RESEARCH.md's Environment Availability table). jsdom cannot exercise a real same-origin fetch against httpOnly cart/customer cookies, which is the entire point of the manual check.

What stands in for it in this plan:
- `public/widget-test.html` was extended with `data-context-endpoint="/api/chat-context"` and a 5-item manual checklist (same-origin fetch happens; `commerce_context` present only when a token was fetched; absent/failing endpoint never blocks chat; `Opps.setContext` replaces the cached token; `cart_created` forces a re-fetch).
- The jsdom-covered behavioral contract (Pitfall 5) is proven by the 11/11 green `tests/widget.test.ts` run: the existing tests set **no** `data-context-endpoint`, so `ensureContext()` returns `null` and the POST body is byte-identical to before — the exact scenario the manual checklist's "absent context endpoint never blocks chat" item also covers, just not through a real network round-trip.
- Real same-origin cookie-backed verification (steps 1-5 of Task 3's `<action>`) remains a TODO for whoever performs the cross-repo dev-wiring step (contract §9), once both xphere and stuscle are running together.

## User Setup Required

None - no external service configuration required. (Cross-repo E2E wiring against a running stuscle storefront is a separate, later step — not user setup for this plan.)

## Next Phase Readiness

- CTX-03 is satisfied at the code/build level: widget captures `data-context-endpoint`, fetches same-origin with cache-until-exp, forwards `commerce_context` conditionally, exposes `Opps.setContext`, and re-fetches on `cart_created`. `public/widget.js` is rebuilt and committed.
- Phase 133 (Signed Context & Identity Pinning) is now fully landed: 133-01 (verify+pin core), 133-02 (chat route wiring), 133-03 (widget forwarding) all complete.
- Phase 134 (Cart Write Tools) can proceed: it needs to emit the SSE `{event:'commerce', action:'cart_created', cartId, itemCount, sig}` payload that this plan's widget code already listens for (the branch is inert until Phase 134 ships the emitter).
- Outstanding, not a blocker: the real same-origin cookie-backed context fetch (Task 3's manual verification) has not been exercised against a live storefront. Recommend running it once stuscle's `/api/chat-context` mint route exists and both dev servers are up, per contract §9 dev-wiring.

---
*Phase: 133-signed-context-identity-pinning*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: tests/widget.test.ts
- FOUND: src/widget/index.ts
- FOUND: public/widget.js
- FOUND: public/widget-test.html
- FOUND: .planning/workstreams/medusa-commerce/phases/133-signed-context-identity-pinning/133-03-SUMMARY.md
- FOUND commit: 6b8e3b55 (Task 1)
- FOUND commit: 292285d9 (Task 2)
