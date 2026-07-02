---
phase: 117-email-templates-sub-sidebar-folders
plan: 02
subsystem: ui
tags: [next, react, email-templates, folders, sub-sidebar, draggable-tree-nav]

# Dependency graph
requires:
  - phase: 117-01
    provides: "email_templates.folder_id/position + email-templates/_actions/folders.ts + listTemplates(folder_id/position)"
  - phase: 114-universal-folders
    provides: "Generic SubSidebarLayout + DraggableTreeNav + NewFolderButton primitives"
provides:
  - "EmailTemplateSubNav (DraggableTreeNav wiring for email templates)"
  - "NewTemplateButton (Link to /settings/email-templates/new)"
  - "Entity-agnostic NewFolderButton (optional createFolder prop, default = workflows)"
  - "settings/email-templates/layout.tsx — SubSidebarLayout wrapping list + new + [id] editor"
affects: [email-templates-ui, phase-118-stable-block-ids]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reuse generic DraggableTreeNav + SubSidebarLayout for a new entity (email templates) with zero primitive changes"
    - "Entity-agnostic shared button via optional action prop with a default (NewFolderButton)"

key-files:
  created:
    - src/components/email-templates/email-template-sub-nav.tsx
    - src/components/email-templates/new-template-button.tsx
    - src/app/(dashboard)/settings/email-templates/layout.tsx
  modified:
    - src/components/workflows/new-folder-button.tsx

key-decisions:
  - "Layout placed at settings/email-templates/ (not email-templates/) — wraps the canonical list + new + [id] editor in one shot, touches no redirect"
  - "NewFolderButton made entity-agnostic via optional createFolder prop defaulting to the workflows action — Workflows call sites unchanged"
  - "No renameItem/footer for email templates (no rename lifecycle, no Logs/Trash pages); item removal is hard deleteTemplate labeled 'Delete'"

patterns-established:
  - "A second entity (email templates) now consumes the universal foldering UI stack identically to Workflows"

requirements-completed: [UFE-06]

# Metrics
duration: 6min
completed: 2026-07-02
---

# Phase 117 Plan 02: Email Templates Sub-Sidebar + Folders UI Summary

**/settings/email-templates (list AND editor) now renders inside a Workflows-style folder sub-sidebar (SubSidebarLayout + DraggableTreeNav) wired to the email-template foldering actions, with an entity-agnostic NewFolderButton and a NewTemplateButton — all on reused generic primitives.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-02T16:45:00Z
- **Completed:** 2026-07-02T16:51:27Z
- **Tasks:** 4
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `NewFolderButton` is now entity-agnostic: optional `createFolder` prop defaulting to the aliased workflows action (`createWorkflowFolder`). Existing Workflows call sites compile with zero changes.
- New `NewTemplateButton` (client) links to `/settings/email-templates/new`, matching `NewWorkflowButton`'s `label`/`className`/`iconOnly` props.
- New `EmailTemplateSubNav` renders the generic `DraggableTreeNav` with `itemNoun="template"`, Mail icons (inherit folder color), `/settings/email-templates/<id>` hrefs, hard-delete via `deleteTemplate` (`deleteItemLabel="Delete"`), `enableFolderIcon`, and folder/item actions from Plan 01. No `renameItem`, no footer.
- New `settings/email-templates/layout.tsx` wraps the list + `new` + `[id]` editor in `SubSidebarLayout` (`storageKey="sub-sidebar:email-templates"`), fetching items via `listTemplates()` and folders by `entity_type='email_template'`.
- `npm run build` exits 0; `/settings/email-templates`, `/settings/email-templates/[id]`, `/settings/email-templates/new` all render; `/email-templates` redirect preserved.

## Task Commits

1. **Task 1: entity-agnostic NewFolderButton + NewTemplateButton** - `3bd308e7` (feat)
2. **Task 2: EmailTemplateSubNav (DraggableTreeNav)** - `5dfdb530` (feat)
3. **Task 3: settings/email-templates layout (SubSidebarLayout)** - `7abfc6e0` (feat)
4. **Task 4: full UI production build** - verification only (no commit; build green)

## Files Created/Modified
- `src/components/email-templates/email-template-sub-nav.tsx` - DraggableTreeNav wiring (Mail icon, canonical hrefs, folder + move/reorder actions, hard delete).
- `src/components/email-templates/new-template-button.tsx` - Link to `/settings/email-templates/new`.
- `src/app/(dashboard)/settings/email-templates/layout.tsx` - SubSidebarLayout wrapping list + editor; folders by entity_type.
- `src/components/workflows/new-folder-button.tsx` - Optional `createFolder` prop (default `createWorkflowFolder`); handleSubmit calls the (defaulted) prop.

## Routing Decision (as implemented)
The layout lives at `src/app/(dashboard)/settings/email-templates/layout.tsx`. A Next.js layout at that path wraps `page.tsx` (list), `new/page.tsx` (create), and `[id]/page.tsx` (editor) of the canonical `/settings/email-templates` experience in one shot. The other route group `app/(dashboard)/email-templates/page.tsx` remains a pure `redirect('/settings/email-templates')`; that redirect and the legacy `[id]`/`new` editors were NOT modified. The email-templates sub-sidebar nests inside the existing settings `SubSidebarLayout` with a distinct `storageKey`, so both panels persist independently.

## NewFolderButton prop change
Added `createFolder?: (input: { name: string }) => Promise<{ ok: true; data: { name: string } } | { ok: false; error: string }>`, defaulted in the signature to `createWorkflowFolder` (aliased import of the workflows `createFolder`). `handleSubmit` now calls the prop. Workflows usage (`<NewFolderButton />`, `<NewFolderButton iconOnly ... />`) is unchanged.

## Decisions Made
- Layout at `settings/email-templates/` per the plan's explicit ROUTING DECISION — wraps canonical routes, preserves redirects.
- Item icon is a static `Mail` glyph that inherits `context.folderColor` when inside a colored folder (default `#6366f1`).

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. (The `[redis] error:` and Sentry deprecation lines in build output are pre-existing environment noise, unrelated to and not caused by this plan — out of scope.)

## User Setup Required
None for code. Runtime sidebar render/drag needs migrations 1225 + 1228 applied first (folders/email_templates.folder_id don't exist in the connected DB until then) — post-apply human-verify, not a code gap.

## Next Phase Readiness
- UFE-06 UI complete on reused generic primitives; a second entity now consumes the universal foldering stack.
- Post-apply human-verify (after 1225 + 1228): visit `/settings/email-templates`, confirm the folder tree renders, create/rename/color/nest folders, drag templates between folders, reorder, and hard-delete a template.

---
*Phase: 117-email-templates-sub-sidebar-folders*
*Completed: 2026-07-02*
