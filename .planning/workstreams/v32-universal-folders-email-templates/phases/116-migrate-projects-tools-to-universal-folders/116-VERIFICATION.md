---
status: passed
phase: 116-migrate-projects-tools-to-universal-folders
verified: 2026-07-02
mode: code-only (migration 1227 written + committed, NOT applied — PENDING-MIGRATIONS.md)
---

# Phase 116 Verification — Migrate Projects + Tools to Universal Folders

**Result: PASSED at the code level.** `npm run build` exit 0; `grep -rn "project_spaces\|tool_folders" src/` reduced to only generated `database.ts` type blocks + the preserved MCP tool name `project_spaces_create` + one comment. No `.from('project_spaces')`/`.from('tool_folders')` table query remains.

## Success Criteria
1. **Data migrations copy project_spaces + tool_folders → folders preserving UUIDs and FKs** — ✅ `supabase/migrations/1227_migrate_project_tool_folders.sql`. ⏳ applied to prod: pending.
2. **Existing spaces + tool folders unchanged post-migration** — ⏳ deferred (post-apply human-verify).
3. **Both modules operate through the shared foldering core** — ✅ Projects (`spaces.ts` + `mcp/tools/projects.ts`, itemFolderColumn='space_id') and Tools (`workflows/actions.ts` + `agents/_actions/tools.ts`, legacy return shapes adapted). Core got a backward-compatible `itemFolderColumn`.
4. **project_spaces + tool_folders retired; workflow_folders_deprecated safe to drop later** — ✅ RENAME in 1227.
5. **npm run build passes** — ✅ exit 0.

## Requirements
- UFE-04 ✅ (Projects) · UFE-05 ✅ (Tools) — code complete.

## Deferred / to verify at apply time (not gaps — code-only)
- Apply `1227` AFTER `1226`. Then runtime-verify: existing spaces/tool folders unchanged; folder CRUD; and specifically the bespoke `moveToolToFolder` / `archiveSpace` / `deleteSpace` paths (kept out of the generic core cascade because it hardcodes `folder_id`).
