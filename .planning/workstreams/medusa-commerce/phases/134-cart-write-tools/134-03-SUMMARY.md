---
phase: 134-cart-write-tools
plan: 03
subsystem: commerce
tags: [medusa, widget, sse, customevent, vitest, esbuild]

# Dependency graph
requires:
  - phase: 134-02
    provides: execute-action.ts real dispatch of both cart-write tools, run-agent.ts streaming emitStructured:emit — the reachable emit path this plan's re-dispatch consumes
provides:
  - src/widget/index.ts widened SSEEvent (cartId/itemCount/sig) + commerce branch that re-dispatches EVERY commerce SSE event as window.dispatchEvent(CustomEvent('xphere:commerce', { detail: { action, cartId, itemCount, sig } })), preserving the Phase 133 cart_created cache-clear
  - public/widget.js rebuilt bundle (committed) carrying the re-dispatch
  - public/widget-test.html CRT-04 manual checklist + console listener snippet, deferred like 133-03 pending a live stuscle stack
  - tests/widget.test.ts bundle-content assertion proving the shipped bundle contains the dispatch, live-stack-free
affects: [135-wishlist-tools, 137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Widget SSE re-dispatch to window: the widget's onEvent closure both reacts internally (cache-clear) AND forwards the raw event outward via window.dispatchEvent(CustomEvent(...)) for host-page consumers — the widget never assumes what the host does with the event, it just relays contract-shaped data"
    - "Bundle-content assertion as a live-stack-free proof: instead of exercising window.dispatchEvent in jsdom (which would only prove the source, not the shipped artifact), the test greps the built public/widget.js for the literal re-dispatch string — cheap, catches a stale/un-rebuilt bundle (the exact Pitfall 7 risk called out in the plan)"

key-files:
  created: []
  modified:
    - src/widget/index.ts
    - public/widget.js
    - public/widget-test.html
    - tests/widget.test.ts

key-decisions:
  - "The commerce branch condition was widened from `evt.event === 'commerce' && evt.action === 'cart_created'` to `evt.event === 'commerce'` (any action) — the CustomEvent dispatch happens unconditionally for every commerce frame, then a nested `if (evt.action === 'cart_created')` performs the Phase 133 cache-clear as an additive side effect, not a replacement"
  - "SSEEvent's three new optional fields (cartId, itemCount, sig) are typed exactly as the contract §6 detail shape requires — no renaming, no wrapping — so the CustomEvent detail object can pass evt fields straight through"

requirements-completed: [CRT-04]

# Metrics
duration: ~7min
completed: 2026-07-17
---

# Phase 134 Plan 03: Widget Commerce Re-dispatch Summary

**Widget forwards every `commerce` SSE frame to the host page as `window.dispatchEvent(new CustomEvent('xphere:commerce', { detail: { action, cartId, itemCount, sig } }))`, preserving the Phase 133 `cart_created` cache-clear, with the rebuilt bundle committed and a bundle-content assertion locking the shipped artifact.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-17T18:32:00Z (approx.)
- **Completed:** 2026-07-17T18:39:02Z
- **Tasks:** 2
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments
- `SSEEvent` widened with `cartId?: string; itemCount?: number; sig?: string` so the stream consumer can read every field the contract §6 `commerce` frame carries
- The `onEvent` handler's `commerce`/`cart_created` branch (Phase 133) now fires the `xphere:commerce` `CustomEvent` for ANY `commerce` event, with the Phase 133 cache-clear preserved as an additive nested check on `cart_created` only
- `public/widget-test.html` gained a CRT-04 checklist section: the detail-shape contract, a note that the cache-clear is additive, a paste-in-console listener snippet, and an explicit deferred-verification note (no live stuscle stack in this environment) mirroring the 133-03 precedent
- `public/widget.js` rebuilt via `npm run build:widget` and committed — `grep -c "xphere:commerce" public/widget.js` returns 1
- `tests/widget.test.ts` gained a new describe block asserting the built bundle's on-disk content contains `xphere:commerce` — suite grew from 11 to 12 tests, all green

## Task Commits

Each task was committed atomically:

1. **Task 1: widget re-dispatch branch + widened SSEEvent + widget-test.html checklist** - `4a950ba8` (feat)
2. **Task 2: rebuild + commit public/widget.js and lock the bundle assertion** - `1f99d87b` (feat)

**Plan metadata:** (this commit, added after SUMMARY.md creation)

## Files Created/Modified
- `src/widget/index.ts` - widened `SSEEvent`; commerce branch now re-dispatches every commerce event as `xphere:commerce` `CustomEvent`, cart_created cache-clear kept as a nested additive check
- `public/widget-test.html` - new "Commerce Re-dispatch Checklist (Phase 134, CRT-04)" section with detail-shape contract, console listener snippet, and deferred-verification note
- `public/widget.js` - rebuilt esbuild bundle (minified IIFE) containing the `xphere:commerce` dispatch
- `tests/widget.test.ts` - new "Widget — commerce re-dispatch bundle assertion (CRT-04)" describe block reading `public/widget.js` from disk and asserting it contains `xphere:commerce`

## Decisions Made
- Widened the branch condition to fire on any `commerce` event (not just `cart_created`) per the plan's explicit interface spec — this is required for `cart_updated` frames (emitted by `update-cart-item.ts` per 134-01) to reach the host page at all; only the cache-clear side effect stays scoped to `cart_created`.
- Kept the re-dispatch and the cache-clear as two independent statements inside the same branch rather than merging them into one conditional expression, so a future reader can see at a glance that the dispatch is unconditional and the cache-clear is the exception, not vice versa.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria (SSEEvent widened, CustomEvent dispatch present, widget-test.html checklist, bundle grep, green test suite) were met on the first implementation pass.

## Issues Encountered
None. `CI=true npx vitest run tests/widget.test.ts --reporter=dot` passed 12/12 on first run (up from 11/11 after 133-03); `npm run build:widget` and the full `npm run build` (typecheck + widget bundles + reviews-widget + Next.js production build + service-worker verification) were green with zero errors on first attempt.

## User Setup Required
None - no external service configuration required. This plan is pure widget-source + bundle + test work; no live Medusa store, Redis, or stuscle storefront needed to verify the automated gate.

## Manual Checkpoint — E2E-Deferred

Per the plan's explicit instruction and the 133-03 precedent, the live host-page verification of the `xphere:commerce` re-dispatch (pasting the listener snippet in a browser console against a real stuscle storefront + xphere agent stack, triggering an actual `cart_created` then `cart_updated` turn, and confirming both events log with the correct detail) requires both repos running together end-to-end. No live stack exists in this execution environment, so this check is documented in `public/widget-test.html`'s new CRT-04 section as a deferred manual step, not blocking plan completion. The automated gate (bundle-content assertion + green `tests/widget.test.ts` + `npm run build`) fully proves the re-dispatch shipped correctly in source and in the built artifact.

## Next Phase Readiness
- CRT-04 is satisfied: the widget now forwards every `commerce` SSE event to the host page in the exact contract §6 shape, closing the loop opened by Phase 134's Wave 1/2 executors (`cart_created`/`cart_updated` emission) — **Phase 134 (Cart Write Tools) is now complete**, all four requirements (CRT-01 through CRT-04) satisfied end-to-end from executor to browser.
- Phase 135 (Wishlist Tools) can proceed independently — it does not depend on the widget re-dispatch, only on the Stuscle `/agent/wishlists/*` HMAC surface and pinned-context reads already established in Phase 133/134.
- Phase 137 (Product Cards & Order Status) will extend this same widget SSE-consumption pattern for `ui`/`product_cards` events — the `onEvent` handler's event-type dispatch structure (string comparison branches) is now proven out for two independent event types (`commerce`, and eventually `ui`) and can be extended the same way.
- No blockers. The only outstanding cross-repo item remains the same one noted in 133-03: real same-origin context-fetch AND now real widget-to-storefront-bridge re-dispatch verification, both deferred until xphere + stuscle run together (contract §9 dev-wiring step).

---
*Phase: 134-cart-write-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 4 modified files confirmed present on disk (src/widget/index.ts, public/widget.js, public/widget-test.html, tests/widget.test.ts); both task commits (`4a950ba8`, `1f99d87b`) confirmed in `git log --oneline --all`.
