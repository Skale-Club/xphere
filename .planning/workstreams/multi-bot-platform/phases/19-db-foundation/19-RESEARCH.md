# Phase 19: DB Foundation - Research

**Researched:** 2026-05-06
**Domain:** PostgreSQL schema migration, Supabase RLS, Next.js server actions
**Confidence:** HIGH

---

## Summary

Phase 19 replaces the flat `folder: TEXT | NULL` column on `tool_configs` with a proper relational `tool_folders` table that supports a 2-level hierarchy (`parent_id` self-reference). The existing `organizations.tool_folder_order: TEXT[]` column is superseded by a `position: INT` column on the new table.

The project has a mature, consistent migration and RLS pattern established across 24 existing migrations. The canonical RLS pattern uses a single `"org_isolation"` policy with `FOR ALL` and `org_id = public.get_current_org_id()` — a compact form first seen in migration 018 that the planner MUST replicate. Server actions follow a strict pattern: authenticated Supabase client via `createClient()` + `getUser()`, no manual `org_id` filtering (RLS handles it), `revalidatePath('/tools')` on mutation.

The data migration challenge is converting existing string-keyed folders (stored in `organizations.tool_folder_order[]` for ordering, and as `tool_configs.folder TEXT` for assignment) into rows in the new `tool_folders` table, then back-filling `tool_configs.folder_id` from those rows. The migration must handle the case where a `tool_config` references a folder name that does NOT appear in `tool_folder_order` (orphan folder names on individual tools).

**Primary recommendation:** Write a single migration file (`025_tool_folders.sql`) that: (1) creates the `tool_folders` table with RLS, (2) inserts folder rows from existing string data, (3) adds `folder_id UUID` to `tool_configs`, (4) back-fills `folder_id` from the string match, (5) drops the old `folder` TEXT column. Update `src/types/database.ts` manually after pushing.

---

## Project Constraints (from CLAUDE.md)

- Always run `npm run build` after changes to catch type errors
- Never call `supabase.auth.getUser()` directly — use `getUser()` from `@/lib/supabase/server`
- Never edit old migrations — add new ones only
- Never manually filter by `org_id` in queries that go through the authenticated client (RLS handles it)
- Auth gating in layouts/pages/server actions, not middleware
- `revalidatePath` required after mutations
- After adding a migration: (1) `npx supabase db push`, (2) update `src/types/database.ts`

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase JS client | ^2.x (project-pinned) | DB queries, RLS enforcement | Already in use throughout |
| PostgreSQL (via Supabase) | 15.x | Relational hierarchy via self-referencing FK | `parent_id UUID REFERENCES tool_folders(id)` |
| Next.js Server Actions | 15 (App Router) | Folder CRUD mutations | Established pattern in `actions.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | project-pinned | Validate server action inputs | All public-facing mutations |

---

## Architecture Patterns

### Migration File Convention
All migrations follow the pattern from existing files:

```sql
-- =============================================================================
-- Migration 025: Tool Folders — relational folder hierarchy for tool_configs
-- Phase: 19-db-foundation (v1.5)
-- =============================================================================

