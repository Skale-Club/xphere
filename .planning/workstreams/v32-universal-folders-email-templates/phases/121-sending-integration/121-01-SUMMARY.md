---
phase: 121-sending-integration
plan: 01
subsystem: email-sending
tags: [email, merge-tags, action-engine, workflows]
requires:
  - email_templates.html_snapshot (Phase 117/120)
  - sendPlatformEmail (src/lib/email/resend.ts)
provides:
  - renderWithVariables (pure merge-tag renderer)
  - executeSendEmailTemplate (send_email_template action executor)
  - send_email_template pre-switch dispatch in the action engine
affects:
  - src/lib/action-engine/execute-action.ts (new dispatch branch)
tech-stack:
  added: []
  patterns:
    - "Pure, dependency-free {{ dot.path }} renderer mirroring interpolate.ts semantics"
    - "Pre-switch string-compare dispatch for action types NOT in the DB enum (no migration)"
key-files:
  created:
    - src/lib/email/merge-tags.ts
    - tests/email-merge-tags.test.ts
    - src/lib/action-engine/executors/send-email-template.ts
  modified:
    - src/lib/action-engine/execute-action.ts
decisions:
  - "renderWithVariables is email-owned (not a reuse of flows/interpolate.ts) so it is dependency-free and unit-testable; semantics are identical (dot-path, missing → '', object → JSON, malformed token left intact)."
  - "send_email_template dispatched via a pre-switch string branch (mirrors update_contact) so NO action_type DB enum entry / migration is needed; the switch exhaustiveness never-check stays intact."
  - "DND parity deferred: the template send is invoked with an explicit recipient + template id, not a contact_id, so no DND check was added (out of scope, per plan)."
metrics:
  duration: ~4m
  tasks: 2
  files: 4
  completed: 2026-07-02
---

# Phase 121 Plan 01: Merge-tags + send_email_template Executor Summary

Builder email templates are now sendable at the engine layer: a pure, unit-tested `renderWithVariables` merge-tag renderer plus a `send_email_template` action executor that loads an org-scoped template, personalizes its `html_snapshot` + subject, and sends through the same `sendPlatformEmail`/Resend path `send_email` uses — dispatched via a pre-switch branch with no DB enum migration.

## What Was Built

### Task 1 — `renderWithVariables` merge-tag renderer + unit test (commit `1a66b03a`)
- `src/lib/email/merge-tags.ts` exports the pure `renderWithVariables(input, vars)`.
- Regex `TOKEN` matches only identifier dot-paths (`{{ a.b.c }}`), whitespace-tolerant; non-path/empty tokens (`{{ not a path! }}`, `{{}}`) do not match and are left intact.
- Missing/null/undefined paths → `''` (no raw `{{}}` left); strings/numbers/booleans stringified; objects/arrays `JSON.stringify`d (never `[object Object]`).
- `tests/email-merge-tags.test.ts` — 15 vitest cases: simple/nested/multi-token resolution, missing-path blanking, malformed/empty token intact, whitespace tolerance, number/boolean coercion, object/array JSON, null/undefined blanking, empty-input and token-free passthrough. All 15 green.

### Task 2 — `send_email_template` executor + dispatch (commit `b0c5b74e`)
- `src/lib/action-engine/executors/send-email-template.ts` exports `executeSendEmailTemplate(params, orgId, supabase)`:
  - Validates `template_id` + `to`; loads the `email_templates` row filtered by `id` + `org_id` (explicit org filter because the engine uses a service-role client); rejects a missing template or a template with no `html_snapshot`.
  - `renderWithVariables` personalizes both the subject (inline `subject` or falls back to the template `name`) and the `html_snapshot`, then sends via `sendPlatformEmail(to, subject, html)`.
- `src/lib/action-engine/execute-action.ts`: added the `executeSendEmailTemplate` import and a PRE-SWITCH branch (`if ((actionType as string) === 'send_email_template') …`) alongside `update_contact`/`contact_add_tag`/`update_booking_status` — so no `case` is added to the switch and the `never` exhaustiveness check (typed to the DB enum) still passes.

## Verification

- `npm run test -- email-merge-tags` → 15/15 passing.
- `npm run build` → exit 0 (executor + dispatch compile; exhaustiveness check intact; no enum entry added).
- `grep` guardrails: executor exports `executeSendEmailTemplate`, references `sendPlatformEmail` + `renderWithVariables`; `execute-action.ts` references `executeSendEmailTemplate` (import + branch) with `0` occurrences of `case 'send_email_template'`.
- No new file under `supabase/migrations/` (code-only — confirmed).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Runtime send verification (a real personalized email actually delivered) is a post-deploy human-verify, explicitly deferred in 121-CONTEXT — not a stub.

## Self-Check: PASSED

- FOUND: src/lib/email/merge-tags.ts
- FOUND: tests/email-merge-tags.test.ts
- FOUND: src/lib/action-engine/executors/send-email-template.ts
- FOUND: src/lib/action-engine/execute-action.ts (modified)
- FOUND commit: 1a66b03a
- FOUND commit: b0c5b74e
