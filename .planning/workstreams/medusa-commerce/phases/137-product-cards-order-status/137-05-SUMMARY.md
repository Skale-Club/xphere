---
phase: 137-product-cards-order-status
plan: 05
subsystem: ui
tags: [widget, sse, xss-safety, product-cards, esbuild]

# Dependency graph
requires:
  - phase: 137-01
    provides: search-products.ts/get-product.ts emitting the contract §6 ui/product_cards SSE payload
provides:
  - widget-side ui/product_cards renderer (createElement/textContent only, no innerHTML)
  - Add-to-cart button routed through the existing submitMessage agent-send path
  - rebuilt + committed public/widget.js containing the renderer
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSE ui events are buffered during a turn (pendingCards) and flushed after 'done' (and on the safety no-done fallback) rather than rendered mid-stream, matching the existing tokenBuffer pattern"
    - "Card DOM is built exclusively with createElement + textContent + element.src/.href attribute assignment -- the widget's only innerHTML usages remain the pre-existing trusted static SVG icon constants, unrelated to any server-supplied data"

key-files:
  created: []
  modified:
    - src/widget/index.ts
    - public/widget.js
    - tests/widget.test.ts

key-decisions:
  - "The plan's literal Task 1 acceptance check ('grep -n innerHTML src/widget/index.ts returns NOTHING') is unsatisfiable as a whole-file invariant: the widget already used innerHTML for 8 pre-existing trusted, hardcoded SVG icon constants (ICON_CHAT/ICON_CLOSE/ICON_SEND/etc.) before this plan, unrelated to any card/server data. Interpreted the check as scoped to the NEW renderer code (which uses createElement/textContent/img.src/anchor exclusively, zero innerHTML) rather than rewriting unrelated pre-existing icon-rendering code, which was out of this plan's file scope and would have been unjustified scope creep."

requirements-completed: [UIX-01]

# Metrics
duration: 18min
completed: 2026-07-17
---

# Phase 137 Plan 05: Widget Product Cards Renderer Summary

**The widget buffers contract §6 `ui`/`product_cards` SSE events during a turn and renders a `.opps-cards` block after `done` using createElement/textContent/img.src/anchor exclusively (no innerHTML), with the "Add to cart" button routed through the existing `submitMessage` agent-send path; `public/widget.js` is rebuilt and committed.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-17T17:41:00Z
- **Completed:** 2026-07-17T17:59:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `SSEEvent` extended with `component?: string` and `items?: unknown[]` (contract §6 fields).
- `submitMessage`'s `onEvent` chain gains a `ui`/`product_cards` branch that buffers `evt.items.slice(0, 5)` into `pendingCards` — never renders mid-stream. The chain keeps its no-terminal-`else` shape, so unrecognized event types (including unrecognized `ui` components) stay silently ignored, preserving old-bundle graceful degradation.
- `pendingCards` flushes via `renderCards()` in both the `done` branch (after the token-buffer assistant bubble is appended) and the safety fallback (stream ends without an explicit `done`) — cards always render below the assistant's text reply.
- `renderCards()` builds each card with `document.createElement` + `.textContent` (title, price) + `img.src` (thumbnail, attribute assignment) + an anchor (`View`, `target=_top`, `rel=noopener`) — zero `innerHTML` in the new code. A card with no `url` simply omits the View anchor (graceful, matches the source-side url-omission contract). The "Add to cart" button's click handler calls `submitMessage('Add "<title>" to my cart')` — the existing agent-send path, never a direct store/API call.
- Card CSS (`.opps-cards`/`.opps-card*`) added to `WIDGET_CSS` using existing theme vars (`T.panelBg`, `T.borderColor`, `T.textPrimary`, `T.textSecondary`, `var(--opps-primary-color)`) with no new animations, matching the existing visual language.
- `public/widget.js` rebuilt via `npm run build:widget` (26.5kb) and committed — `grep -c "opps-cards" public/widget.js` returns 2 (renderer + CSS both present in the shipped, minified artifact).
- `tests/widget.test.ts` extended with a jsdom-driven SSE sequence (session → token → ui/product_cards → done) proving: `.opps-cards` renders with exactly one `.opps-card`; title/price render via `textContent` (proving no markup injection); the View anchor has the correct `href`/`target=_top`/`rel=noopener`; clicking "Add to cart" triggers a second chat POST whose body message contains `Add "Sweatshirt" to my cart`. Additional tests cover the no-`url` case (no View anchor) and unknown-`ui`-component degradation (no `.opps-cards`, no thrown error). A dedicated bundle-content assertion proves the shipped `public/widget.js` — not just the source — contains the renderer.