-- Section header comments describing intent
-- ADD COLUMN IF NOT EXISTS / CREATE TABLE / CREATE INDEX / ENABLE RLS / CREATE POLICY
-- Data migration in the same file (idempotent where possible)
-- DROP COLUMN at the end (after data is safe)
```

File name: `025_tool_folders.sql` (next in sequence after `024_chat_realtime_publication.sql`).

### RLS Pattern (canonical — from migration 018+)
The compact `FOR ALL` form is the established pattern for new tables:

```sql
-- Source: supabase/migrations/018_google_reviews.sql
ALTER TABLE public.tool_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.tool_folders
  FOR ALL
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
```

Note: Use `(SELECT public.get_current_org_id())` not bare `public.get_current_org_id()` — the subquery form is evaluated once per statement, not once per row (established in migration 001 commentary).

### tool_folders Table Schema
```sql
CREATE TABLE public.tool_folders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  parent_id   UUID        REFERENCES public.tool_folders(id) ON DELETE CASCADE,
  position    INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, parent_id, name)  -- prevent duplicate names within same parent scope
);
```

Constraint notes:
- `parent_id` is nullable — NULL means top-level folder
- `ON DELETE CASCADE` on `parent_id` — deleting a folder cascades to subfolders
- The unique constraint covers `(org_id, parent_id, name)` — a folder and a subfolder can share the same name, but two top-level folders in the same org cannot
- The unique constraint with nullable `parent_id` in PostgreSQL: two NULLs are not considered equal by default; use a partial index or NULLS NOT DISTINCT (PostgreSQL 15+ syntax: `UNIQUE NULLS NOT DISTINCT (org_id, parent_id, name)`) for the top-level case

### Foreign Key Addition to tool_configs
```sql
ALTER TABLE public.tool_configs
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.tool_folders(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` — if a folder is deleted, the tool becomes "ungrouped" (same behavior the UI already handles for tools with `folder = NULL`).

### Data Migration Strategy
The migration must handle three data sources in order:

1. **Source of truth for folder names and order:** `organizations.tool_folder_order TEXT[]` — this is the authoritative ordered list of top-level folders per org
2. **Fallback:** `tool_configs.folder TEXT` — any tool with a folder name not in `tool_folder_order` still has a valid folder assignment that must be preserved

Migration SQL logic (within the same `025_tool_folders.sql` file):

```sql
-- Step 1: Insert folders from organizations.tool_folder_order
-- Use WITH ORDINALITY to preserve position
INSERT INTO public.tool_folders (org_id, name, position, parent_id)
SELECT
  o.id,
  folder_name,
  (ordinality - 1)::INT,  -- 0-based position
  NULL
FROM public.organizations o,
     LATERAL unnest(o.tool_folder_order) WITH ORDINALITY AS u(folder_name, ordinality)
WHERE array_length(o.tool_folder_order, 1) > 0
ON CONFLICT (org_id, parent_id, name) DO NOTHING;  -- adjust if using NULLS NOT DISTINCT

-- Step 2: Insert any folder names on tool_configs that were NOT in tool_folder_order
INSERT INTO public.tool_folders (org_id, name, position, parent_id)
SELECT DISTINCT
  tc.organization_id,
  tc.folder,
  0,  -- position unknown, default to 0
  NULL
FROM public.tool_configs tc
WHERE tc.folder IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tool_folders tf
    WHERE tf.org_id = tc.organization_id
      AND tf.name = tc.folder
      AND tf.parent_id IS NULL
  )
ON CONFLICT DO NOTHING;

-- Step 3: Back-fill folder_id on tool_configs
UPDATE public.tool_configs tc
SET folder_id = tf.id
FROM public.tool_folders tf
WHERE tf.org_id = tc.organization_id
  AND tf.name = tc.folder
  AND tf.parent_id IS NULL;

-- Step 4: Drop the old flat column
ALTER TABLE public.tool_configs DROP COLUMN IF EXISTS folder;

