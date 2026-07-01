---
phase: 117
slug: billing-observability
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
---

# Phase 117 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (see `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/billing-webhook.test.ts tests/billing-credit-rpcs.test.ts` |
| **Full suite command** | `npm run build` (includes type check) then `npx vitest run` |
| **Estimated runtime** | ~10-15s for the two extended test files |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/billing-webhook.test.ts tests/billing-credit-rpcs.test.ts`
- **After every plan wave:** `npm run build && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 117-01-01 | 01 | 1 | BOB-01 | unit (extend existing) | `npx vitest run tests/billing-webhook.test.ts -t "processing failure"` | ✅ existing file, extend | ⬜ pending |
| 117-01-02 | 01 | 1 | BOB-02 | unit (extend existing) | `npx vitest run tests/billing-credit-rpcs.test.ts -t "fails OPEN"` | ✅ existing file, extend | ⬜ pending |
| 117-01-03 | 01 | 1 | BOB-03 | manual (no new code path) | Query `/admin/logs?source=stripe-webhook` and `?source=billing-credits` after a real/staged failure | N/A — verifies existing, unchanged `getPlatformLogs()` behavior | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/billing-webhook.test.ts` — add `vi.mock('@/lib/logger', () => ({ log: vi.fn() }))`, assert in the existing "processing failure" test — covers BOB-01
- [ ] `tests/billing-credit-rpcs.test.ts` — add `vi.mock('@/lib/logger', () => ({ log: vi.fn() }))`, assert in the two existing "fails OPEN" tests — covers BOB-02
- Both are extensions of existing files, not new files; no framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Admin can see billing failures via `/admin/logs` filtered by source | BOB-03 | No new code path — this is the existing, already-shipped `getPlatformLogs()`/`/admin/logs` page continuing to work unchanged; verifying it requires a real row to exist and a page load, not unit-testable in isolation | After BOB-01/BOB-02 land, trigger (or wait for) a real or staged webhook/debit failure, then load `/admin/logs?source=stripe-webhook` or `?source=billing-credits` and confirm the row appears with correct severity/error_message |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (BOB-01/BOB-02) or documented manual verification (BOB-03, a pre-existing unchanged code path)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify or manual gate
- [x] Wave 0 covers all MISSING references — both test-file extensions
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-01
