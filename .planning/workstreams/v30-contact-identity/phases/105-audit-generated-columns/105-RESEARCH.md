# Phase 105: AUDIT-GENERATED-COLUMNS — Research

**Researched:** 2026-05-25
**Domain:** Postgres schema migration (Supabase managed PG 17) — generated columns, immutable SQL functions, audit table, branched migration validation
**Confidence:** HIGH

## Summary

This phase is a pure database migration. It adds three columns to `public.contacts` (`phone_e164`, `email_normalized`, `identity_status`), creates one IMMUTABLE SQL function (`normalize_phone`), creates one new table (`contact_duplicate_audit`) plus one refresh function (`refresh_contact_duplicate_audit`), and regenerates `src/types/database.ts`. No application code changes.

All required Postgres features (`GENERATED ALWAYS AS ... STORED`, `IMMUTABLE` SQL functions, `regexp_replace`) are supported on Supabase PG 17 and already used in this repo (`066_contact_imports.sql` uses generated stored columns). The CONTEXT.md decisions D-01 through D-04 are locked; this research provides the concrete SQL, migration number, validation flow, and risk catalog the planner needs.

**Primary recommendation:** Single migration file `supabase/migrations/1056_contact_identity_audit.sql` ordered: (1) `normalize_phone()`, (2) add three columns to `contacts` (generated columns must reference the function, which must already exist), (3) backfill `identity_status` per D-03, (4) create `contact_duplicate_audit` + RLS + indexes, (5) create `refresh_contact_duplicate_audit()`. Validate via Supabase branch (`mcp__supabase_mcp_xphere__create_branch` → `apply_migration` on branch → run refresh → inspect → `merge_branch`). Regenerate types via `mcp__supabase_mcp_xphere__generate_typescript_types` (no `gen:types` npm script exists in this repo). Run `npm run build` to verify type compatibility.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Audit Output Format:** Persist audit results in table `contact_duplicate_audit` with columns: `cluster_id uuid`, `org_id uuid`, `match_type text CHECK (match_type IN ('phone','email'))`, `normalized_value text`, `contact_ids uuid[]`, `cluster_size int`, `detected_at timestamptz`. Re-runnable via SQL function `refresh_contact_duplicate_audit()`. No admin UI in this phase — that ships in Phase 106.

**D-02 — Phone Normalization:** `normalize_phone(input text) RETURNS text` does minimal work: strip everything except digits, preserve a single leading `+` if present, return NULL on empty. Function is IMMUTABLE so it can power generated columns.

**D-02a:** Validation of impossible numbers stays in the app layer (`react-international-phone` + Zod refine in `src/lib/contacts/zod-schemas.ts`). DB does not validate — it normalizes whatever is stored.

**D-02b:** Email normalization is inline `lower(trim(coalesce(email,'')))` with `NULLIF ''` in the generated column definition — no separate function needed.

**D-03 — identity_status Backfill:** Per-row backfill (not blanket default):
- `channel_only` when `phone IS NULL AND email IS NULL AND source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL`
- `identified` for everything else

**D-03a:** Future statuses (`verified`, `merge_conflict`, `archived_duplicate`) reserved but not assigned in this phase — only `channel_only` and `identified` appear post-backfill.

**D-03b:** CHECK constraint enumerates all 5 future values now, even though only 2 are used, to avoid re-altering the constraint in later phases.

**D-04 — Migration Approach:** Apply migration via Supabase branch first (`mcp__supabase_mcp_xphere__create_branch` or CLI). On branch: run migration → run audit refresh → inspect for parse errors → if clean, merge branch back to main. Do not apply directly to remote prod.

**D-04a:** Migration file naming continues 0xx sequence. Next number is determined at planning time by listing `supabase/migrations/`.

### Claude's Discretion

- TypeScript type regeneration approach (`src/types/database.ts`) — Claude picks between `mcp__supabase_mcp_xphere__generate_typescript_types` MCP call vs hand-edit.
- Exact placement of `normalize_phone()` in migration file (single file vs split).
- Whether to add a `contact_duplicate_audit_id` reverse FK on `contacts` (probably no — clusters reference contacts, not vice versa).
- Index strategy on `contact_duplicate_audit` for Phase 106 query patterns.

### Deferred Ideas (OUT OF SCOPE)

