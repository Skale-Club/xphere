---
phase: 23
slug: inbound-routing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 23 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30-60 seconds |

## Sampling Rate

- **After every task commit:** `npm run build`
- **After every plan wave:** `npx vitest run`
- **Before `/gsd:verify-work`:** `npm run build` green + `npx vitest run` green (162 tests baseline)

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 23-01-* | 01 | 1 | ROUTING-01..04 | build + RED stubs | `npm run build && npx vitest run tests/manychat` | ⬜ pending |
| 23-02-* | 02 | 2 | ROUTING-03, ROUTING-04 | build + targeted | `npm run build && npx vitest run tests/manychat/dispatch-event.test.ts` | ⬜ pending |
| 23-03-* | 03 | 2 | ROUTING-01, ROUTING-02 | build + targeted | `npm run build && npx vitest run tests/manychat/rule-actions.test.ts` | ⬜ pending |
| 23-04-* | 04 | 3 | ROUTING-03, ROUTING-04 | full suite | `npm run build && npx vitest run` | ⬜ pending |

## Wave 0 Requirements

- [ ] `tests/manychat/rule-actions.test.ts` — stubs for createManychatRule, updateManychatRule, deleteManychatRule
- [ ] `tests/manychat/resolve-rule.test.ts` — stubs for rule matcher (event_type + condition JSONB)
- [ ] `tests/manychat/dispatch-event.test.ts` — stubs for dispatcher (match → executeAction → log → update event row)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end webhook → rule match → action_logs row | ROUTING-03, ROUTING-04 | Requires live DB + integration | After migration 027 push, configure rule + tool_config, send webhook, verify action_logs row + manychat_events.action_log_id set |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity OK
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
