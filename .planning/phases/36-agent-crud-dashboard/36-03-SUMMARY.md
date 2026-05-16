---
phase: 36-agent-crud-dashboard
plan: 03
subsystem: ui
tags: [server-actions, tanstack-table, shadcn, rls, soft-delete, channel-defaults]

# Dependency graph
requires:
  - phase: 33-schema-foundation-legacy-default-agent-backfill
    provides: "agents table + agent_channel_defaults table (UNIQUE org+channel) + Main Agent seed per org"
  - phase: 36-agent-crud-dashboard/01
    provides: "agents.temperature + agents.max_tokens columns"
  - phase: 36-agent-crud-dashboard/02
    provides: "AGENT_CHANNELS const, AGENT_CHANNEL_LABELS, route scaffolds, empty actions module"
provides:
  - "src/app/(dashboard)/agents/actions.ts — 6 list-page server actions (getAgents, getActiveAgents, getChannelDefaults, setChannelDefault, toggleAgentActive, softDeleteAgent)"
  - "src/components/agents/agents-table.tsx — TanStack table with optimistic Active toggle + soft-delete modal"
  - "src/components/agents/channel-defaults-card.tsx — per-channel dropdown wired to setChannelDefault (sentinel maps to null = DELETE)"
  - "src/app/(dashboard)/agents/page.tsx — server component composing both, replaces Plan 02 scaffold"
  - "tests/agents/fixtures.ts — seedTestOrg helper (isolated org + Main Agent via service client)"
  - "tests/agents/list-actions.test.ts — integration suite verifying DB-side correctness of each action"
