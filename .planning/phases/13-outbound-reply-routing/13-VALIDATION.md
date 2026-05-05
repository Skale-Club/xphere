---
phase: 13
slug: outbound-reply-routing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-05
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/outbound-reply-routing.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/outbound-reply-routing.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 0 | METAINBOX-03 | unit | `npx vitest run tests/outbound-reply-routing.test.ts 2>&1 \| tail -10` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 1 | METAINBOX-03 | unit | `npx vitest run tests/outbound-reply-routing.test.ts 2>&1 \| tail -10` | ✅ W0 | ⬜ pending |
| 13-02-02 | 02 | 1 | METAINBOX-03 | build | `npm run build 2>&1 \| tail -10` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/outbound-reply-routing.test.ts` — RED stubs for all 3 channel routing assertions (widget, messenger, instagram) + error handling

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Messenger reply delivered | METAINBOX-03 | Requires live Meta test account + registered webhook | Send reply in Messenger conversation; verify message appears in test Messenger thread |
| Real Instagram reply delivered | METAINBOX-03 | Requires live Meta test account + registered webhook | Send reply in Instagram conversation; verify message appears in test Instagram DM |
| Revoked token reconnect prompt | METAINBOX-03 | Requires manually revoked token | Revoke page token in Meta dev console; attempt reply; confirm reconnect prompt appears in UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
