# v3.2 — Pending Production Migrations (apply BEFORE deploying the v3.2 code)

**Why this file exists:** the v3.2 code is being built and committed in "code-only" mode. Production DB writes are gated by the harness (auto-mode safety lock) and by a pre-existing migration-history desync that blocks `supabase db push`. So migrations are written as files + committed, but NOT applied. **They must be applied to the production CRM (`mwklvkmggmsintqcqfvu`, "Xphere") before the v3.2 code is deployed** — otherwise the new code will query tables/columns that don't exist yet and break existing features.

**How to apply (recommended):** in an INTERACTIVE Claude Code session (not auto-mode), have Claude run the Supabase management MCP `apply_migration` on project `mwklvkmggmsintqcqfvu` for each item below, in order, approving each prompt. (The linked CLI `supabase db push` is currently blocked by a history desync — see [[project-supabase-migration-desync]] — so prefer MCP apply_migration or reconcile history first.)

**Order matters.** Apply top-to-bottom. Each is idempotent-safe to re-check with the verify query.

---

## 1. `1225_universal_folders.sql` — Phase 114 (additive)
- **Status:** ⏳ pending apply (file committed: `supabase/migrations/1225_universal_folders.sql`)
- **What:** creates `public.folders` (entity-typed universal folder store) + RLS + index + moddatetime trigger. Additive — touches no existing table.
- **Risk:** low (new table, reversible via `drop table public.folders`).
- **Verify after:** `select to_regclass('public.folders');` → non-null.

---

## 2. `1226_migrate_workflow_folders.sql` — Phase 115 (data migration, UFE-03)
- **Status:** ⏳ pending apply (file committed: `supabase/migrations/1226_migrate_workflow_folders.sql`)
- **What:** copies `workflow_folders` → `folders` (entity_type='workflow') preserving UUIDs, repoints `workflows.folder_id` FK to `folders(id)`, and renames `workflow_folders` → `workflow_folders_deprecated` (retire, not drop).
- **Order:** apply AFTER `1225_universal_folders.sql`, BEFORE deploying the Phase 115 code (the swapped layout/actions query `folders` and would break if the copy hasn't run).
- **Risk:** MEDIUM-HIGH (touches production data + repoints a foreign key). UUID preservation keeps `workflows.folder_id` valid; the RENAME leaves a rollback safety net.
- **Verify after:** `select count(*) from public.folders where entity_type='workflow';` must match the old row count `select count(*) from public.workflow_folders_deprecated;`.

---

## 3. `1227_migrate_project_tool_folders.sql` — Phase 116 (data migration, UFE-04/UFE-05)
- **Status:** pending apply (file committed: `supabase/migrations/1227_migrate_project_tool_folders.sql`)
- **What:** copies `project_spaces` -> `folders` (entity_type='project') and `tool_folders` -> `folders` (entity_type='tool') preserving UUIDs; repoints `projects.space_id` and `tool_configs.folder_id` FKs to `folders(id)`; renames both legacy tables `_deprecated` (retire, not drop). Tools copy nulls color/icon/created_by (source lacks them). Note: `folders` uses NULLS-DISTINCT uniqueness, slightly loosening top-level tool-folder-name uniqueness vs the old `NULLS NOT DISTINCT` constraint — acceptable.
- **Order:** apply AFTER `1226_migrate_workflow_folders.sql`, BEFORE deploying the Phase 116 code (the swapped projects/tools layouts + actions query `folders` and would break if the copy hasn't run). After this applies and parity is confirmed, `workflow_folders_deprecated` is safe to drop.
- **Risk:** MEDIUM-HIGH (touches production data + repoints two foreign keys). UUID preservation keeps `projects.space_id` / `tool_configs.folder_id` valid; the RENAME leaves a rollback safety net.
- **Verify after:** `select count(*) from public.folders where entity_type='project';` must match `select count(*) from public.project_spaces_deprecated;` AND `select count(*) from public.folders where entity_type='tool';` must match `select count(*) from public.tool_folders_deprecated;`.

---

## 4. `1228_email_templates_folders.sql` — Phase 117 (additive, UFE-06)
- **Status:** ⏳ pending apply (file committed: `supabase/migrations/1228_email_templates_folders.sql`)
- **What:** adds `folder_id` (FK → `folders(id)` ON DELETE SET NULL) + `position` (int, default 0) + index `email_templates_folder_idx` to `public.email_templates`. Additive — no data migration, greenfield (no pre-existing template folders).
- **Order:** apply AFTER `1225_universal_folders.sql` (needs `public.folders` to exist for the FK), BEFORE deploying the Phase 117 code (the email-templates layout/sub-nav query `folder_id`/`position` and would break if the columns don't exist).
- **Risk:** LOW (additive columns, reversible via `alter table public.email_templates drop column folder_id, drop column position`).
- **Verify after:** `select to_regclass('public.email_templates');` → non-null AND `select column_name from information_schema.columns where table_name='email_templates' and column_name in ('folder_id','position');` → returns both rows.

<!-- Phase 115+ migrations will be appended here as they are built. -->
