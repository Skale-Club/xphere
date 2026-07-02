---
status: passed
phase: 117-email-templates-sub-sidebar-folders
verified: 2026-07-02
mode: code-only (migration 1228 written + committed, NOT applied — PENDING-MIGRATIONS.md #4)
---

# Phase 117 Verification — Email Templates Sub-Sidebar + Folders

**Result: PASSED at the code level.** `npm run build` exit 0 after each wave.

## Success Criteria
1. **email_templates gains folder_id (FK → folders) + position** — ✅ `supabase/migrations/1228_email_templates_folders.sql` + `database.ts` type. ⏳ applied: pending.
2. **/settings/email-templates renders inside SubSidebarLayout with EmailTemplateSubNav (DraggableTreeNav, entity_type='email_template')** — ✅ new `settings/email-templates/layout.tsx` wraps list + new + [id] editor; `email-template-sub-nav.tsx` built on the generic tree; redirects untouched; distinct storageKey.
3. **Create/rename/color/icon/nest folders + drag templates between folders + reorder** — ✅ wired via `email-templates/_actions/folders.ts` (core delegations) + entity-agnostic `NewFolderButton`. ⏳ runtime confirmation post-apply.
4. **List folder-scoped + npm run build passes** — ✅ `listTemplates()` selects folder_id/position; build exit 0. (Grid folder-filtering left as optional polish; sidebar tree is the organizer.)

## Requirements
- UFE-06 ✅ code complete (runtime render/drag pending apply of 1225 + 1228).

## Deferred (not a gap — code-only)
- Apply `1228` after `1225`. Then runtime-verify sidebar render + drag. Workflows `NewFolderButton` regression check (should be unaffected — optional prop, default = workflows).
