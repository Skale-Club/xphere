---
phase: 115-credit-balance-visibility
verified: 2026-07-01T15:29:01Z
status: human_needed
score: 6/6 must-haves verified (automated); 1 item requires live human click-through before production ship
human_verification:
  - test: "Live click-through: indicator renders on a credit-bearing org, popover opens with included/topup breakdown, 'Manage billing' link navigates to /settings/billing"
    expected: "Sparkles icon appears in desktop TopBar between ThemeToggle and OrgSwitcher; clicking opens a popover showing 'Copilot credits', rounded total, '{X} from your plan · {Y} purchased', and a working 'Manage billing' link that closes the popover and navigates"
    why_human: "No component-render test harness exists in this repo (vitest environment: 'node', no @testing-library/react/jsdom) — this is a pre-existing, documented repo-wide gap (VALIDATION.md waiver), not specific to this phase. Task 4's checkpoint was approved based on code review + passing build/tests, NOT an actual clicked-through browser session (the orchestrating session's connected Chrome browser was on a different machine/network with no route to localhost:4267)."
  - test: "Live Realtime update: trigger a balance UPDATE on copilot_credit_balances while the dashboard is open, confirm the indicator's number changes without a page reload"
    expected: "Indicator balance updates within a few seconds of the UPDATE, with no manual reload"
    why_human: "Requires a live Supabase connection + real browser session to observe the postgres_changes event actually arriving and re-rendering. The publication membership was confirmed live via SQL query (pg_publication_tables), but the client-side subscription's actual event handling was never observed firing in a real browser."
  - test: "Low/zero visual state transitions and CRB-03 absence for orgs with no credits plan"
    expected: "Icon/badge turn amber at <=20% of allowance, destructive-red at <=0; indicator is entirely absent (not a broken/zero pill) for an org with no credit-bearing plan and no balance row"
    why_human: "Threshold logic (getCreditsVisualState) is unit-tested and confirmed correct in isolation, but the actual Tailwind class rendering, badge geometry, and conditional-absence behavior in a real page load were not visually observed."
---

# Phase 115: Credit Balance Visibility Verification Report

**Phase Goal:** Users can see their org's credit balance at a glance from anywhere in the dashboard, with it staying current and guiding them toward billing when it matters.
**Verified:** 2026-07-01T15:29:01Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An org whose plan resolves to a nonzero `copilotIncludedUsd`, OR that already has a nonzero credit balance/allowance, is classified as "has a credits plan" | VERIFIED | `hasCreditsPlan()` in `src/lib/billing/credits-visibility.ts` implements exactly this OR-logic; `tests/billing-credits-visibility.test.ts` (4/4 passing) covers all four boundary cases |
| 2 | An org with no credit-bearing plan and no existing balance row is classified as "does not have a credits plan" | VERIFIED | Same function, same test file — the `false` case (`planCopilotIncludedUsd: 0, balanceIncludedAllowanceUsd: 0, balanceTotalUsd: 0`) passes |
| 3 | Balance thresholds (healthy/low/zero at 20% boundary, zero-allowance guard) are correctly classified | VERIFIED | `getCreditsVisualState()` in `credits-visibility.ts`; `tests/billing-credits-indicator.test.ts` (8/8 passing) covers zero, negative, exact-boundary, just-above-boundary, full, zero-allowance, and zero-both cases |
| 4 | On every dashboard page, an org whose plan includes credits sees a persistent balance indicator (included + topup) in the global TopBar | code-verified / NOT live-observed | `CreditsIndicator` rendered in `top-bar.tsx` desktop actions row and mobile `MobileMenu` grid, gated by `hasCreditsPlan`, fed from `resolveCreditsVisibility()` in `(dashboard)/layout.tsx`. Production build compiles clean. No live browser render was performed (see Human Verification). |
| 5 | The indicator is absent for an org with no credit-bearing plan and no existing balance row | code-verified / NOT live-observed | Guarded by `{hasCreditsPlan && <CreditsIndicator .../>}` in both desktop and mobile render sites, plus a defensive `if (!orgId \|\| !balance) return null` inside the component itself. Logic is sound; visual absence was not observed in a live page load. |
| 6 | After a debit/top-up, the indicator's balance updates live without a page reload | code-verified / NOT live-observed | Realtime `postgres_changes` UPDATE subscription on `copilot_credit_balances`, filtered by `org_id`, reads raw snake_case payload fields correctly (`included_balance_usd`, `topup_balance_usd`, `included_allowance_usd`). Publication membership confirmed live in remote DB (migration 1226, `pg_publication_tables` query returned the row per 115-02-SUMMARY.md). Client-side event handling was never observed firing in a real browser. |
| 7 | Low/zero balance shows distinct visual state (amber/destructive) with dot badge, clickable through to /settings/billing | code-verified / NOT live-observed | `visualState` drives `className` branches for both the trigger button and popover text; dot badge renders when `visualState !== 'healthy'`. "Manage billing" `<Link href="/settings/billing">` closes popover on click via `onClick={() => setOpen(false)}`. Matches UI-SPEC.md's Component Contract verbatim on code review. Click-through was never actually clicked in a browser. |
| 8 | On mobile, the indicator is reachable via a 4th Quick Actions tile, hidden when no credits plan | code-verified / NOT live-observed | 4th tile added after the Theme tile in `MobileMenu`, gated by `{hasCreditsPlan && (...)}`, using the same invisible-overlay + `pointer-events-none` technique as the existing Notifications tile. `grid-cols-3` unchanged (tile wraps a row). Not visually observed at mobile width. |

