---
phase: 36
name: Agent CRUD Dashboard
milestone: v2.0
status: planning
discuss_completed: 2026-05-16
---

# Phase 36: Context + Locked Decisions

## Phase Boundary

`/dashboard/agents` — admin can list, create, edit, and configure agents end-to-end. Reuses the existing v1.5 tool-folder hierarchy for tool selection. Includes per-channel default agent mapping (`agent_channel_defaults`) on the same page.

**Carrying forward from prior phases:**
- `agents` table created in Phase 33 — all columns already exist (`name`, `slug`, `description`, `system_prompt`, `model`, `is_active`, `temperature`, `max_tokens`, `max_history`, `fallback_message`, `allowed_channels`, `channel_overrides`, `kb_scope`)
- `agent_tools` junction created in Phase 33 — UI grants/revokes here
- `agent_channel_defaults` table created in Phase 33 — UI manages here
- `runAgent()` runtime (Phase 34) consumes whatever this UI creates — phase produces config, runtime executes
- `resolveTool/resolveAgentTool` already separate (Phase 34) — UI just toggles `agent_tools` rows
- Pattern locked: server actions + shadcn/ui + react-hook-form + zod (CLAUDE.md)
- Pattern locked: `createClient` / `getUser` cached helpers, never `supabase.auth.getUser()` directly

## Requirements in Scope

AGENT-01, AGENT-02, AGENT-03, AGENT-08, TOOL-02, TOOL-03, TOOL-04

## Out of Scope (Phase 36 boundary — do not implement)

- Partner agent picker / agent_partners UI → Phase 38 (delegation)
- Prompt version history / draft/publish flow → Phase 41
- Playground UI → Phase 39
- Observability widgets on agent page → Phase 40
- Channel adapters (ManyChat/Meta/Telegram) → Phase 37
- Agent badge in chat-area realtime view → Phase 40

---

## Locked Decisions

### D-36-01: List Page = Table Layout (Same as Tools)

**Decision:** `/dashboard/agents` uses the same table-with-server-actions pattern as `/dashboard/tools`.

Columns (left → right):
- **Name** (clickable, links to edit page)
- **Slug** (monospace, gray)
- **Model** (badge: `anthropic/claude-sonnet-4-6` etc.)
- **Tools** (count badge, e.g. "3 attached")
- **Active** (toggle switch, optimistic update)
- **Updated** (relative time)
- **Actions** (... menu: Edit / Delete) — Duplicate deferred to v2.x

Top of page has "New Agent" button (top-right) and a "Channel Defaults" card (top-left) — see D-36-04.

Pattern reuse: `src/components/tools/tools-table.tsx` shape. Equivalent file: `src/components/agents/agents-table.tsx`.

### D-36-02: Edit Form = Single Page with Collapsible Sections

**Decision:** Agent edit lives at `/dashboard/agents/[id]`. Single scrollable page with 4 collapsible cards:

1. **Basics** — name, slug (auto-generated from name, editable), description, system_prompt (large textarea), model (dropdown), is_active (toggle), fallback_message
2. **Generation** — temperature (number 0-2 step 0.1), max_tokens (number), max_history (number turns)
3. **Tools** — inline checkbox list with folder collapsibles (D-36-05)
4. **Channels** — allowed_channels (multi-select chips), channel_overrides editor (D-36-03)

Single "Save" button at the bottom persists everything in one server action. Form-level zod validation.

Create flow at `/dashboard/agents/new` uses the same form with empty defaults.

### D-36-03: channel_overrides = Structured Per-Channel Rows

**Decision:** Each channel in `allowed_channels` shows a row with these editable fields:
- `system_prompt_suffix` (textarea, optional — appended to base prompt with newline separator)
- `model` (dropdown, optional — empty = use agent base model)
- `temperature` (number, optional)
- `max_tokens` (number, optional)
- `max_history` (number, optional)

Empty fields are NOT written to the JSONB (so the runtime falls back to base agent values). Zod schema validates the shape on save and rejects malformed structures.

Server-side: `channel_overrides JSONB` is shaped as `Record<AgentChannel, Partial<ChannelOverride>>`.

### D-36-04: agent_channel_defaults = Top Card on Agents List Page

**Decision:** `/dashboard/agents` shows a "Channel Defaults" card at the top, above the agents table.

Each row = a channel (web_widget, whatsapp, messenger, instagram, manychat, telegram).
Each row has: channel name + dropdown of org's `is_active=true` agents.
Selecting an agent for a channel UPSERTs `agent_channel_defaults(org_id, channel, agent_id)`.
Clearing the selection DELETEs the row → channel falls back to the seeded Main Agent at runtime.

Inactive agents are excluded from the dropdown (D-36-08). Channels without a default fall back to Main Agent in `runAgent`'s `agent_channel_defaults` resolution (Phase 35 D-35-06 already handles this).

### D-36-05: Tool Picker = Inline Checkbox List with Folder Collapsibles

**Decision:** The "Tools" section on the agent edit page shows tools grouped by `tool_folders` (v1.5 hierarchy). Folders are collapsible sections. Each tool row has:
- Checkbox (state: checked = exists in `agent_tools`)
- Tool name (clickable link to `/dashboard/tools/[id]` in new tab)
- Type badge (`send_sms`, `custom_webhook`, etc.)
- Integration name (e.g. "GoHighLevel" — pulled from `tool_configs.integration_id` join)
- Warning icon if integration is `is_active=false` or missing (still selectable per TOOL-04)

A search input above the list filters tool names client-side.

