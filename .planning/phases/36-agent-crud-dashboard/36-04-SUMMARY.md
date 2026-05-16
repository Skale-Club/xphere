---
phase: 36-agent-crud-dashboard
plan: 04
subsystem: ui
tags: [react-hook-form, zod, supabase, server-actions, agents, tool-picker]

requires:
  - phase: 36-agent-crud-dashboard/01
    provides: agents/agent_tools/agent_channel_defaults tables + tool_folders + Zod-friendly columns
  - phase: 36-agent-crud-dashboard/02
    provides: shared zod-schemas, slugify, models, channels, AGENT_CHANNEL_LABELS + Checkbox/Collapsible/Tooltip UI primitives
  - phase: 36-agent-crud-dashboard/03
    provides: agents/actions.ts (Plan 03 list/toggle/soft-delete actions) which Plan 04 APPENDS to without rewriting
provides:
  - getAgentById/createAgent/updateAgent/setAgentTools/getToolPickerData server actions
  - AgentForm with 4 collapsible sections (Basics/Generation/Tools/Channels) and single Save
  - ToolPicker (folder-grouped checkbox tree with integration-status warnings)
  - ChannelOverridesEditor (per-channel structured override rows)
  - /agents/new and /agents/[id] routes fully wired
affects: [36-05 (verification), 37 (channel adapters consume saved channel_overrides), 38 (delegation reuses tool picker), 41 (prompt version history overlays this form)]

tech-stack:
  added: []
  patterns:
    - "Diff-based setAgentTools: INSERT toAdd + DELETE toRemove, never UPDATE existing rows (preserves agent_tools.allowed_channels — Pitfall 5)"
    - "Deny-by-default tool attachment on createAgent (TOOL-03): server action ignores tool_ids input, form forces tool_ids=[] in create mode"
    - "Slug auto-fill via slugify(name) that stops as soon as user manually edits slug (D-36-06)"
    - "FormProvider wraps useForm so nested components (ChannelOverridesEditor) read via useFormContext"
    - "Partial-failure UX wording for sequential non-transactional writes: 'Tool changes failed — please retry attaching tools on the form and save again.'"

key-files:
  created:
    - src/components/agents/agent-form.tsx
    - src/components/agents/tool-picker.tsx
    - src/components/agents/channel-overrides-editor.tsx
    - tests/agents/form-actions.test.ts
  modified:
    - src/app/(dashboard)/agents/actions.ts
    - src/app/(dashboard)/agents/new/page.tsx
    - src/app/(dashboard)/agents/[id]/page.tsx

key-decisions:
  - "Diff-based tool persistence: setAgentTools NEVER UPDATEs existing rows, so any per-tool allowed_channels scoping survives a save with the same tool selection"
  - "Create-mode form forces tool_ids=[] on submit AND createAgent server action never calls setAgentTools — two layers of deny-by-default per TOOL-03"
  - "23505 collisions on both create and update return the same human string 'An agent with this slug already exists for your organization.' so the form can route to FormMessage on the slug field consistently"
  - "Tool picker is read-only over the folder hierarchy (no DnD/rename/add-folder UI) per RESEARCH §5 — those mutations belong to /tools, not /agents"
  - "Channel overrides editor leaves empty fields undefined so channelOverrideSchema.transform() strips them; runtime then falls back to base agent values (D-36-03)"

patterns-established:
  - "All form server actions return either {error: string} or success-shaped objects; form maps {error} → FormMessage when text matches a known field signature, otherwise sonner toast"
  - "Sequential writes without an RPC wrapper surface a recovery-oriented toast naming the second step to retry — caller knows what's safe to re-submit"

requirements-completed: [AGENT-01, AGENT-02, AGENT-03, TOOL-02, TOOL-03, TOOL-04]

duration: ~20min
completed: 2026-05-16
---

# Phase 36 Plan 04: Agent CRUD Form Summary

**Single-page agent edit/create form with 4 collapsible sections, diff-based tool attachment that preserves per-tool channel scoping, and deny-by-default tool grants for new agents.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 3

## Accomplishments

- 5 new server actions appended to `agents/actions.ts` (`getAgentById`, `createAgent`, `updateAgent`, `setAgentTools`, `getToolPickerData`) without touching the 6 Plan 03 exports
- Diff-based `setAgentTools` provably preserves `agent_tools.allowed_channels` on no-op saves (test covers this directly)
- `createAgent` never inserts an `agent_tools` row, enforcing TOOL-03 deny-by-default at the DB layer regardless of what the form submits
- Tool picker reuses Plan 01 `tool_folders` hierarchy in read-only mode, flags tools whose integration is inactive/missing with AlertTriangle (still selectable per TOOL-04), and supports client-side filtering
- Channel overrides editor renders one card per allowed channel; empty fields strip on save (`channelOverrideSchema.transform()`)
- Slug auto-fills from name and stops as soon as the user edits the slug field; 23505 collisions surface as a field-level error
- Sequential `updateAgent` + `setAgentTools` writes have a recovery-oriented toast for the no-transaction window

## Task Commits

1. **Task 1: Append create/edit/tool-picker server actions to actions.ts** — `d3cd70e` (feat, TDD: test+impl in one commit)
2. **Task 2: Build tool-picker.tsx + channel-overrides-editor.tsx** — `eecbd2a` (feat)
3. **Task 3: Build agent-form.tsx + wire new/page.tsx + [id]/page.tsx** — `a800e73` (feat)

## Files Created/Modified