**Score:** 3/3 pure-logic truths fully verified via automated tests + code; 5/5 UI/wiring truths are code-verified (artifacts exist, are substantive, are wired, compile, and match spec) but NOT confirmed via an actual live click-through — this is the disclosed gap from 115-03-SUMMARY.md's "Known Gaps" section, not a phase failure.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/billing/credits.ts` | `resolveCreditsVisibility(orgId)` exported, returns `{ balance, hasCreditsPlan }` | VERIFIED | Present at lines 96-148; re-exports `hasCreditsPlan`/`getCreditsVisualState` from `credits-visibility.ts` for backward compatibility (line 10, 16) |
| `src/lib/billing/credits-visibility.ts` | Client-safe (no `server-only`) home for `hasCreditsPlan`/`getCreditsVisualState` | VERIFIED | New file, no `server-only` import, pure functions, matches interface exactly. Not in the original plan file list — added as a Rule-3 deviation in Plan 03, documented in SUMMARY |
| `src/components/billing/credits-card.tsx` | `toCredits()` exported (no longer private) | VERIFIED | `export function toCredits(usd: number): string` at line 38 |
| `src/components/billing/credits-indicator.tsx` | `CreditsIndicator` client component — Popover + Realtime + 3-state badge | VERIFIED | Full component present, matches UI-SPEC.md Component Contract, imports `getCreditsVisualState` from the new client-safe module and `toCredits` from `credits-card.tsx` |
| `src/components/layout/top-bar.tsx` | `CreditsIndicator` rendered in desktop actions row and MobileMenu Quick Actions grid | VERIFIED | Desktop: line 254, between `<ThemeToggle />` and `<OrgSwitcher/>`. Mobile: lines 188-196, 4th tile with `pointer-events-none` overlay technique |
| `src/app/(dashboard)/layout.tsx` | `resolveCreditsVisibility(activeOrgId)` called alongside existing entitlements resolution; props passed to TopBar | VERIFIED | Import at line 32, resolution block lines 87-102 (fail-open on error), `hasCreditsPlan`/`copilotBalance` passed at lines 245-246. Existing `isBillingEnforced() ? await getEntitlements()` line at 73 unmodified |
| `tests/billing-credits-visibility.test.ts` | Unit coverage for has-credits-plan logic | VERIFIED | 4/4 passing |
| `tests/billing-credits-indicator.test.ts` | Unit coverage for healthy/low/zero threshold | VERIFIED | 8/8 passing |
| `supabase/migrations/1226_copilot_credits_realtime.sql` | Idempotent `ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances` | VERIFIED | File present, exact idempotent `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` pattern matching migrations 024/1206. Applied to remote DB via Supabase Management API (CLI push blocked by pre-existing migration-history desync, same root cause as Phase 114); confirmed live via `pg_publication_tables` query per 115-02-SUMMARY.md |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `credits.ts` (`resolveCreditsVisibility`) | `entitlements.ts` (`resolveEffectivePlan`) | direct dynamic `import()` call | WIRED | Line 99, `await import('./entitlements')` then `resolveEffectivePlan(...)` called at line 120 |
| `credits.ts` (`resolveCreditsVisibility`) | `catalog.ts` (`getPlan`) | direct dynamic `import()` call | WIRED | Line 100, `getPlan(eff.planKey)` called at line 128 |
| `(dashboard)/layout.tsx` | `credits.ts` (`resolveCreditsVisibility`) | direct async call, result passed as TopBar props | WIRED | Import line 32, call line 91, props threaded lines 245-246 |
| `top-bar.tsx` | `credits-indicator.tsx` | import + render in both desktop row and MobileMenu grid | WIRED | Import line 16; render sites at line 254 (desktop) and line 193 (mobile) |
| `credits-indicator.tsx` | `copilot_credit_balances` table | Supabase Realtime `postgres_changes` UPDATE subscription, `org_id` filter | WIRED | Channel + `.on('postgres_changes', {event:'UPDATE', table:'copilot_credit_balances', filter: 'org_id=eq.${orgId}'})` at lines 36-43; publication membership confirmed live in remote DB |
| `credits-indicator.tsx` | `/settings/billing` | "Manage billing" link, closes popover before navigation | WIRED | `<Link href="/settings/billing" onClick={() => setOpen(false)}>` at lines 132-138 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `CreditsIndicator` | `balance` (`useState(initialBalance)`) | `initialBalance` prop, seeded server-side from `(dashboard)/layout.tsx`'s `resolveCreditsVisibility()` → `getCopilotBalance()` → real `copilot_credit_balances` DB row (or `EMPTY_BALANCE` zeros if no row) | Yes | FLOWING — real DB query (`.select('included_balance_usd', ...)` in `getCopilotBalance`), not a static/hardcoded stub |
| `CreditsIndicator` | `balance` (post-mount updates) | Realtime `postgres_changes` payload, mapped from real snake_case DB columns | Yes (contingent on the subscription actually firing, unconfirmed live) | FLOWING at the code level; live event delivery not observed in a browser session |
| `TopBar`/`MobileMenu` | `hasCreditsPlan`, `copilotBalance` props | `(dashboard)/layout.tsx`'s `resolveCreditsVisibility(activeOrgId)`, itself backed by real `organizations`/`billing_subscriptions`/`copilot_credit_balances` queries with a fail-open default (`false`/`null`) only on DB error | Yes | FLOWING — no hardcoded empty props at any call site |

