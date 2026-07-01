---
phase: 115-credit-balance-visibility
plan: 03
subsystem: ui
tags: [react, nextjs, supabase-realtime, popover, shadcn, billing]

# Dependency graph
requires:
  - phase: 115-credit-balance-visibility (Plan 01)
    provides: resolveCreditsVisibility(), hasCreditsPlan(), getCreditsVisualState(), toCredits() exports
  - phase: 115-credit-balance-visibility (Plan 02)
    provides: Realtime publication on copilot_credit_balances (migration 1226), applied and verified live
provides:
  - CreditsIndicator client component — Popover trigger + Realtime subscription + 3-state visual badge
  - TopBar/MobileMenu wiring rendering CreditsIndicator in desktop actions row and mobile Quick Actions grid
  - (dashboard)/layout.tsx resolving credits visibility alongside (not replacing) the existing entitlements gate
  - src/lib/billing/credits-visibility.ts — client-safe (no 'server-only') home for the pure hasCreditsPlan/getCreditsVisualState logic
affects: [116-billing-test-coverage, 117-billing-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client component reads pure billing logic from a dedicated non-'server-only' module (credits-visibility.ts) instead of the server-only wallet facade, to avoid pulling server-only code into client bundles"
    - "Realtime postgres_changes handler re-maps raw snake_case DB column names manually — never trusts payload.new to match the camelCase app-level interface"

key-files:
  created:
    - src/components/billing/credits-indicator.tsx
    - src/lib/billing/credits-visibility.ts
  modified:
    - src/components/layout/top-bar.tsx
    - src/app/(dashboard)/layout.tsx
    - src/lib/billing/credits.ts

key-decisions:
  - "Extracted hasCreditsPlan/getCreditsVisualState out of credits.ts (which has a top-level `import 'server-only'`) into a new client-safe module, credits-visibility.ts, after the production build failed with a server-only bundling error the moment the client CreditsIndicator component imported from credits.ts. credits.ts now re-exports both names for backward compatibility with existing tests and (dashboard)/layout.tsx."
  - "Task 4's manual checkpoint was approved by the user based on code/build/test review rather than a live clicked-through browser session — see Known Gaps below."

requirements-completed: [CRB-01, CRB-04]

# Metrics
duration: 27min
completed: 2026-07-01
---

# Phase 115 Plan 03: CreditsIndicator Component + TopBar/MobileMenu Wiring Summary

**New `CreditsIndicator` client component (Popover + Supabase Realtime clone of `NotificationBell`) rendered in both the desktop `TopBar` and the mobile `MobileMenu` Quick Actions grid, fed by a new `resolveCreditsVisibility()` call in `(dashboard)/layout.tsx` — completing CRB-01 through CRB-04's user-facing surface.**

## Performance

- **Duration:** ~27 min
- **Started:** 2026-07-01T14:49:43Z
- **Completed:** 2026-07-01T15:15:53Z
- **Tasks:** 4 (3 automated + 1 manual checkpoint)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `CreditsIndicator` component: `Sparkles`-icon `Popover` trigger with a conditional dot badge (amber for low, destructive-red for zero, no badge when healthy), a breakdown popover ("Copilot credits" header, rounded credit total, "{X} from your plan · {Y} purchased" line, low/zero inline note, "Manage billing" link that closes the popover before navigating to `/settings/billing`)
- Supabase Realtime `postgres_changes` subscription scoped to the org's `copilot_credit_balances` row, reading raw snake_case payload fields (`included_balance_usd`, `topup_balance_usd`, `included_allowance_usd`) per the established pitfall in RESEARCH.md — balance updates in place with no page reload
- `TopBar` renders the indicator between `ThemeToggle` and `OrgSwitcher` in the desktop actions row, gated by `hasCreditsPlan`
- `MobileMenu`'s Quick Actions grid gained a 4th "Credits" tile (grid stays `grid-cols-3`, tile wraps to a new row), using the same invisible-overlay-over-visible-icon technique as the existing Notifications tile, including `pointer-events-none` on the decorative icon/label
- `(dashboard)/layout.tsx` calls `resolveCreditsVisibility(activeOrgId)` alongside (not replacing) the existing `isBillingEnforced() ? await getEntitlements() : null` line, and passes `hasCreditsPlan`/`copilotBalance` down to `TopBar`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the CreditsIndicator component** - `1374141c` (feat)
2. **Task 2: Wire CreditsIndicator into TopBar (desktop) and MobileMenu (mobile)** - `0321d21a` (feat)
3. **Task 3: Resolve credits visibility in the dashboard layout and pass to TopBar** - `77bb28e9` (feat, includes the Rule 3 blocking-issue fix below)
4. **Task 4: Manual verification checkpoint** - approved (see Deviations/Known Gaps — no separate commit; verification-only task)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified
- `src/components/billing/credits-indicator.tsx` - New `CreditsIndicator` client component (Popover + Realtime + 3-state visual badge)
- `src/lib/billing/credits-visibility.ts` - New client-safe module holding `hasCreditsPlan()` and `getCreditsVisualState()` (no `server-only` import)
- `src/lib/billing/credits.ts` - Now imports and re-exports `hasCreditsPlan`/`getCreditsVisualState` from `credits-visibility.ts` instead of defining them locally
- `src/components/layout/top-bar.tsx` - `TopBarProps`/`MobileMenu` props extended with `hasCreditsPlan`/`copilotBalance`; renders `CreditsIndicator` in the desktop actions row and as a 4th mobile Quick Actions tile
- `src/app/(dashboard)/layout.tsx` - Added `resolveCreditsVisibility(activeOrgId)` call and threaded `hasCreditsPlan`/`copilotBalance` into the `<TopBar/>` call site

## Decisions Made
- Extracted the pure CRB-03/CRB-04 logic into `credits-visibility.ts` rather than stripping `server-only` from `credits.ts` wholesale — keeps the wallet facade (`getCopilotBalance`, `meterDebit`, etc., all genuinely server-only IO) protected from accidental client import, while making the pure threshold/gating functions safely importable from a client component. `credits.ts` re-exports both names so no existing caller or test (`tests/billing-credits-visibility.test.ts`, `tests/billing-credits-indicator.test.ts`, `(dashboard)/layout.tsx`) needed to change its import path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted hasCreditsPlan/getCreditsVisualState out of the server-only credits.ts module**
- **Found during:** Task 3 (`npm run build` verification)
- **Issue:** `npm run build` failed to compile with: `You're importing a module that depends on "server-only" ... but you are using it in the Pages Router` — traced to `credits-indicator.tsx` (a `'use client'` component) importing `getCreditsVisualState` from `src/lib/billing/credits.ts`, which has a top-level `import 'server-only'`. This wasn't visible until the real production build ran (task 1/2's isolated `tsc --noEmit` greps didn't catch it, since `server-only` is a webpack-time bundling constraint, not a type error).
- **Fix:** Created `src/lib/billing/credits-visibility.ts` containing the two pure, IO-free functions (`hasCreditsPlan`, `getCreditsVisualState`) with no `server-only` import. `credits.ts` now imports and re-exports both for backward compatibility. `credits-indicator.tsx` imports `getCreditsVisualState` directly from the new module.
- **Files modified:** `src/lib/billing/credits-visibility.ts` (new), `src/lib/billing/credits.ts`, `src/components/billing/credits-indicator.tsx`
- **Verification:** `npm run build` passes clean (webpack compile succeeds, no server-only error); `npx vitest run tests/billing-credits-visibility.test.ts tests/billing-credits-indicator.test.ts` — both files still pass unchanged (same import path `@/lib/billing/credits` still works via re-export)
- **Committed in:** `77bb28e9` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for correctness — the feature would not have compiled/shipped without this fix. No scope creep; the fix is a pure refactor (move + re-export), no behavior change to either function.

## Issues Encountered

- The build's TypeScript-checking phase hit a Node heap OOM (`FATAL ERROR: Ineffective mark-compacts near heap limit`) on the first `npm run build` retry after the server-only fix, in this environment's default Node heap size. Resolved by rerunning with `NODE_OPTIONS="--max-old-space-size=6144" npm run build`, which completed successfully. This is an environment/machine constraint, not a code issue — no source changes were made for this.

## User Setup Required

None - no external service configuration required.

## Known Gaps

**Task 4 (manual verification checkpoint) was approved based on code/build/test review, not a live clicked-through browser session.** The coordinating session attempted a live browser check via a connected Chrome extension, but it could not reach `localhost:4267` (a cross-machine/network limitation — the dev server itself was separately confirmed responding 200 via local `fetch`/curl checks in this executor's session). The user chose to approve based on:
- `npm run build` passing clean (webpack + TypeScript, no errors)
- The full targeted test suite passing (`tests/billing-entitlements-unit.test.ts`, `tests/billing-credits-visibility.test.ts`, `tests/billing-credits-indicator.test.ts`, `tests/notifications/*` — 42/42 passed)
- Direct code review confirming the component/wiring matches `115-UI-SPEC.md`'s Component Contract exactly (Popover structure, trigger styling, 3 visual states, Realtime snake_case payload field reads, click-through "Manage billing" link, mobile grid tile technique with `pointer-events-none`)

This is **not** equivalent to the live render/click-through/Realtime-update verification the checkpoint's `<how-to-verify>` steps describe (rendering with a real org's data, actually clicking the popover open, actually triggering a balance UPDATE and watching it propagate, actually resizing to mobile width). Per `115-VALIDATION.md`'s documented waiver, this repo has no automated component-render harness, so this manual step was the intended substitute — but it was itself only partially executed (build/test/code-review substitution, not a live session). If a regression in the rendered/interactive behavior exists that neither `tsc`/webpack nor the pure-logic unit tests would catch (e.g., a Tailwind class typo, a Popover prop mismatch, an actual runtime error in the Realtime handler only triggered by a real event), it would not have been caught by this verification pass. Recommend a real click-through pass next time a browser session can reach this dev environment, before relying on this indicator in a live user-facing demo.

## Next Phase Readiness
- CRB-01 through CRB-04 are all now implemented and committed; Phase 115 (Credit Balance Visibility) is complete (3/3 plans).
- Phase 116 (Billing Test Coverage) and Phase 117 (Billing Observability) have no direct code dependency on this plan's UI work, but both should be aware `credits-visibility.ts` is now the canonical home for `hasCreditsPlan`/`getCreditsVisualState` if they need to reference or extend that logic.
- Flagged (carried over from Plan 02, not addressed in this plan): the CLI auth/migration-history desync for this Supabase project (`mwklvkmggmsintqcqfvu`) remains unresolved — `npx supabase db push` will still fail until the user runs `supabase login` + `supabase migration repair` for the affected versions. Not a blocker for any of this milestone's remaining phases since migrations have been applied via the Management API as a fallback.

---
*Phase: 115-credit-balance-visibility*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: `src/components/billing/credits-indicator.tsx`
- FOUND: `src/lib/billing/credits-visibility.ts`
- FOUND: `src/components/layout/top-bar.tsx`
- FOUND: `src/app/(dashboard)/layout.tsx`
- FOUND: `.planning/workstreams/billing-robustness/phases/115-credit-balance-visibility/115-03-SUMMARY.md`
- FOUND: commit `1374141c`
- FOUND: commit `0321d21a`
- FOUND: commit `77bb28e9`