- **Merge UI / conflict resolution:** Phase 106.
- **`UNIQUE (org_id, phone_e164)` partial index:** Phase 107. Cannot be added until duplicates are resolved in Phase 106.
- **`contact_channel_identities` table:** Phase 108.
- **Identity invariant trigger (must have phone OR email OR channel):** Phase 109.
- **`verified` state, email link click verification, SMS reply-yes:** Phase 110.
- **Placeholder email rejection:** Phase 110.
- **CSV import dedup integration with new normalized columns:** Phase 110.
- **Removal of `contacts.source` column:** Phase 110.
- **libphonenumber / strict E.164 validation in DB:** rejected.
</user_constraints>

<phase_requirements>
## Phase Requirements

`REQUIREMENTS.md` does not exist for this workstream. IDs derived from ROADMAP.md success criteria for Phase 105.

| ID | Description | Research Support |
|----|-------------|------------------|
| CID-01 | Audit query produces report of duplicate clusters keyed by `(org_id, phone_e164)` and `(org_id, email_normalized)` with count + sample contact IDs per cluster | "Audit Table Schema" + "Refresh Function" sections below provide ready-to-use SQL. Index strategy in "Index Strategy" supports Phase 106 query pattern. |
| CID-02 | Migration adds `phone_e164` and `email_normalized` STORED generated columns to `contacts`, with deterministic `normalize_phone()` SQL function | "Generated Columns in Postgres" + "normalize_phone() Function" sections. Established pattern from `066_contact_imports.sql` confirms generated columns are supported. Equivalence proof provided vs TS impl in `src/lib/contacts/zod-schemas.ts:20-28`. |
| CID-03 | Migration adds `identity_status text NOT NULL DEFAULT 'identified' CHECK (...)` with per-row backfill (channel_only vs identified) | "identity_status Column" section provides exact DDL + backfill UPDATE. CHECK constraint pre-enumerates all 5 future values per D-03b. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Run `npm run build` after every change** — catches type errors before finishing. Mandatory post-migration step (types regen → build).
- **Never edit old migrations** — always add a new numbered file.
- **Multi-tenant RLS** — every new table has `ENABLE ROW LEVEL SECURITY` and `get_current_org_id()`-scoped policy.
- **Auth via cached helpers** — N/A for this phase (no app code).
- **Webhook handlers return 200** — N/A (no app code).
- **`src/types/database.ts` is the canonical type source** — must be regenerated after schema changes.

## Migration Numbering

Inventory of `supabase/migrations/` (highest numbers, sorted lexically — note the repo skipped from `046` to `1035`-style four-digit numbering at the start of v2.4):

```
1045_project_task_times.sql
1046_phone_number_per_number_settings.sql
1050_landing_config.sql
1051_create_task_create_note_action_type.sql
1052_phone_number_id_on_conversations_and_calls.sql
1053_traffic_module.sql
1054_campaign_utm.sql
1055_lock_get_tag_usage_search_path.sql
```

**Next migration number: `1056`.** Naming convention `<num>_<snake_case_description>.sql`. Recommended filename: **`1056_contact_identity_audit.sql`**.

> Source: `Glob supabase/migrations/*.sql` (full list captured; highest is `1055_lock_get_tag_usage_search_path.sql`).

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| PostgreSQL | 17 (per `supabase/config.toml:36`) | Database | Supabase managed PG. Supports STORED generated columns and IMMUTABLE SQL functions natively. |
| Supabase CLI | latest | `db push` for promoting migrations | Already standard per CLAUDE.md (`npx supabase db push`). |
| `mcp__supabase_mcp_xphere__*` | MCP tools | Branch creation, migration apply, type generation | Branching workflow per D-04. |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `mcp__supabase_mcp_xphere__create_branch` | Create isolated DB branch | Step 1 of D-04 flow |
| `mcp__supabase_mcp_xphere__apply_migration` | Apply migration to branch | Step 2 of D-04 flow |
| `mcp__supabase_mcp_xphere__execute_sql` | Run audit refresh, inspect results | Step 3 of D-04 flow |
| `mcp__supabase_mcp_xphere__merge_branch` | Promote branch to main | Step 4 of D-04 flow (after validation) |
| `mcp__supabase_mcp_xphere__generate_typescript_types` | Regen `src/types/database.ts` | After migration applied to main |
| `mcp__supabase_mcp_xphere__get_advisors` | Catch RLS / index linter warnings | After branch migration applied |
| `mcp__supabase_mcp_xphere__list_migrations` | Verify state on remote | Pre- and post-flight |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Branch workflow (D-04) | Direct `npx supabase db push` to prod | Direct push is faster but irreversible; D-04 mandates branch. |
| `CHECK` constraint on `identity_status` | Postgres `CREATE TYPE ... AS ENUM` | Repo uses BOTH (e.g. `public.contact_import_status` is an enum in `066`, but `traffic_setups.verification_state` is a CHECK constraint in `1053`). D-03b mandates CHECK to allow easy extension. |
| `mcp__supabase_mcp_xphere__generate_typescript_types` | Hand-edit `src/types/database.ts` | MCP tool is authoritative — hand-edit risks drift. Use MCP. |

