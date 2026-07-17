---
phase: 131
slug: chat-route-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 131 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; only `tests/**` is picked up — colocated tests are ignored) |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run tests/rate-limit.test.ts tests/chat-route-limits.test.ts` (file names per plan) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60s full suite |
| **Baseline caveat** | `tests/widget-config-route.test.ts` has 2 pre-existing failures on a file this phase touches — repair in Wave 0 or the gate cannot go green |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** `npm test` + `npm run lint`
- **Before verify-work:** full suite green (including repaired baseline)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (planner fills) | | | CHT-01 | unit | vitest: failMode open/memory/closed with `@/lib/redis` mocked down | ❌ | ⬜ |
| (planner fills) | | | CHT-02 | unit | vitest: R1 rejects before org lookup (supabase mock not called); R3/R4 branches incl. bogus-sessionId session-create | ❌ | ⬜ |
| (planner fills) | | | CHT-03 | unit | vitest: 4001-char message → 400; maxDuration export = 60 (grep) | ❌ | ⬜ |
| (planner fills) | | | CHT-04 | unit | vitest: custom_webhook with literal private IP (169.254.169.254) → error string, no fetch (DNS-free fast path) | ❌ | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Repair `tests/widget-config-route.test.ts` (2 pre-existing baseline failures) — phase touches shared IP-extraction code; gate must start green
- [ ] Redis mock helper for limiter tests (`@/lib/redis` mocked; local `.env.local` REDIS_URL points at a dead Redis — never rely on live Redis in tests)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live 429 behavior over HTTP | CHT-02 | Full-route SSE/CORS shape best confirmed live | `for i in $(seq 1 21); do curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4267/api/chat/<token> -H 'content-type: application/json' -d '{"message":"hi"}'; done | tail -1` → 429 (E2E wiring step) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
