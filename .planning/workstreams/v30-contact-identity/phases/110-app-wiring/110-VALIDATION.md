---
phase: 110
slug: app-wiring
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 110 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | vitest 1.x + pg client |
| **Quick run** | `npm run build` |
| **Full suite** | `npm run lint && npm run build && npx vitest run` |
| **Estimated runtime** | ~120 seconds (more files than prior phases) |

## Sampling Rate

- Migration task: SQL probes for table/RLS/CASCADE/UNIQUE
- TS tasks: `npm run build` exit 0
- Unit tests: `npx vitest run` (isBlockedEmail tests)
- UI changes: visual via dev server (manual)

## Wave 0 Requirements

None — all infrastructure established in prior phases.

## Manual-Only Verifications

| Behavior | Why Manual | Test |
|---|---|---|
| Badge renders per identity_status | Visual judgment | Load contact-info-panel for contacts of each status |
| Conflict filter chip toggles correctly | UX flow | Click chip on /contacts page, verify URL + filter |
| "Mark verified" button UX | UX flow | Click button on identified contact, verify status bump + toast |
| CSV pre-flight surface | UX flow | Upload CSV with known duplicates, verify conflict count shown |

## Validation Sign-Off

- [x] Migration 1062 SQL-probed
- [x] isBlockedEmail unit-tested
- [x] markContactVerified idempotency tested
- [x] CSV refactor preserves batch shape, uses normalized columns
- [x] Build green
- [x] Manual UI verifications documented for ship-readiness

**Approval:** approved 2026-05-26
