# Phase 36: Agent CRUD Dashboard — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-05-16
**Phase:** 36-agent-crud-dashboard
**Areas discussed:** List layout, Form layout, Channel overrides editor, Channel defaults UI, Tool picker, Slug

---

## List Page Layout

| Option | Description | Selected |
|---|---|---|
| Table (same as Tools) | Sortable columns: Name, Model, Active, Tools count, Last updated | ✓ |
| Card grid | Visual cards, less dense | |

**Why:** Consistency with existing dashboard pattern.

## Form Layout

| Option | Description | Selected |
|---|---|---|
| Single page with collapsible sections | All fields on one scrollable page, 4 cards (Basics/Generation/Tools/Channels) | ✓ |
| Tabs | Tabs at top with independent saves | |
| Wizard | Multi-step | |

**Why:** Easier to scan entire config at once; single save action.

## channel_overrides Editor

| Option | Description | Selected |
|---|---|---|
| Structured form: per-channel rows | Form fields per channel; Zod validates JSONB shape | ✓ |
| Free JSONB editor (Monaco/CodeMirror) | Code editor for raw JSON | |

**Why:** AGENT-07 requires structured validation; error-prone JSON editing avoided.

## Channel Defaults UI

| Option | Description | Selected |
|---|---|---|
| Inside /dashboard/agents list page | Top card above agents table | ✓ |
| Separate /dashboard/settings/channels page | Lives under settings | |

**Why:** Co-locates agent management with channel assignment.

## Tool Picker

| Option | Description | Selected |
|---|---|---|
| Inline checkbox list with folder collapsibles | Folders collapsible (v1.5 pattern), checkboxes per tool, no modal | ✓ |
| Modal with search + folder filter | Better for many tools, more clicks | |

**Why:** Reuses v1.5 tools dashboard pattern; visible state.

## Slug Field

| Option | Description | Selected |
|---|---|---|
| Auto-generated from name, editable | Hyphenated lowercase from name input, override allowed, unique-per-org validation | ✓ |
| Required manual input | Admin types explicitly | |

**Why:** Lower friction; unique-per-org validated server-side.

## Decisions Made by Orchestrator (Not Asked)

| Decision | Choice | Rationale |
|---|---|---|
| Delete behavior | Soft delete (is_active=false) | AGENT-10 requires historical agent_invocations to stay queryable |
| Inactive agent visibility | Shown in table (faded), excluded from dropdowns | Standard inactive pattern |
| Model dropdown options | Hardcoded constant (7 models from agent_model_pricing) | Matches Phase 33 seed |
| Server actions pattern | Next.js 'use server' with cached helpers | CLAUDE.md compliance |
| Sidebar nav entry | "Agents" entry below "Tools" | Logical hierarchy (agents consume tools) |
| Realtime subscriptions | None — admin-edited, low concurrency | Not needed |

## Deferred Ideas

- Partner agent picker → Phase 38
- Prompt version history view → Phase 41
- Bulk operations → v2.x
- Agent templates → v2.x
- Drag-and-drop ordering → not needed
