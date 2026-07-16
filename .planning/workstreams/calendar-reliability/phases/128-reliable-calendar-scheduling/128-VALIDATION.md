---
phase: 128
slug: reliable-calendar-scheduling
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 128 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run tests/calendar-tick-window.test.ts tests/calendar-tick-route.test.ts tests/workflow-seeds-tenant-neutral.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s quick, ~3 min full |

## Sampling Rate

- **After every task commit:** quick run command (pure-function + route tests, mocked)
- **After every plan wave:** add `tests/calendar-tick-idempotency.test.ts` (real DB, transactional soft-skip)
- **Before `/gsd:verify-work`:** full suite green
- **Max feedback latency:** 180 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (planner fills) | — | — | SCH-01/02 | unit (pure fn) | `npx vitest run tests/calendar-tick-window.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SCH-02 | integration (real DB) | `npx vitest run tests/calendar-tick-idempotency.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SCH-03 | route auth test | `npx vitest run tests/calendar-tick-route.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | SCH-04 | seed YAML scan | `npx vitest run tests/workflow-seeds-tenant-neutral.test.ts` | ❌ W0 | ⬜ |

## Wave 0 Requirements

- [ ] Extract window/offset/dedup logic from `src/app/api/cron/calendar-tick/route.ts` into `src/lib/calendar/tick.ts` (prerequisite for unit testing)
- [ ] `tests/calendar-tick-window.test.ts` — watermark-bounded window + offset-derived dedup key
- [ ] `tests/calendar-tick-idempotency.test.ts` — real-DB (transaction+SAVEPOINT+rollback) unique-constraint dedup + watermark persistence
- [ ] `tests/calendar-tick-route.test.ts` — SCH-03 secret behavior (mirror tests/ghl-reengagement-route.test.ts)
- [ ] `tests/workflow-seeds-tenant-neutral.test.ts` — recursive YAML scan asserting no Skleanings-specific content in platform seeds

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration apply to prod (dedup constraint/watermark table) | SCH-02/03 | Via Supabase MCP by orchestrator at phase end | Apply via MCP, re-run real-DB suite green |
| CRON_SECRET set in GitHub Actions + Coolify | SCH-03 | Live env config | Confirm workflow yml sends secret; endpoint 401s without it |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity holds
- [x] `nyquist_compliant: true`

**Approval:** pending
