---
phase: 38
slug: multi-agent-delegation-intersection-authz-idempotency
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run tests/agent-delegation.test.ts` |
| **Full suite command** | `npx vitest run tests/agent-delegation.test.ts tests/agent-runtime-guardrails.test.ts && npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/agent-delegation.test.ts`
- **After every plan wave:** Run full suite + `npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green + build passes
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 38-01-01 | 01 | 0 | DELEG-04, DELEG-05, GATE-02 | unit | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-01-02 | 01 | 0 | DELEG-06 | unit | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-01-03 | 01 | 0 | IDEMP-03 | unit | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-01 | 02 | 1 | schema | schema | `npm run build` | N/A | ⬜ pending |
| 38-02-02 | 02 | 1 | IDEMP-01 | schema | `npm run build` | N/A | ⬜ pending |
| 38-03-01 | 03 | 1 | DELEG-02, DELEG-03 | integration | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-03-02 | 03 | 1 | DELEG-06 | integration | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-03-03 | 03 | 1 | DELEG-07, GATE-04 | integration | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-04-01 | 04 | 2 | IDEMP-02, IDEMP-03, GATE-06 | integration | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-05-01 | 05 | 2 | DELEG-08 | integration | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |
| 38-06-01 | 06 | 3 | GATE-02, GATE-04, GATE-05, GATE-06 | integration | `npx vitest run tests/agent-delegation.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/agent-delegation.test.ts` — stubs for all DELEG, IDEMP, and GATE tests
- [ ] Wave 0 test stubs must import from `../src/lib/agent-runtime` and compile

*Note: Vitest + all dependencies already installed from Phase 34.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Widget badge display | DELEG-08 | Requires browser rendering | Open playground, send message that triggers delegation, verify badge appears |
| `delegation_visibility=hidden` suppresses badges | DELEG-08 | Requires org setting change | Set org column to 'hidden', verify no badge events in SSE stream |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
