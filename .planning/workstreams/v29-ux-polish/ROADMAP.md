# Roadmap: v2.9 UX Polish & Feature Completeness

**Workstream:** v29-ux-polish
**Phases:** 3 (102–104) | **Requirements:** 13 (FLOW-01..05, NOTIF-01..05, THEME-01..03)

---

## Phase 102: WORKFLOWS-UNIFICATION

**Goal:** Merge "Automations" (Action Engine tool registry) + "Visual Flows" into a single system named Workflows — unified sidebar nav, unified UX, full feature parity.
**Depends on:** Nothing
**Requirements:** FLOW-01, FLOW-02, FLOW-03, FLOW-04, FLOW-05
**UI hint:** yes
**Success Criteria:**
1. Sidebar has a single "Workflows" entry (no separate "Automations" and "Flows" items)
2. `/workflows` route shows both automation tools and visual flows in one unified view
3. All existing automations (action engine tool configs) accessible and functional
4. All existing visual flows accessible and functional — no data loss
5. Folders, logs, integrations, all existing capabilities preserved
6. `npm run build` exits 0

**Plans:** 3
- [x] 102-01-PLAN.md — Create all /workflows/** pages (copy + update route strings, unified landing with tabs)
- [x] 102-02-PLAN.md — Update cross-cutting references: sidebar href, flow-canvas import, new-flow-form push, command palette
- [x] 102-03-PLAN.md — Replace /automations/** pages with redirect stubs + npm run build gate

---

## Phase 103: NOTIFICATIONS

**Goal:** Real-time in-app notification system — bell icon in header opens a dropdown popover with persisted notifications delivered via Supabase Realtime.
**Depends on:** Nothing
**Requirements:** NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05
**UI hint:** yes
**Success Criteria:**
1. `notifications` table in Supabase with columns: id, org_id, user_id, type, payload (jsonb), read_at, created_at — RLS scoped to org
2. Bell icon in `top-bar.tsx` shows numeric unread count badge (replaces mock `hasNotifications`)
3. Clicking bell opens a Popover with list of notifications — dropdown style, inline below bell
4. Notification types handled: `new_conversation`, `missed_call`, `flow_failed`
5. Each notification is clickable and navigates to the relevant resource
6. "Mark all as read" button at top of panel
7. Read notifications visible for 30 days in dimmer tone
8. Supabase Realtime subscription updates unread count live
9. `npm run build` exits 0

**Plans:** 3
- [x] 103-01-PLAN.md — DB migration: notifications table + RLS policies
- [x] 103-02-PLAN.md — Notification panel component + bell wiring in top-bar
- [x] 103-03-PLAN.md — Event emitters: insert notifications from conversation/call/flow webhooks

---

## Phase 104: LIGHT-THEME

**Goal:** Full light mode — remove forcedTheme="dark" lock, define light CSS variables, ThemeToggle already in header.
**Depends on:** Nothing
**Requirements:** THEME-01, THEME-02, THEME-03
**UI hint:** yes
**Success Criteria:**
1. `layout.tsx` has `defaultTheme="system"` and `enableSystem={true}` — `forcedTheme="dark"` removed
2. `globals.css` has `:root { }` block with light-mode values for all CSS custom properties
3. Theme persists across page reloads via next-themes localStorage
4. Dashboard, sidebar, all pages look correct in both dark and light mode
5. ThemeToggle in header switches theme without flash
6. `npm run build` exits 0

**Plans:** 2
- [x] 104-01-PLAN.md — Remove forcedTheme lock + define light CSS variables in globals.css
- [x] 104-02-PLAN.md — Audit and fix dark:-prefixed classes + component-level light mode corrections