-- Step 5: Drop the old order column from organizations (superseded by position)
ALTER TABLE public.organizations DROP COLUMN IF EXISTS tool_folder_order;
```

**Important:** The `UNIQUE NULLS NOT DISTINCT` syntax requires PostgreSQL 15+. Supabase Cloud runs PostgreSQL 15, so this is safe. The planner MUST verify or use a workaround (partial unique index) if uncertain.

### Server Actions Pattern (established in actions.ts)
```typescript
// Source: src/app/(dashboard)/tools/actions.ts
'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createFolder(name: string, parentId: string | null = null): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // No manual org_id filter needed — RLS scopes via get_current_org_id()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { error } = await supabase.from('tool_folders').insert({
    org_id: orgId,
    name,
    parent_id: parentId,
    position: 0,  // caller can reorder separately
  })

  if (error) return { error: error.message }
  revalidatePath('/tools')
}
```

### TypeScript Types Pattern
New entries follow the established shape in `src/types/database.ts`:

```typescript
tool_folders: {
  Row: {
    id: string
    org_id: string
    name: string
    parent_id: string | null
    position: number
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    org_id: string
    name: string
    parent_id?: string | null
    position?: number
    created_at?: string
    updated_at?: string
  }
  Update: {
    name?: string
    parent_id?: string | null
    position?: number
    updated_at?: string
  }
  Relationships: [
    {
      foreignKeyName: 'tool_folders_org_id_fkey'
      columns: ['org_id']
      isOneToOne: false
      referencedRelation: 'organizations'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'tool_folders_parent_id_fkey'
      columns: ['parent_id']
      isOneToOne: false
      referencedRelation: 'tool_folders'
      referencedColumns: ['id']
    }
  ]
}
```

Also update `tool_configs` Row/Insert/Update in `database.ts`:
- Remove `folder: string | null` from Row, Insert, Update
- Add `folder_id: string | null` to Row, Insert, Update
- Add FK relationship entry for `tool_folders`

And remove `tool_folder_order: string[]` from the `organizations` Row/Insert/Update.

### Anti-Patterns to Avoid
- **Editing existing migration files:** Never edit `001_foundation.sql` through `024_chat_realtime_publication.sql` — add new file only
- **Manual org_id filtering:** Do not write `WHERE organization_id = orgId` in queries run through the authenticated client — RLS handles it
- **Separate USING vs WITH CHECK:** The `FOR ALL` form with both clauses in one policy is the established pattern for new tables — do not split into separate per-operation policies (old-style from migration 001/002 — newer migrations use the compact form)
- **Forgetting `updated_at` trigger:** `public.update_updated_at()` function already exists; add trigger for the new table
- **NULL equality trap:** In PostgreSQL, `NULL != NULL`, so a UNIQUE constraint on `(org_id, parent_id, name)` does NOT prevent duplicate top-level folder names (both `parent_id = NULL`). Must use `UNIQUE NULLS NOT DISTINCT` (PG15+) or a separate partial unique index

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Org scoping | Manual WHERE org_id = ? | Supabase RLS with get_current_org_id() | RLS is enforced at DB level, cannot be bypassed by a bug |
| Position management | Custom ordering logic | Simple INT position column + app-layer reorder | Phase 21 handles reorder UI; DB just stores the int |
| Cascade deletes | Application-level cleanup | PostgreSQL `ON DELETE CASCADE` / `ON DELETE SET NULL` | Atomic, cannot be skipped |

---

## Runtime State Inventory

This is a data migration phase — existing runtime state must be explicitly accounted for.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `tool_configs.folder TEXT` — flat string column on all existing tool_config rows; `organizations.tool_folder_order TEXT[]` — ordered folder names per org | SQL data migration within `025_tool_folders.sql`: insert folder rows, back-fill `folder_id`, then drop old columns |
| Live service config | None — folder data not referenced by any webhook handler or edge function | None |
| OS-registered state | None | None — verified by codebase search |
| Secrets/env vars | None — no env vars reference folder string values | None |
| Build artifacts | `src/types/database.ts` — manually maintained, references `folder: string | null` on `tool_configs` and `tool_folder_order: string[]` on `organizations` | Manual update after migration push |

**Key data migration concern:** Tools can reference a folder name that never appeared in `organizations.tool_folder_order`. Both sources must be unioned when creating `tool_folders` rows. The migration SQL in the Architecture Patterns section handles this with a two-step INSERT.

**After migration push, these still reference the old string column:**
- `src/app/(dashboard)/tools/actions.ts` — `ToolConfigWithIntegration` type has `folder: string | null`; `createToolConfig` and `updateToolConfig` write `folder:` not `folder_id:`; `getFolderOrder` and `saveFolderOrder` use `organizations.tool_folder_order`
- `src/components/tools/tools-table.tsx` — reads `t.folder`, uses `orderedFolders` state built from `folderOrder: string[]` prop
- `src/components/tools/tool-config-form.tsx` — form field `folder: z.string().optional().nullable()` writes to `folder` column
- `src/app/(dashboard)/tools/page.tsx` — calls `getFolderOrder()`, passes `folderOrder` prop

All of these need updating in Phase 19 as part of the server actions and TypeScript type work.

---

## Common Pitfalls

### Pitfall 1: NULL uniqueness in PostgreSQL
**What goes wrong:** Two top-level folders (both with `parent_id = NULL`) can have the same name because `NULL != NULL` in SQL, so UNIQUE(org_id, parent_id, name) does not catch duplicates among top-level folders.
**Why it happens:** Standard SQL NULL semantics — NULLs are never equal to each other.
**How to avoid:** Use `UNIQUE NULLS NOT DISTINCT (org_id, parent_id, name)` (PostgreSQL 15 syntax, available on Supabase Cloud), OR use two separate constraints: a partial unique index for top-level (`WHERE parent_id IS NULL`) and the standard UNIQUE for non-null parent.
**Warning signs:** Can create two folders both named "Sales" at the top level — confusing UI, broken disambiguation.

### Pitfall 2: Data loss if migration runs before all tool_configs folder values are captured
**What goes wrong:** The migration drops `tool_configs.folder` after back-filling `folder_id`. If a `folder` value on a `tool_config` row has no matching `tool_folders` row, the tool becomes ungrouped silently.
**Why it happens:** Step 1 of the migration only inserts from `tool_folder_order`. Tools with orphan folder names (not in that array) would lose their assignment.
**How to avoid:** Step 2 of the migration (INSERT from `tool_configs.folder` where not already in `tool_folders`) catches this. Test with: `SELECT folder FROM tool_configs WHERE folder IS NOT NULL AND folder_id IS NULL` AFTER back-fill but BEFORE DROP — if any rows, abort.
**Warning signs:** After migration, any tool that had a folder string is now showing in "Ungrouped".

### Pitfall 3: `tool_config-form.tsx` still writes to `folder` column after migration
**What goes wrong:** The form still sends `folder: string | null` to `createToolConfig`/`updateToolConfig`. After migration, this column no longer exists — the insert/update will fail or silently ignore the field.
**Why it happens:** The UI and server actions must be updated atomically with the migration.
**How to avoid:** Phase 19 plan must include updating actions.ts and the form to use `folder_id: UUID | null` instead of `folder: string | null`. The form will need to accept a list of folder objects (id + name) rather than free-text strings.
**Warning signs:** Build errors (`folder` not in type), or silent assignment failures.

### Pitfall 4: `getFolderOrder` / `saveFolderOrder` become no-ops
**What goes wrong:** These two server actions read/write `organizations.tool_folder_order` which is dropped by the migration.
**Why it happens:** The ordering responsibility moves to `tool_folders.position`.
**How to avoid:** Replace `getFolderOrder`/`saveFolderOrder` with new actions: `getFolders()` (returns `ToolFolder[]` ordered by `position`) and `updateFolderPosition(id, position)` or `reorderFolders(orderedIds)`.
**Warning signs:** TypeScript errors in actions.ts after dropping the column from database.ts.

### Pitfall 5: `updated_at` trigger missing on new table
**What goes wrong:** `updated_at` column never auto-updates on folder rename.
**Why it happens:** Easy to forget — `update_updated_at()` function exists but the trigger must be created for each new table.
**How to avoid:** Add `CREATE TRIGGER trg_tool_folders_updated_at BEFORE UPDATE ON public.tool_folders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();` in the migration.

---

## Code Examples

### Migration file header (exact format)
```sql
-- Source: supabase/migrations/018_google_reviews.sql (model)
-- =============================================================================
-- Migration 025: Tool Folders — relational hierarchy replacing flat folder column
-- Phase: 19-db-foundation (v1.5)
-- =============================================================================
```

### Compact RLS policy (FOR ALL, established in migration 018)
```sql
-- Source: supabase/migrations/018_google_reviews.sql
CREATE POLICY "org_isolation" ON public.tool_folders
  FOR ALL
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));
```

### getFolders replacement for getFolderOrder
```typescript
// Replaces getFolderOrder() in src/app/(dashboard)/tools/actions.ts
export type ToolFolder = {
  id: string
  org_id: string
  name: string
  parent_id: string | null
  position: number
  created_at: string
  updated_at: string
}

