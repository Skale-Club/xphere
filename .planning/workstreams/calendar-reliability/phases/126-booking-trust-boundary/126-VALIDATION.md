---
phase: 126
slug: booking-trust-boundary
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 126 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (repo root) — `environment: 'node'`, includes `tests/**/*.test.ts(x)`, setup loads `.env.local` |
| **Quick run command** | `npx vitest run tests/calendar-bookings.test.ts tests/calendar-slots.test.ts` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~30 seconds (quick), ~3 min (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/calendar-bookings.test.ts tests/calendar-slots.test.ts` (mocked, no live DB)
- **After every plan wave:** Run `npx vitest run tests/calendar-overlap-constraint.test.ts tests/calendar-rls.test.ts tests/mcp-bookings.test.ts tests/calendar-cancel-page.test.ts` (real-DB suites soft-skip when env vars absent)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | CAL-01 | unit (mocked Supabase) | `npx vitest run tests/calendar-bookings.test.ts` | ✅ extend | ⬜ pending |
| (filled by planner) | — | — | CAL-01 | unit (mocked Supabase) | `npx vitest run tests/mcp-bookings.test.ts` | ❌ W0 | ⬜ pending |
| (filled by planner) | — | — | CAL-02 | integration (real DB `pg.Client`) | `npx vitest run tests/calendar-overlap-constraint.test.ts` | ❌ W0 | ⬜ pending |
| (filled by planner) | — | — | CAL-03 | unit/integration | `npx vitest run tests/calendar-cancel-page.test.ts` | ❌ W0 | ⬜ pending |
| (filled by planner) | — | — | CAL-04 | integration (real anon client) | `npx vitest run tests/calendar-rls.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/calendar-overlap-constraint.test.ts` — real-DB `pg.Client` test for new `CHECK` + exclusion constraint (CAL-02); copy `BEGIN/COMMIT` + soft-skip pattern from `tests/contact-identity-trigger.test.ts`
- [ ] `tests/calendar-rls.test.ts` — real anon-client RLS negative tests for `bookings`/`user_availability`/`event_types` (CAL-04); copy pattern from `tests/rls-isolation.test.ts`
- [ ] `tests/mcp-bookings.test.ts` — mocked-Supabase unit test for `src/lib/mcp/tools/bookings.ts::bookings_create` (CAL-01); model on `tests/calendar-bookings.test.ts` `buildFakeAdmin` proxy pattern
- [ ] `tests/calendar-cancel-page.test.ts` — assert cancel page GET path performs zero writes (CAL-03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production migration apply (btree_gist + exclusion constraint) | CAL-02 | Prod DB apply happens via Supabase MCP `apply_migration` by operator; pre-flight audit query must confirm no existing overlapping confirmed bookings | Run pre-flight overlap audit SQL from RESEARCH.md against prod before applying migration |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
