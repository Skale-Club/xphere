---
phase: 26-rules-ui-event-log
plan: "01"
subsystem: integrations/manychat
tags: [rules-ui, server-actions, crud, react-hook-form, zod, shadcn]
dependency_graph:
  requires:
    - rule-actions.ts (createManychatRule, updateManychatRule, deleteManychatRule, getManychatRules)
    - manychat_channels table (for getManychatFlows decrypt + channel lookup)
    - manychat_rules table (for rules CRUD)
    - tool_configs table (for tool config selector)
  provides:
    - getManychatFlows() server action
    - /integrations/manychat/rules page (full CRUD UI)
    - Sub-page navigation on /integrations/manychat
  affects:
    - Admin can navigate ManyChat sub-pages without touching database
    - Admin can create, edit, and delete routing rules via UI
tech_stack:
  added: []
  patterns:
    - TDD (RED → GREEN) for server action unit tests
    - Server component page fetches data, passes to client component as props
    - useFieldArray for dynamic condition key/value rows
    - State-driven AlertDialog (no trigger element)
    - useEffect on sheet open to lazy-load ManyChat flows
key_files:
  created:
    - src/app/(dashboard)/integrations/manychat/rules/page.tsx
    - src/components/integrations/manychat-rules.tsx
    - tests/manychat-flows.test.ts
  modified:
    - src/app/(dashboard)/integrations/manychat/actions.ts
    - src/app/(dashboard)/integrations/manychat/page.tsx
decisions:
  - flow_ns is not stored in manychat_rules — admin must re-select flow when editing (acceptable for Phase 26)
  - Flows loaded lazily on sheet open via useEffect calling getManychatFlows() server action (D-02)
  - Delete AlertDialog is state-driven with deletingRuleId state (no AlertDialogTrigger wrapper needed)
  - ruleSchema uses z.coerce.number() and z.boolean() without .default() to avoid Resolver type mismatch
metrics:
  duration: "11 minutes"
  completed_date: "2026-05-07"
  tasks_completed: 3
  files_changed: 5
---

# Phase 26 Plan 01: ManyChat Rules UI Summary

**One-liner:** Full CRUD rules manager for ManyChat routing rules — Sheet form with flow dropdown (lazy API load), condition key/value builder, and AlertDialog delete confirmation.

## What Was Built

### Task 1: getManychatFlows() + tests

Added `getManychatFlows()` to `src/app/(dashboard)/integrations/manychat/actions.ts`. The function mirrors the `testManychatConnection` pattern exactly — decrypts the org's API key via AES-256-GCM, fires `GET /fb/page/getFlows` with a 5-second `AbortController` timeout, and returns `{ flows: Array<{name, ns}> }` on success or `{ error: string }` on any failure path.

Six test cases written in `tests/manychat-flows.test.ts` covering: not authenticated, no channel, decrypt failure, AbortError timeout, non-2xx status, and success (verifying `name` + `ns` extraction from the API response).

### Task 2: Rules page + ManychatRules component

**`src/app/(dashboard)/integrations/manychat/rules/page.tsx`** — server component that:
- Guards auth via `getUser()` + redirect
- Parallel-fetches: `getManychatRules()`, `tool_configs` (id/tool_name/action_type/is_active), `manychat_channels` (id only)
- Passes `rules`, `toolConfigs`, `channelId` as props to `<ManychatRules>`

**`src/components/integrations/manychat-rules.tsx`** — client component with:
- **Rules table** (event_type, condition count badge, tool config name, priority, active badge, edit/delete actions)
- **RuleFormSheet** — Sheet with react-hook-form + zodResolver: event_type input, flow dropdown (loaded via `getManychatFlows` on open with loading/error states), tool config Select, priority number input, is_active Switch, and dynamic condition key/value rows via `useFieldArray`
- **AlertDialog** — state-driven delete confirmation (open when `deletingRuleId !== null`), calls `deleteManychatRule` on confirm
- **Toasts** — sonner `toast.success` / `toast.error` on all mutations

### Task 3: Nav links on settings page

Added `<nav>` with three `<Link>` elements (Settings | Rules | Events) to both:
- `/integrations/manychat/page.tsx` — Settings is underlined (active)
- `/integrations/manychat/rules/page.tsx` — Rules is underlined (active)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Zod resolver type incompatibility**
- **Found during:** Task 2, first build attempt
- **Issue:** `z.coerce.number().default(0)` and `z.boolean().default(true)` produce optional types in the Zod inference but not in react-hook-form's `RuleFormValues` — causing TS2322 on the `resolver` prop
- **Fix:** Removed `.default()` from `priority` and `isActive` in `ruleSchema`; supply explicit `defaultValues` in `useForm` instead
- **Files modified:** `src/components/integrations/manychat-rules.tsx`
- **Commit:** bea6b4e (part of Task 2)

**2. [Rule 1 - Bug] Fixed `vi.mocked(decrypt)` not resetting between test cases**
- **Found during:** Task 1, second test run (FLOWS-04/05/06 failing)
- **Issue:** FLOWS-03 overrides `decrypt` to throw; subsequent tests were not resetting it, causing cascade failures
- **Fix:** Added `vi.mocked(decrypt).mockResolvedValue('real-api-key')` to `beforeEach` in the test file
- **Files modified:** `tests/manychat-flows.test.ts`
- **Commit:** b1487e3

## Test Results

```
✓ FLOWS-01: returns { error: "Not authenticated." } when no user session
✓ FLOWS-02: returns { error: "No ManyChat channel configured." } when no channel row exists
✓ FLOWS-03: returns { error: "Failed to decrypt credentials." } when decrypt throws
✓ FLOWS-04: returns { error: "Connection timed out after 5 seconds." } when AbortError fires
✓ FLOWS-05: returns { error: "ManyChat returned status 401" } when response is not ok
✓ FLOWS-06: returns { flows } with name and ns on success

Test Files: 1 passed (1)
Tests: 6 passed (6)
```

## Build Status

`npm run build` exits 0 with zero type errors.

## Known Stubs

None — all data is wired from real server-side fetches. The flow dropdown in edit mode resets to empty (flow_ns not stored in the rules table) — this is an intentional design decision documented in Phase 26 CONTEXT.md, not a stub.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/app/(dashboard)/integrations/manychat/rules/page.tsx` | FOUND |
| `src/components/integrations/manychat-rules.tsx` | FOUND |
| `tests/manychat-flows.test.ts` | FOUND |
| Commit `b1487e3` (Task 1) | FOUND |
| Commit `bea6b4e` (Task 2) | FOUND |
| Commit `f9519c2` (Task 3) | FOUND |
