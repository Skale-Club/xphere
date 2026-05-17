# Phase 36: Agent CRUD Dashboard - Research

**Researched:** 2026-05-16
**Domain:** Next.js 15 App Router admin CRUD UI (server actions + react-hook-form + zod + shadcn/ui + Supabase RLS)
**Confidence:** HIGH

## Summary

Phase 36 is a pure UI/server-action phase over an already-shipped schema. Every table the UI manipulates (`agents`, `agent_tools`, `agent_channel_defaults`) was created in Phase 33 (migrations 034 + 036) with full RLS via `(SELECT public.get_current_org_id())`, and the runtime that consumes the data (`runAgent()`) is already live (Phases 34-35). The phase produces config; it does not change runtime behavior.

The codebase has a tight, well-established pattern for this exact shape of work: `/dashboard/tools` is a 1:1 reference — it pairs a server-component list page with a server-actions module, a client `*-table.tsx` with folder collapsibles, and a `*-form.tsx` built on `react-hook-form` + `zod` + `@hookform/resolvers/zod`. **Reuse, do not reinvent.**

**Primary recommendation:** Mirror `src/app/(dashboard)/tools/` end to end. Add **only** two new shadcn primitives the project doesn't yet have (`Checkbox` and `Collapsible`); everything else is already installed. Resolve one critical schema gap with the planner (D-36-02 lists `temperature` and `max_tokens` form fields but the `agents` table has no such columns — they only exist inside `channel_overrides` JSONB per Phase 34 state).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-36-01: List Page = Table Layout (Same as Tools)**
`/dashboard/agents` uses the same table-with-server-actions pattern as `/dashboard/tools`. Columns left → right: Name (clickable link), Slug (mono/gray), Model (badge), Tools (count badge), Active (toggle Switch, optimistic), Updated (relative time), Actions (... menu: Edit / Duplicate / Delete). Top of page has "New Agent" button (top-right) and a "Channel Defaults" card (top-left).

**D-36-02: Edit Form = Single Page with Collapsible Sections**
Agent edit lives at `/dashboard/agents/[id]`. Single scrollable page with 4 collapsible cards:
1. **Basics** — name, slug (auto from name, editable), description, system_prompt (large textarea), model (dropdown), is_active (toggle), fallback_message
2. **Generation** — temperature (0-2 step 0.1), max_tokens, max_history
3. **Tools** — inline checkbox list with folder collapsibles (D-36-05)
4. **Channels** — allowed_channels (multi-select chips), channel_overrides editor (D-36-03)

Single "Save" button at bottom persists everything in one server action. Form-level zod validation. Create at `/dashboard/agents/new` with empty defaults.

**D-36-03: channel_overrides = Structured Per-Channel Rows**
Each channel in `allowed_channels` shows a row with: `system_prompt_suffix` (textarea), `model` (dropdown), `temperature`, `max_tokens`, `max_history`. Empty fields NOT written to JSONB. Zod validates shape. Server-side: `channel_overrides JSONB` shaped as `Record<AgentChannel, Partial<ChannelOverride>>`.

**D-36-04: agent_channel_defaults = Top Card on Agents List Page**
"Channel Defaults" card at top of `/dashboard/agents`, above the agents table. Each row = a channel (web_widget, whatsapp, messenger, instagram, manychat, telegram). Each row has: channel name + dropdown of org's `is_active=true` agents. Selecting UPSERTs `agent_channel_defaults(org_id, channel, agent_id)`. Clearing DELETEs the row → falls back to seeded Main Agent. Inactive agents excluded.

**D-36-05: Tool Picker = Inline Checkbox List with Folder Collapsibles**
"Tools" section shows tools grouped by `tool_folders` (v1.5 hierarchy). Folders collapsible. Each tool row: checkbox (state from `agent_tools`), name (link to `/dashboard/tools/[id]` new tab), type badge, integration name, warning icon if integration `is_active=false`. Search input above filters client-side. Save behavior: diff selected vs current `agent_tools` → INSERT new, DELETE removed (single transaction). New agents start UNCHECKED (deny-by-default per TOOL-03).

**D-36-06: Slug = Auto-Generated from Name, Editable**
Auto-fills as user types name (lowercased, hyphenated, max 50 chars). Override allowed. Zod: `^[a-z0-9-]+$` and `min(1)`. Server-side uniqueness check per org → field-level error on collision.

**D-36-07: Delete = Soft Delete (is_active=false)**
"Delete" sets `is_active=false` and reassigns any `agent_channel_defaults` rows pointing at this agent to the Main Agent. Historical `agent_invocations` rows stay queryable. Confirmation modal: "X channel defaults will be reassigned to Main Agent. Continue?". No hard delete in UI.

**D-36-08: Inactive Agents Visible in List, Excluded from Dropdowns**
Inactive agents shown in table (faded row, Active toggle off). Filter dropdown "Show inactive" (default: show all). Excluded from: Channel Defaults dropdowns, reassignment dropdown during delete, future partner picker.

**D-36-09: Model Dropdown = Hardcoded Options for Now**
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

**D-36-10: Server Actions Pattern**
`src/app/(dashboard)/agents/actions.ts` exports: `getAgents()`, `getAgentById(id)`, `createAgent(input)`, `updateAgent(id, input)`, `softDeleteAgent(id)`, `toggleAgentActive(id, active)`, `setAgentTools(agentId, toolIds[])`, `getChannelDefaults()`, `setChannelDefault(channel, agentId | null)`. Use `getUser()` + `createClient()` cached helpers (RLS auto-scopes).

**D-36-11: Navigation — Add "Agents" to Sidebar**
Add "Agents" entry to existing `AppSidebar` (`src/components/layout/app-sidebar.tsx`), placed below "Tools". Icon: bot/robot from lucide-react.

**D-36-12: No Realtime Subscriptions on Agents List**
Admin-edited (low concurrency); no `postgres_changes` subscriptions. `revalidatePath('/dashboard/agents')` after server actions is sufficient.

### Claude's Discretion

