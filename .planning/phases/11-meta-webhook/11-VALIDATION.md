---
phase: 11
slug: meta-webhook
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-04
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/meta-webhook*` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/meta-webhook*`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | METAEV-01 | unit | `npx vitest run tests/meta-webhook-verification.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 0 | METAEV-02 | unit | `npx vitest run tests/meta-webhook-conversation.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 0 | METAEV-03 | unit | `npx vitest run tests/meta-webhook-automation.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-04 | 01 | 0 | METAEV-04 | unit | `npx vitest run tests/meta-webhook-keyword.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-05 | 01 | 0 | METAEV-05 | unit | `npx vitest run tests/meta-webhook-24h.test.ts` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | METAEV-01 | integration | `npx vitest run tests/meta-webhook-verification.test.ts` | ✅ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | METAEV-02,03 | integration | `npx vitest run tests/meta-webhook-conversation.test.ts` | ✅ W0 | ⬜ pending |
| 11-02-03 | 02 | 1 | METAEV-04,05 | integration | `npx vitest run tests/meta-webhook-automation.test.ts tests/meta-webhook-24h.test.ts` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/meta-webhook-verification.test.ts` — RED stubs for GET challenge verification (METAEV-01)
- [ ] `tests/meta-webhook-conversation.test.ts` — RED stubs for conversation creation from Instagram + Messenger (METAEV-02, METAEV-03)
- [ ] `tests/meta-webhook-automation.test.ts` — RED stubs for automation dispatch + keyword filter (METAEV-03, METAEV-04)
- [ ] `tests/meta-webhook-keyword.test.ts` — RED stubs for keyword trigger matching (METAEV-04)
- [ ] `tests/meta-webhook-24h.test.ts` — RED stubs for 24h window enforcement (METAEV-05)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Meta App Dashboard confirms webhook active | METAEV-01 | Requires Meta Developer Portal UI access | After deploying, go to Meta App → Webhooks, verify challenge passes and webhook shows as active |
| Real Instagram DM appears in inbox | METAEV-02 | Requires live Meta test account | Send DM from test Instagram account; confirm conversation appears in /chat within 5s |
| Real Messenger message appears in inbox | METAEV-03 | Requires live Meta test account | Send message from test Messenger account; confirm conversation appears in /chat within 5s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
