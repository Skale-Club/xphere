# Phase 121 — Deferred / Out-of-Scope Items

## Pre-existing `npm run workflows:validate-all` failures (NOT caused by phase 121)

Discovered during 121-02. These 4 files fail `workflows:validate-all` both with and
without the phase-121 changes (verified by stashing `spec.ts` — they fail identically).
All live under `.planning/workflows/examples/` (illustrative examples, NOT
platform-default seeds under `supabase/seeds/workflows/`). Out of scope for this phase —
the phase-121 seed (`supabase/seeds/workflows/send-email-template-tool.yaml`) passes cleanly.

1. `.planning/workflows/examples/missed-call-followup.yaml` — 3 errors:
   - `[unknown_trigger] trigger.type: Trigger "event:call.missed" is not registered.`
   - `[unresolved_variable] nodes[1]: {{contact.phone}} not in scope.`
2. `.planning/workflows/examples/schedule-daily-report.yaml` — 1 error:
   - `[unresolved_variable] nodes[0]: {{org.admin_phone}} not in scope.`
3. `.planning/workflows/examples/tool-create-contact-ghl.yaml` — 1 error:
   - `[missing_field] trigger.config.input_schema: tool_call triggers require an input_schema.`
4. `.planning/workflows/examples/tool-lookup-contact.yaml` — 1 error:
   - `[unknown_node_type] nodes[0].kind: Unknown node kind "get_availability".`

These example files predate this workstream and are documentation examples, not CI-gated
seeds. Fixing/retiring them is a separate housekeeping task.

## Pre-existing unrelated working-tree modifications

At phase-121 execution time the working tree already had uncommitted edits to files
outside this phase's scope (`next.config.ts`, several `src/components/*`,
`supabase/functions/push-sender/index.ts`, `tests/xpot-integration-contract.test.ts`,
`.planning/active-workstream`, `src/app/(dashboard)/actions.ts`). These were NOT touched
by phase 121 and were deliberately left unstaged (per-task commits stage only the
phase's own files).