- Exact zod schema breakdown (file structure, naming) — recommended in `## Architecture Patterns`
- Where to add `Checkbox` and `Collapsible` shadcn primitives (path/install) — recommended below
- Diff algorithm for tool selection (set diff vs full delete+insert) — recommended below
- Whether to consolidate Switch (Active toggle) into the table row or use a `<Form>` field — table-row inline matches Tools precedent
- Whether to use `Sheet` or new route page for create — CONTEXT.md says new route (`/dashboard/agents/new`), so follow

### Deferred Ideas (OUT OF SCOPE)

- Bulk operations (multi-select agents for bulk activate/deactivate) → v2.x
- Agent templates (clone from a template) → v2.x cross-org marketplace
- Drag-and-drop ordering of agents → not needed for v2.0
- Partner agents picker (DELEG-01 schema exists; UI is Phase 38)
- Prompt version history view → Phase 41
- Model dropdown sourced from `agent_model_pricing` DB table → future
- Channel adapters (ManyChat/Meta/Telegram inbound branching on `agent_id`) → Phase 37
- Per-agent metrics widget / observability → Phase 40
- Playground UI → Phase 39
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGENT-01 | Each org can create agents with required fields: name, slug (unique per org), description, system_prompt, model, is_active | `agents` table + `(org, slug) UNIQUE` already in migration 034; CONTEXT D-36-02 covers all required fields; ROADMAP success criterion #1 |
| AGENT-02 | Optional generation config: temperature (default 0.7), max_tokens (default 1024), max_history (default 20) | **GAP:** `agents` table has only `max_history` column. `temperature`/`max_tokens` are not table columns — they live inside `channel_overrides` JSONB (Phase 34 state). See `## Open Questions` Q1 |
| AGENT-03 | Configurable `fallback_message` (default: "I can't help...") | `agents.fallback_message TEXT NOT NULL DEFAULT 'I cannot help with that right now.'` exists in migration 034 |
| AGENT-08 | Map default agent per channel via `agent_channel_defaults(org_id, channel, agent_id)`; channel inbound resolves via this table when no rule-level override | Table exists (migration 036). CONTEXT D-36-04 covers UI. Runtime resolution already done (Phase 35 D-35-06). |
| TOOL-02 | Attach/detach tools via multi-select picker reusing v1.5 `tool_folders` grouping | `tool_folders` + `tool_configs.folder_id` exist; `agent_tools(agent_id, tool_config_id)` UNIQUE in migration 034. CONTEXT D-36-05 covers the picker |
| TOOL-03 | New agents start with **zero attached tools** (deny-by-default) | CONTEXT D-36-05 final paragraph mandates unchecked-by-default; ROADMAP success criterion #2 |
| TOOL-04 | Picker shows tool name, type, folder, depended-on integration; tools without usable integration visually flagged but still selectable | `tool_configs` join to `integrations` already used in `getToolConfigs()`. CONTEXT D-36-05 covers warning icon requirement |
</phase_requirements>

## Standard Stack

All libraries below are **already installed**. No new runtime dependency is strictly required, but two new shadcn/ui primitives (Checkbox, Collapsible) should be generated.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.2.2 | App Router, server actions, `revalidatePath` | Project framework (CLAUDE.md) |
| react | ^19.0.0 | useTransition, useFormStatus, server components | Locked |
| @supabase/ssr | ^0.10.0 | `createServerClient` with RLS-scoped cookies | Used by `src/lib/supabase/server.ts` |
| react-hook-form | ^7.72.0 | Form state | Project standard for all forms (CLAUDE.md) |
| @hookform/resolvers | ^5.2.2 | Wires zod into RHF (`zodResolver`) | Project standard |
| zod | ^3.25.76 | Schema validation (client + server) | Project standard |
| @tanstack/react-table | ^8.21.3 | Headless table for list pages | Used in tools-table.tsx |
| sonner | (transitive) | Toast notifications | Project standard (CLAUDE.md) |
| date-fns | ^4.1.0 | Relative time formatting ("Updated" column) | Used in tool detail page |
| lucide-react | ^1.7.0 | Icons (Bot icon for sidebar) | Project icon set |

### Supporting shadcn/ui primitives already in `src/components/ui/`
| Primitive | Path | Use For |
|-----------|------|---------|
| Table | `table.tsx` | Agents list grid + tool picker rows |
| Card | `card.tsx` | Channel Defaults card + 4 form sections (use as collapsible container) |
| Form / FormField / FormItem / FormControl / FormLabel / FormMessage / FormDescription | `form.tsx` | RHF wrapper |
| Input / Textarea / Label | `input.tsx`, `textarea.tsx`, `label.tsx` | Form fields |
| Select / SelectContent / SelectItem / SelectTrigger / SelectValue | `select.tsx` | Model dropdown, channel-default dropdown |
| Switch | `switch.tsx` | `is_active` toggle |
| Badge | `badge.tsx` | Model badge, tool count badge, channel chips, integration "missing" flag |
| Button | `button.tsx` | Save, New Agent, Cancel, etc. |
| DropdownMenu | `dropdown-menu.tsx` | Row actions (... menu: Edit / Duplicate / Delete) |
| AlertDialog | `alert-dialog.tsx` | Delete confirmation modal (D-36-07) |
| Dialog | `dialog.tsx` | Alternative for non-destructive modals |
| Sheet | `sheet.tsx` | Available, but D-36-02 says full page route — likely unused |
| Skeleton | `skeleton.tsx` | Loading state |
| Tooltip | `tooltip.tsx` | Integration "missing" hover info |
| Tabs | `tabs.tsx` | Available, but D-36-02 says collapsibles not tabs |
| ScrollArea | `scroll-area.tsx` | Tool picker scroll within section |

### Missing primitives (ADD before form implementation)
| Primitive | Radix package | Why needed |
|-----------|---------------|------------|
| **Checkbox** | `@radix-ui/react-checkbox` | Tool picker (D-36-05); allowed_channels multi-select chips |
| **Collapsible** | `@radix-ui/react-collapsible` | 4 form sections (Basics / Generation / Tools / Channels). Card primitive does not collapse. |

**Installation:**
```bash
npm install @radix-ui/react-checkbox @radix-ui/react-collapsible
```

