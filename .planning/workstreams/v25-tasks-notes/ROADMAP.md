# Roadmap: v2.5 Tasks & Notes CRM System

**Workstream:** v25-tasks-notes
**Phases:** 6 (76–81) | **Requirements:** 26 (TSK-01..14, NOT-01..12)

---

## Phase 76: DB-FOUNDATION

**Goal:** Supabase migrations for `tasks` and `notes` tables with RLS, TypeScript types updated — all downstream phases unblocked
**Depends on:** Nothing (first phase of v2.5)
**Requirements:** TSK-01 (partial), TSK-09, TSK-12, NOT-01 (partial), NOT-08, NOT-11
**Success Criteria:**
1. Migration 067 applies cleanly: `tasks` table exists with columns `id, org_id, title, description, due_date, priority (enum), status (enum), assigned_to, entity_type, entity_id, created_by, created_at, updated_at`; RLS enabled with org-scoped policies
2. Migration 067 or 068 creates `notes` table with columns `id, org_id, title, content, pinned, entity_type, entity_id, created_by, created_at, updated_at`; RLS enabled with org-scoped policies
3. `task_priority` ENUM (low/medium/high/urgent) and `task_status` ENUM (todo/in_progress/done/cancelled) created as DB types
4. `note_entity_type` or shared ENUM for `entity_type` (contact/account/opportunity) created
5. `src/types/database.ts` updated to reflect all new tables and types
6. `npm run build` exits 0

**Plans:** 2/2 plans complete
- [x] 76-01-PLAN.md — Migration 067: tasks table + enums + RLS
- [x] 76-02-PLAN.md — Migration 068: notes table + RLS + TypeScript types update

---

## Phase 77: TASKS-ACTIONS

**Goal:** All server actions for task CRUD are implemented, validated, and tested — UI phases can import directly
**Depends on:** Phase 76
**Requirements:** TSK-01, TSK-02, TSK-03, TSK-10, TSK-12, TSK-13
**Success Criteria:**
1. `createTask(input)` validates with zod, inserts into `tasks`, returns the created row
2. `updateTask(id, input)` validates, updates the row, throws on org mismatch
3. `deleteTask(id)` removes the row, throws on org mismatch
4. `getTasks(filters?)` returns tasks scoped to current org, supports filter params (status, priority, assigned_to, due_date range, entity_type+entity_id)
5. `toggleTaskDone(id)` flips status between done/todo atomically
6. All actions use `getUser()` + `createClient()` from `@/lib/supabase/server`; `org_id` never manually filtered (RLS handles it)
7. Vitest unit tests cover happy path + validation rejection for each action
8. `npm run build` exits 0

**Plans:** 2
- [ ] 77-01-PLAN.md — Zod schemas + RED test stubs for all task actions
- [ ] 77-02-PLAN.md — Implement createTask/updateTask/deleteTask/getTasks/toggleTaskDone + tests GREEN

---

## Phase 78: TASKS-LIST-UI

**Goal:** `/dashboard/tasks` page is live with list view, filters, sorting, quick-create drawer, overdue indicators, and mark-done toggle
**Depends on:** Phase 77
**Requirements:** TSK-04, TSK-05, TSK-06, TSK-07, TSK-08, TSK-10, TSK-14
**Success Criteria:**
1. `/dashboard/tasks` renders a table with columns: title, priority badge, status badge, due date (red if overdue), assigned user avatar+name, linked entity chip
2. Filter bar: status (multi-select), priority (multi-select), assigned user dropdown, due date range picker — filters apply without page reload via URL params
3. Sort controls: due date asc/desc, priority, created date — active sort visually indicated
4. Quick-create: clicking "New Task" opens a slide-over with the full task form (react-hook-form + zod); on submit the row appears in the list via router.refresh()
5. "Mark done" button/checkbox on each row calls toggleTaskDone; row status updates immediately (optimistic or router.refresh)
6. Overdue detection: due_date < today AND status IN (todo, in_progress) → red date text + "Overdue" badge
7. Sidebar navigation shows a "Tasks" item under the CRM group (or its own group)
8. `npm run build` exits 0

**Plans:** 3
- [ ] 78-01-PLAN.md — RED test stubs for tasks page + UI-SPEC
- [ ] 78-02-PLAN.md — TasksTable + TaskForm + TaskSlideOver components
- [ ] 78-03-PLAN.md — /tasks page wiring + sidebar nav + filter/sort URL params + overdue logic

