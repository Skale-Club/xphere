---
phase: 130
slug: calendar-product-coherence
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 130 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 (node env — no @testing-library/react in this repo; UI verified via extracted pure functions + browser QA) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run tests/calendar-bookings-list.test.ts tests/calendar-bookings-page.test.ts tests/contacts-actions-bookings.test.ts tests/calendar-scope.test.ts tests/event-types-actions.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s quick, ~3 min full |

## Sampling Rate

- **After every task commit:** quick run command (mocked, no live DB)
- **After every plan wave:** full suite
- **Before `/gsd:verify-work`:** full suite green + browser QA checklist
- **Max feedback latency:** 180 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (planner fills) | — | — | SYNC-03 | unit | `npx vitest run tests/calendar-bookings-list.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SYNC-03 | unit (pure bucketing fn) | `npx vitest run tests/calendar-bookings-page.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SYNC-03 | unit | `npx vitest run tests/contacts-actions-bookings.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SYNC-03 | unit | `npx vitest run tests/calendar-scope.test.ts` | ❌ W0 (shared with phase 127 — EXTEND if it exists) | ⬜ |
| (planner fills) | — | — | SYNC-04 | unit | `npx vitest run tests/event-types-actions.test.ts` | ❌ W0 | ⬜ |

## Wave 0 Requirements

- [ ] `tests/calendar-bookings-list.test.ts` — bounded/paginated getBookings replacement (SYNC-03)
- [ ] `tests/calendar-bookings-page.test.ts` — status bucketing incl. `showed` (extract pure fn first) (SYNC-03)
- [ ] `tests/contacts-actions-bookings.test.ts` — event_types(title) join read correctness (SYNC-03)
- [ ] `tests/calendar-scope.test.ts` — organizer hydration (SYNC-03; extend phase 127's file if present)
- [ ] `tests/event-types-actions.test.ts` — event type create/update regression (SYNC-04)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard rendering after control removal (round_robin, dead location kinds, default_location_type) | SYNC-04 | No component-render test infra in repo | Browser QA: event-type dialog/form shows only supported options; bookings page shows showed bucket; calendar view loads bounded range |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity holds
- [x] `nyquist_compliant: true`

**Approval:** pending
