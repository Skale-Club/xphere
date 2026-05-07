---
phase: 30
slug: executor-backends
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/send-sms.test.ts tests/custom-webhook.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 0 | SMS-01..04 | stub | `npx vitest run tests/send-sms.test.ts` | ❌ W0 | ⬜ pending |
| 30-01-02 | 01 | 0 | WEBHOOK-01..05 | stub | `npx vitest run tests/custom-webhook.test.ts` | ❌ W0 | ⬜ pending |
| 30-02-01 | 02 | 1 | SMS-01,02,03 | unit | `npx vitest run tests/send-sms.test.ts` | ❌ W0 | ⬜ pending |
| 30-02-02 | 02 | 1 | SMS-04 | unit | `npx vitest run tests/send-sms.test.ts` | ❌ W0 | ⬜ pending |
| 30-02-03 | 02 | 1 | WEBHOOK-01..05 | unit | `npx vitest run tests/custom-webhook.test.ts` | ❌ W0 | ⬜ pending |
| 30-02-04 | 02 | 1 | SMS-01..04,WEBHOOK-01..05 | integration | `npm run build` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/send-sms.test.ts` — stubs for SMS-01, SMS-02, SMS-03, SMS-04
- [ ] `tests/custom-webhook.test.ts` — stubs for WEBHOOK-01, WEBHOOK-02, WEBHOOK-03, WEBHOOK-04, WEBHOOK-05

*Existing Vitest infrastructure covers this phase — no new framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Twilio SMS actually delivered | SMS-01 | Requires live Twilio credentials | Configure Twilio integration, create send_sms tool_config, trigger via action engine, verify SMS received |
| custom_webhook fires real HTTP call | WEBHOOK-01 | Requires live endpoint | Configure tool_config pointing to webhook.site or similar, trigger, verify request received |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