affects: [36-04 (edit form will reuse actions module + AgentListItem type), 36-05 (e2e verification will exercise this page)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Embedded count via PostgREST relation: select('*, agent_tools(count)') returns [{ count: N }] per row → narrow + flatten to a scalar tool_count"
    - "Soft-delete guard pattern: refuse if target IS Main Agent OR no active Main Agent exists; otherwise reassign FK references first, then deactivate"
    - "Radix Select sentinel value (__main_agent_default__) because Radix forbids empty-string values on SelectItem; handler maps sentinel → null before action call"
    - "DB-correctness tests run via service-role client (bypass RLS + skip request-scoped getUser); module-export assertion ensures the action file exists"

key-files:
  created:
    - src/components/agents/agents-table.tsx
    - src/components/agents/channel-defaults-card.tsx
    - tests/agents/fixtures.ts
    - tests/agents/list-actions.test.ts
    - .planning/phases/36-agent-crud-dashboard/36-03-SUMMARY.md
  modified:
    - src/app/(dashboard)/agents/actions.ts (placeholder → 6 real exports)
    - src/app/(dashboard)/agents/page.tsx (scaffold → real composition)

# Requirements satisfied
decisions:
  - "AGENT-01: Admin can see all agents (active + inactive) in a table with name/slug/model/tools-count/active/updated/actions"
  - "AGENT-08: Channel Defaults card UPSERTs/DELETEs agent_channel_defaults for the 6 supported channels"
  - "D-36-07: Soft-delete reassigns agent_channel_defaults rows pointing at the deleted agent → Main Agent; refuses if target IS Main Agent or no active Main Agent exists"
  - "D-36-08: Channel Defaults dropdowns receive only is_active=true agents; inactive rows render with opacity-60 in the table"
  - "Quality gate: Duplicate row action is intentionally absent (deferred to v2.x)"

metrics:
  duration_min: 10
  tasks: 3
  files_created: 5
  files_modified: 2
  commits: 4
  completed_date: 2026-05-16
---

# Phase 36 Plan 03: List Page + Channel Defaults Summary

`/agents` list page wired end-to-end with six RLS-scoped server actions, an
optimistic-toggle agents table, and a per-channel default agent mapping card.

## What Shipped

### Server Actions (`src/app/(dashboard)/agents/actions.ts`)

Replaced the empty `'use server'` placeholder from Plan 02 with six real exports:

| Action | Behavior |
|---|---|
| `getAgents()` | All org agents (active + inactive), DESC by created_at, with `tool_count` via embedded `agent_tools(count)` relation |
| `getActiveAgents()` | `is_active=true` only — feeds the Channel Defaults dropdown (D-36-08) |
| `getChannelDefaults()` | Returns `Record<AgentChannel, string \| null>` — all 6 channels with their current agent_id or null |
| `setChannelDefault(channel, agentId)` | UPSERTs on `(organization_id, channel)`; DELETEs the row when agentId is null |
| `toggleAgentActive(id, active)` | Flips `is_active` + stamps `updated_by`; revalidates `/agents` |
| `softDeleteAgent(id)` | Per D-36-07: refuses target IS Main Agent or no active Main Agent exists → reassigns `agent_channel_defaults` pointing at id → Main Agent → flips `is_active=false`; returns `reassignedCount` |

All actions follow the project convention: cached `getUser` + `createClient`,
return `{ error?: string } | void`, never throw. INSERTs/UPSERTs include
`organization_id` (RLS WITH CHECK); SELECTs rely on auto-scoping.

### Components

**`src/components/agents/agents-table.tsx`** — client component with TanStack table:

- Columns: Name (Link to `/agents/[id]`), Slug (mono), Model (Badge), Tools (`{n} attached`), Active (Switch, optimistic via useTransition), Updated (`formatDistanceToNow`), Actions (DropdownMenu)
- Row actions menu: **Edit + Delete only** — Duplicate intentionally absent
- Inactive rows: `opacity-60` (D-36-08 'faded')
- "Show inactive" toggle filters client-side (default: show all)
- Delete AlertDialog reads `channelDefaults` prop to compute reassignment count + channel labels in the confirmation message

**`src/components/agents/channel-defaults-card.tsx`** — Card with 6 rows (one per channel):

- Per-channel `<Select>` dropdown of active agents + "Main Agent (default)" sentinel option
- Radix Select forbids `value=""` so a sentinel (`__main_agent_default__`) maps to `null` before calling `setChannelDefault` (= DELETE)
- Inactive agents excluded (parent passes `is_active=true` only)
- `useTransition` keeps the UI responsive; toast on success/error; `router.refresh()` re-fetches

### Page (`src/app/(dashboard)/agents/page.tsx`)

Server component with `Promise.all` parallel-fetch of `getAgents` +
`getChannelDefaults` + `getActiveAgents`. Renders header + "New agent" button +
ChannelDefaultsCard + AgentsTable. The previous "Coming online" Card is gone.

### Tests

- `tests/agents/fixtures.ts` — `seedTestOrg()` helper creates an isolated org with a seeded Main Agent (service-role client, bypasses RLS). Cleanup cascades via `organizations.delete`.
- `tests/agents/list-actions.test.ts` — 7 tests: module-export assertion (proves the file compiles with all 6 exports) + 6 DB-correctness tests that exercise the exact SQL shapes each action runs (upsert / delete / update / soft-delete reassignment / Main Agent guard predicate / embedded count relation).

Why we don't invoke the actions directly: they call request-scoped Next.js
`getUser()`, which requires a Next.js request context Vitest doesn't bootstrap.
This approach was approved in the RESEARCH "Test Strategy" section.

## How the Pieces Fit

```
/agents (server component)
├── Promise.all(getAgents, getChannelDefaults, getActiveAgents)   ← 3 actions
├── <ChannelDefaultsCard defaults agents />                       ← active agents only
│     └── onChange → setChannelDefault(channel, id | null)        ← 4th action
└── <AgentsTable agents channelDefaults />                        ← all agents
      ├── Switch onCheckedChange → toggleAgentActive(id, next)    ← 5th action
      └── AlertDialog confirm → softDeleteAgent(id)               ← 6th action
            (delete modal reads channelDefaults to show
             reassignment count + per-channel labels)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Radix Select rejects empty-string value**
- **Found during:** Task 2 (channel-defaults-card.tsx)
- **Issue:** Plan asked for `<SelectItem value="">Main Agent (default)</SelectItem>` to represent "no default". Radix Select disallows empty-string values on items (throws at runtime).
- **Fix:** Introduced a sentinel constant `DEFAULT_SENTINEL = '__main_agent_default__'`. The Select value uses the sentinel when `defaults[ch]` is null; `onValueChange` maps the sentinel back to `null` before calling `setChannelDefault`. Functionally equivalent to the plan's intent.
- **Files modified:** `src/components/agents/channel-defaults-card.tsx`
- **Commit:** `2c4a7d1`

**2. [Rule 3 - Blocking] organizations.widget_token NOT NULL without default**
- **Found during:** Task 1 (test fixture)
- **Issue:** The `Database['public']['Tables']['organizations']['Insert']` type marks `widget_token` as optional, but the actual schema has NOT NULL and no DEFAULT — test fixture failed with `23502`.
- **Fix:** `seedTestOrg` now generates a `widget_token: 'wt-<random>'` per org insert.
- **Files modified:** `tests/agents/fixtures.ts`
- **Commit:** `c604e9b`

**3. [Rule 1 - Bug] tests/agents/list-actions.test.ts: wrong integrations column name**
- **Found during:** Task 1 test setup ("tools count" test)
- **Issue:** Initial test used `credentials: {}` on `integrations.insert(...)`; actual column is `encrypted_api_key TEXT NOT NULL`.
- **Fix:** Use `encrypted_api_key: 'test-key'`.
- **Files modified:** `tests/agents/list-actions.test.ts`
- **Commit:** `c604e9b`

### Plan-Driven Adjustments

- The plan acceptance criteria expected `grep -c "Main Agent (default)" channel-defaults-card.tsx` to return exactly 1. The initial implementation had 2 (one in the SelectValue placeholder, one in the SelectItem). Since the Select always has a value matching one of the items, the placeholder text was redundant — removed it to satisfy the criterion. Behavior unchanged.

### Auth Gates

None — Plan 03 didn't require any external authentication. Tests use the
service-role key already loaded by `tests/setup/load-env.ts`.

## Verification

```
$ npx vitest run tests/agents
Test Files  3 passed (3)
     Tests  22 passed (22)

$ npm run build
✓ Compiled successfully
✓ /agents route prerenders (ƒ Dynamic)
```

Acceptance criteria (from PLAN.md) all met:
- 6 actions exported with correct names (greps verified)
- `Cannot delete the Main Agent` + `no active Main Agent` strings present
- `onConflict: 'organization_id,channel'` present
- `revalidatePath('/agents')` count = 3
- agents-table.tsx contains AgentsTable, toggleAgentActive, softDeleteAgent, channelDefaults, AlertDialog; no Duplicate
- channel-defaults-card.tsx contains ChannelDefaultsCard, setChannelDefault, AGENT_CHANNELS, "Main Agent (default)"
- page.tsx contains ChannelDefaultsCard, AgentsTable, Promise.all, `/agents/new`; no "Coming online"
- `npm run build` exits 0

## Known Stubs

None. The page is fully wired:
- Every column shows real data from the DB.
- Every interaction (Active toggle, channel default change, soft delete) persists through a server action and revalidates the page.
- Inactive agents are correctly excluded from the Channel Defaults dropdowns at the data layer (`getActiveAgents` filters server-side).

The "New agent" button links to `/agents/new`, which currently renders the
Plan 02 scaffold ("Coming soon — full create form in Plan 04"). This is the
expected handoff to Plan 04; it is not a stub from this plan.

## What Plan 04 Inherits

- `AgentListItem` type (from `actions.ts`) — list view shape with `tool_count`
- The 6 list-page server actions — reusable in the edit form for `/agents/[id]/page.tsx` server fetch
- Test fixture pattern (`seedTestOrg`) — Plan 04's `createAgent`/`updateAgent` tests can reuse it
- The Channel Defaults card already handles the reassignment-target side of D-36-07; Plan 04's form just needs to expose `is_active` as a field

## Self-Check: PASSED

- [x] `src/app/(dashboard)/agents/actions.ts` — FOUND (6 exports verified by grep + test)
- [x] `src/app/(dashboard)/agents/page.tsx` — FOUND (real composition, no scaffold text)
- [x] `src/components/agents/agents-table.tsx` — FOUND
- [x] `src/components/agents/channel-defaults-card.tsx` — FOUND
- [x] `tests/agents/fixtures.ts` — FOUND
- [x] `tests/agents/list-actions.test.ts` — FOUND (7/7 green)
- [x] Commit `c604e9b` (test: RED) — FOUND in git log
- [x] Commit `2b2ba85` (feat: actions GREEN) — FOUND in git log
- [x] Commit `2c4a7d1` (feat: components) — FOUND in git log
- [x] Commit `6cbddb2` (feat: page wiring) — FOUND in git log
- [x] `npm run build` exits 0 — verified
- [x] `npx vitest run tests/agents` — 22/22 GREEN
