---
phase: 127
slug: canonical-booking-lifecycle
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 127 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run tests/calendar/transition-dispatch.test.ts tests/calendar-bookings.test.ts tests/mcp-bookings.test.ts tests/workflows/engine.test.ts` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~40s quick, ~3 min full |

---

## Sampling Rate

- **After every task commit:** quick run command (fully mocked, no live DB)
- **After every plan wave:** add `tests/calendar-lifecycle-rpc.test.ts` + other real-DB suites (soft-skip without env)
- **Before `/gsd:verify-work`:** full suite green, real-DB suites not soft-skipped
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (planner fills) | — | — | LIFE-01 | unit | `npx vitest run tests/calendar/lifecycle.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | LIFE-01 | integration (real DB RPC) | `npx vitest run tests/calendar-lifecycle-rpc.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | LIFE-02 | static/unit vocabulary check | `npx vitest run tests/calendar-status-vocabulary.test.ts` | ❌ W0 | ⬜ |
| (planner fills) | — | — | LIFE-03 | unit | `npx vitest run tests/calendar-bookings.test.ts tests/mcp-bookings.test.ts tests/workflows/engine.test.ts tests/action-engine-booking.test.ts tests/xkedule-webhook.test.ts` | ✅ extend + ❌ W0 (3 new) | ⬜ |
| (planner fills) | — | — | LIFE-04 | unit | `npx vitest run tests/calendar-scope.test.ts` | ❌ W0 | ⬜ |

---

## Wave 0 Requirements

- [ ] `tests/calendar/lifecycle.test.ts` — canonical service guards/idempotency/one-event (LIFE-01)
- [ ] `tests/calendar-lifecycle-rpc.test.ts` — real-DB RPC atomic guard vs racing transition (LIFE-01)
- [ ] `tests/calendar-status-vocabulary.test.ts` — no out-of-vocabulary status literal reaches bookings writes (LIFE-02)
- [ ] `tests/mcp-bookings.test.ts` — extend with bookings_cancel event coverage (LIFE-03)
- [ ] `tests/workflows/engine.test.ts` — extend with booking_* action-node coverage (LIFE-03)
- [ ] `tests/action-engine-booking.test.ts` — booking_* cases in execute-action.ts (LIFE-03)
- [ ] `tests/xkedule-webhook.test.ts` — first test file for the Xkedule route: no-event-on-failed-update + completed→showed mapping (LIFE-03)
- [ ] `tests/calendar-scope.test.ts` — buildMeetingScope title-column fix + organizer population (LIFE-04)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| New lifecycle RPC migration apply to prod | LIFE-01 | Prod apply via Supabase MCP by orchestrator at phase end | Apply migration via MCP, re-run real-DB suites green |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