No hollow-prop or disconnected-data-source patterns found. All rendering paths trace back to real queries with sensible fail-open defaults on error (not silent fake data).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pure logic: `hasCreditsPlan` boundary cases | `npx vitest run tests/billing-credits-visibility.test.ts` | 4/4 passed | PASS |
| Pure logic: `getCreditsVisualState` threshold cases | `npx vitest run tests/billing-credits-indicator.test.ts` | 8/8 passed | PASS |
| No regression to adjacent billing/notifications suites | `npx vitest run tests/billing-entitlements-unit.test.ts tests/notifications/*` | All passed (21 tests) | PASS |
| Full test suite — no new regressions from this phase | `npx vitest run` (full 1721-test suite) | 1303 passed, 64 failed, 28 skipped, 326 todo — all 64 failures are in unrelated subsystems (contacts, pipeline, meta-webhooks, action-engine, auth mocks, etc.), none touch billing/credits/notifications files, consistent with Phase 114/115-01's documented `deferred-items.md` pre-existing gap | PASS (no phase-115-attributable regressions) |
| Production build compiles clean, including the server-only bundling fix | `NODE_OPTIONS="--max-old-space-size=6144" npm run build` | Exit code 0, full route manifest generated, `verify-sw` postbuild guard passed | PASS |
| Live component render / click-through / Realtime event delivery | N/A — requires browser + live Supabase session | Not run (documented gap) | SKIP — routed to Human Verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CRB-01 | 115-03 | Persistent credit balance indicator (included + topup) in global sidebar/header on every dashboard page when plan includes credits | SATISFIED (code) / NEEDS HUMAN (live render) | `CreditsIndicator` wired into `top-bar.tsx`, fed real balance data; build compiles; never visually confirmed rendering |
| CRB-02 | 115-02, 115-03 | Indicator updates without full page reload after debit/top-up | SATISFIED (code) / NEEDS HUMAN (live update) | Realtime publication migration applied and confirmed live in `pg_publication_tables`; client subscription code correctly reads snake_case payload; live propagation never observed |
| CRB-03 | 115-01, 115-03 | Indicator hidden/empty-state for orgs without credit-bearing plan | SATISFIED (code) / NEEDS HUMAN (visual absence) | `hasCreditsPlan()` unit-tested (4/4), gates both render sites; visual absence in a real page load never observed |
| CRB-04 | 115-01, 115-03 | Distinct visual state (color/badge) for low/zero balance, clickable to billing settings | SATISFIED (code) / NEEDS HUMAN (visual states + click-through) | `getCreditsVisualState()` unit-tested (8/8, all boundary cases); Tailwind class branches and "Manage billing" link present in code; never visually confirmed or clicked |

