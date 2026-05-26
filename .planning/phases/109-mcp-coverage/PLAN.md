# Phase 109 — MCP Coverage (P0)

## Context

The unified MCP server shipped in phase ~108 (`/api/mcp` + OAuth + bearer fallback,
35 tools across projects/traffic/contacts/opportunities/conversations/tasks/bookings).
External agents (Claude, ChatGPT custom connectors) can now connect, but the tool
surface is too narrow for them to *operate* the platform.

Concrete miss: an agent connected via the MCP cannot today list accounts, manage
tags, read pipelines/stages, browse calls, manage labels, create/cancel bookings,
read notes/notifications, or trigger workflows. Several of these are referenced
by other tools (e.g. `opportunities_move_stage` needs a `stage_id` an agent can
only discover by reading pipeline stages).

This phase closes the **P0 gap** — the minimum surface for an agent to actually
operate Xphere end-to-end without the human jumping into the dashboard for
read-only lookups. ~40 new tools.

Out of scope (deferred to later phases):
- P1 — outbound campaigns, email marketing, reviews, imports, workflow run mgmt,
  agent invocations history, opportunity activities, availability, locations
- P2 — twilio number config, manychat rules, integration config, contact merge,
  voice configs, platform settings, audit logs

## Naming + Conventions

- Tools follow `<domain>_<action>` (e.g. `accounts_create`, `tags_list`).
- Read tools return `{ <plural>: [...] }` or the row directly for single-record gets.
- Write tools return the affected row, or `{ updated: true }` / `{ deleted: true }`.
- Errors return `{ error: '<code>', detail?, status? }` — handled by the server wrapper.
- All inputs are Zod schemas with `.strict()`.
- Each tool declares `area: 'general_xphere' | 'projects'` for the audit log.
- Multi-tenant scoping uses `auth.orgId` from the bearer/OAuth context — the
  service-role client is used and queries are filtered by `org_id` (or
  `organization_id` for tables that use the legacy column name — see below).
- **Column naming gotcha**: tables vary between `org_id` (newer) and
  `organization_id` (older Vapi/Knowledge/Twilio tables). The handler must use
  the right one. Audit per-tool in implementation.

## Tool inventory (P0 — ~40 tools)

### 1. Accounts / Companies (5 tools)

Table: `accounts` (org_id). Columns: name, domain, website, industry, size, phone, address, notes, tags, custom_fields, source, assigned_to.

| Tool | Description | Input | Output |
|---|---|---|---|
| `accounts_list` | Paginated list with filters | `{ industry?, tag?, assigned_to?, limit?, offset? }` | `{ accounts, limit, offset }` |
| `accounts_count` | Total with same filters | filters subset | `{ count }` |
| `accounts_get` | Single account | `{ account_id }` | row |
| `accounts_create` | New account | `{ name, domain?, website?, industry?, phone?, address?, tags?, notes? }` | row |
| `accounts_update` | Patch fields | `{ account_id, ...patch }` | `{ updated: true }` |

### 2. Tags (5 tools)

Table: `tags` (org_id, name, slug, color). Junction: `contact_tags`, `opportunity_tags`.

| Tool | Description | Input | Output |
|---|---|---|---|
| `tags_list` | All tags in org | `{}` | `{ tags }` |
| `tags_create` | New tag | `{ name, color? }` (slug auto-generated server-side) | row |
| `tags_update` | Rename/recolor | `{ tag_id, name?, color? }` | `{ updated: true }` |
| `tags_delete` | Remove tag | `{ tag_id }` | `{ deleted: true }` |
| `contact_tags_set` | Replace tags on a contact | `{ contact_id, tag_ids: string[] }` | `{ updated: true, tag_count }` |

### 3. Pipelines & Stages (read-only — 4 tools)

Tables: `pipelines`, `pipeline_stages`.

| Tool | Description | Input | Output |
|---|---|---|---|
| `pipelines_list` | All pipelines in org | `{}` | `{ pipelines }` |
| `pipelines_get` | One pipeline | `{ pipeline_id }` | row |
| `pipeline_stages_list` | Stages of a pipeline (or all) | `{ pipeline_id? }` | `{ stages }` |
| `pipelines_get_default` | Returns default pipeline + its stages (for new opportunities) | `{}` | `{ pipeline, stages }` |

### 4. Custom Field Definitions (read-only — 2 tools)

Table: `custom_field_definitions` (entity scope: contact/account/opportunity).

| Tool | Description | Input | Output |
|---|---|---|---|
| `custom_fields_list` | Definitions for an entity type | `{ entity: 'contact' \| 'account' \| 'opportunity', include_archived? }` | `{ fields }` |
| `custom_fields_get` | One definition | `{ field_id }` | row |

### 5. Calls — Vapi AI (3 tools)

Table: `calls` (organization_id — note legacy column).