- `src/app/(dashboard)/agents/actions.ts` — APPENDED 5 new exports; all 6 Plan 03 exports preserved verbatim
- `src/components/agents/agent-form.tsx` — 4 collapsible sections, react-hook-form + zodResolver, FormProvider wrapping; slug auto-fill via slugTouched ref; partial-failure recovery toast
- `src/components/agents/tool-picker.tsx` — folder-grouped Collapsible + Checkbox rows; integration name + AlertTriangle warning; client-side search across tool_name/action_type/integration.name
- `src/components/agents/channel-overrides-editor.tsx` — per-channel cards using useFormContext; empty fields coerce to undefined for the zod transform to strip
- `src/app/(dashboard)/agents/new/page.tsx` — placeholder REPLACED with server component that fetches getToolPickerData and renders AgentForm mode=create
- `src/app/(dashboard)/agents/[id]/page.tsx` — placeholder REPLACED with server component that parallel-fetches getAgentById + getToolPickerData; notFound() when missing
- `tests/agents/form-actions.test.ts` — 5 tests GREEN covering DB-side invariants the actions rely on

## Decisions Made

- **`createAgent` never calls `setAgentTools`** even if `input.tool_ids` is populated. The form already forces `tool_ids=[]` in create mode, but stripping it in the action too is the deny-by-default safety net per TOOL-03.
- **`setAgentTools` never UPDATEs existing rows.** Diff is computed as set difference on `tool_config_id`; no-op saves do nothing to the DB. This preserves any `allowed_channels` set on the row (future per-tool scoping surface). Pitfall 5 verified by test.
- **No transaction wrapper around `updateAgent` + `setAgentTools`.** Phase 36 accepts the brief inconsistency window; the form surfaces a recovery toast naming the retry step. RPC wrapper deferred to Phase 38 alongside delegation flows (also batched writes).
- **Tool picker is read-only over the folder hierarchy.** Add-folder/rename/DnD belong to `/tools`; opening that surface here would create two divergent folder management UIs.
- **Slug auto-fill uses a ref, not form state.** Once `slugTouched.current` flips true (slug != slugify(name)), auto-fill stays off for the lifetime of the form — even if the user goes back and edits name.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Test fixture column name**
- **Found during:** Task 1 (RED run of form-actions.test.ts)
- **Issue:** Plan's test scaffold used `integrations.credentials` and `tool_configs.name` / `type`; actual schema has `encrypted_api_key`, `tool_name`, `action_type`. Test failed at fixture insert before any assertion.
- **Fix:** Updated the test's `beforeAll` to use `encrypted_api_key: 'test-key'` for integration insert and `tool_name` + `action_type` + `fallback_message` for tool_configs insert.
- **Files modified:** `tests/agents/form-actions.test.ts`
- **Verification:** All 5 tests went GREEN after the fix.
- **Committed in:** `d3cd70e` (part of Task 1 commit)

**2. [Rule 1 — Bug] tool-picker referenced wrong column name**
- **Found during:** Task 2 implementation review
- **Issue:** Plan's tool-picker code referenced `tool.name` and `tool.type`; the actual `tool_configs` columns are `tool_name` and `action_type`. Would have caused TypeScript errors at build.
- **Fix:** Updated picker to use `tool.tool_name` / `tool.action_type` in render, search filter, and order().
- **Files modified:** `src/components/agents/tool-picker.tsx`
- **Verification:** `npm run build` GREEN with /agents/[id] route compiling cleanly.
- **Committed in:** `eecbd2a` (part of Task 2 commit)

**3. [Rule 1 — Bug] Default allowed_channels open-folder set was empty**
- **Found during:** Task 2 implementation review
- **Issue:** Plan's `openFolders` init was `new Set(data.folders.map((f) => f.id))` — does not include the `null` key for the Unfiled bucket, so Unfiled would render as closed even when populated.
- **Fix:** Init now `new Set<string | null>([...data.folders.map((f) => f.id), null])`.
- **Files modified:** `src/components/agents/tool-picker.tsx`
- **Verification:** Visual logic verified by reading; Unfiled section now expands by default along with named folders.
- **Committed in:** `eecbd2a` (part of Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs in plan scaffold code)
**Impact on plan:** All three were pre-existing typos/mismatches in the plan's scaffold against the actual schema/types; none changed the design. No scope creep.

## Issues Encountered

- None beyond the auto-fixed scaffold mismatches above. Build, tests, and acceptance grep counts all clean on first proper try.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 05 (verification) can exercise create → edit → tool-attach → channel-override save flows end-to-end.
- All Phase 36 in-scope requirements (AGENT-01/02/03, TOOL-02/03/04) are wired and demonstrable through the UI.
- Phase 38 delegation work can reuse `ToolPicker` as-is for the partner-agent allowlist surface.

## Self-Check: PASSED

Verified after writing this summary:

- `src/app/(dashboard)/agents/actions.ts` — present, 5 new exports added, 6 Plan 03 exports preserved
- `src/components/agents/agent-form.tsx` — present
- `src/components/agents/tool-picker.tsx` — present
- `src/components/agents/channel-overrides-editor.tsx` — present
- `src/app/(dashboard)/agents/new/page.tsx` — present (replaced placeholder)
- `src/app/(dashboard)/agents/[id]/page.tsx` — present (replaced placeholder)
- `tests/agents/form-actions.test.ts` — present
- Commits `d3cd70e`, `eecbd2a`, `a800e73` all in git log

---
*Phase: 36-agent-crud-dashboard*
*Completed: 2026-05-16*
