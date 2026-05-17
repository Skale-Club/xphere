---
phase: 36-agent-crud-dashboard
verified: 2026-05-16T19:55:00Z
status: passed
score: 5/5 success criteria verified · 7/7 requirements satisfied
re_verification: false
---

# Phase 36: Agent CRUD Dashboard — Verification Report

**Phase Goal:** An admin can create, edit, and configure agents end-to-end through `/dashboard/agents` — name, slug, prompt, model, generation config, fallback message, attached tools (reusing v1.5 folder grouping), partner agents, channel allow-list, channel overrides JSONB, and per-channel default mapping.

**Verified:** 2026-05-16T19:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (mapped from ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Admin can navigate to `/dashboard/agents`, see agents listed, create new agent with full field set, edit any field; saves persist with `created_by`/`updated_by` audit fields | VERIFIED | `src/app/(dashboard)/agents/page.tsx` renders `AgentsTable` + `ChannelDefaultsCard`; `new/page.tsx` + `[id]/page.tsx` render `AgentForm`; `createAgent` / `updateAgent` in `actions.ts` stamp `created_by` (L297) and `updated_by` (L298, L351); phase-gate test runs the full create→attach→default→soft-delete chain GREEN |
| 2 | Tool attachment uses multi-select picker reusing v1.5 `tool_folders` hierarchy; new agents start with zero tools (deny-by-default verified by all-unchecked picker); each row shows name/type/folder/integration with warning flag for missing integration | VERIFIED | `tool-picker.tsx` groups by `folder_id` (L69-77), renders Checkbox per tool (L126), Badge for type (L131), integration name + AlertTriangle warning for `is_active=false` (L139-153); `agent-form.tsx` L135 forces `tool_ids: []` in create mode; `createAgent` action L312 explicitly skips `setAgentTools` (TOOL-03 safety net); test `form-actions.test.ts` "new agent has zero agent_tools rows" GREEN |
| 3 | Admin can set default agent per channel via `agent_channel_defaults` UI; channels without default fall back to Main Agent | VERIFIED | `channel-defaults-card.tsx` renders Select per channel (L74-112) with `DEFAULT_SENTINEL` mapping to `null` → `setChannelDefault(ch, null)` DELETEs the row; setting a value UPSERTs with `onConflict: 'organization_id,channel'`; `softDeleteAgent` reassigns rows pointing at deleted agent → Main Agent (L179-184); phase-gate "lifecycle" test GREEN |
| 4 | Channel overrides JSONB editable via structured per-channel form; backed by Zod parser that rejects malformed shape on save | VERIFIED | `channel-overrides-editor.tsx` renders one Card per channel in `allowed_channels`, fields: system_prompt_suffix/model/temperature/max_tokens/max_history (L57-135); `zod-schemas.ts` `channelOverrideSchema.transform()` strips empty fields (L17-27); test "strips empty/undefined fields" GREEN, "rejects temperature out of range" GREEN |
| 5 | Inactive agents excluded from CRUD UI dropdowns but historical `agent_invocations` remain queryable | VERIFIED | `getActiveAgents()` at L49 filters `.eq('is_active', true)` and feeds `ChannelDefaultsCard.agents` prop; `softDeleteAgent` sets `is_active=false` without DELETE → historical FKs preserved; phase-gate test asserts `agent_tools` row still queryable after soft-delete (AGENT-10) GREEN |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/044_agents_generation_config.sql` | ADD COLUMN temperature NUMERIC(3,2) NULL + max_tokens INTEGER NULL + CHECK bounds | VERIFIED | 43 lines; both ADD COLUMN, both CHECK constraints, no DEFAULT clause, COMMENT ON COLUMN present |
| `src/types/database.ts` | temperature + max_tokens on agents Row/Insert/Update | VERIFIED | L398-399 (Row), L420-421 (Insert), L438-439 (Update) all present with `number \| null` |
| `src/lib/agents/zod-schemas.ts` | agentSchema + channelOverrideSchema with `.transform()` strip | VERIFIED | 60 lines; both exports present; `.transform()` at L17 strips empty fields |
| `src/lib/agents/slug.ts` | slugify() helper | VERIFIED | Lowercase + replace non-alnum with `-` + strip leading/trailing + 50-char slice |
| `src/lib/agents/models.ts` | AVAILABLE_MODELS const (7 entries) | VERIFIED | 7 model IDs including `anthropic/claude-sonnet-4-6` (DEFAULT_MODEL) |
| `src/lib/agents/channels.ts` | AGENT_CHANNELS (6 entries) + LABELS | VERIFIED | 6 channels mirror `agent_channel` enum; LABELS map present |
| `src/app/(dashboard)/agents/page.tsx` | Server component, Promise.all fetch, ChannelDefaultsCard + AgentsTable | VERIFIED | 37 lines; `Promise.all` at L12; "New agent" button → `/agents/new` |
| `src/app/(dashboard)/agents/new/page.tsx` | Renders AgentForm mode=create | VERIFIED | 17 lines; passes `mode="create"` and `toolPickerData` |
| `src/app/(dashboard)/agents/[id]/page.tsx` | Server component fetching agent + tool picker data; notFound on miss | VERIFIED | `notFound()` at L16; `Promise.all` at L12; full `initialValues` mapping |
| `src/app/(dashboard)/agents/actions.ts` | 11 server actions exported | VERIFIED | Exactly 11: getAgents, getActiveAgents, getChannelDefaults, setChannelDefault, toggleAgentActive, softDeleteAgent, getAgentById, getToolPickerData, createAgent, updateAgent, setAgentTools |
| `src/components/agents/agents-table.tsx` | TanStack table, Active Switch, Edit/Delete actions (no Duplicate), reassignment count in delete dialog | VERIFIED | 355 lines; columns Name/Slug/Model/Tools/Active/Updated/Actions; DropdownMenu items Edit + Delete only; AlertDialog shows reassignment channels by label |
| `src/components/agents/channel-defaults-card.tsx` | Per-channel Select with "Main Agent (default)" sentinel + setChannelDefault | VERIFIED | 117 lines; 6 Select rows + DEFAULT_SENTINEL maps to null; `disabled={isPending}` |
| `src/components/agents/agent-form.tsx` | 4 collapsible sections, zodResolver(agentSchema), auto-slug with manual override, partial-failure toast | VERIFIED | 499 lines; CollapsibleSection used 5× (def + 4 uses); titles "Basics"/"Generation"/"Tools"/"Channels"; slugTouched ref; exact recovery toast wording at L194 |
| `src/components/agents/tool-picker.tsx` | Folder collapsibles + Checkbox per tool + AlertTriangle for inactive integration (still selectable) | VERIFIED | 192 lines; groups by folder_id, "Unfiled" bucket for null; integration warning rendered when `is_active === false \|\| id == null`; no draggable/DnD code |
| `src/components/agents/channel-overrides-editor.tsx` | Per-channel cards with structured override fields | VERIFIED | 142 lines; renders one Card per channel; uses `useFormContext`; "Use base model" sentinel maps to undefined |
| `src/components/layout/app-sidebar.tsx` | Agents nav entry with Bot icon | VERIFIED | L17 Bot import; L47 `{ icon: Bot, label: 'Agents', href: '/agents', active: true }` |
| `tests/agents/rls.test.ts` | Cross-org isolation for 3 tables | VERIFIED | 5 tests GREEN: distinct orgs, agents partitioned, agent_tools partitioned, agent_channel_defaults partitioned, RLS smoke |
| `tests/agents/phase-gate.test.ts` | Full lifecycle + AGENT-02 bounds | VERIFIED | 3 tests GREEN: lifecycle, in-bounds persist, CHECK constraint rejects out-of-range |
| `tests/agents/form-actions.test.ts` | Deny-by-default + diff + 23505 + AGENT-02 persistence | VERIFIED | 5 tests GREEN |
| `tests/agents/list-actions.test.ts` | UPSERT/DELETE + toggle + softDelete reassignment + tools count | VERIFIED | 7 tests GREEN |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `agents-table.tsx` | `toggleAgentActive` / `softDeleteAgent` | Server action import + useTransition | WIRED | L24-26 imports; L82, L109 invocations inside `startTransition`; `router.refresh()` post-success |
| `channel-defaults-card.tsx` | `setChannelDefault` | onValueChange on Select | WIRED | L49 invocation inside `startTransition`; DEFAULT_SENTINEL → null branch |
| `agent-form.tsx` | `createAgent` / `updateAgent` | onSubmit handler | WIRED | L168, L184 invocations inside `startTransition`; slug-collision error mapped to field error via `form.setError('slug', …)` |
| `agent-form.tsx` | `agentSchema` | zodResolver | WIRED | L139 `resolver: zodResolver(agentSchema)` |
| `tool-picker.tsx` | `agent_tools` / `tool_configs` / `tool_folders` / `integrations` | data props from `getToolPickerData` | WIRED | Props typed as `ToolPickerData`; folder iteration L183-184; integration check L118-120; action SELECT joins `integrations(id, name, is_active)` |
| `actions.ts` | Supabase `agents` + `agent_channel_defaults` | createClient() + RLS-scoped queries | WIRED | 11 distinct `.from()` invocations across 11 actions; UPSERTs include `organization_id`; SELECTs rely on RLS |
| `migration 044` | remote Supabase DB | npx supabase db push | WIRED | Phase gate test "out-of-range temperature is rejected by CHECK constraint" GREEN — proves CHECK exists on remote |
| `src/types/database.ts` | `agentSchema` consumers | `Database['public']['Tables']['agents']['Insert']` shape | WIRED | createAgent / updateAgent pass `temperature` + `max_tokens` directly into Insert/Update — build GREEN proves shape alignment |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `agents/page.tsx` | `agents`, `channelDefaults`, `activeAgents` | `getAgents()`, `getChannelDefaults()`, `getActiveAgents()` (real Supabase queries on `agents` + `agent_channel_defaults`) | Yes — backed by real RLS-scoped SELECTs | FLOWING |
| `agents/[id]/page.tsx` | `agent`, `toolPickerData` | `getAgentById(id)` + `getToolPickerData()` | Yes — real SELECT on `agents` + relational join with `agent_tools.tool_config_id`, plus join `tool_configs → integrations` | FLOWING |
| `AgentsTable` | `agents`, `channelDefaults` props | passed from `page.tsx` after real DB fetch | Yes | FLOWING |
| `ChannelDefaultsCard` | `defaults`, `agents` props | real `getChannelDefaults()` + `getActiveAgents()` | Yes — empty object only if user is null; `is_active=true` filter excludes inactive | FLOWING |
| `AgentForm` (edit mode) | `defaultValues` | initialValues prop derived from real `getAgentById` row | Yes — every field mapped from DB row | FLOWING |
| `ToolPicker` | `data.folders`, `data.tools` | `getToolPickerData()` parallel fetch | Yes — uses `tool_name`, `action_type`, `folder_id`, `integration.is_active` (matched to real schema) | FLOWING |

No hollow renders. All dynamic data originates from real RLS-scoped Supabase queries.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 36 test suite | `npx vitest run tests/agents` | 35/35 GREEN in 7.07s across 6 files | PASS |
| Full project build | `npm run build` | Exit 0 — all 3 agent routes prerender as `ƒ /agents`, `ƒ /agents/[id]`, `ƒ /agents/new`; no TS errors | PASS |
| Migration 044 live on remote | (proxy) phase-gate test "out-of-range temperature is rejected by CHECK constraint" | GREEN — proves CHECK constraint applied | PASS |
| Vapi handlers untouched | `git diff --stat b276740~1..HEAD -- src/app/api/vapi/ src/lib/vapi/` | Empty (no diff) | PASS |
| Agent runtime untouched | `git diff --stat b276740~1..HEAD -- src/lib/agent-runtime/` | Empty (no diff) | PASS |
| Server-action count = 11 | grep `^export async function` in `actions.ts` | 11 matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AGENT-01 | 02, 03, 04 | name/slug (unique per org)/description/system_prompt/model/is_active CRUD | SATISFIED | Migration 034 enforces `uniq_agents_org_slug`; `form-actions.test.ts` "duplicate slug per org raises 23505" GREEN; `createAgent`/`updateAgent` translate 23505 → field error |
| AGENT-02 | 01, 04 | Optional temperature (default 0.7), max_tokens (default 1024), max_history (default 20 turns) | SATISFIED | Migration 044 adds NULL-able columns + CHECK bounds; `database.ts` types updated; form fields surfaced under "Generation"; phase-gate tests "persistence" + "out-of-range rejection" GREEN |
| AGENT-03 | 04 | Configurable `fallback_message` with default | SATISFIED | Form field at L312-322; default `'I cannot help with that right now.'` at L127; column exists in migration 034 with default text |
| AGENT-08 | 03 | Per-channel default agent mapping via `agent_channel_defaults` | SATISFIED | `ChannelDefaultsCard` UI wires `setChannelDefault` (UPSERT/DELETE); fallback to Main Agent via `softDeleteAgent` reassignment; phase-gate lifecycle test GREEN |
| TOOL-02 | 04 | Multi-select picker reusing v1.5 `tool_folders` grouping | SATISFIED | `tool-picker.tsx` groups by `folder_id`, renders Collapsible per folder + Checkbox per tool; `setAgentTools` diff logic preserves `agent_tools.allowed_channels` (Pitfall 5) — `form-actions.test.ts` GREEN |
| TOOL-03 | 04 | New agents start with zero attached tools (deny-by-default) | SATISFIED | `agent-form.tsx` L135 forces `tool_ids: []` in create mode; `createAgent` L312 explicitly skips `setAgentTools` safety net; form shows "New agents start with no tools attached" copy; test "new agent has zero agent_tools rows" GREEN |
| TOOL-04 | 04 | Picker shows name/type/folder/integration with visual flag for inactive integration (still selectable) | SATISFIED | `tool-picker.tsx` L130-138 renders tool_name + action_type Badge + integration.name; L139-153 renders AlertTriangle (amber) when `integration.is_active === false \|\| id == null`; Checkbox remains enabled (no `disabled` prop on inactive rows) |

All 7 requirements declared by phase plans are SATISFIED. No orphaned requirements (ROADMAP REQ list matches plan declarations).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none material) | — | — | — | — |

Notes during scan:
- `tool-picker.tsx` L51 initial `useState(new Set([...folders.map(f=>f.id), null]))` — initial empty set is overwritten by initializer function; not a stub.
- `actions.ts` returns `[]` and `null` from read helpers when user/org missing — defensive defaults, not hollow returns. Each read path has a real query immediately below.
- `getChannelDefaults` returns the `empty` skeleton when no rows match — this is intentional shape preservation (record of 6 channels with null values), not a stub.
- No `TODO`/`FIXME`/`PLACEHOLDER`/`Coming soon` strings detected in Phase 36 source files.

### Human Verification Required

None required for automated phase gate. The following remain useful for full UX confidence but are not blocking:

1. **Visual smoke of `/agents`** — Test: navigate to `/dashboard/agents` as an authenticated admin. Expected: Channel Defaults card above the agents table; Main Agent row shows is_active=true. Why human: visual layout, hover/focus states, optimistic-UI snappiness.
2. **End-to-end create + edit cycle in browser** — Test: create "Specialist Bot", reopen, attach a tool, save, soft-delete from row actions. Expected: redirect to `/agents/<newId>`, tool count updates after save, delete dialog mentions reassignment if Specialist was a channel default. Why human: router transitions + sonner toast timing.
3. **Inactive integration warning hover** — Test: deactivate an integration whose tool is in an agent's picker; reopen the agent edit page. Expected: AlertTriangle visible next to that tool; tooltip on hover shows "Integration missing or inactive". Why human: tooltip rendering + amber color contrast.

### Gaps Summary

None. All 5 success criteria are observably true in code, all 7 requirements are satisfied, all 35 phase-scope tests pass, the build is clean, the migration is verified live on remote (via the CHECK-constraint phase-gate assertion), and Vapi + agent-runtime are untouched across the entire phase commit range (commits `b276740..bd79a83`).

---

_Verified: 2026-05-16T19:55:00Z_
_Verifier: Claude (gsd-verifier)_