| Tool | Description | Input | Output |
|---|---|---|---|
| `ai_calls_list` | Recent AI calls | `{ assistant_id?, status?, from?, to?, limit? }` | `{ calls }` |
| `ai_calls_get` | One AI call with transcript | `{ call_id }` | row + `transcript_turns` |
| `ai_calls_count` | Total | filters subset | `{ count }` |

### 6. Calls — Twilio human (3 tools)

Table: `call_logs` (org_id).

| Tool | Description | Input | Output |
|---|---|---|---|
| `calls_list` | Recent call logs | `{ direction?, contact_id?, opportunity_id?, limit? }` | `{ calls }` |
| `calls_get` | One call (with recording_url if available) | `{ call_id }` | row |
| `calls_count` | Total | filters subset | `{ count }` |

### 7. Conversation Labels (4 tools)

Tables: `conversation_labels` (org_id, name, color), `conversation_label_assignments` (label_id, conversation_id).

| Tool | Description | Input | Output |
|---|---|---|---|
| `conversation_labels_list` | All labels | `{}` | `{ labels }` |
| `conversation_labels_create` | New label | `{ name, color? }` | row |
| `conversation_labels_assign` | Add label to conversation | `{ conversation_id, label_id }` | `{ assigned: true }` |
| `conversation_labels_unassign` | Remove label | `{ conversation_id, label_id }` | `{ unassigned: true }` |

### 8. Bookings (3 new tools — `bookings_list` already exists)

Table: `bookings` (org_id).

| Tool | Description | Input | Output |
|---|---|---|---|
| `bookings_get` | One booking | `{ booking_id }` | row |
| `bookings_create` | Create a new booking | `{ event_type_id, start_at, end_at, booker_name, booker_email, booker_phone?, notes?, contact_id? }` | row |
| `bookings_cancel` | Cancel a booking | `{ booking_id, reason? }` | `{ cancelled: true }` |

### 9. Event Types (3 tools)

Table: `event_types` (org_id, name, duration_minutes, location, color, etc.).

| Tool | Description | Input | Output |
|---|---|---|---|
| `event_types_list` | All event types | `{ user_id?, active_only? }` | `{ event_types }` |
| `event_types_create` | New event type | `{ name, duration_minutes, description?, color?, location? }` | row |
| `event_types_update` | Patch | `{ event_type_id, ...patch }` | `{ updated: true }` |

### 10. Notes (5 tools)

Table: `notes` (org_id, content, entity_type, entity_id).

| Tool | Description | Input | Output |
|---|---|---|---|
| `notes_list` | List notes (optionally scoped to entity) | `{ entity_type?, entity_id?, limit? }` | `{ notes }` |
| `notes_get` | One note | `{ note_id }` | row |
| `notes_create` | Add note | `{ content, entity_type?, entity_id? }` | row |
| `notes_update` | Edit | `{ note_id, content }` | `{ updated: true }` |
| `notes_delete` | Remove | `{ note_id }` | `{ deleted: true }` |

### 11. Notifications (3 tools)

Table: `notifications` (org_id, type, payload, read_at).

| Tool | Description | Input | Output |
|---|---|---|---|
| `notifications_list` | Recent notifications | `{ unread_only?, limit? }` | `{ notifications }` |
| `notifications_count_unread` | Unread badge count | `{}` | `{ count }` |
| `notifications_mark_read` | Mark one (or all) as read | `{ notification_id? }` (omit = all) | `{ updated: <n> }` |

### 12. Knowledge Base (4 tools)

Tables: `knowledge_sources` (organization_id), `documents` (linked to knowledge_source via knowledge_source_id, has pgvector embedding).

| Tool | Description | Input | Output |
|---|---|---|---|
| `knowledge_list` | All sources | `{ status? }` | `{ sources }` |
| `knowledge_get` | One source | `{ source_id }` | row |
| `knowledge_search` | Semantic search across the org's knowledge | `{ query, top_k? }` | `{ matches: [{ content, source_id, similarity }] }` |
| `knowledge_add_text` | Quickly ingest a text snippet (server enqueues embedding) | `{ name, content }` | `{ source_id, status: 'processing' }` |

**Implementation note for `knowledge_search`**: reuse the existing
`match_documents` RPC if present (search `supabase/migrations/` for it); else
fallback to calling the embed endpoint inline. Both `process-embeddings` edge
function and `lib/knowledge/` should be reviewed before implementing this tool.

### 13. Workflows (3 tools)

Tables: `workflows`, `workflow_runs`, `workflow_triggers`.

| Tool | Description | Input | Output |
|---|---|---|---|
| `workflows_list` | List workflows | `{ active_only?, kind? }` (kind = tool \| flow) | `{ workflows }` |
| `workflows_get` | One workflow with its trigger config | `{ workflow_id }` | row + triggers |
| `workflows_trigger` | Execute a workflow manually with a payload | `{ workflow_id, payload? }` | `{ run_id, status: 'queued' }` |

