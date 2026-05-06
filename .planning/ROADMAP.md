# Operator Roadmap

## Milestones

- ✅ **v1.0 MVP** — 6 phases, 30 plans (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** — LangChain vector pipeline (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** — 6 phases, 21 plans (shipped 2026-04-05)
- ✅ **v1.3 Google Reviews Widget + Meta Messaging** — 7 phases (phases 7–13, shipped 2026-05-05)
- ✅ **v1.4 Chat System Refactor** — 5 phases (phases 14–18, shipped 2026-05-05) — see [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- 🚧 **v1.5 Tools Folder System** — 3 phases (phases 19–21, in progress)

## Shipped

<details>
<summary>✅ v1.0 MVP — SHIPPED 2026-04-03</summary>

See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

- [x] Phase 1: Foundation
- [x] Phase 2: Action Engine
- [x] Phase 3: Observability
- [x] Phase 4: Knowledge Base
- [x] Phase 5: Outbound Campaigns
- [x] Phase 6: API Key Admin

</details>

<details>
<summary>✅ v1.1 Knowledge Base — SHIPPED 2026-04-03</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

- [x] Data Layer — LangChain schema, match_documents RPC
- [x] File Pipeline — upload → chunk → embed → pgvector
- [x] URL Pipeline — scrape → chunk → embed → pgvector
- [x] UI & Wiring — limits, OpenAI banner, AlertDialog, semantic search

</details>

<details>
<summary>✅ v1.2 Operator + Embedded Chatbot — SHIPPED 2026-04-05</summary>

See [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

- [x] Phase 1: Foundation — Redis, Supabase schema, brand rename, static widget asset (completed 2026-04-04)
- [x] Phase 2: Chat API — POST /api/chat/[token], session management, conversation persistence (completed 2026-04-04)
- [x] Phase 3: AI Conversation Engine — SSE streaming, knowledge base pre-retrieval, action engine tool calls (completed 2026-04-04)
- [x] Phase 4: Widget Embed Script — Shadow DOM widget, esbuild pipeline, browser-verified (completed 2026-04-04)
- [x] Phase 5: Admin Configuration — widget config page, live preview, embed code, token regen (completed 2026-04-05)
- [x] Phase 6: Chat Inbox — ConversationList + ChatArea + AdminChatLayout, sidebar Chat group (completed 2026-04-05)

</details>

<details>
<summary>✅ v1.3 Google Reviews Widget + Meta Messaging — SHIPPED 2026-05-05</summary>

See [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

- [x] Phase 7: DB Foundation — Migrations 018/019/020 (google_locations, meta_channels, channel columns) (completed 2026-05-04)
- [x] Phase 8: Reviews Admin — Location registration, Google Places API sync, dashboard (completed 2026-05-04)
- [x] Phase 9: Reviews Widget — Embeddable script, 4 layouts, public token endpoint (completed 2026-05-04)
- [x] Phase 10: Meta OAuth — Facebook Login, full token exchange chain, channel settings (completed 2026-05-04)
- [x] Phase 11: Meta Webhook — Inbound event receiver, conversation creation, 24h enforcement (completed 2026-05-05)
- [x] Phase 12: Multi-Channel Inbox UI — Channel icons, filter pills, header, banners, bot pause/resume (completed 2026-05-05)
- [x] Phase 13: Outbound Reply Routing — Branch reply route by channel (Messenger/Instagram/widget) (completed 2026-05-05)

</details>

---

## 🚧 v1.5 Tools Folder System (In Progress)

**Milestone Goal:** Transform the tools module into an organized explorer with 2-level folder nesting (folder > subfolder), inline rename, delete with confirmation, and drag-and-drop tool moving. Extends the existing flat `folder` string column into a proper relational folder hierarchy.

### Phases

- [ ] **Phase 19: DB Foundation** — Migrate from flat folder string to a relational `tool_folders` table with `parent_id` supporting 2-level hierarchy; update server actions and data fetching
- [ ] **Phase 20: Folder & Subfolder CRUD** — Create, rename inline, and delete (with confirmation modal) for both top-level folders and subfolders; collapsible section rendering and Ungrouped section
- [ ] **Phase 21: Drag and Drop** — Reorder top-level folders via DnD; move tools between folders by dragging over the target folder header with visual highlight

## Phase Details

### Phase 19: DB Foundation
**Goal**: The tools data layer supports a 2-level folder hierarchy with proper relational structure, replacing the flat string column
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: (infrastructure — enables all v1.5 requirements)
**Success Criteria** (what must be TRUE):
  1. A `tool_folders` table exists with `id`, `org_id`, `name`, `parent_id` (nullable), `position`, and RLS enforced per org
  2. Existing tools retain their folder assignment after migration (no data loss from the flat `folder` string)
  3. Server actions for listing, creating, updating, and deleting folders return correct data scoped to the active org
  4. `tool_configs` rows reference `folder_id` (FK to `tool_folders`) instead of the flat `folder` string column
**Plans**: 3 plans
Plans:
- [ ] 19-01-PLAN.md — SQL migration (025_tool_folders.sql) + Vitest test stub
- [ ] 19-02-PLAN.md — TypeScript types update + server actions rewrite
- [ ] 19-03-PLAN.md — App caller updates (page.tsx, tools-table.tsx, tool-config-form.tsx) + full build verification

### Phase 20: Folder & Subfolder CRUD
**Goal**: Admins can create, rename, and delete folders and subfolders, with tools rendering in collapsible sections inline in the tools table
**Depends on**: Phase 19
**Requirements**: FOLDER-01, FOLDER-02, FOLDER-03, SUBFOLDER-01, SUBFOLDER-02, SUBFOLDER-03, DISPLAY-01, DISPLAY-02
**Success Criteria** (what must be TRUE):
  1. Admin can create a top-level folder by name and see it appear as a collapsible section in the tools table immediately
  2. Admin can create a subfolder by clicking the (+) button on a parent folder header, and the subfolder appears nested inside that folder's collapsible section
  3. Admin can click any folder or subfolder label to rename it inline — the label becomes an input, Enter confirms the new name, Escape cancels
  4. Admin can delete a folder or subfolder via a confirmation modal that clearly offers two options: orphan its tools (move them to Ungrouped) or delete them along with the folder
  5. Tools not assigned to any folder appear in an "Ungrouped" section at the bottom of the list
**Plans**: TBD
**UI hint**: yes

### Phase 21: Drag and Drop
**Goal**: Admins can reorder top-level folders and move tools between folders by dragging
**Depends on**: Phase 20
**Requirements**: FOLDER-04, MOVE-01, MOVE-02
**Success Criteria** (what must be TRUE):
  1. Admin can drag a top-level folder header to a new position in the list and the order persists after page reload
  2. Admin can drag a tool row and hover over a folder or subfolder header — the target header highlights visually to indicate it is a valid drop target
  3. Admin can drop a dragged tool onto a folder or subfolder header and the tool moves to that folder, disappearing from its previous location immediately
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** 19 → 20 → 21

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 19. DB Foundation | v1.5 | 0/3 | Planned | - |
| 20. Folder & Subfolder CRUD | v1.5 | 0/TBD | Not started | - |
| 21. Drag and Drop | v1.5 | 0/TBD | Not started | - |

*Last updated: 2026-05-06 — Phase 19 planned (3 plans, 3 waves)*
