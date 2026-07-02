---
status: passed
phase: 115-migrate-workflows-to-universal-folders
verified: 2026-07-02
mode: code-only (migration 1226 written + committed, NOT applied — see PENDING-MIGRATIONS.md)
---

# Phase 115 Verification — Migrate Workflows to Universal Folders

**Result: PASSED at the code level.** `npm run build` exit 0; `grep -rn "workflow_folders" src/` reduced to only the generated `database.ts` type block (no runtime code queries the legacy table).

## Success Criteria
1. **Data migration copies workflow_folders → folders (entity_type='workflow') preserving UUIDs, repoints workflows.folder_id** — ✅ in `supabase/migrations/1226_migrate_workflow_folders.sql` (file). ⏳ *applied to prod: pending.*
2. **Existing folders unchanged in sidebar post-migration** — ⏳ deferred (post-apply human-verify — cannot check without applying 1226).
3. **CRUD via shared foldering core** — ✅ `_actions/folders.ts` + `workflows.ts` delegate to `@/lib/foldering/core` (entity_type='workflow'); export names/shapes preserved so `workflow-sub-nav.tsx` unchanged. ⏳ runtime confirmation post-apply.
4. **workflow_folders retired (renamed _deprecated); app references only folders** — ✅ RENAME in 1226; `layout.tsx` queries `folders`.
5. **npm run build passes** — ✅ exit 0.

## Requirements
- UFE-03 ✅ code complete (runtime/data parity pending apply of 1226).

## Deferred (not a gap — code-only mode)
- Apply `1226` to prod AFTER `1225`, BEFORE deploy. Runtime + data parity verification happens then. Tracked in `PENDING-MIGRATIONS.md`.