Then create `src/components/ui/checkbox.tsx` and `src/components/ui/collapsible.tsx` from canonical shadcn/ui templates (https://ui.shadcn.com/docs/components/checkbox, https://ui.shadcn.com/docs/components/collapsible). The pattern matches the existing `switch.tsx` shim — thin Radix wrapper with `cn()` styling.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `react-hook-form` + zod | Native React 19 `useFormState` / `useActionState` | RHF is project-locked (CLAUDE.md); newer React patterns are partially used elsewhere but for a 30+ field form RHF dramatically simplifies dirty tracking, conditional sections, and per-field validation feedback |
| Tabs primitive | Collapsibles per D-36-02 | User explicitly locked Collapsible sections; do not deviate |
| Sheet/drawer for new agent | Full route page per D-36-02 | Locked. Drives URL-shareability for unfinished drafts |
| Checkbox-list tool picker | Combobox with chips | Locked by D-36-05; checkbox-list reuses folder collapsibles consistently with v1.5 |

**Version verification:** All package.json versions above were read directly from `C:\Users\Vanildo\Dev\operator\package.json` on 2026-05-16. The two new Radix packages should be installed at the latest 1.x (verified: `@radix-ui/react-checkbox@1.3.x` and `@radix-ui/react-collapsible@1.1.x` are the current series as of 2026-05).

## Architecture Patterns

### Recommended File Layout (mirrors `/dashboard/tools/`)

```
src/
├── app/(dashboard)/agents/
│   ├── page.tsx                  # server component: list + Channel Defaults card
│   ├── new/page.tsx              # server component: empty form
│   ├── [id]/page.tsx             # server component: fetch + render form
│   └── actions.ts                # all 'use server' server actions
├── components/agents/
│   ├── agents-table.tsx          # client: TanStack table + filter + row actions
│   ├── agent-form.tsx            # client: react-hook-form, 4 collapsible sections
│   ├── channel-defaults-card.tsx # client: per-channel dropdown row
│   ├── tool-picker.tsx           # client: folder collapsibles + checkbox list + search
│   └── channel-overrides-editor.tsx # client: per-channel row editor
├── lib/agents/
│   ├── zod-schemas.ts            # shared zod schemas (slug, channel_overrides, etc.)
│   ├── slug.ts                   # slugify(name) helper
│   └── models.ts                 # AVAILABLE_MODELS const (D-36-09)
└── components/ui/
    ├── checkbox.tsx              # NEW
    └── collapsible.tsx           # NEW
```

### Pattern 1: Server-Component List Page (verbatim from `/dashboard/tools/page.tsx`)

```typescript
// Source: src/app/(dashboard)/tools/page.tsx
import { getAgents, getChannelDefaults, getActiveAgents } from './actions'
import { AgentsTable } from '@/components/agents/agents-table'
import { ChannelDefaultsCard } from '@/components/agents/channel-defaults-card'

export default async function AgentsPage() {
  const [agents, channelDefaults, activeAgents] = await Promise.all([
    getAgents(),
    getChannelDefaults(),
    getActiveAgents(),
  ])

  return (
    <div className="p-6 space-y-5">
      <ChannelDefaultsCard defaults={channelDefaults} agents={activeAgents} />
      <AgentsTable agents={agents}>
        <h1 className="text-lg font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure the chat agents that serve your text channels.
        </p>
      </AgentsTable>
    </div>
  )
}
```

### Pattern 2: Server Action Shape (verbatim from `tools/actions.ts`)

```typescript
'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createAgent(input: CreateAgentInput): Promise<{ error?: string; id?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data, error } = await supabase.from('agents').insert({
    organization_id: orgId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    system_prompt: input.system_prompt,
    model: input.model,
    fallback_message: input.fallback_message,
    max_history: input.max_history,
    allowed_channels: input.allowed_channels,
    channel_overrides: input.channel_overrides,
    is_active: input.is_active,
    created_by: user.id,
    updated_by: user.id,
  }).select('id').single()

  if (error) {
    if (error.code === '23505') return { error: 'An agent with this slug already exists for your organization.' }
    return { error: error.message }
  }

  revalidatePath('/dashboard/agents')
  return { id: data.id }
}
```

**Key conventions to honor (all verified from `tools/actions.ts`):**
- Return shape: `{ error?: string } | void` (or with extra fields like `{ id }` on create); never throw
- Always call `await getUser()` first; return early if null
- Use `await createClient()` to get the cached, RLS-aware Supabase client
- Use `revalidatePath('/dashboard/agents')` after every mutation
- Treat error code `23505` (Postgres unique violation) as a field-level user error
- Never manually filter by `org_id` in queries (RLS scopes automatically) — but DO set `organization_id` on inserts (RLS `WITH CHECK` requires it). For the agent slug-uniqueness check, the `(organization_id, slug)` UNIQUE constraint already in migration 034 handles it via `23505`; an explicit pre-check is redundant.

### Pattern 3: Form (verbatim from `tools/tool-config-form.tsx`)

```typescript
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

const agentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits, hyphens only').max(50),
  description: z.string().max(500).nullable().optional(),
  system_prompt: z.string().min(1, 'System prompt is required'),
  model: z.enum(AVAILABLE_MODELS),
  fallback_message: z.string().min(1).max(500),
  max_history: z.number().int().min(1).max(100),
  is_active: z.boolean(),
  allowed_channels: z.array(z.enum(AGENT_CHANNELS)).min(1, 'At least one channel'),
  channel_overrides: z.record(z.enum(AGENT_CHANNELS), channelOverrideSchema),
  tool_ids: z.array(z.string().uuid()),
})

const form = useForm<z.infer<typeof agentSchema>>({
  resolver: zodResolver(agentSchema),
  mode: 'onSubmit',
  defaultValues: { /* ... */ },
})
```

The `channel_overrides` schema must strip empty fields **before** writing to JSONB (per D-36-03):

```typescript
const channelOverrideSchema = z.object({
  system_prompt_suffix: z.string().optional(),
  model: z.enum(AVAILABLE_MODELS).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).optional(),
  max_history: z.number().int().min(1).optional(),
}).transform((v) => {
  // Strip undefined/empty so JSONB stays compact and runtime falls back to base values
  const cleaned: Record<string, unknown> = {}
  if (v.system_prompt_suffix?.trim()) cleaned.system_prompt_suffix = v.system_prompt_suffix.trim()
  if (v.model) cleaned.model = v.model
  if (v.temperature !== undefined) cleaned.temperature = v.temperature
  if (v.max_tokens !== undefined) cleaned.max_tokens = v.max_tokens
  if (v.max_history !== undefined) cleaned.max_history = v.max_history
  return cleaned
})
```

### Pattern 4: Sidebar Nav Entry (verbatim from `app-sidebar.tsx`)

The sidebar uses a simple object array. Add an entry like:

```typescript
// Source: src/components/layout/app-sidebar.tsx line 42-50
import { Bot } from 'lucide-react' // ADD this import

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/', active: true },
  { icon: Phone, label: 'Phone', href: '/phone', active: true },
  { icon: Zap, label: 'Tools', href: '/tools', active: true },
  { icon: Bot, label: 'Agents', href: '/agents', active: true }, // INSERT here (below Tools per D-36-11)
  { icon: BookOpen, label: 'Knowledge', href: '/knowledge', active: true },
  // ...
]
```

The active-state matching at line 110-118 already handles `pathname.startsWith(item.href + '/')`, so `/agents/new` and `/agents/[id]` will both highlight the Agents entry without extra work.

### Pattern 5: Tool Picker Reuse Strategy

`src/components/tools/tools-table.tsx` is **875 lines** and implements folder collapsibles with DnD + rename + delete. **Do not try to parameterize it.** Build a leaner `agent-tool-picker.tsx` that reuses only the *grouping logic* (the `toolsByFolder` / `subfoldersByParent` `useMemo` blocks at lines 724-744) and renders rows as `<label><Checkbox/>...</label>` instead of `<DraggableToolRow/>`. No DnD, no rename, no add-folder UI inside the picker.

Concretely, copy:
- The `toolsByFolder` map (folder_id → tools[]) — pure data shape
- The `subfoldersByParent` map (parent_id → folder[]) — pure data shape
- The render loop that iterates `orderedFolders` → renders folder header → renders subfolders → renders tools
- The collapsed-folder Set state

Replace:
- Each `DraggableToolRow` with `<ToolPickerRow tool={tool} checked={selectedIds.has(tool.id)} onToggle={...} />`
- The DnD context and sortable contexts → remove
- The folder add/rename/delete buttons → remove

### Anti-Patterns to Avoid

- **Don't compute uniqueness in JS before insert.** The DB constraint `(organization_id, slug) UNIQUE` is the source of truth; handle `23505` on error. Pre-checking creates a TOCTOU race.
- **Don't `supabase.auth.getUser()` in server actions** — use the cached `getUser()` from `@/lib/supabase/server` (CLAUDE.md mandatory).
- **Don't manually filter by `organization_id` in SELECT queries** — RLS already does it (CLAUDE.md). DO set it on INSERT (RLS WITH CHECK requires it).
- **Don't re-implement the Tools table.** Build a separate, smaller picker. Reuse the data shape, not the JSX tree.
- **Don't store `temperature` or `max_tokens` as agent columns** — they don't exist on the table (see Open Question Q1). They live in `channel_overrides` JSONB only.
- **Don't write empty fields into `channel_overrides`** — strip them so the runtime's "missing key → use base" fallback works (Phase 34 lock).
- **Don't use `revalidatePath('/tools')`** for agent mutations — use `revalidatePath('/dashboard/agents')` or just `/agents` to match the existing convention (note: `tools/actions.ts` uses `/tools` not `/dashboard/tools` — match that style, so use `/agents`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state + validation | Custom controlled inputs | `react-hook-form` + `zodResolver` | Project-locked; 30+ field form needs RHF for dirty tracking & sectioned validation |
| Schema validation (client+server) | Hand-rolled `if/else` checks | `zod` | Already in use; share schema between client form and server action |
| Slug uniqueness check | Pre-flight SELECT then INSERT | DB `UNIQUE` constraint + error code `23505` | Atomic; race-free. Constraint already exists in migration 034 |
| Table | Hand-rolled `<table>` | `@tanstack/react-table` headless | Used in `tools-table.tsx`; sortable / filterable out of the box |
| Diff insert/delete for `agent_tools` | Full delete + re-insert on each save | Set diff: `toAdd = next \ current`, `toRemove = current \ next` | Avoids unnecessary writes; preserves `created_at` for audit; respects RLS |
| Slugify | Custom regex pipeline | Small helper: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)` | One-liner; no library justified |
| Relative-time formatting | Custom date math | `date-fns` `formatDistanceToNow` (already installed, used in `tool/[toolConfigId]/page.tsx`) | Used elsewhere |
| Toast notifications | Custom toast | `sonner` (project standard per CLAUDE.md) | Already wired |
| Confirmation modal | Custom modal | `AlertDialog` from `@/components/ui/alert-dialog` | Used in `tools-table.tsx` line 1035 |
| Multi-select chips | Custom popover | Checkbox grid in a small Card + map to chips | Simpler than a combobox; D-36-03 calls them "chips" which is presentation only |

**Key insight:** The `/dashboard/tools` page is a complete, current, working precedent for **every** pattern this phase needs. Reuse imports, error-handling style, return shapes, and component composition verbatim — don't introduce new conventions.

## Common Pitfalls

### Pitfall 1: Missing temperature/max_tokens Columns
**What goes wrong:** Saving an agent with `temperature: 0.7` from the Generation section fails silently — Supabase's typed client (`Database['public']['Tables']['agents']['Insert']`) rejects unknown keys with a TS error; or if cast away, the DB ignores them.
**Why it happens:** Migration 034 omitted these columns intentionally (Phase 34 state: "temperature is override-only (undefined if not overridden)"). They live only inside `channel_overrides` JSONB.
**How to avoid:** Either (a) treat the base "Generation" section as setting *defaults for the web_widget override only* (i.e. base form fields write to `channel_overrides.web_widget`), or (b) plan a migration adding these columns before the form ships. See Open Question Q1.
**Warning signs:** TS error on `.insert({ temperature: ... })`; user reports "I set temperature but the agent still uses 0.7".

### Pitfall 2: `organization_id` Required on Insert
**What goes wrong:** `INSERT INTO agents (...)` without `organization_id` fails RLS `WITH CHECK`.
**Why it happens:** RLS policies match against `(SELECT public.get_current_org_id())`; the row must include the org_id to satisfy the check. RLS does NOT auto-fill the column.
**How to avoid:** Always include `organization_id: orgId` (from `supabase.rpc('get_current_org_id')`) in the insert payload. See `tool_configs` createToolConfig at `tools/actions.ts:141` — it reads org_id from `org_members` rather than the RPC, which is a related but slightly different pattern. The RPC `get_current_org_id()` is the canonical and faster path (CLAUDE.md).
**Warning signs:** "new row violates row-level security policy for table 'agents'" error.

### Pitfall 3: `channel_overrides` Bloat from Empty Fields
**What goes wrong:** Form sends `{ web_widget: { temperature: null, model: '', max_tokens: undefined } }` which becomes `{ web_widget: { temperature: null } }` in JSONB — then the runtime sees `temperature === null` and tries to use it.
**Why it happens:** zod `.optional()` accepts `undefined`, but JSON serialization can preserve `null` / empty-string. Phase 34 runtime checks `key in overrides` for fallback semantics.
**How to avoid:** Apply the `.transform()` shown in Pattern 3 to strip empty/null/undefined keys before writing. Test runtime fallback in integration: set `channel_overrides.whatsapp.model = ''`, save, reload, assert that `whatsapp` key is either absent or `{}` in DB.
**Warning signs:** Agent produces inconsistent replies; runtime logs show `model: null`.

### Pitfall 4: Sidebar Nav Active-State for Nested Routes
**What goes wrong:** Adding `{ label: 'Agents', href: '/agents' }` works for `/agents` but the active state breaks for `/agents/[id]/playground` (future Phase 39).
**Why it happens:** The sidebar uses `pathname.startsWith(item.href + '/')` (app-sidebar.tsx line 111-118) which is correct, BUT there are special cases coded for `/chat` and `/phone`. Don't accidentally collide.
**How to avoid:** Just add the nav item with no special case. The startsWith check at line 111 covers `/agents/new`, `/agents/[id]`, `/agents/[id]/playground` correctly out of the box.
**Warning signs:** Agents nav item is not highlighted on edit page.

### Pitfall 5: Tool-Picker Diff Across Channels
**What goes wrong:** `agent_tools` has an `allowed_channels` array column. Phase 36 picker is a *boolean* checkbox (tool attached or not), not a per-channel matrix. If the form ignores `allowed_channels`, an existing tool with `allowed_channels=['whatsapp']` gets clobbered to `allowed_channels=NULL` on re-save.
**Why it happens:** The diff logic only computes `(agent_id, tool_config_id)` pairs; doesn't preserve the existing `allowed_channels`.
**How to avoid:** On save, for tools that **remain selected**, do NOT issue an UPDATE — only INSERT new pairs and DELETE removed ones. Existing rows keep their `allowed_channels` intact. (Phase 36 doesn't UI-edit `allowed_channels` per D-36-05 — that's a future enhancement.)
**Warning signs:** Tool that previously only worked on WhatsApp suddenly works on all channels after a no-op save.

### Pitfall 6: Soft-Delete Reassignment of Channel Defaults
**What goes wrong:** Admin soft-deletes Agent X, but `agent_channel_defaults` still points at X for `whatsapp`. Next inbound WhatsApp message hits an inactive agent → HTTP 410 from runtime (per AGENT-10).
**Why it happens:** D-36-07 specifies reassignment to Main Agent, but the implementation must find the Main Agent. There's no `is_main_agent` flag — only the seed convention "name = 'Main Agent'".
**How to avoid:** Resolve Main Agent by `SELECT id FROM agents WHERE organization_id = ? AND name = 'Main Agent' AND is_active = true LIMIT 1`. If absent, fail the soft-delete with a clear error ("Cannot delete: no Main Agent to reassign to."). Phase 33 seeded one per org so it should always exist.
**Warning signs:** Channel falls through to 410; WhatsApp users get "service temporarily unavailable".

### Pitfall 7: Server Actions Don't Run on Client First Render
**What goes wrong:** Auto-slug fills only on initial type but not when user pastes a name; or it fights user override.
**Why it happens:** Auto-slug must be a pure client-side computation watching the `name` field via `form.watch`; do NOT push it through a server action.
**How to avoid:** Use a `useEffect` on `form.watch('name')` that updates `slug` only when `slug` is empty or matches the previously-computed slug (i.e., user hasn't manually edited). Track a `slugTouched` boolean.
**Warning signs:** Slug field can't be edited; or it changes unexpectedly after user types in it.

## Runtime State Inventory

**Trigger:** Phase 36 is a greenfield CRUD UI over an already-shipped schema — no rename, no refactor, no migration logic. **However**, the schema gap below (Open Q1) may require a small additive migration before the UI ships.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `agents` rows (one Main Agent per org from Phase 33 seed); existing `agent_tools` from Phase 33 backfill (all active tool_configs granted to Main Agent); existing `agent_channel_defaults` (one `web_widget` row per org from Phase 33 D-33-09) | UI must not break on these. Test: load existing Main Agent in `/agents/[id]` and save with no changes → no field churn. Verify slug uniqueness still passes (Main Agent slug = "main-agent" per Phase 33 seed convention; new agents must not collide). |
| Live service config | None — Phase 36 doesn't touch external services. Phase 37 will wire ManyChat/Meta on `agent_id`. | None |
| OS-registered state | None | None |
| Secrets/env vars | None — no new env vars introduced by this phase | None |
| Build artifacts | None — Next.js builds from source; `src/types/database.ts` is already current as of Phase 33 (verified: `agents`, `agent_tools`, `agent_channel_defaults` types present and complete in `src/types/database.ts:378-614`) | None |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Next.js dev server | `npm run dev` on port 4267 | ✓ | 16.2.2 | — |
| Supabase (remote) | RLS-scoped queries | ✓ | (production project; verified by prior phases) | — |
| `npm run build` (type-check gate) | CI before commit | ✓ (per CLAUDE.md "use `npm run build` as type-check gate") | — | — |
| Vitest | Unit + integration tests | ✓ | 4.1.2 | — |
| `@radix-ui/react-checkbox` | Tool picker / channel chips | ✗ | — | Build a custom checkbox from native `<input type="checkbox">` styled with Tailwind — workable but inconsistent with rest of UI; recommend install |
| `@radix-ui/react-collapsible` | 4 form sections | ✗ | — | Use Card + a manual `<button onClick={toggle}>` + conditional render with `hidden` — workable but accessibility (aria-expanded) suffers; recommend install |
| `npm run lint` | Lint gate | ✗ (broken — Next.js 16 removed `next lint`; documented in MEMORY.md) | — | Skip; rely on `npm run build` for type-check (already documented project-wide as the gate) |

**Missing dependencies with no fallback:** None blocking.

**Missing dependencies with fallback:** `@radix-ui/react-checkbox`, `@radix-ui/react-collapsible` — strongly recommend installing rather than hand-rolling. Both are tiny (<10KB gz) and already in the Radix ecosystem the project uses.

## Code Examples

### Slug auto-generation hook
```typescript
// Source: derived from CONTEXT D-36-06 + react-hook-form watch pattern from tool-config-form.tsx
'use client'
import { useEffect, useRef } from 'react'
import { useFormContext } from 'react-hook-form'

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export function useAutoSlug() {
  const { watch, setValue, getValues } = useFormContext()
  const slugTouched = useRef(false)
  const name = watch('name')
  const slug = watch('slug')

  // Track manual edits to slug
  useEffect(() => {
    const lastAutoSlug = slugify(getValues('name') ?? '')
    if (slug && slug !== lastAutoSlug) {
      slugTouched.current = true
    }
  }, [slug, getValues])

  // Re-derive slug from name when user hasn't manually touched it
  useEffect(() => {
    if (!slugTouched.current) {
      setValue('slug', slugify(name ?? ''), { shouldValidate: true })
    }
  }, [name, setValue])
}
```

### Diff-based `setAgentTools` server action
```typescript
// Source: this research synthesis (no existing precedent — but matches tools/actions.ts return shape)
export async function setAgentTools(
  agentId: string,
  selectedToolIds: string[]
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data: existing, error: fetchError } = await supabase
    .from('agent_tools')
    .select('tool_config_id')
    .eq('agent_id', agentId)
  if (fetchError) return { error: fetchError.message }

  const currentSet = new Set(existing?.map(r => r.tool_config_id) ?? [])
  const nextSet = new Set(selectedToolIds)
  const toAdd = [...nextSet].filter(id => !currentSet.has(id))
  const toRemove = [...currentSet].filter(id => !nextSet.has(id))

  if (toAdd.length > 0) {
    const { error } = await supabase.from('agent_tools').insert(
      toAdd.map(tool_config_id => ({
        organization_id: orgId,
        agent_id: agentId,
        tool_config_id,
        // allowed_channels left NULL = all channels (per migration 034 default semantics)
      }))
    )
    if (error) return { error: error.message }
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('agent_tools')
      .delete()
      .eq('agent_id', agentId)
      .in('tool_config_id', toRemove)
    if (error) return { error: error.message }
  }

  revalidatePath('/agents')
  revalidatePath(`/agents/${agentId}`)
}
```

### Channel Defaults UPSERT/DELETE
```typescript
// Source: derived from agent_channel_defaults UNIQUE(organization_id, channel) + CONTEXT D-36-04
export async function setChannelDefault(
  channel: AgentChannel,
  agentId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  if (agentId === null) {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .delete()
      .eq('channel', channel) // RLS scopes org
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('agent_channel_defaults')
      .upsert(
        { organization_id: orgId, channel, agent_id: agentId },
        { onConflict: 'organization_id,channel' }
      )
    if (error) return { error: error.message }
  }

  revalidatePath('/agents')
}
```

### Soft-delete with reassignment
```typescript
// Source: CONTEXT D-36-07 + Pitfall #6
export async function softDeleteAgent(id: string): Promise<{ error?: string; reassignedCount?: number } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Find Main Agent for reassignment
  const { data: mainAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', 'Main Agent')
    .eq('is_active', true)
    .maybeSingle()
  if (!mainAgent) return { error: 'Cannot delete: no active Main Agent to reassign channel defaults to.' }
  if (mainAgent.id === id) return { error: 'Cannot delete the Main Agent.' }

  // Reassign channel defaults pointing at this agent → Main Agent
  const { count, error: reassignError } = await supabase
    .from('agent_channel_defaults')
    .update({ agent_id: mainAgent.id })
    .eq('agent_id', id)
    .select('id', { count: 'exact', head: true })
  if (reassignError) return { error: reassignError.message }

  // Soft-delete
  const { error } = await supabase
    .from('agents')
    .update({ is_active: false, updated_by: user.id })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/agents')
  return { reassignedCount: count ?? 0 }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next lint` script | `eslint.config.js` flat config | Next.js 16 (in use here) | `npm run lint` is broken; use `npm run build` as type-check gate (CLAUDE.md, MEMORY.md) |
| React 18 `useFormState` | React 19 `useActionState` | React 19 (in use) | Both available; this project still uses RHF for complex forms — react-hook-form remains the standard |
| `pages/` router | App Router | Next.js 13+ (locked here) | All Phase 36 code is App Router (`(dashboard)/agents/...`) |
| Direct `supabase.auth.getUser()` | Cached `getUser()` helper | Project pattern (CLAUDE.md) | MUST use the cached helper |

**Deprecated/outdated:**
- `next lint` — removed in Next.js 16 (project-wide pending fix, not a Phase 36 concern)

## Open Questions

### Q1: Where do `temperature` and `max_tokens` live?
- **What we know:** CONTEXT D-36-02 lists "Generation" form section with `temperature` (0-2 step 0.1), `max_tokens`, `max_history`. ROADMAP success criterion #1 lists "optional temperature/max_tokens/max_history". AGENT-02 requirement says "optional generation config: temperature (default 0.7), max_tokens (default 1024), max_history (default 20)". Migration 034 created `agents.max_history INTEGER NOT NULL DEFAULT 10` but did NOT create `temperature` or `max_tokens` columns. Phase 34 state explicitly: *"agents table has no max_tokens or temperature columns (not in migration 034): maxTokens defaults to 1024; temperature is override-only (undefined if not overridden)"*.
- **What's unclear:** Should Phase 36 (a) add a small additive migration to add `temperature NUMERIC` and `max_tokens INTEGER` columns to the `agents` base table, OR (b) interpret the "Generation" form section as editing `channel_overrides.web_widget` (the canonical default channel) directly?
- **Recommendation:** **Option (a)** — add a migration `044_agents_generation_config.sql` adding the two nullable columns (no defaults, so NULL means "use runtime default"). Reasoning: D-36-02 places these in the "Basics + Generation" section *above* the per-channel overrides; treating base form fields as a channel override would confuse the UX (users would expect base values to apply across all channels). Phase 34 runtime already tolerates `temperature: undefined` (override-only); adding nullable columns preserves that semantic. Confidence: MEDIUM (planner should confirm with user; the alternative is to descope these fields from Phase 36 and only expose them via `channel_overrides`).

### Q2: "Tools (count badge)" — count active vs total?
- **What we know:** D-36-01 says column shows "3 attached" — a count of `agent_tools` rows.
- **What's unclear:** Does it filter out tools whose `tool_configs.is_active = false`, or count raw junction rows?
- **Recommendation:** Count raw `agent_tools` rows (one count, one source of truth). If user wants "X attached (Y inactive)" we can split in a future polish iteration. Confidence: HIGH (judgment call, no contradicting requirement).

### Q3: Should the form's `is_active` toggle save independently from the rest of the form?
- **What we know:** D-36-01 lists "Active (toggle switch, optimistic update)" as a **column** in the list view → that's a separate per-row toggle. D-36-02 also lists "is_active (toggle)" inside the Basics form section → that's a form field.
- **What's unclear:** If user toggles in the form but doesn't hit Save, is the change discarded? The list-row toggle is optimistic and fires `toggleAgentActive(id, active)` server action immediately.
- **Recommendation:** Two distinct UI controls calling two distinct paths. List-row Switch → `toggleAgentActive` (immediate). Form-section Switch → part of `updateAgent` payload (saved with rest of form). Document this in the form section help text to avoid user confusion. Confidence: HIGH.

### Q4: What does "Duplicate" do in the row actions menu (D-36-01)?
- **What we know:** Listed as a row action.
- **What's unclear:** Deep clone including tools and channel_overrides? Slug must differ.
- **Recommendation:** `duplicateAgent(id)` server action — inserts a new row with `name = source.name + ' (copy)'`, `slug = source.slug + '-copy'` (and `-copy-2`, `-copy-3` etc. on collision), copies `system_prompt`, `model`, `description`, `fallback_message`, `max_history`, `channel_overrides`, `allowed_channels`; copies `agent_tools` rows; does NOT copy `agent_channel_defaults` (defaults stay on the original); sets `is_active = false` so the duplicate doesn't immediately serve traffic. Confidence: MEDIUM (planner should confirm with user — it's a small feature that could also be deferred to v2.x).

## Project Constraints (from CLAUDE.md)

- **Auth:** Always use cached `createClient()` + `getUser()` from `@/lib/supabase/server`. Never call `supabase.auth.getUser()` directly.
- **Multi-tenancy:** Every table has RLS; queries auto-scope via `get_current_org_id()`. Never manually `.eq('organization_id', ...)` on authenticated SELECT (RLS handles it). DO include `organization_id` on INSERT (RLS WITH CHECK requires it).
- **Components:** Server components by default. `'use client'` only when needed. Forms use `react-hook-form` + `zod` + `zodResolver`. Toasts use `sonner`.
- **Build gate:** Always run `npm run build` after changes to catch TS errors. `npm run lint` is broken — don't rely on it.
- **Migrations:** Live in `supabase/migrations/`. Never edit old migrations; add new ones. After adding: `npx supabase db push` and update `src/types/database.ts`.
- **Production origin:** `https://operator.skale.club`. Use for webhook URLs / docs examples.
- **Platform framing:** Operator is a tenant-aware orchestration platform — prefer reusable platform capabilities over hardcoding one client's playbook. (For Phase 36, this means the model dropdown, the channel list, and the tool picker must be fully tenant-generic — no Skleanings/Vapi assumptions in the agent form.)
- **Sensitive paths:** `src/lib/crypto.ts` (don't touch); `supabase/migrations/` (additive only); `src/app/api/vapi/` (keep fast & Node.js). None of these are in Phase 36 scope.
- **MEMORY.md:** SUPABASE_DB_PASSWORD lives in `.env.local` (symlinked to G:\My Drive). Migrations via `npx supabase db push` need GDrive mounted.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 with `@vitejs/plugin-react` |
| Config file | `vitest.config.ts` (environment: node, globals: true, include: `tests/**/*.test.ts(x)`, setup: `tests/setup/load-env.ts`, testTimeout: 30000) |
| Quick run command | `npx vitest run tests/agents` (run only Phase 36 tests) |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGENT-01 | createAgent inserts with required fields; rejects duplicate slug per org | integration | `npx vitest run tests/agents/actions.test.ts -t "createAgent"` | ❌ Wave 0 |
| AGENT-01 | zod schema validates required fields (name, slug, system_prompt, model) | unit | `npx vitest run tests/agents/zod-schemas.test.ts -t "agentSchema"` | ❌ Wave 0 |
| AGENT-02 | max_history persists; temperature/max_tokens persist (assumes Q1 resolution) | integration | `npx vitest run tests/agents/actions.test.ts -t "generation"` | ❌ Wave 0 |
| AGENT-03 | fallback_message defaults applied; updates persist | integration | `npx vitest run tests/agents/actions.test.ts -t "fallback"` | ❌ Wave 0 |
| AGENT-08 | setChannelDefault upserts; passing null deletes the row | integration | `npx vitest run tests/agents/actions.test.ts -t "setChannelDefault"` | ❌ Wave 0 |
| TOOL-02 | setAgentTools diff-inserts new and diff-deletes removed | integration | `npx vitest run tests/agents/actions.test.ts -t "setAgentTools"` | ❌ Wave 0 |
| TOOL-03 | Creating a new agent results in zero rows in agent_tools | integration | `npx vitest run tests/agents/actions.test.ts -t "deny-by-default"` | ❌ Wave 0 |
| TOOL-04 | Tool picker data includes integration_id join and `is_active` flag from integrations | unit (data shape) | `npx vitest run tests/agents/tool-picker-data.test.ts` | ❌ Wave 0 |
| D-36-06 | slugify('  Hello World!! ') === 'hello-world'; long names truncate at 50 | unit | `npx vitest run tests/agents/slug.test.ts` | ❌ Wave 0 |
| D-36-03 | channelOverrideSchema strips empty fields (temperature undefined → key removed) | unit | `npx vitest run tests/agents/zod-schemas.test.ts -t "channel_overrides"` | ❌ Wave 0 |
| D-36-07 | softDeleteAgent reassigns channel_defaults to Main Agent; refuses if Main Agent missing or target is Main Agent | integration | `npx vitest run tests/agents/actions.test.ts -t "softDelete"` | ❌ Wave 0 |
| RLS | Cross-org isolation: org A cannot SELECT/UPDATE agents from org B | integration | `npx vitest run tests/agents/rls.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/agents` (Phase 36 scope only — fast)
- **Per wave merge:** `npm test` (full suite to catch cross-Phase regressions, especially `agent_channel_defaults`-dependent tests in Phase 35)
- **Phase gate:** `npm test` GREEN + `npm run build` clean before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/agents/actions.test.ts` — integration suite (createAgent, updateAgent, softDeleteAgent, setAgentTools, setChannelDefault, toggleAgentActive)
- [ ] `tests/agents/zod-schemas.test.ts` — unit tests for `agentSchema`, `channelOverrideSchema`, slug regex
- [ ] `tests/agents/slug.test.ts` — unit tests for slugify helper
- [ ] `tests/agents/tool-picker-data.test.ts` — unit tests for the picker's grouping helpers
- [ ] `tests/agents/rls.test.ts` — cross-org isolation smoke test (mirror `tests/rls-isolation.test.ts`)
- [ ] Shared fixture for seeded org + Main Agent + at least 2 tool_configs in 2 folders (reuse `tests/setup/load-env.ts` for env, but a new `tests/agents/fixtures.ts` for data)
- [ ] No framework install needed — Vitest 4.1.2 already installed

## Sources

### Primary (HIGH confidence)
- Local: `src/app/(dashboard)/tools/page.tsx` — list page pattern
- Local: `src/app/(dashboard)/tools/actions.ts` — server actions shape (return types, error handling, revalidatePath, RLS pattern)
- Local: `src/components/tools/tools-table.tsx` — folder collapsible + TanStack table + DnD (pattern to selectively reuse)
- Local: `src/components/tools/tool-config-form.tsx` — RHF + zod + shadcn Form pattern (canonical reference)
- Local: `src/app/(dashboard)/tools/[toolConfigId]/page.tsx` — edit page (server-component fetch + Card layout)
- Local: `src/components/layout/app-sidebar.tsx` — sidebar nav array shape
- Local: `src/lib/supabase/server.ts` — cached `createClient`/`getUser`
- Local: `supabase/migrations/034_agents.sql` — agents, agent_tools, agent_partners schema (Phase 33)
- Local: `supabase/migrations/036_agent_channel_defaults.sql` — channel defaults schema (Phase 33)
- Local: `src/types/database.ts` lines 378-614 — TS row/insert/update shapes for `agents`, `agent_tools`, `agent_partners`, `agent_prompt_versions`, `agent_channel_defaults`
- Local: `package.json` — verified all required libraries present
- Local: `.planning/STATE.md` — Phase 34 lock: "agents table has no max_tokens or temperature columns"
- Local: `.planning/REQUIREMENTS.md` — AGENT-01..03, AGENT-08, TOOL-02..04 specs
- Local: `.planning/ROADMAP.md` — Phase 36 success criteria
- Local: `.planning/phases/36-agent-crud-dashboard/36-CONTEXT.md` — 12 locked decisions
- Local: `.planning/config.json` — `workflow.nyquist_validation: true`, `commit_docs: true`
- Local: `vitest.config.ts` — test framework config
- Local: `CLAUDE.md` — project conventions

### Secondary (MEDIUM confidence)
- shadcn/ui docs (https://ui.shadcn.com/docs/components/checkbox, /collapsible) — canonical templates for the two missing primitives. Verified by inspecting existing `src/components/ui/switch.tsx` which follows the identical Radix-wrapper pattern.

### Tertiary (LOW confidence)
- None — every claim above is backed by either local code inspection, an explicit CONTEXT.md decision, or a CLAUDE.md directive.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in `package.json`; two missing primitives clearly identified
- Architecture: HIGH — `/dashboard/tools` is a complete, current, in-repo precedent for every pattern
- Pitfalls: HIGH — 6 of 7 pitfalls are derived from concrete observations of the schema, runtime locks, or existing code; #1 (temperature column) is verified from STATE.md and migration 034
- Server actions / RLS: HIGH — pattern is locked codebase-wide and tested in Phase 33-35
- Schema/types: HIGH — `src/types/database.ts` was regenerated end of Phase 33 P07 (see git log "regen types + flip Plan 01 vitest stubs GREEN")
- Open Questions: MEDIUM — Q1 (temperature/max_tokens columns) is the single most consequential gap and warrants user/planner confirmation before Wave 1

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (~30 days; stable schema, locked decisions, no fast-moving deps)
