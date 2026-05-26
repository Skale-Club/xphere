---
phase: 109
slug: identity-trigger
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 109 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| **Framework** | vitest 1.x + pg client via db-query.mjs |
| **Quick run** | `npm run build` |
| **Full suite** | `npm run lint && npm run build && npx vitest run` |
| **Migration test** | apply via apply-1061.mjs + 6 trigger probes |
| **Estimated runtime** | ~90 seconds |

## Sampling Rate

- Migration tasks: SQL probes for each trigger (deferred-pass, deferred-fail, orphan-block, orphan-allow, promote, archived-exempt)
- TS tasks: `npm run build` exit 0
- Vitest task: 6 tests pass against prod (or soft-skip)
- Max feedback latency: ~90 seconds

## Wave 0 Requirements

None — vitest + pg + apply-script pattern established in prior phases.

## Manual-Only Verifications

None — all logic is trigger-based and SQL-probable.

## Validation Sign-Off

- [x] All trigger functions covered by SQL probes
- [x] Status-based skip (channel_only) verified end-to-end
- [x] Orphan delete blocked + allowed paths both tested
- [x] Promotion (channel_only → identified) verified
- [x] archived_duplicate exemption verified

**Approval:** approved 2026-05-26
