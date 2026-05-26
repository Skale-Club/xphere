---
phase: 107
slug: unique-constraints
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 107 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | vitest 1.x + pg client via db-query.mjs |
| **Quick run** | `npm run build` |
| **Full suite** | `npm run lint && npm run build && npx vitest run` |
| **Race test** | `npx vitest run tests/contacts-unique-constraint.test.ts` |
| **Estimated runtime** | ~90 seconds |

## Sampling Rate

- Migration tasks: SQL probe via db-query.mjs in acceptance
- TS tasks: `npm run build` exit 0 in acceptance
- Race test task: vitest exit 0 with both pass + soft-skip logic
- Max feedback latency: ~90 seconds

## Wave 0 Requirements

None — vitest + pg already installed; `vi.mock('server-only')` pattern + race-test pattern established in Phase 106.

## Manual-Only Verifications

| Behavior | Why Manual | Test |
|---|---|---|
| Form toast on duplicate | Visual judgment | Submit contact form with existing phone/email, observe toast copy + link |
| Multi-conflict admin link | Visual + routing | Trigger merge_conflict via two-contact scenario, observe admin link in toast |

## Validation Sign-Off

- [x] Migration tasks have SQL probes
- [x] All TS tasks have `npm run build` gate
- [x] Race test is the canonical correctness proof for the UNIQUE constraint
- [x] No watch-mode flags

**Approval:** approved 2026-05-26
