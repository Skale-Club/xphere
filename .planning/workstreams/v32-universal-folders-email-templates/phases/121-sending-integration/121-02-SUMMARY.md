---
phase: 121-sending-integration
plan: 02
subsystem: workflows
tags: [workflows, spec, validator, email, tool-seed]
requires:
  - executeSendEmailTemplate (121-01)
  - send_email_template pre-switch dispatch (121-01)
provides:
  - send_email_template NodeSpec in the workflow capability spec (NODES)
  - platform-default send_email_template tool seed (kind='tool')
affects:
  - src/lib/workflows/spec.ts (new NodeSpec — surfaces in /api/workflows/spec, gated on resend)
tech-stack:
  added: []
  patterns:
    - "A workflow node kind IS the action_type passed to executeAction (validator gates kinds against the NODES array)"
    - "integration_required org-gates a node in getWorkflowSpec() (dropped unless a required provider is connected)"
key-files:
  created:
    - supabase/seeds/workflows/send-email-template-tool.yaml
  modified:
    - src/lib/workflows/spec.ts
decisions:
  - "send_email_template is gated with integration_required: ['resend'] (unlike always-available send_email) because it resolves a tenant email_templates row and represents org email capability — the faithful way to satisfy UFE-11's 'appears when email is configured' org-gate."
  - "The tool seed omits an `integration:` line on the node (matching the send_email/send_tenant_email siblings); gating lives in the node's integration_required in the spec, not the seed."
metrics:
  duration: ~5m
  tasks: 2
  files: 2
  completed: 2026-07-02
---

# Phase 121 Plan 02: send_email_template Spec Node + Tool Seed Summary

`send_email_template` (the 121-01 executor) is now a registered workflow node kind in the capability spec — org-gated on the `resend` integration so it only surfaces in `/api/workflows/spec` when email is connected — plus a committed platform-default `kind='tool'` seed that invokes it by name and passes the CLI validator.

## What Was Built

### Task 1 — NodeSpec in spec.ts (commit `92384fdc`)
- Added a `send_email_template` NodeSpec in the `NODES` "Action | email" group, right after `send_tenant_email`.
- `kind: 'action'`, `integration_required: ['resend']`, `params_schema` requiring `template_id` + `to` with optional `subject` + `variables`, plus a merge-tag example.
- Because the validator gates a node kind iff it exists in `NODES`, this registration is what makes the 121-01 executor authorable/validatable; `getWorkflowSpec()` drops it for orgs without Resend and includes it for orgs with Resend (UFE-11 org-gate).

### Task 2 — platform-default tool seed (commit `66bead08`)
- Created `supabase/seeds/workflows/send-email-template-tool.yaml`: a `kind='tool'` (single-action) workflow with a `tool_call` trigger (`tool_name: send_email_template` + `input_schema` for template_id/to/subject/variables), one action node `kind: send_email_template` mapping `{{input.*}}`, and one edge.
- All `{{input.*}}` refs are in scope for a tool_call trigger, so validation passes.

## Verification

- `npm run workflows:validate supabase/seeds/workflows/send-email-template-tool.yaml` → `✓`, exit 0.
- `npm run workflows:validate-all` → the new seed passes and no other `supabase/seeds/workflows/*` file regressed (29 pass). The 4 remaining failures are all pre-existing `.planning/workflows/examples/*` files (unregistered triggers, out-of-scope variables, missing input_schema, unknown `get_availability` kind) — confirmed pre-existing by stashing `spec.ts` (they fail identically without the phase-121 change). Logged in `deferred-items.md`; out of scope per the scope boundary.
- `npm run build` → exit 0 (NodeSpec typechecks against the NodeSpec interface).
- No new file under `supabase/migrations/` (code-only — confirmed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Quoted the `variables` input_schema description in the tool seed**
- **Found during:** Task 2 (first `workflows:validate` run)
- **Issue:** The unquoted description `Merge-tag values, e.g. { contact: { first_name: "Ana" } }.` triggered a YAML parse error ("Nested mappings are not allowed in compact mappings") because the inline `{ … }` was parsed as a nested flow mapping.
- **Fix:** Wrapped the description in single quotes so it is a literal scalar.
- **Files modified:** supabase/seeds/workflows/send-email-template-tool.yaml
- **Commit:** 66bead08

## Known Stubs

None. Runtime verification (an actual workflow run sending a personalized template email) is a post-deploy human-verify, explicitly deferred in 121-CONTEXT.

## Self-Check: PASSED

- FOUND: src/lib/workflows/spec.ts (modified)
- FOUND: supabase/seeds/workflows/send-email-template-tool.yaml
- FOUND commit: 92384fdc
- FOUND commit: 66bead08
