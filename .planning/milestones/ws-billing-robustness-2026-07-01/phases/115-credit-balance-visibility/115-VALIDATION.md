---
phase: 115
slug: credit-balance-visibility
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
---

# Phase 115 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (environment: `'node'`, globals: true, `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`) |
| **Quick run command** | `npx vitest run tests/billing-credits-indicator.test.ts tests/billing-credits-visibility.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10-20s for the two new pure-logic test files |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/billing-credits-indicator.test.ts tests/billing-credits-visibility.test.ts` (fast, pure-logic only)
- **After every plan wave:** `npx vitest run` (full suite — confirms no regression to `tests/billing-entitlements-unit.test.ts` or `tests/notifications/*` from the shared-pattern reuse)
- **Before `/gsd:verify-work`:** Full suite green; manual click-through required for CRB-01, CRB-02, CRB-04's visual/interactive aspects since no component-render harness exists in this repo (`environment: 'node'`, no `@testing-library/react`)
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 115-01-01 | 01 | 1 | CRB-03 | unit | `npx vitest run tests/billing-credits-visibility.test.ts` | ❌ W0 | ⬜ pending |
| 115-01-02 | 01 | 1 | CRB-04 | unit | `npx vitest run tests/billing-credits-indicator.test.ts` | ❌ W0 | ⬜ pending |
| 115-01-03 | 01 | 1 | CRB-01, CRB-04 | manual | Click-through: indicator renders, shows breakdown, clicks to /settings/billing | N/A — no render harness | ⬜ pending |
| 115-01-04 | 01 | 1 | CRB-02 | manual | Trigger a debit/top-up, confirm indicator updates without reload | N/A — needs live Supabase + browser | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/billing-credits-visibility.test.ts` — unit tests for the plan-includes-credits boolean resolution (CRB-03), following the `resolveEffectivePlan()` pure-function test style already in `tests/billing-entitlements-unit.test.ts`
- [ ] `tests/billing-credits-indicator.test.ts` — unit tests for the exported `getCreditsVisualState()` threshold function (CRB-04: healthy/low/zero at the 20% boundary and its edges: exactly 0, exactly 20%, just above/below)
- No framework install needed — Vitest is already configured and sufficient for the pure-logic tests this phase can produce

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Indicator renders with included+topup breakdown when plan has credits | CRB-01 | No component-render harness exists in this repo (`environment: 'node'`, no `@testing-library/react`/jsdom) — same gap `NotificationBell` itself has always had | Load the dashboard for an org on a credit-bearing plan, confirm the pill shows the correct rounded credit count and the popover shows included/topup breakdown |
| Balance updates live via Realtime without reload | CRB-02 | Requires a live Supabase connection + browser session, not unit-testable | Trigger a Copilot turn (or top-up) in one tab, confirm the indicator updates in another tab/page without a manual reload |
| Indicator hidden for orgs without a credit-bearing plan (visual confirmation) | CRB-03 | The boolean logic is unit-tested, but visual absence/empty-state rendering needs a real page load | Load the dashboard for an org whose plan resolves to no credits, confirm the indicator is absent or shows the empty state, not a broken/zero pill |
| 3-state visual threshold rendering + click-through link | CRB-04 | Threshold logic is unit-tested, but the actual color/badge rendering and click navigation need a real browser | Simulate low and zero balance states, confirm visual state changes (amber/destructive) and clicking navigates to `/settings/billing` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (unit tests for CRB-03/CRB-04 logic) or documented manual verification (CRB-01/CRB-02 rendering/live-update, consistent with the pre-existing gap for `NotificationBell`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify or manual gate
- [x] Wave 0 covers all MISSING references — the two new pure-logic test files
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Waiver note:** CRB-01 and CRB-02 have no automated coverage because this repo has no component-rendering test infrastructure at all (`vitest.config.ts` runs `environment: 'node'`, no `@testing-library/react`) — this is a pre-existing repo-wide gap, not something introduced by this phase, and matches the exact precedent of `NotificationBell` (the component this phase's pattern is copied from) never having been component-tested either. Adding `@testing-library/react` + `jsdom` is out of scope for this UI-only phase. The testable logic (CRB-03's visibility boolean, CRB-04's threshold function) is extracted as pure functions and unit-tested per Wave 0.

**Approval:** approved 2026-07-01
