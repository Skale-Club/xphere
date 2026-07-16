---
phase: 129
slug: provider-synchronization-integrity
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 129 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run tests/google-calendar-busy.test.ts tests/xkedule-webhook.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s quick, ~3 min full |

## Sampling Rate

- **After every task commit:** quick run command (mocked)
- **After every plan wave:** add `tests/integrations-rls.test.ts` (real DB, soft-skip)
- **Before `/gsd:verify-work`:** full suite green
- **Max feedback latency:** 180 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (planner fills) | — | — | SYNC-01 | unit (mocked fetch) | `npx vitest run tests/google-calendar-busy.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SYNC-01 | integration (real DB RLS regression) | `npx vitest run tests/integrations-rls.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SYNC-01 | unit (google event id persistence) | same/new file per planner | ❌ W0 | ⬜ |
| (planner fills) | — | — | SYNC-02 | unit (webhook status mapping + lifecycle call) | `npx vitest run tests/xkedule-webhook.test.ts` | ❌ W0 (shared with phase 127 if it created it first — extend, don't duplicate) | ⬜ |
| (planner fills) | — | — | SYNC-02 | doc/static (GHL scope verification) | grep-based assertions per plan | — | ⬜ |

## Wave 0 Requirements

- [ ] `tests/google-calendar-busy.test.ts` — fetchBusyTimes multi-calendar-id support (SYNC-01)
- [ ] `tests/integrations-rls.test.ts` — org-scoping regression proof (SYNC-01)
- [ ] `tests/xkedule-webhook.test.ts` — status mapping (completed→showed) + lifecycle-service-call behavior (SYNC-02); if phase 127 already created this file, EXTEND it
- [ ] GHL: orchestrator decision — no GHL→bookings write path exists; SYNC-02 GHL scope = verify + document + assert no direct bookings writes from src/lib/ghl/** (grep-based test acceptable)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration apply to prod (google event id storage) | SYNC-01 | Via Supabase MCP by orchestrator at phase end | Apply via MCP, re-run suites green |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity holds
- [x] `nyquist_compliant: true`

**Approval:** pending