No orphaned requirements — REQUIREMENTS.md maps exactly CRB-01 through CRB-04 to Phase 115, and all four appear across the three plans' `requirements` frontmatter fields (115-01: CRB-03, CRB-04; 115-02: CRB-02; 115-03: CRB-01, CRB-02, CRB-03, CRB-04).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TODO/FIXME/placeholder/stub patterns found in any of the 6 phase-115 files | — | None |

Scanned `credits.ts`, `credits-visibility.ts`, `credits-indicator.tsx`, `top-bar.tsx`, `(dashboard)/layout.tsx`, and the migration file for stub markers, empty-return handlers, hardcoded empty props, and console.log-only implementations. None found. All error paths (`resolveCreditsVisibility`'s catch block, `ensureCopilotProvisioned`'s catch block) fail open to sensible defaults with `console.error` logging, not silent swallowing of the happy path.

### Human Verification Required

**This is the central caveat of this verification.** All logic, wiring, data-flow, and build-time checks pass. However, the phase's core deliverable is a piece of interactive UI, and the one checkpoint designed to verify its actual rendered/interactive behavior (115-03 Task 4) was **not performed as a live clicked-through browser session** — it was approved based on code review, passing unit tests, and a clean production build. This is explicitly disclosed in 115-03-SUMMARY.md's "Known Gaps" section, and is being carried forward here rather than silently marked as fully verified.

### 1. Desktop indicator render + popover click-through

**Test:** Run `npm run dev`, open the dashboard for an org on a credit-bearing plan (or one with an existing topup balance). Confirm the Sparkles icon appears in the TopBar between the theme toggle and org switcher. Click it.
**Expected:** Popover opens showing "Copilot credits", a rounded credit total, "{X} from your plan · {Y} purchased" breakdown line, and a "Manage billing" link. Clicking "Manage billing" closes the popover and navigates to `/settings/billing`.
**Why human:** No component-render test harness in this repo (`environment: 'node'`, no `@testing-library/react`) — same pre-existing gap as `NotificationBell`. Code review confirms the JSX matches UI-SPEC.md exactly, but no render was ever observed.

