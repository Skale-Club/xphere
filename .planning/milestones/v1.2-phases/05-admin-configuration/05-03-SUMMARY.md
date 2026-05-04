---
phase: 05-admin-configuration
plan: 03
subsystem: widget
tags: [widget, esbuild, vitest, shadow-dom, admin-config]

# Dependency graph
requires:
  - phase: 05-admin-configuration
    plan: 01
    provides: token-scoped public widget config endpoint with normalized defaults
  - phase: 05-admin-configuration
    plan: 02
    provides: admin-managed widget display name, color, and welcome message
provides:
  - widget boot-time config hydration from `/api/widget/[token]/config`
  - fallback-safe runtime theming for display name, primary color, and welcome message
  - widget runtime tests covering successful hydration and failed-config fallback
affects: [05-04, public-widget-runtime, embed-install-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - preserve synchronous `document.currentScript` capture, then hydrate widget config asynchronously after mount
    - drive widget theming through a Shadow DOM CSS custom property on the host element

key-files:
  created: []
  modified:
    - src/widget/index.ts
    - tests/widget.test.ts
    - public/widget.js

key-decisions:
  - "Keep widget boot non-blocking by fetching admin config after DOM mount so token capture and fallback boot remain intact."
  - "Apply admin primary color through a shared Shadow DOM CSS variable so the bubble, avatars, user bubble, and send button update together."

patterns-established:
  - "Public widget config is normalized client-side before use, with Phase 4 defaults reused on fetch or payload failure."
  - "Widget runtime tests mock the boot config fetch and chat POST independently to protect both startup hydration and send flow behavior."

requirements-completed: [ADMIN-01]

# Metrics
duration: 2 min
completed: 2026-04-04
---

# Phase 05 Plan 03: Widget Runtime Config Hydration Summary

**Public widget now hydrates admin-managed display name, primary color, and welcome message from the token-scoped config endpoint while preserving Phase 4 fallback safety.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T19:08:45Z
- **Completed:** 2026-04-04T19:10:58Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added boot-time widget config fetching against `/api/widget/[token]/config` using the existing script-origin-derived `apiBase`
- Applied admin-configured display name, welcome copy, and theme color without breaking session persistence, double-init protection, or chat send flow
- Expanded widget runtime tests for successful config hydration, failed fetch fallback, and preserved invalid-token chat error behavior
- Rebuilt `public/widget.js` so the shipped embed asset includes the new hydration logic

## Task Commits

Each task was committed atomically:

1. **Task 1: Fetch public widget config during widget boot** - `9267450` (feat)
2. **Task 2: Extend widget tests for config hydration and fallback** - `e6c4672` (test)
3. **Task 3: Rebuild the distributable widget asset** - `d59bd85` (feat)

## Files Created/Modified
- `src/widget/index.ts` - fetches public widget config at startup, normalizes values, and applies runtime UI overrides via Shadow DOM state
- `tests/widget.test.ts` - covers config hydration success, fetch fallback, and preserved invalid-token chat handling
- `public/widget.js` - rebuilt minified embed bundle containing the config-fetch runtime changes

## Decisions Made
- Kept config hydration asynchronous after the widget mounts so synchronous `document.currentScript` token capture stays unchanged.
- Used a single Shadow DOM CSS variable for the primary color so all key widget shell surfaces update together from one validated value.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- Widget runtime now consumes the admin config endpoint safely and the shipped asset has been regenerated.
- Ready for 05-04 verification of token rotation and real embed behavior.

## Self-Check: PASSED

---
*Phase: 05-admin-configuration*
*Completed: 2026-04-04*
