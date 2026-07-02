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

<!-- Phase 115+ migrations will be appended here as they are built. -->