## Task Commits

Each task was committed atomically:

1. **Task 1: SSEEvent + ui buffer + renderCards (createElement/textContent) + CSS** - `8716f587` (feat)
2. **Task 2: rebuild + commit public/widget.js; extend tests/widget.test.ts** - `28599d69` (feat)

**Plan metadata:** (recorded with this SUMMARY commit)

## Files Created/Modified
- `src/widget/index.ts` - extended `SSEEvent`, `pendingCards` buffer, `ui`/`product_cards` branch, `renderCards()` helper (createElement/textContent/img.src/anchor only), `.opps-card*` CSS
- `public/widget.js` - rebuilt esbuild bundle (26.5kb) containing the card renderer
- `tests/widget.test.ts` - product-cards render test, no-url test, unknown-event-degradation test, bundle-content assertion

## Decisions Made
- Interpreted the plan's literal "grep innerHTML returns NOTHING" acceptance check as scoped to the new renderer code, not the whole file — see key-decisions above and Deviations below.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing-critical-functionality, or blocking issues were found; the plan's design (buffer-then-flush, createElement/textContent-only renderer, submitMessage routing) was implemented as specified.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None — plan executed as written, with one literal-acceptance-check interpretation documented under Decisions (the security invariant the check exists to protect — no innerHTML in the card renderer — fully holds; see key-decisions).

## Issues Encountered
- The plan's Task 1 acceptance criterion `grep -n "innerHTML" src/widget/index.ts` returning NOTHING is unsatisfiable as a literal whole-file check: the widget file already used `innerHTML` for 8 pre-existing, hardcoded, trusted SVG icon constants (`ICON_CHAT`, `ICON_CLOSE`, `ICON_SEND`, `ICON_CLOSE_SM`, `ICON_EXPAND`/`ICON_COLLAPSE` toggle) before this plan — none of which touch server-supplied or card data. Resolved by confirming the NEW renderer code (`renderCards`) uses zero `innerHTML` (createElement/textContent/img.src/anchor exclusively, verified by direct code inspection and by the jsdom render tests asserting exact `textContent` values), which is the actual security invariant the plan's Task 1 `<done>` criterion describes ("createElement/textContent-only block ... no innerHTML"). No code changes were made to the pre-existing icon-rendering lines, which are out of this plan's file/feature scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UIX-01 is now fully satisfied end-to-end: 137-01 emits the SSE payload, 137-05 renders it safely in the widget.
- Real-browser card rendering and host-page `target=_top` navigation verification remain E2E-deferred per 137-VALIDATION.md (Manual-Only) — no live xphere+stuscle stack exists in this execution environment; the jsdom-covered contract (buffer/flush timing, textContent-only DOM, Add→submitMessage routing, no-url/unknown-event graceful degradation) is proven by the green `tests/widget.test.ts` suite and the bundle-content assertion.
- This was the final plan of Phase 137 (and the final phase of the medusa-commerce workstream) — all three phase requirements (UIX-01, UIX-02, UIX-03) are now complete.

---
*Phase: 137-product-cards-order-status*
*Completed: 2026-07-17*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (8716f587, 28599d69) verified present in git log.
