---
phase: 106
slug: merge-tool
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-25
---

# Phase 106 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | vitest 1.x + pg-based DB probes via `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/db-query.mjs` |
| **Quick run** | `npm run build` (types + compile gate) |
| **Full suite** | `npm run lint && npm run build` |
| **Estimated runtime** | ~90 seconds |

## Sampling Rate

- After every task commit: `npm run build` if TS files touched; SQL probe if migration touched
- After every plan wave: `npm run build` full
- Before verify: build green + all SQL probes return expected rows
- Max feedback latency: ~90 seconds

## Wave 0 Requirements

None — vitest + pg already installed (from Phase 105).

## Manual-Only Verifications

| Behavior | Why Manual | Test |
|---|---|---|
| Merge UI rendering empty state | Visual judgment in browser | Load `/admin/contacts/conflicts`, confirm empty state copy + refresh button |
| Merge confirmation modal copy | Wording check | Click "Merge into A" on synthetic test cluster |
| Banner on archived contact | Visual + link check | Manually mark a contact archived, load conversation that references it |

## Validation Sign-Off

- [x] Every migration task has a SQL probe in acceptance criteria
- [x] Every TS task has `npm run build` exit 0
- [x] Sampling continuity ≤ 3 consecutive tasks without automated verify
- [x] No watch-mode flags

**Approval:** approved 2026-05-25
