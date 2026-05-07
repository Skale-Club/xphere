---
phase: 28
slug: action-executors
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/google-contacts-actions.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/google-contacts-actions.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 28-01-01 | 01 | 0 | ACTIONS-01..04 | unit stubs | `npx vitest run tests/google-contacts-actions.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-02 | 01 | 0 | ACTIONS-01..04 | type-check | `npm run build` | ✅ | ⬜ pending |
| 28-02-01 | 02 | 1 | ACTIONS-01 | unit | `npx vitest run tests/google-contacts-actions.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-02 | 02 | 1 | ACTIONS-02 | unit | `npx vitest run tests/google-contacts-actions.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-03 | 02 | 1 | ACTIONS-03 | unit | `npx vitest run tests/google-contacts-actions.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-04 | 02 | 1 | ACTIONS-04 | unit | `npx vitest run tests/google-contacts-actions.test.ts` | ❌ W0 | ⬜ pending |
| 28-03-01 | 03 | 2 | ACTIONS-01..04 | integration | `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/google-contacts-actions.test.ts` — stubs for ACTIONS-01 (create), ACTIONS-02 (update), ACTIONS-03 (find), ACTIONS-04 (delete), plus no-integration error case

*Existing infrastructure (vitest) covers the framework requirement.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| google_contacts_create fires real People API call and creates contact | ACTIONS-01 | Requires live Google OAuth credentials + People API access | Trigger action_type=google_contacts_create via action engine with connected org; verify contact appears in Google Contacts |
| google_contacts_update modifies existing contact | ACTIONS-02 | Requires live credentials + existing contact | Trigger with known contact email; verify field changes in Google Contacts |
| google_contacts_find returns match | ACTIONS-03 | Requires live credentials + existing contact | Trigger with known email/phone; verify returned string contains name and email |
| google_contacts_delete removes contact | ACTIONS-04 | Requires live credentials + existing contact | Trigger with known email; verify contact no longer appears in Google Contacts |
| Token refresh-on-401 updates integrations row | ACTIONS-01..04 | Requires expired access_token in DB | Manually set token_expiry to past; trigger any executor; verify integrations.config.token_expiry updated |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