---

## Phase 79: NOTES-ACTIONS

**Goal:** All server actions for notes CRUD are implemented, validated, and tested — UI phases can import directly
**Depends on:** Phase 76
**Requirements:** NOT-01, NOT-02, NOT-03, NOT-05, NOT-06, NOT-11, NOT-12
**Success Criteria:**
1. `createNote(input)` validates with zod, inserts into `notes`, returns the created row
2. `updateNote(id, input)` validates, updates title/content/pinned, throws on org mismatch
3. `deleteNote(id)` removes the row, throws on org mismatch
4. `getNotes(filters?)` returns notes scoped to org, sorted pinned-first then created_at desc; supports `search` (ilike on title+content) and `entity_type+entity_id` filters
5. `toggleNotePin(id)` flips `pinned` boolean atomically
6. All actions use `getUser()` + `createClient()` from `@/lib/supabase/server`
7. Vitest unit tests cover happy path + validation rejection for each action
8. `npm run build` exits 0

**Plans:** 2
- [ ] 79-01-PLAN.md — Zod schemas + RED test stubs for all note actions
- [ ] 79-02-PLAN.md — Implement createNote/updateNote/deleteNote/getNotes/toggleNotePin + tests GREEN

---

## Phase 80: NOTES-LIST-UI

**Goal:** `/dashboard/notes` page is live with card grid view, search, quick-create, and pin toggle
**Depends on:** Phase 79
**Requirements:** NOT-04, NOT-05, NOT-06, NOT-07, NOT-10
**Success Criteria:**
1. `/dashboard/notes` renders notes as a card grid (or list toggle); pinned notes appear at top with a pin icon
2. Each card shows: title (or first 80 chars of content as fallback), content preview, author name, creation date, linked entity chip (if any), and a pin/unpin button
3. Search input filters cards by title/content (client-side debounced or URL param); empty state message when no results
4. Quick-create: "New Note" opens a slide-over with title (optional) + content (textarea) + entity link picker; submits via createNote server action
5. Pin toggle calls toggleNotePin; card moves to/from pinned section without full reload (router.refresh)
6. Sidebar navigation shows a "Notes" item alongside Tasks
7. `npm run build` exits 0

**Plans:** 3
- [ ] 80-01-PLAN.md — RED test stubs for notes page
- [ ] 80-02-PLAN.md — NoteCard + NoteForm + NoteSlideOver components
- [ ] 80-03-PLAN.md — /notes page wiring + sidebar nav + search + pin toggle

---

## Phase 81: ENTITY-INTEGRATION

**Goal:** Task and Note panels appear in contact, account, and opportunity detail pages; sidebar navigation is complete with correct grouping
**Depends on:** Phase 78, Phase 80
**Requirements:** TSK-11, NOT-09, TSK-09, NOT-08
**Success Criteria:**
1. Contact detail page has a Tasks tab/section showing tasks linked to that contact with counts; user can create a task pre-linked to the contact
2. Account detail page has a Tasks tab/section with same behavior
3. Opportunity detail page (pipeline card or sheet) has a Tasks tab/section with same behavior
4. Contact, Account, and Opportunity detail pages each have a Notes section showing notes linked to that record; user can create a note pre-linked from within the detail page
5. All linked tasks/notes created from within entity detail pages auto-populate `entity_type` + `entity_id`
6. Sidebar CRM group is organized: Contacts, Companies, Pipeline, Tasks, Notes (in that order)
7. `npm run build` exits 0

**Plans:** 2
- [ ] 81-01-PLAN.md — TasksPanel + NotesPanel reusable components
- [ ] 81-02-PLAN.md — Wire panels into contact/account/opportunity detail + sidebar ordering

---

## Progress

| Phase | Plans | Status | Completed |
|-------|-------|--------|-----------|
| 76. DB-FOUNDATION | 2/2 | Complete   | 2026-05-19 |
| 77. TASKS-ACTIONS | 0/2 | ○ Not Started | — |
| 78. TASKS-LIST-UI | 0/3 | ○ Not Started | — |
| 79. NOTES-ACTIONS | 0/2 | ○ Not Started | — |
| 80. NOTES-LIST-UI | 0/3 | ○ Not Started | — |
| 81. ENTITY-INTEGRATION | 0/2 | ○ Not Started | — |

---

*Created: 2026-05-18*