export async function getFolders(): Promise<ToolFolder[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tool_folders')
    .select('*')
    .order('position', { ascending: true })
  if (error || !data) return []
  return data as ToolFolder[]
}
```

### Updated ToolConfigWithIntegration type
```typescript
// After migration: folder_id replaces folder in actions.ts
export type ToolConfigWithIntegration = {
  id: string
  organization_id: string
  integration_id: string
  tool_name: string
  action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook'
  config: unknown
  fallback_message: string
  is_active: boolean
  folder_id: string | null   // was: folder: string | null
  labels: string[]
  created_at: string
  integrations: {
    id: string
    name: string
    provider: string
  } | null
}
```

### Existing `update_updated_at` trigger (already in DB — just reference it)
```sql
-- Source: supabase/migrations/001_foundation.sql (function already exists)
CREATE TRIGGER trg_tool_folders_updated_at
  BEFORE UPDATE ON public.tool_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies — this phase is DB migration + server-side TypeScript only; Supabase CLI and Node.js are already in use).

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`, so this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | Check `tests/` directory — project has `tests/` folder per CLAUDE.md |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
Phase 19 is infrastructure (no user-visible requirements from REQUIREMENTS.md). Success criteria are structural:

| Criteria | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| SC-1 | `tool_folders` table exists with correct columns and RLS | manual/smoke (DB state) | `npx supabase db push` (migration applies cleanly) | N/A — migration |
| SC-2 | Existing tools retain folder assignment after migration | manual (data verification query) | SQL: `SELECT COUNT(*) FROM tool_configs WHERE folder_id IS NULL AND ...` | N/A |
| SC-3 | Server actions return correct data scoped to org | unit | `npx vitest run tests/tools/` | ❌ Wave 0 |
| SC-4 | `tool_configs.folder_id` FK exists, `folder` column dropped | manual (schema check) | `npx supabase db push` (no error) | N/A |

### Sampling Rate
- **Per task commit:** `npm run build` (catches TypeScript errors from schema changes)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** `npm run build` green + migration applies cleanly + `npx vitest run` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/actions.test.ts` — unit tests for `getFolders`, `createFolder`, `updateFolder`, `deleteFolder`
- [ ] Tests may need a Supabase test client mock or use existing test infrastructure pattern

