---
phase: 131
slug: chat-route-hardening
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-17
planned: 2026-07-17
---

# Phase 131 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; only `tests/**` is picked up — colocated tests are ignored) |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run tests/rate-limit.test.ts tests/chat-api.test.ts tests/custom-webhook.test.ts tests/widget-config-route.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick set < 10s (fully mocked); full suite ~60s+ (includes real-DB suites) |
| **Baseline caveat** | `tests/widget-config-route.test.ts` had 2 pre-existing failures — repaired in 131-01 Task 1 (Wave 0) before any new work lands |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** quick run + `npm run build` (type gate) + `npm run lint`
- **Before verify-work:** `npm test` full suite — the 4 phase test files green; any other failure must be shown pre-existing (DB-backed suites; capture baseline via `git stash && npm test` if unsure)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 131-01-T1 | 131-01 | 1 | Wave 0 baseline | unit | `npx vitest run tests/widget-config-route.test.ts` | ✅ (repairing 2 stale assertions) | ⬜ |
| 131-01-T2 | 131-01 | 1 | CHT-01 | unit | `npx vitest run tests/rate-limit.test.ts` (failModes open/memory/closed, both Redis seams via mocked `@/lib/redis`, Map bounding, 3-arg backward compat) | ❌ created in-task (Wave 0 gap) | ⬜ |
| 131-02-T1 | 131-02 | 2 | CHT-04 | unit | `npx vitest run tests/custom-webhook.test.ts` (literal private IPs — DNS-free; `Webhook blocked:` return, fetch not called, no newline) | ✅ (15 todos → +7 real tests) | ⬜ |
| 131-03-T1 | 131-03 | 2 | CHT-02 (shared IP helper) | unit | `npx vitest run tests/widget-config-route.test.ts` | ✅ | ⬜ |
| 131-03-T2 | 131-03 | 2 | CHT-02, CHT-03 | unit | `npx vitest run tests/chat-api.test.ts` (R1 429 before org lookup — supabase mock not called; R2/R5 keys+args; 4001-char → 400; `maxDuration === 60` export) | ✅ extend (`@/lib/rate-limit` mocked) | ⬜ |
| 131-03-T3 | 131-03 | 2 | CHT-02 (R3/R4) | unit | `npx vitest run tests/chat-api.test.ts` (R3 resume; R4 on fresh/bogus-sessionId/org-mismatch create paths; `ensureDbSession` not called on deny) | ✅ extend | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Repair `tests/widget-config-route.test.ts` (2 pre-existing baseline failures) — **assigned: 131-01 Task 1** (runs before all new work; plans 02/03 depend on 131-01)
- [ ] Redis mock helper for limiter tests — **assigned: 131-01 Task 2** (inline `vi.hoisted` mock of `@/lib/redis` with controllable `{ isReady, incr, expire, ttl }`; local `.env.local` REDIS_URL points at a dead Redis — never rely on live Redis in tests)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live 429 behavior over HTTP | CHT-02 | Full-route SSE/CORS shape best confirmed live | `for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4267/api/chat/<token> -H 'content-type: application/json' -H 'x-forwarded-for: 203.0.113.9' -d '{"message":"hi"}'; done | tail -1` → 429 (Redis down locally → memory fallback engages, proving CHT-01+CHT-02 together) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`tests/rate-limit.test.ts` created by the same task that needs it; baseline repair is 131-01 Task 1)
- [x] No watch-mode flags (all commands are `vitest run`)
- [x] Feedback latency < 90s (quick set < 10s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-07-17 (6 tasks, all automated-verifiable)