### 2. Mobile Quick Actions tile

**Test:** Resize to mobile width (or device mode), open the hamburger menu, confirm a 4th "Credits" tile appears in the Quick Actions grid (wrapped to a new row) and tapping it opens the same popover.
**Expected:** Tile visible only when `hasCreditsPlan` is true; tapping opens the identical popover via the invisible-overlay technique.
**Why human:** Same rendering-harness gap; the overlay/`pointer-events-none` technique is copied verbatim from the existing (also never component-tested) Notifications tile, so precedent suggests it works, but this instance was not visually confirmed.

### 3. Live Realtime balance update

**Test:** Confirm migration 1226 is live (`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='copilot_credit_balances'` — already confirmed per 115-02-SUMMARY.md). With the dashboard open, trigger a balance change (a real Copilot turn debit, or a manual `UPDATE public.copilot_credit_balances SET included_balance_usd = included_balance_usd - 1 WHERE org_id = '<org-id>'`).
**Expected:** The indicator's number updates within a few seconds, without a page reload.
**Why human:** Requires a live Supabase Realtime connection and an actual browser tab open to observe the update — cannot be simulated in a unit test or a headless build check.

### 4. Low/zero visual states

**Test:** Simulate low balance (`included_balance_usd` at ~2.5% of `included_allowance_usd`) and zero balance (`included_balance_usd = 0, topup_balance_usd = 0`).
**Expected:** Icon/badge turn amber for low ("Running low on credits."), destructive-red for zero ("You're out of credits.").
**Why human:** Threshold math is unit-tested and correct; the actual Tailwind class application and visual contrast were never rendered in a browser.

### 5. CRB-03 absence for non-credits orgs

**Test:** Load the dashboard for an org with no credit-bearing plan and no existing balance row.
**Expected:** Indicator is entirely absent from both the desktop TopBar and the mobile Quick Actions grid — no broken/zero pill.
**Why human:** The gating boolean (`hasCreditsPlan`) is unit-tested and the conditional render (`{hasCreditsPlan && ...}`) is present in code at both render sites, but the actual DOM absence (vs. e.g. an empty Popover shell rendering) was never visually confirmed.

### Gaps Summary

No code-level gaps were found. Every artifact specified in the three plans' `must_haves` exists, is substantive (not a stub), is wired correctly end-to-end (server resolution → props → component → Realtime subscription → click-through link), and the full request/response/data-flow chain traces back to real database queries with sensible fail-open error handling — not hardcoded or disconnected data.

The single open item is procedural, not architectural: the phase's own validation strategy (115-VALIDATION.md) correctly anticipated that CRB-01/02/03/04's *rendered* behavior would need manual browser verification (since this repo has no component-render test harness), but the environment available during execution could not actually perform that verification — the connected Chrome browser had no network route to the dev server. The user approved the checkpoint anyway, based on code review + passing build/tests, and this was transparently logged as a "Known Gap" in 115-03-SUMMARY.md rather than concealed.

This phase should not be treated as fully production-verified until a real human click-through (items 1-5 above) is performed — ideally the next time a browser session can reach this dev environment, before this indicator is relied upon in a live user-facing demo or ships broadly. There is no evidence of a defect; the risk is specifically the class of bug that unit tests and `tsc`/webpack cannot catch (a Tailwind class typo, a Popover prop mismatch, a Realtime handler runtime error only triggered by a real event, an unexpected interaction between the invisible-overlay mobile technique and touch events).

---

*Verified: 2026-07-01T15:29:01Z*
*Verifier: Claude (gsd-verifier)*