*(Check `tests/` directory for existing test patterns before creating new fixtures)*

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `folder: TEXT` on `tool_configs` | `folder_id: UUID FK` to `tool_folders` | Phase 19 | Enables 2-level hierarchy, relational integrity |
| `tool_folder_order: TEXT[]` on `organizations` | `position: INT` on `tool_folders` | Phase 19 | Ordering is per-folder, survives folder renames |

**Deprecated after Phase 19:**
- `getFolderOrder()` / `saveFolderOrder()` — replaced by `getFolders()` and position-based reorder
- `organizations.tool_folder_order` column — dropped by migration
- `tool_configs.folder` TEXT column — dropped by migration

---

## Open Questions

1. **NULLS NOT DISTINCT uniqueness**
   - What we know: PostgreSQL 15 supports `UNIQUE NULLS NOT DISTINCT`. Supabase Cloud is PostgreSQL 15.
   - What's unclear: Exact Supabase Cloud minor version — some Supabase deployments lag on PG15 patch level. This syntax is safe to use but if it fails, fallback is two constraints: `UNIQUE(org_id, parent_id, name)` + partial index `CREATE UNIQUE INDEX ON tool_folders(org_id, name) WHERE parent_id IS NULL`.
   - Recommendation: Use NULLS NOT DISTINCT; document fallback in migration comments.

2. **Whether existing data has orphan folder names**
   - What we know: `tool_folder_order` is the canonical order; individual `tool_configs.folder` strings may not all appear there.
   - What's unclear: Production data state (no access to prod DB from local).
   - Recommendation: Migration Step 2 handles this defensively; verify post-migration with a SQL query in the verification plan.

3. **Whether `tool_config-form.tsx` should use a `<select>` or remain free-text after Phase 19**
   - What we know: Phase 19 is DB + server actions only; UI behavior changes are Phase 20.
   - What's unclear: Whether the form needs to work at all during Phase 19 (folder_id is nullable, so existing tools without a folder still work; creating a new tool without assigning a folder also works).
   - Recommendation: Phase 19 updates the form to pass `folder_id` instead of `folder` string, but the folder selector UI (choosing from a list) is a Phase 20 concern. For Phase 19, the form field can accept a folder UUID directly or be temporarily disabled. The planner should decide — keeping it working means the form needs the folder list passed in.

---

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/001_foundation.sql` — RLS pattern with `(SELECT get_current_org_id())` subquery form, `update_updated_at()` trigger function
- `supabase/migrations/002_action_engine.sql` — `tool_configs` original schema, FK patterns, index patterns
- `supabase/migrations/016_tool_folders_labels.sql` — how `folder TEXT` was added
- `supabase/migrations/017_org_folder_order.sql` — how `tool_folder_order TEXT[]` was added
- `supabase/migrations/018_google_reviews.sql` — canonical modern RLS `"org_isolation"` pattern with `FOR ALL`
- `src/app/(dashboard)/tools/actions.ts` — all current server action signatures and patterns
- `src/types/database.ts` — full type structure, what must change
- `src/components/tools/tools-table.tsx` — client component using `folderOrder: string[]` and `t.folder`
- `src/components/tools/tool-config-form.tsx` — form writing `folder: string | null`
- `.planning/config.json` — `nyquist_validation: true`, `commit_docs: true`

### Secondary (MEDIUM confidence)
- PostgreSQL 15 docs on NULLS NOT DISTINCT (standard SQL extension, well-documented)

---

## Metadata

**Confidence breakdown:**
- Migration structure: HIGH — read all 24 existing migrations, pattern is consistent
- RLS pattern: HIGH — migration 018 shows the exact pattern to replicate
- Data migration strategy: HIGH — both data sources identified and handled in SQL
- Server actions changes: HIGH — current actions.ts fully read, all callers identified
- TypeScript types: HIGH — database.ts fully read, all three change sites identified
- Unique constraint on nullable parent_id: MEDIUM — NULLS NOT DISTINCT is PG15 but production Supabase minor version unconfirmed

**Research date:** 2026-05-06
**Valid until:** Stable schema — valid until schema changes; 90 days minimum