**No `npm install` needed.** This phase touches only SQL + auto-generated TS types.

## Architecture Patterns

### Recommended Migration Structure

Single file, ordered sections:

```sql
-- 1056_contact_identity_audit.sql
-- Section 1: normalize_phone() — IMMUTABLE, must exist before generated column DDL
-- Section 2: ALTER contacts ADD COLUMN phone_e164 GENERATED ALWAYS AS (...) STORED
-- Section 3: ALTER contacts ADD COLUMN email_normalized GENERATED ALWAYS AS (...) STORED
-- Section 4: ALTER contacts ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'identified' CHECK (...)
-- Section 5: UPDATE contacts SET identity_status = 'channel_only' WHERE <D-03 predicate>
-- Section 6: CREATE TABLE contact_duplicate_audit + RLS + indexes
-- Section 7: CREATE FUNCTION refresh_contact_duplicate_audit() RETURNS void
-- Section 8: COMMENT ON ... documentation
```

### Pattern 1: STORED Generated Columns (already used in repo)

**Source:** `supabase/migrations/066_contact_imports.sql:88-93` — `progress_percent int GENERATED ALWAYS AS (...) STORED`.

```sql
ALTER TABLE public.contacts
  ADD COLUMN phone_e164 text
    GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;
```

**Requirements:**
- Function referenced **MUST** be `IMMUTABLE` (PG rejects `STABLE`/`VOLATILE` in generated column expressions).
- Function must exist before the `ALTER TABLE` runs (hence ordering in migration).
- Generated columns are evaluated on INSERT/UPDATE. Existing rows: PG rewrites the table when the column is added; values are computed for every row at that point. **No manual backfill needed for generated columns.**
- Cannot reference other generated columns or subqueries.
- Cannot be written to directly (INSERT/UPDATE must omit them).

### Pattern 2: IMMUTABLE SQL Function

```sql
CREATE OR REPLACE FUNCTION public.normalize_phone(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN input IS NULL THEN NULL
    WHEN btrim(input) = '' THEN NULL
    WHEN regexp_replace(input, '[^0-9]', '', 'g') = '' THEN NULL
    ELSE
      CASE WHEN left(btrim(input), 1) = '+' THEN '+' ELSE '' END
      || regexp_replace(input, '[^0-9]', '', 'g')
  END
$$;
```

**Why IMMUTABLE-safe:**
- `regexp_replace`, `btrim`, `left`, string concatenation, `CASE` are all IMMUTABLE in PG 17.
- No `now()`, `current_setting()`, sequence calls, or table reads.
- PG won't accept `IMMUTABLE` on the function declaration unless the body really is — if we missed a STABLE function, the DDL fails fast.

### Pattern 3: RLS Policy for New Tables

**Source (most recent table creation):** `supabase/migrations/1053_traffic_module.sql:23-35`.

```sql
ALTER TABLE public.contact_duplicate_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_duplicate_audit_select ON public.contact_duplicate_audit
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- Audit is written by the refresh function only (SECURITY DEFINER).
-- No INSERT/UPDATE/DELETE policies → only service role and SECURITY DEFINER funcs can mutate.
```

**Note:** The `(SELECT public.get_current_org_id())` form (with SELECT wrapper) is the established pattern — it lets PG cache the value per query. Used consistently from `051_contacts.sql:47-48` through `1053_traffic_module.sql:27`.

### Anti-Patterns to Avoid

- **Putting normalize_phone() in a CREATE TABLE column DDL without first creating the function** — PG parses top-to-bottom; function must exist first.
- **Using STABLE or VOLATILE on normalize_phone()** — PG will reject the `GENERATED ALWAYS AS` clause referencing it.
- **Adding UNIQUE indexes in this migration** — explicitly Phase 107.
- **Manual backfill of `phone_e164` / `email_normalized`** — generated STORED columns auto-populate on `ADD COLUMN`. Adding an UPDATE would error ("column is a generated column").
- **Wrapping ENUM around `identity_status`** — D-03b mandates CHECK. ENUMs require `ALTER TYPE ... ADD VALUE` (non-transactional pre-PG 12, awkward) to extend.
- **Forgetting `PARALLEL SAFE`** — without it, generated columns can't be evaluated in parallel scans. Cheap to add.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phone E.164 strict validation | Custom DB CHECK with libphonenumber port | App-layer Zod (`react-international-phone` in `src/components/ui/phone-input.tsx`) | D-02a explicitly rejected. Production phones already have inconsistent legacy data; rejecting at DB breaks ingestion. |
| Email RFC validation | Regex CHECK | App-layer Zod (`isValidEmail` in `zod-schemas.ts:36-40`) | Same reasoning. DB normalizes, app validates. |
| Duplicate detection algorithm | Loop in app code | `refresh_contact_duplicate_audit()` SQL function with `GROUP BY ... HAVING count(*) > 1` | One round-trip vs N. Postgres aggregation is the right tool. |
| Type generation | Hand-edit `database.ts` | `mcp__supabase_mcp_xphere__generate_typescript_types` | Authoritative from live schema; hand-edit drifts. |