**Implementation note for `workflows_trigger`**: reuse existing
`POST /api/workflows/[id]/run` server logic if present, or call the workflow
engine directly. Search `src/lib/action-engine/` and `src/app/api/workflows/`.

### 14. Agents (2 tools)

Table: `agents`.

| Tool | Description | Input | Output |
|---|---|---|---|
| `agents_list` | All agents | `{ active_only? }` | `{ agents }` |
| `agents_get` | One agent with channel defaults | `{ agent_id }` | row + `channel_defaults` |

---

## Implementation map

**New tool files** (one per domain):
- `src/lib/mcp/tools/accounts.ts`
- `src/lib/mcp/tools/tags.ts`
- `src/lib/mcp/tools/pipelines.ts`
- `src/lib/mcp/tools/custom-fields.ts`
- `src/lib/mcp/tools/ai-calls.ts`
- `src/lib/mcp/tools/calls.ts`
- `src/lib/mcp/tools/conversation-labels.ts`
- `src/lib/mcp/tools/event-types.ts`
- `src/lib/mcp/tools/notes.ts`
- `src/lib/mcp/tools/notifications.ts`
- `src/lib/mcp/tools/knowledge.ts`
- `src/lib/mcp/tools/workflows.ts`
- `src/lib/mcp/tools/agents.ts`

**Updated files**:
- `src/lib/mcp/tools/bookings.ts` — extract bookings tools from `tasks.ts` to its own file (cleaner) and add `bookings_get`, `bookings_create`, `bookings_cancel`. Optional rename — can also keep in `tasks.ts`.
- `src/lib/mcp/registry.ts` — import + spread the 13 new tool arrays into `ALL_MCP_TOOLS`.

**No migration needed** — all P0 tools operate on existing tables. RLS already in
place from the original migrations.

**Settings UI** — no change required. The settings/mcp page already shows the
single endpoint URL. The Claude/ChatGPT connector will automatically pick up the
new tools via `tools/list` JSON-RPC.

## Open questions (decide during implementation)

1. **`pipelines_get_default`** — How does the platform identify "default" pipeline?
   Look for `is_default = true` column or first-by-position. Check
   `src/app/(dashboard)/pipeline/` to see how the dashboard picks a default.

2. **`bookings_create`** — Should it auto-resolve a contact by email/phone, or
   require an explicit `contact_id`? Decision: optional `contact_id`, plus the
   booker fields, mirroring how the public scheduling form works.

3. **`knowledge_search`** — If no `match_documents` RPC exists, do we ship this
   tool now (with a slower fallback) or defer to P1? Decision: ship — semantic
   search is too core to defer. Implementation may call OpenAI embed → manual
   cosine match if no RPC found.

4. **`workflows_trigger` audit** — When an MCP-triggered workflow itself calls
   other MCP-exposed tools (or fails), should the audit log link them? Decision:
   for v1, just log the trigger event in `project_mcp_audit_logs` with
   `target=<workflow_id>`. Cross-event tracing is a P2 enhancement.

5. **`conversation_labels_create` slug** — Like `tags_create`, do we auto-slug?
   Decision: yes, mirror tag behaviour (slugify name server-side, dedup per org).

## Verification plan

After implementation:
1. `npm run build` — type check passes.
2. Local curl smoke test against `/api/mcp` (with legacy bearer):
   ```bash
   curl -X POST http://localhost:4267/api/mcp \
     -H "Authorization: Bearer xph_..." \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```
   Confirm the returned tool list contains all ~40 new names.
3. Call one representative tool per domain and confirm the response shape
   matches the spec (no 500s, no auth bypass).
4. Connect via Claude desktop's custom connector and ask:
   - "How many accounts do I have?" → should call `accounts_count`.
   - "List my pipelines and their stages." → should chain `pipelines_list` +
     `pipeline_stages_list`.
   - "Find conversations labeled 'VIP'." → labels exist + can be filtered.
   - "Search my knowledge base for X." → `knowledge_search` returns matches.
5. `git push` to main → wait for Vercel production deploy → repeat (3) against
   `https://xphere.app/api/mcp`.

## Sequencing

Implement in waves to keep diffs reviewable even though delivered as one PR:

1. **Wave A — pure read** (no side effects): accounts/list,get,count + tags/list +
   pipelines/list,get,stages + custom_fields/list + ai_calls + calls + notes/list,get
   + notifications/list,count + knowledge/list,get + workflows/list,get + agents/list,get.
2. **Wave B — writes on existing entities**: accounts_create/update,
   tags_create/update/delete, contact_tags_set, conversation_labels CRUD,
   notes_create/update/delete, notifications_mark_read, event_types CRUD.
3. **Wave C — execution / side-effect-heavy**: bookings_create/cancel,
   knowledge_add_text, workflows_trigger.
4. **Wave D — wiring**: registry.ts updates, build, smoke tests.

Single commit at the end.
