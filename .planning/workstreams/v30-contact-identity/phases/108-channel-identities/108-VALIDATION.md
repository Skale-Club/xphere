---
phase: 108
slug: channel-identities
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 108 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | vitest 1.x + pg client via db-query.mjs |
| **Quick run** | `npm run build` |
| **Full suite** | `npm run lint && npm run build` |
| **Estimated runtime** | ~90 seconds |

## Sampling Rate

- Migration tasks: SQL probes (table+UNIQUE+CHECK+RLS+CASCADE+backfill idempotency)
- TS tasks: `npm run build` exit 0
- Webhook tasks: grep for findByChannelIdentity + attachChannelIdentity wiring
- Max feedback latency: ~90 seconds

## Wave 0 Requirements

None — vitest + pg + manual type regen pattern established in prior phases.

## Manual-Only Verifications

None — all DDL + helpers + wiring is SQL-probable or grep-verifiable.

## Validation Sign-Off

- [x] Migration probes cover UNIQUE, CHECK, ON DELETE CASCADE, RLS
- [x] Backfill idempotency probe (run twice, second is no-op)
- [x] All TS tasks have `npm run build` gate
- [x] No watch-mode flags

**Approval:** approved 2026-05-26
