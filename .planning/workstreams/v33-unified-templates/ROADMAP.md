# Roadmap: Xphere v3.3 Settings Nav Cleanup + Unified Templates

## Overview

This milestone cleans up two nav wrongs (a redundant Call Center link, a stray Chat Widget entry) and turns the existing "Communications" Settings section into a real, extensible "Templates" home. WhatsApp templates — today only reachable via a contextual "Manage templates" button — get a first-class Settings route with search/filter. A brand-new "Messages" template type (default body + optional per-channel SMS/Email/WhatsApp overrides) ships as Settings-only CRUD, proving the data model before any composer/campaign integration. The nav rename to "Templates" lands last, once Email, Messages, and WhatsApp all have something real to point to.

## Phases

- [x] **Phase 122: Settings Nav Cleanup** - Remove the redundant Call Center link and move Chat Widget into Build; zero dependency on the rest of the milestone. (completed 2026-07-03)
- [x] **Phase 123: WhatsApp Templates Relocation + Search/Filter** - Give the existing WhatsApp templates screen a real Settings route with search + status/category/language filtering, preserving dual-provider sync behavior. (completed 2026-07-03)
- [x] **Phase 124: Messages Templates Data Model + CRUD** - New `message_templates` table (RLS) with default body + per-channel overrides; list/create/edit/delete UI at `/settings/message-templates`. (completed 2026-07-03)
- [x] **Phase 125: Messages Preview + Templates Nav Finalization** - Per-channel resolution preview on the Messages template editor; rename Communications → Templates with Email/Messages/WhatsApp entries in an extensible shared pattern. (completed 2026-07-03)

## Phase Details

### Phase 122: Settings Nav Cleanup
**Goal**: Settings navigation stops duplicating the Calls surface and stops misfiling Chat Widget under Communications.
**Depends on**: Nothing
**Requirements**: NAV-01, NAV-02
**Success Criteria** (what must be TRUE):
  1. Admin opens Settings and no longer sees a "Call Center" link anywhere in the sub-nav — the only route to that surface is the top-level Calls sidebar item at `/calls/settings`.
  2. Admin finds "Chat Widget" listed under the Build section of Settings, not Communications.
  3. Visiting `/settings/widget` directly still works unchanged (route untouched, only its nav entry moved).
**Plans**: 1 plan

Plans:
- [x] 122-01-PLAN.md — Remove Call Center nav item, move Chat Widget to Build section

### Phase 123: WhatsApp Templates Relocation + Search/Filter
**Goal**: WhatsApp templates stop being nav-orphaned and gain the search/filter tools admins need to find a template among many.
**Depends on**: Nothing (parallel-safe with Phase 122; independent of Phase 124)
**Requirements**: WAT-01, WAT-02, WAT-03, WAT-04, WAT-05
**Success Criteria** (what must be TRUE):
  1. Admin reaches the WhatsApp templates screen from a real Settings nav entry, not only via a contextual "Manage templates" button.
  2. Admin can type a name into a search box and see the WhatsApp template list filter live.
  3. Admin can filter the list by status (Approved/Pending/Rejected/Paused/Disabled), category, and language, independently or combined.
  4. Both existing provider paths (Meta Cloud API and Zernio) still render their templates and sync/approval mechanics exactly as before — no behavior regression for either provider.
  5. The pre-existing contextual entry points (integration panel "Manage templates" button, chat template picker fallback) still work and land on the relocated page.
**Plans**: 1 plan
**UI hint**: yes

Plans:
- [x] 123-01-PLAN.md — Relocate WhatsApp templates page to /settings/whatsapp-templates, repoint entry points, add name search + status/category/language filters (completed 2026-07-03)

### Phase 124: Messages Templates Data Model + CRUD
**Goal**: A brand-new, org-scoped "Messages" quick-reply template type exists with full CRUD, independent of and clearly distinct from WhatsApp Business templates.
**Depends on**: Nothing (independent data model; can run parallel to Phase 122/123)
**Requirements**: MSG-01, MSG-02, MSG-03, MSG-04
**Success Criteria** (what must be TRUE):
  1. Admin can create a Messages template with a name, a default body, and optional per-channel body overrides for SMS, Email, and WhatsApp.
  2. Admin can view a list of Messages templates, open one to edit its name/default body/overrides, and delete one, all from `/settings/message-templates`.
  3. A Messages template created in one org is never visible to another org (RLS-enforced like every other tenant table).
  4. A newly saved Messages template is immediately usable with no approval step or external sync — clearly a separate concept from WhatsApp Business templates, with no shared table or approval workflow between them.
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 124-01-PLAN.md — message_templates migration (RLS + trigger) + hand-written database.ts types + server actions (list/get/create/update/delete) (completed 2026-07-03)
- [x] 124-02-PLAN.md — List/new/editor UI at /settings/message-templates with SMS/Email/WhatsApp override tabs, delete confirmation, and Settings sub-nav entry (completed 2026-07-03)

### Phase 125: Messages Preview + Templates Nav Finalization
**Goal**: Admins can verify what a Messages template will actually send per channel, and Settings navigation now has one coherent, extensible "Templates" home covering Email, Messages, and WhatsApp.
**Depends on**: Phase 123, Phase 124
**Requirements**: MSG-05, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):
  1. While editing a Messages template, admin can preview the resolved body for each channel (SMS/Email/WhatsApp), correctly showing the channel override when set and falling back to the default body when not, before saving.
  2. The Settings sub-nav section previously labeled "Communications" is now labeled "Templates" and lists Email Templates, Messages, and WhatsApp Templates as its entries.
  3. Adding a future template kind to this section is a one-line nav-item addition using the same shared section/card pattern as the existing three entries — no structural nav rework needed.
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 125-01-PLAN.md — Restructure Messages template editor into 5 tabs (Default/SMS/Email/WhatsApp/Preview) with live per-channel resolution preview
- [x] 125-02-PLAN.md — Rename Settings sub-nav Communications section to Templates

## Progress

**Execution Order:**
Phases 122 and 123 and 124 have no interdependency and may execute in any order (or in parallel); Phase 125 depends on both 123 and 124 completing first. Numeric order for default execution: 122 → 123 → 124 → 125.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 122. Settings Nav Cleanup | 1/1 | Complete    | 2026-07-03 |
| 123. WhatsApp Templates Relocation + Search/Filter | 1/1 | Complete    | 2026-07-03 |
| 124. Messages Templates Data Model + CRUD | 2/2 | Complete    | 2026-07-03 |
| 125. Messages Preview + Templates Nav Finalization | 2/2 | Complete    | 2026-07-03 |
