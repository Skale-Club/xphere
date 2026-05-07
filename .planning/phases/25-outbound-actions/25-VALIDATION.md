---
phase: 25
slug: outbound-actions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (project root, environment: node) |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30–45 seconds (current 151-test baseline + ~6–8 new manychat tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm run build` (catches enum + type drift in <10s)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green AND `25-HUMAN-UAT.md` signed off
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

> Plan-level granularity. The planner refines into per-task IDs (`{N}-{plan}-{task}`) when authoring `25-XX-PLAN.md` files.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 25-W0-01 | 01 | 0 | OUTBOUND-01 | unit (RED) | `npx vitest run tests/manychat/set-field.test.ts` | ❌ W0 | ⬜ pending |
| 25-W0-02 | 01 | 0 | OUTBOUND-02 | unit (RED) | `npx vitest run tests/manychat/add-tag.test.ts` | ❌ W0 | ⬜ pending |
| 25-W0-03 | 01 | 0 | OUTBOUND-03 | unit (RED) | `npx vitest run tests/manychat/trigger-flow.test.ts` | ❌ W0 | ⬜ pending |
| 25-W0-04 | 01 | 0 | OUTBOUND-04 | unit (RED) | `npx vitest run tests/manychat/send-message.test.ts` | ❌ W0 | ⬜ pending |
| 25-W0-05 | 01 | 0 | client wrapper | unit (RED) | `npx vitest run tests/manychat/client.test.ts` | ❌ W0 | ⬜ pending |
| 25-W0-06 | 01 | 0 | dispatcher routing | unit (RED) | `npx vitest run tests/manychat/execute-action-manychat.test.ts` | ❌ W0 | ⬜ pending |
| 25-01-XX | 01 | 1 | OUTBOUND-01..04 | build (TS) | `npm run build` | ✅ via type edit | ⬜ pending |
| 25-01-XX | 01 | 1 | bridge migration | unit (extend) | `npx vitest run tests/manychat/channel-actions.test.ts` | ✅ extend | ⬜ pending |
| 25-02-XX | 02 | 2 | OUTBOUND-01 | unit (GREEN) | `npx vitest run tests/manychat/set-field.test.ts` | ✅ via Plan 01 | ⬜ pending |
| 25-02-XX | 02 | 2 | OUTBOUND-02 | unit (GREEN) | `npx vitest run tests/manychat/add-tag.test.ts` | ✅ via Plan 01 | ⬜ pending |
| 25-02-XX | 02 | 2 | OUTBOUND-03 | unit (GREEN) | `npx vitest run tests/manychat/trigger-flow.test.ts` | ✅ via Plan 01 | ⬜ pending |
| 25-02-XX | 02 | 2 | OUTBOUND-04 | unit (GREEN) | `npx vitest run tests/manychat/send-message.test.ts` | ✅ via Plan 01 | ⬜ pending |
| 25-02-XX | 02 | 2 | dispatcher GREEN | unit | `npx vitest run tests/manychat/execute-action-manychat.test.ts` | ✅ via Plan 01 | ⬜ pending |
| 25-02-XX | 02 | 2 | inbound→outbound chain | integration | `npx vitest run tests/manychat/dispatch-event.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/manychat/set-field.test.ts` — RED stubs for OUTBOUND-01 (POST body shape, 4xx throw, missing-param errors)
- [ ] `tests/manychat/add-tag.test.ts` — RED stubs for OUTBOUND-02
- [ ] `tests/manychat/trigger-flow.test.ts` — RED stubs for OUTBOUND-03
- [ ] `tests/manychat/send-message.test.ts` — RED stubs for OUTBOUND-04 (incl. `text` convenience → v2 dynamic-block)
- [ ] `tests/manychat/client.test.ts` — RED stubs for shared fetch wrapper (5s `AbortController` timeout, `Authorization: Bearer`, `Content-Type: application/json`)
- [ ] `tests/manychat/execute-action-manychat.test.ts` — RED stubs for dispatcher routing across all 4 new `case` arms (mirror `tests/action-engine.test.ts`)
- [ ] Extend `tests/manychat/channel-actions.test.ts` — bridge insert assertions on `createManychatChannel` (row count, encrypted blob equality, FK linkage, compensating-delete on bridge insert failure)
- [ ] Extend `tests/manychat/dispatch-event.test.ts` — assert one new action_type resolves end-to-end (use `manychat_add_tag` as canary; mocks `addManychatTag` underneath)
- Framework install: ✅ none — Vitest already wired; 151-test baseline green.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `manychat_set_field` against real ManyChat account updates the subscriber's custom field in the ManyChat dashboard | OUTBOUND-01 | Live API call hits ManyChat servers; the subscriber, field_id, and resulting state are external. Mocked unit tests can't verify ManyChat actually applied the change. | (a) Provision a test ManyChat subscriber + custom field; (b) create a tool_config with `action_type='manychat_set_field'`, `config.field_id={id}`; (c) trigger a webhook event matched to a rule pointing at this tool; (d) refresh the ManyChat dashboard and confirm the custom field shows the new value; (e) confirm `action_logs` row has `status='success'`. |
| Live `manychat_add_tag` adds the tag visible in ManyChat's Audience view | OUTBOUND-02 | External state; same reasoning as above. | Same flow with `action_type='manychat_add_tag'`, `config.tag_id={id}`. Verify tag appears on the subscriber's profile in ManyChat. |
| Live `manychat_trigger_flow` actually fires the named flow (subscriber receives the flow's first message) | OUTBOUND-03 | The flow's effect is the only signal; flow execution is internal to ManyChat. | Same flow with `action_type='manychat_trigger_flow'`, `config.flow_ns='content...'`. Verify the test subscriber receives the flow's intended output (DM, etc.). |
| Live `manychat_send_message` delivers text to the subscriber within ManyChat's compliance window | OUTBOUND-04 | Delivery is the assertion; ManyChat enforces 24-hour window + `message_tag` rules. | Same flow with `action_type='manychat_send_message'`, `params.text='Test from Operator'`. Verify subscriber receives the DM in their inbox. Test both inside and outside the 24-hour window with `message_tag='ACCOUNT_UPDATE'`. |
| Bridge backfill on production preserves all existing `manychat_channels` rows | Migration safety | Backfill correctness across an unknown row count is operationally dangerous; idempotent re-runs need confirmation. | (a) Before `npx supabase db push`: count rows in `manychat_channels`; (b) push migration 028; (c) `SELECT count(*) FROM integrations WHERE provider='manychat'` matches step (a); (d) re-run the migration's backfill statement and confirm count is unchanged. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 W0 entries above)
- [ ] No watch-mode flags (`vitest run`, never `vitest watch`)
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner verifies all tasks map cleanly)

**Approval:** pending