**Key insight:** This phase is intentionally minimal — only DB infrastructure. Resist scope creep into Phase 106/107 territory (merge UI, UNIQUE constraints).

## Runtime State Inventory

Not applicable — this is an additive schema change, not a rename/refactor.

- **Stored data:** None — only ADDs columns; existing data untouched except for backfilled `identity_status` UPDATE.
- **Live service config:** None — no external service references `phone_e164`/`email_normalized`/`identity_status` yet (they don't exist).
- **OS-registered state:** None.
- **Secrets/env vars:** None.
- **Build artifacts:** `src/types/database.ts` will be regenerated by MCP tool — committed alongside migration.

## Common Pitfalls

### Pitfall 1: Generated column DDL fails because function isn't IMMUTABLE
**What goes wrong:** `ERROR: generation expression is not immutable`.
**Why:** PG resolves function volatility at DDL time. If `normalize_phone` is declared STABLE (or undeclared, which defaults to VOLATILE), PG rejects the `ALTER TABLE ... GENERATED ALWAYS AS` clause.
**How to avoid:** Declare `IMMUTABLE PARALLEL SAFE` explicitly. Verify on branch before promoting.
**Warning sign:** Migration parse error on Section 2 of the file.

### Pitfall 2: Backfill UPDATE attempts to write generated columns
**What goes wrong:** `ERROR: column "phone_e164" can only be updated to DEFAULT`.
**Why:** Generated STORED columns are auto-populated; explicit writes are forbidden.
**How to avoid:** The Section 5 backfill UPDATE in this migration touches only `identity_status`, NOT `phone_e164` or `email_normalized`. Generated columns populate automatically when added.
**Warning sign:** UPDATE statement in the migration that lists `phone_e164` or `email_normalized` in `SET`.

### Pitfall 3: `ALTER TABLE ADD COLUMN ... GENERATED STORED` rewrites whole table
**What goes wrong:** On large `contacts` tables, this can take minutes and hold an `ACCESS EXCLUSIVE` lock.
**Why:** Adding a STORED generated column requires computing the value for every existing row, which rewrites the heap.
**How to avoid:** Branch validation surfaces the duration. For production `contacts` (verify row count via `mcp__supabase_mcp_xphere__execute_sql` with `SELECT count(*) FROM contacts;` first), expect a brief lock. Run during low-traffic window. Document expected duration in the plan.
**Warning sign:** Branch migration takes > 30 seconds on a small dataset, projecting to minutes on prod.

### Pitfall 4: `identity_status` CHECK constraint backfill races with new INSERTs
**What goes wrong:** During the UPDATE backfill, an INSERT lands a row with `identity_status='identified'` (the DEFAULT) when it should be `channel_only`.
**Why:** The DEFAULT is `'identified'`; backfill UPDATE is a separate statement. New rows during the window get DEFAULT.
**How to avoid:** The backfill UPDATE runs in the same migration transaction as the column ADD — application connections briefly see the new column with DEFAULT before the UPDATE runs, but `ALTER TABLE` holds `ACCESS EXCLUSIVE` so no concurrent writes are possible. Safe by virtue of the lock. Document this explicitly.
**Warning sign:** Splitting migration into multiple transactions (e.g., concurrent index creation) would break this guarantee.

### Pitfall 5: Phone with only `+` survives normalization
**What goes wrong:** Input `"+"` → trimmed `"+"` → digits `""` → my function returns NULL (correct). But input `"+++"` → trimmed `"+++"` → starts with `+` → digits `""` → also NULL. Edge case verified safe.
**Why:** Documenting because the TS impl in `zod-schemas.ts:20-28` returns NULL when `digits` is empty (line 26), so SQL must match.
**How to avoid:** SQL function includes `WHEN regexp_replace(input, '[^0-9]', '', 'g') = '' THEN NULL` branch.

### Pitfall 6: Email with CRLF or whitespace inside the address
**What goes wrong:** Input `"  USER@DOMAIN.COM\r\n"` → `trim()` in PG removes surrounding whitespace but NOT internal CRLF. `lower(trim(email))` doesn't strip internal control chars.
**Why:** PG's `trim()` by default strips only leading/trailing whitespace (space, tab, newline, CR are in the default character set, actually — verify).
**Mitigation:** PG `trim()` default strips space, tab, newline, CR — confirmed safe for surrounding CRLF. For internal CRLF (rare, malformed): app-layer Zod (`isValidEmail`) rejects before insert. DB normalizes whatever lands. Acceptable per D-02b.
**Confidence:** MEDIUM — defer strict validation to app layer per D-02a/b.

### Pitfall 7: Historical garbage in `phone` produces huge normalized strings
**What goes wrong:** Free-text `phone` like "Call John at +1-555-0100 ext. 42 or his cell 555-0199" → digit extraction yields `+1555010042555 0199` (16 digits). Stored column has no length cap. Phase 107 UNIQUE index will treat these as distinct values from real phones.
**Why:** D-02 minimal normalization is intentional — DB doesn't validate, just normalizes.
**Mitigation in THIS phase:** Audit query (Section 7) surfaces oversized clusters. Phase 106 merge UI handles. Phase 107 UNIQUE only kicks in after Phase 106 cleanup.
**Detection:** Add to audit refresh function output an `unusual_normalized_value` flag (e.g., `length(normalized_value) > 20`) for Phase 106 inspection.

### Pitfall 8: `mcp__supabase_mcp_xphere__merge_branch` cost / availability
**What goes wrong:** Supabase branches incur compute cost; some plans don't include branching.
**Why:** Branching is a Pro+ feature; verify project tier before relying on it.
**How to avoid:** Pre-flight check via `mcp__supabase_mcp_xphere__list_branches`. If branching unavailable, fall back to: clone schema dump locally, apply via local `supabase db reset`, inspect, then `npx supabase db push` to prod with explicit user confirmation.
**Confidence:** MEDIUM — need to verify tier; planner should make `list_branches` the first action.

## Code Examples

### Complete migration body (1056_contact_identity_audit.sql)

```sql
-- =============================================================================
-- Migration 1056: Contact Identity Audit + Generated Columns (CID-01..03)
--
-- Phase 105 of v3.0 Contact Identity workstream. Adds normalization
-- infrastructure to contacts without UNIQUE constraints (those land in
-- Phase 107 after Phase 106 merge cleanup).
--
-- Scope:
--   * normalize_phone() — IMMUTABLE SQL function mirroring TS normalisePhone
--   * contacts.phone_e164      — STORED generated column
--   * contacts.email_normalized — STORED generated column
--   * contacts.identity_status — text + CHECK, per-row backfill
--   * contact_duplicate_audit  — persistent audit table
--   * refresh_contact_duplicate_audit() — re-runnable refresh
--
-- NOT in scope: UNIQUE indexes (Phase 107), merge UI (Phase 106),
-- channel identity table (Phase 108), invariant trigger (Phase 109).
-- =============================================================================

-- ----- Section 1: normalize_phone() ------------------------------------------
-- Mirrors src/lib/contacts/zod-schemas.ts:20-28 byte-for-byte:
--   trim → if startsWith('+') preserve plus → strip non-digits → if empty NULL
--   else return plus + digits.
-- IMMUTABLE so generated columns can reference it.

CREATE OR REPLACE FUNCTION public.normalize_phone(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN input IS NULL THEN NULL
    WHEN btrim(input) = '' THEN NULL
    WHEN regexp_replace(input, '[^0-9]', '', 'g') = '' THEN NULL
    ELSE
      CASE WHEN left(btrim(input), 1) = '+' THEN '+' ELSE '' END
      || regexp_replace(input, '[^0-9]', '', 'g')
  END
$$;

COMMENT ON FUNCTION public.normalize_phone(text) IS
  'Loose E.164 normalization: strip non-digits, preserve single leading +. '
  'Mirrors TS normalisePhone in src/lib/contacts/zod-schemas.ts. '
  'IMMUTABLE so it can power generated columns.';

-- ----- Section 2: phone_e164 generated column --------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_e164 text
    GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;

COMMENT ON COLUMN public.contacts.phone_e164 IS
  'STORED generated column: normalize_phone(phone). Used by Phase 107 UNIQUE index.';

-- ----- Section 3: email_normalized generated column --------------------------
-- D-02b: inline expression, no separate function. NULLIF '' yields NULL for
-- blank emails.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_normalized text
    GENERATED ALWAYS AS (NULLIF(lower(btrim(coalesce(email, ''))), '')) STORED;

COMMENT ON COLUMN public.contacts.email_normalized IS
  'STORED generated column: lower(trim(email)) with NULL for blanks. '
  'Used by Phase 107 UNIQUE index.';

-- ----- Section 4: identity_status column -------------------------------------
-- D-03b: CHECK enumerates all 5 future values to avoid re-altering in
-- Phases 106/109/110.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'identified'
    CHECK (identity_status IN (
      'channel_only',
      'identified',
      'verified',
      'merge_conflict',
      'archived_duplicate'
    ));

COMMENT ON COLUMN public.contacts.identity_status IS
  'Identity lifecycle: channel_only (Phase 105/109), identified (default), '
  'verified (Phase 110), merge_conflict (Phase 106), archived_duplicate (Phase 106).';

-- ----- Section 5: identity_status backfill (D-03) ----------------------------

UPDATE public.contacts
   SET identity_status = 'channel_only'
 WHERE phone IS NULL
   AND email IS NULL
   AND source IN ('instagram','whatsapp','facebook','messenger')
   AND external_id IS NOT NULL;

-- ----- Section 6: contact_duplicate_audit table ------------------------------

CREATE TABLE IF NOT EXISTS public.contact_duplicate_audit (
  cluster_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  match_type       text NOT NULL CHECK (match_type IN ('phone','email')),
  normalized_value text NOT NULL,
  contact_ids      uuid[] NOT NULL,
  cluster_size     int NOT NULL CHECK (cluster_size >= 2),
  detected_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes optimized for Phase 106 query patterns:
--   * Admin merge UI lists clusters per org, sorted by size DESC
--   * Filter by match_type when picking phone vs email cluster view
CREATE INDEX IF NOT EXISTS idx_cda_org_size
  ON public.contact_duplicate_audit (org_id, cluster_size DESC);
CREATE INDEX IF NOT EXISTS idx_cda_org_match_type
  ON public.contact_duplicate_audit (org_id, match_type);

ALTER TABLE public.contact_duplicate_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_duplicate_audit_select
  ON public.contact_duplicate_audit
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- No INSERT/UPDATE/DELETE policies: only service role and SECURITY DEFINER
-- functions can mutate. refresh_contact_duplicate_audit() handles writes.

COMMENT ON TABLE public.contact_duplicate_audit IS
  'Persistent duplicate cluster audit. Populated by refresh_contact_duplicate_audit(). '
  'Read by Phase 106 admin merge UI.';

-- ----- Section 7: refresh_contact_duplicate_audit() --------------------------

CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Truncate and rebuild. Audit is a materialized snapshot; not append-only.
  TRUNCATE public.contact_duplicate_audit;

  -- Phone duplicates
  INSERT INTO public.contact_duplicate_audit
    (org_id, match_type, normalized_value, contact_ids, cluster_size, detected_at)
  SELECT
    org_id,
    'phone',
    phone_e164,
    array_agg(id ORDER BY created_at),
    count(*)::int,
    now()
  FROM public.contacts
  WHERE phone_e164 IS NOT NULL
  GROUP BY org_id, phone_e164
  HAVING count(*) >= 2;

  -- Email duplicates
  INSERT INTO public.contact_duplicate_audit
    (org_id, match_type, normalized_value, contact_ids, cluster_size, detected_at)
  SELECT
    org_id,
    'email',
    email_normalized,
    array_agg(id ORDER BY created_at),
    count(*)::int,
    now()
  FROM public.contacts
  WHERE email_normalized IS NOT NULL
  GROUP BY org_id, email_normalized
  HAVING count(*) >= 2;
END;
$$;

COMMENT ON FUNCTION public.refresh_contact_duplicate_audit() IS
  'Rebuilds contact_duplicate_audit from current contacts state. '
  'Re-runnable; truncate-and-insert pattern. SECURITY DEFINER bypasses RLS.';

REVOKE ALL ON FUNCTION public.refresh_contact_duplicate_audit() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_contact_duplicate_audit() TO authenticated;
```

### TS ↔ SQL equivalence proof for normalize_phone

| Input | TS `normalisePhone` (zod-schemas.ts:20-28) | SQL `normalize_phone()` |
|-------|--------------------------------------------|--------------------------|
| `null` | `null` (line 21) | NULL (`input IS NULL`) |
| `undefined` | `null` (line 21) | n/a (SQL has no undefined) |
| `""` | `null` (line 23 — empty after trim) | NULL (`btrim(input) = ''`) |
| `"   "` | `null` (line 23) | NULL (`btrim(input) = ''`) |
| `"+1 (555) 010-0100"` | `"+15550100100"` | `'+' \|\| '15550100100'` = `"+15550100100"` |
| `"555-0100"` | `"5550100"` (no plus, line 24-27) | `'' \|\| '5550100'` = `"5550100"` |
| `"+"` | `null` (line 26 — digits empty) | NULL (`regexp_replace = ''` branch) |
| `"++1234"` | `"+1234"` (only first char checked for `+`) | `"+1234"` (`left(btrim(...), 1) = '+'`, digits = `1234`) |
| `"abc"` | `null` (digits empty) | NULL |
| `"  +44 20 7946 0958  "` | `"+442079460958"` | `"+442079460958"` |

**One edge case to flag:** TS `startsWith('+')` is checked AFTER `trim()`. SQL uses `left(btrim(input), 1)`. Both trim first → identical.

### Audit refresh + inspect (branch validation)

```sql
-- Run on branch after migration applied
SELECT public.refresh_contact_duplicate_audit();

-- Inspect
SELECT match_type, count(*) as cluster_count,
       sum(cluster_size) as total_dupe_rows,
       max(cluster_size) as largest_cluster
FROM public.contact_duplicate_audit
GROUP BY match_type;

-- Detect oversized normalized values (Pitfall 7)
SELECT * FROM public.contact_duplicate_audit
WHERE length(normalized_value) > 20
ORDER BY length(normalized_value) DESC
LIMIT 20;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-maintain normalized form via app code | STORED generated columns | PG 12+ (2019) | Bypass-proof; cannot drift from raw column. |
| Define enums via `CREATE TYPE AS ENUM` | CHECK constraints on text | Long-standing best practice | Extensible without `ALTER TYPE`. Repo uses both; D-03b mandates CHECK here. |
| Apply migrations directly via `db push` | Branch → validate → merge | Supabase branching GA | Catches DDL errors before they touch prod. |

**Deprecated/outdated:**
- N/A — all techniques used here are current best practice on PG 17.

## Open Questions

1. **Is Supabase branching available on this project's tier?**
   - What we know: D-04 mandates branch-first. MCP tool `create_branch` exists.
   - What's unclear: Plan tier / cost.
   - Recommendation: First action in plan is `mcp__supabase_mcp_xphere__list_branches`. If it errors with "feature unavailable," fall back to local validation (Pitfall 8 mitigation) and surface to user before continuing.

2. **Production row count of `contacts`.**
   - What we know: STORED generated column ADD rewrites the table.
   - What's unclear: How long the rewrite takes on prod.
   - Recommendation: Before applying to main, run `SELECT count(*) FROM contacts;` on prod (via `mcp__supabase_mcp_xphere__execute_sql`). If > 100k rows, schedule during low-traffic window and warn user.

3. **Does any current code path read `contacts.identity_status` already?**
   - What we know: Column doesn't exist yet.
   - What's unclear: Whether the regenerated TS type, once introduced, breaks any code that does `select('*')` and asserts a closed shape.
   - Recommendation: `npm run build` after type regen is the test. Plan must include this as gate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 17 | Migration target | ✓ | 17 (supabase/config.toml:36) | — |
| Supabase MCP server (`mcp__supabase_mcp_xphere__*`) | Branching workflow (D-04) + type generation | ✓ (configured per repo MCP setup) | — | `npx supabase db push` for migration; CLI `supabase gen types typescript --project-id ...` for types |
| `npm run build` | Type compatibility verification | ✓ (CLAUDE.md commands) | — | — |
| Supabase branching feature | D-04 branch validation | ⚠ Unknown — needs `list_branches` probe | — | Local supabase stack reset + manual inspection |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Branching may not be available on the project tier. Fallback documented in Pitfall 8.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (per package.json:120) |
| Config file | `vitest.config.*` (not yet verified — Wave 0 may need to confirm) |
| Quick run command | `npm run test` (= `vitest run`) |
| Full suite command | `npm run test && npm run build` |
| SQL validation command | `mcp__supabase_mcp_xphere__execute_sql` against branch |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CID-01 | Audit table populated by refresh function with correct cluster grouping | SQL integration (on branch) | `mcp__supabase_mcp_xphere__execute_sql` running `refresh_contact_duplicate_audit()` then `SELECT count(*), match_type FROM contact_duplicate_audit GROUP BY match_type;` and asserting count > 0 if seed data has duplicates | ❌ Wave 0 — new ad-hoc SQL test |
| CID-01 | Cluster includes correct `contact_ids` array | SQL integration | `SELECT cluster_id FROM contact_duplicate_audit WHERE array_length(contact_ids, 1) = cluster_size;` (must return all rows) | ❌ Wave 0 |
| CID-02 | `phone_e164` populates correctly via generated column | SQL integration | `INSERT INTO contacts (org_id, phone) VALUES ('<test-org>', '+1 (555) 010-0100') RETURNING phone_e164;` → assert `'+15550100100'` | ❌ Wave 0 |
| CID-02 | `email_normalized` populates correctly | SQL integration | `INSERT INTO contacts (org_id, email) VALUES ('<test-org>', '  USER@DOMAIN.COM  ') RETURNING email_normalized;` → assert `'user@domain.com'` | ❌ Wave 0 |
| CID-02 | `normalize_phone()` matches TS impl on full equivalence table | Unit (Vitest, optional) | New `tests/normalize-phone-equivalence.test.ts` — run TS impl in-process, run SQL via pg query against test db, compare across 20+ cases | ❌ Wave 0 (optional — branch SQL probe covers majority) |
| CID-03 | `identity_status` backfilled correctly | SQL integration | `SELECT identity_status, count(*) FROM contacts GROUP BY identity_status;` post-migration; assert `channel_only` count > 0 for orgs with Meta-only contacts | ❌ Wave 0 |
| CID-03 | CHECK constraint rejects invalid values | SQL integration | `INSERT INTO contacts (..., identity_status) VALUES (..., 'nonsense');` → expect 23514 check_violation | ❌ Wave 0 |
| (gate) | `npm run build` exits 0 after types regen | Build | `npm run build` | ✓ Existing |
| (gate) | RLS policies unchanged on `contacts` | SQL inspection | `SELECT polname FROM pg_policies WHERE schemaname='public' AND tablename='contacts';` — diff vs pre-migration snapshot | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run build` (type check). SQL changes: run the relevant `execute_sql` probe on branch.
- **Per wave merge:** `npm run test && npm run build`.
- **Phase gate:** Full suite green + branch validation report attached + `mcp__supabase_mcp_xphere__get_advisors` clean before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/normalize-phone-equivalence.test.ts` — optional Vitest test cross-checking TS vs SQL normalize_phone (if pg test harness exists; otherwise rely on branch SQL probes)
- [ ] Standardized branch validation SQL script — capture as `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/validate.sql` for re-use in Phase 106+
- [ ] Snapshot of pre-migration `pg_policies` for `contacts` — to diff post-migration (RLS-unchanged assertion)

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/051_contacts.sql` — current `contacts` schema (verified columns, source CHECK values, RLS pattern)
- `supabase/migrations/066_contact_imports.sql:88-93` — existing STORED generated column precedent in repo
- `supabase/migrations/1053_traffic_module.sql:23-35` — most recent table creation pattern (RLS + indexes)
- `supabase/config.toml:36` — Postgres major_version = 17
- `src/lib/contacts/zod-schemas.ts:20-34` — TS normalization to mirror in SQL
- `src/types/database.ts:1620-1639` — current `ContactRow` type that needs regen
- `package.json` — Vitest 4.1.2; no `gen:types` script (confirms MCP path)
- `CLAUDE.md` — repo conventions (RLS, `npm run build`, never edit old migrations)
- `.planning/config.json` — `workflow.nyquist_validation = true` confirmed

### Secondary (MEDIUM confidence)
- Postgres docs: `IMMUTABLE` requirement for generated columns (PG 12+ behavior; verified against PG 17 syntax used in `066`)
- Supabase branching MCP tool availability — assumed configured; `list_branches` probe needed to confirm tier

### Tertiary (LOW confidence)
- Exact behavior of PG `btrim()` default character set for CRLF — Pitfall 6 acknowledges this as a defer-to-app-layer concern per D-02b.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — PG 17 + STORED generated columns proven by `066_contact_imports.sql` precedent
- Architecture (RLS, CHECK constraint, audit table): HIGH — matches `1053_traffic_module.sql` recent pattern
- normalize_phone equivalence: HIGH — TS source read at lines 20-28; SQL function written to match line-by-line
- Branching workflow: MEDIUM — MCP tools exist; tier availability needs runtime probe
- Pitfalls (especially table-rewrite duration): MEDIUM — depends on prod row count, surfaced as Open Question 2

**Research date:** 2026-05-25
**Valid until:** 2026-06-24 (30 days — stable schema patterns; Supabase MCP tool surface evolves slowly)