Save behavior: on form submit, diff selected vs current `agent_tools` rows → INSERT new selections, DELETE removed ones (single transaction).

Per TOOL-03: when CREATING a new agent, the picker starts with all checkboxes UNCHECKED (deny-by-default).

### D-36-06: Slug = Auto-Generated from Name, Editable

**Decision:** Slug field auto-fills as user types name (lowercased, hyphenated, max 50 chars). User can override the auto-fill. Zod validates: `^[a-z0-9-]+$` and `min(1)`. Server-side action checks unique per org before save — returns field-level error if collision.

### D-36-07: Delete = Soft Delete (is_active=false)

**Decision:** "Delete" action sets `is_active=false` and reassigns any `agent_channel_defaults` rows pointing at this agent to the Main Agent. Historical `agent_invocations` rows stay queryable (AGENT-10 requirement). A confirmation modal shows: "X channel defaults will be reassigned to Main Agent. Continue?"

True hard-delete is not exposed in the UI (would orphan FK rows and historical invocations).

### D-36-08: Inactive Agents Visible in List, Excluded from Dropdowns

**Decision:** Inactive agents (`is_active=false`) are shown in the agents table (faded row, "Active" toggle off). A filter dropdown at top of table lets admin toggle "Show inactive" (default: show all).

Inactive agents are EXCLUDED from:
- The "Channel Defaults" card dropdowns
- The dropdown shown when reassigning channel defaults during delete (D-36-07)
- Future partner agent picker (Phase 38)

### D-36-09: Model Dropdown = Hardcoded Options for Now

**Decision:** Model dropdown options are hardcoded in a constant for Phase 36:
```ts
const AVAILABLE_MODELS = [
  'anthropic/claude-sonnet-4-6',  // default for new agents (D-34-04)
  'anthropic/claude-opus-4-7',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
] as const
```

This matches the 7 models seeded in `agent_model_pricing` (Phase 33). Future: dropdown could be sourced from `agent_model_pricing` table — deferred until pricing rows are managed via admin UI.

### D-36-10: Server Actions Pattern

**Decision:** All CRUD operations use Next.js server actions (`'use server'`):
- `src/app/(dashboard)/agents/actions.ts` exports: `getAgents()`, `getAgentById(id)`, `createAgent(input)`, `updateAgent(id, input)`, `softDeleteAgent(id)`, `toggleAgentActive(id, active)`, `setAgentTools(agentId, toolIds[])`, `getChannelDefaults()`, `setChannelDefault(channel, agentId | null)`
- Server actions use `getUser()` + `createClient()` cached helpers (RLS auto-scopes by org)
- Form submissions use `useFormStatus` / `useFormState` (React 19 patterns) where appropriate, otherwise client-side react-hook-form + a "save" handler that calls the server action

### D-36-11: Navigation — Add "Agents" to Sidebar

**Decision:** Add an "Agents" entry to the existing `AppSidebar` (`src/components/layout/AppSidebar.tsx`) — placed below "Tools" since agents consume tools. Icon: bot/robot icon from lucide-react.

### D-36-12: No Realtime Subscriptions on Agents List

**Decision:** Agents are admin-edited (low concurrency); no `postgres_changes` subscriptions needed. `revalidatePath('/dashboard/agents')` after server actions is sufficient.

---

## Existing Code Patterns to Reuse

| Pattern | Source |
|---|---|
| Table + server actions | `src/app/(dashboard)/tools/page.tsx` + `actions.ts` |
| Tool folder collapsibles | `src/components/tools/tools-table.tsx` |
| Form pattern (react-hook-form + zod) | `src/components/tools/tool-config-form.tsx` |
| Sidebar nav entry | `src/components/layout/AppSidebar.tsx` |
| Server action with RLS | `src/app/(dashboard)/tools/actions.ts` (getToolConfigs) |
| Soft delete pattern | (new — no existing precedent; use is_active=false) |

## Key Files (created in Phase 36)

| File | Purpose |
|---|---|
| `src/app/(dashboard)/agents/page.tsx` | List page (table + Channel Defaults card) |
| `src/app/(dashboard)/agents/new/page.tsx` | Create page (reuses edit form) |
| `src/app/(dashboard)/agents/[id]/page.tsx` | Edit page |
| `src/app/(dashboard)/agents/actions.ts` | All server actions |
| `src/components/agents/agents-table.tsx` | List table component |
| `src/components/agents/agent-form.tsx` | Edit form (collapsible sections) |
| `src/components/agents/channel-defaults-card.tsx` | Top card on list page |
| `src/components/agents/tool-picker.tsx` | Inline tool checkbox tree |
| `src/components/agents/channel-overrides-editor.tsx` | Per-channel JSONB editor |
| `src/lib/agents/zod-schemas.ts` | Shared zod schemas for agent CRUD validation |
| `src/components/layout/AppSidebar.tsx` | Updated — add Agents nav entry |

## Test Strategy

- Unit: zod schemas (slug regex, channel_overrides shape validation)
- Integration: server actions against real Supabase (create → update → soft delete → channel defaults set/clear) — service-role for setup, authenticated client for assertions
- No UI snapshot tests (the visual design is not in scope for this phase's test coverage)

## Deferred Ideas

- Bulk operations (multi-select agents for bulk activate/deactivate) → v2.x
- Agent templates (clone from a template) → v2.x cross-org marketplace
- Drag-and-drop ordering of agents → not needed for v2.0
- Partner agents picker (DELEG-01 schema exists; UI is Phase 38)
- Prompt version history view → Phase 41
- Model dropdown sourced from `agent_model_pricing` DB table → future
