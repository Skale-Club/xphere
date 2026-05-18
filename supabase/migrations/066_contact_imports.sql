-- =============================================================================
-- Migration 066: Contact Imports — Import Pipeline Database Layer
-- (SEED-018 / v2.4 CRM Expansion / Phase 73 IMPORT-SCHEMA-WORKER)
--
-- Introduces the durable job table (contact_imports), per-row error table
-- (contact_import_errors), Realtime publication entry for live progress
-- updates, and a pg_cron cleanup job — all the server-side primitives
-- that Phase 74 (upload action) and Phase 75 (worker + history UI) build upon.
--
-- Addresses: IMP-18 (scheduled cleanup cron), IMP-19 (RLS org isolation).
--
-- Idempotent: safe to re-run — guards on pg_type, CREATE TABLE IF NOT EXISTS,
-- DROP POLICY IF EXISTS, CREATE INDEX IF NOT EXISTS, pg_publication_tables,
-- and cron.schedule (upserts by job name).
--
-- Hetzner-portable: pure Postgres + pg_cron. No Vercel-specific constructs.
-- pg_cron is supported on self-hosted Postgres. Supabase Storage is the only
-- non-portable element; the migration documents the manual bucket setup below.
-- =============================================================================

-- =============================================================================
-- Section 2 — ENUM: contact_import_status (9 values, order matters)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_import_status') THEN
    CREATE TYPE public.contact_import_status AS ENUM (
      'uploading',
      'parsing',
      'previewing',
      'queued',
      'processing',
      'completed',
      'partial',
      'failed',
      'cancelled'
    );
  END IF;
END $$;

-- =============================================================================
-- Section 3 — ENUM: contact_import_dedup_strategy (3 values)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_import_dedup_strategy') THEN
    CREATE TYPE public.contact_import_dedup_strategy AS ENUM (
      'skip_existing',
      'update_existing',
      'create_duplicate'
    );
  END IF;
END $$;

-- =============================================================================
-- Section 4 — Table: public.contact_imports
-- =============================================================================
-- Durable job record for a single CSV import operation. Each row tracks the
-- entire lifecycle from file upload through parsing, preview, queued, processing,
-- and final status. progress_percent is a GENERATED ALWAYS AS STORED column —
-- it is computed from (processed_rows * 100 / total_rows) capped at 100, and
-- cannot be written directly (INSERT/UPDATE must omit it).

CREATE TABLE IF NOT EXISTS public.contact_imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  storage_path        text NOT NULL,
  filename            text NOT NULL,
  size_bytes          bigint NOT NULL,
  mime_type           text,
  status              public.contact_import_status NOT NULL DEFAULT 'uploading',
  status_message      text,
  error_summary       text,
  mapping             jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_strategy      public.contact_import_dedup_strategy NOT NULL DEFAULT 'skip_existing',
  dedup_keys          text[] DEFAULT ARRAY['phone','email'],
  default_tags        text[],
  default_source      text DEFAULT 'csv_import',
  default_assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_rows          int DEFAULT 0,
  processed_rows      int DEFAULT 0,
  inserted_rows       int DEFAULT 0,
  updated_rows        int DEFAULT 0,
  skipped_rows        int DEFAULT 0,
  error_rows          int DEFAULT 0,
  progress_percent    int GENERATED ALWAYS AS (
                        CASE WHEN total_rows > 0
                          THEN LEAST(100, (processed_rows * 100 / total_rows))
                          ELSE 0
                        END
                      ) STORED,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Section 5 — Table: public.contact_import_errors
-- =============================================================================
-- Append-only per-row error log for a contact_imports job. Each row captures
-- the original CSV row number, the raw row data (as jsonb), the offending
-- field, and a human-readable message. Errors are fetched on-demand by the
-- UI; they are intentionally NOT streamed via Realtime (see Section 10).
--
-- ON DELETE CASCADE: when a contact_imports row is deleted (e.g., by the
-- pg_cron cleanup job), all associated errors are automatically removed.
-- contact_import_errors has no updated_at column — errors are append-only.

CREATE TABLE IF NOT EXISTS public.contact_import_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   uuid NOT NULL REFERENCES public.contact_imports(id) ON DELETE CASCADE,
  row_number  int NOT NULL,
  raw_row     jsonb NOT NULL,
  field       text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Section 6 — Indexes
-- =============================================================================

-- Compound index for the most common query: "list my org's imports, filtered
-- by status, newest first". org_id first (most selective for multi-org DB),
-- status second (filter), created_at DESC third (sort).
CREATE INDEX IF NOT EXISTS idx_contact_imports_org_status_created
  ON public.contact_imports (org_id, status, created_at DESC);

-- Covering index for fetching all errors for a given import, ordered by row
-- number (the natural order for error display in the UI preview table).
CREATE INDEX IF NOT EXISTS idx_contact_import_errors_import_row
  ON public.contact_import_errors (import_id, row_number);

-- =============================================================================
-- Section 7 — RLS on contact_imports (IMP-19)
-- =============================================================================
-- Canonical org-isolation pattern: SECURITY DEFINER helper get_current_org_id()
-- resolves the active org from user_active_org + vo_active_org cookie. All
-- authenticated queries automatically target only the active org's rows.

ALTER TABLE public.contact_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_imports_org_isolation ON public.contact_imports;
CREATE POLICY contact_imports_org_isolation ON public.contact_imports
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- =============================================================================
-- Section 8 — RLS on contact_import_errors (IMP-19)
-- =============================================================================
-- contact_import_errors has no org_id column — org isolation is enforced via
-- an EXISTS subquery through import_id → contact_imports.org_id. This ensures
-- org B cannot read org A's import errors even by guessing UUIDs.

ALTER TABLE public.contact_import_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_import_errors_org_isolation ON public.contact_import_errors;
CREATE POLICY contact_import_errors_org_isolation ON public.contact_import_errors
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.contact_imports ci
      WHERE ci.id = contact_import_errors.import_id
        AND ci.org_id = (SELECT public.get_current_org_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contact_imports ci
      WHERE ci.id = contact_import_errors.import_id
        AND ci.org_id = (SELECT public.get_current_org_id())
    )
  );

-- =============================================================================
-- Section 9 — updated_at trigger on contact_imports
-- =============================================================================
-- contact_import_errors has no updated_at column (append-only) — trigger
-- is only needed on contact_imports.

DROP TRIGGER IF EXISTS trg_contact_imports_set_updated_at ON public.contact_imports;
CREATE TRIGGER trg_contact_imports_set_updated_at
  BEFORE UPDATE ON public.contact_imports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =============================================================================
-- Section 10 — Realtime publication
-- =============================================================================
-- Publish contact_imports to supabase_realtime so clients can subscribe to
-- postgres_changes events filtered by org_id. Clients subscribe via:
--   supabase.channel('imports').on('postgres_changes',
--     { event: '*', schema: 'public', table: 'contact_imports', filter: 'org_id=eq.{orgId}' },
--     handler)
--   .subscribe()
-- contact_import_errors is intentionally NOT published (errors are fetched on-demand).
--
-- Guard: ALTER PUBLICATION ... ADD TABLE is NOT idempotent in Postgres — adding
-- a table already in the publication raises an error. The DO block below makes
-- this section safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'contact_imports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_imports;
  END IF;
END $$;

-- =============================================================================
-- Section 11 — pg_cron cleanup job (IMP-18)
-- =============================================================================
-- IMP-18: Scheduled cleanup — delete contact_imports rows older than 30 days.
-- pg_cron runs on the Supabase database server and is Hetzner-portable (pg_cron
-- works on self-hosted Postgres too).
--
-- Storage object cleanup (corresponding objects in the 'contact-imports' bucket)
-- is best-effort and handled by the cleanup Edge Function in Phase 75. When a
-- contact_imports row is deleted here, the orphaned Storage object is reaped on
-- the next Edge Function invocation. This is acceptable because Storage objects
-- from 30-day-old imports carry no compliance risk.
--
-- Idempotent: cron.schedule() in pg_cron upserts by job name.
-- ON DELETE CASCADE from contact_imports → contact_import_errors ensures all
-- associated error rows are removed in the same transaction.
--
-- If pg_cron is not available on this Postgres instance, the DO block below
-- raises a NOTICE and skips gracefully (no error). Check pg_extension for
-- availability before relying on this in production.

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-stale-imports',       -- job name (unique, upserted)
      '0 3 * * *',                   -- daily at 03:00 UTC
      $cron$
        DELETE FROM public.contact_imports
        WHERE created_at < now() - INTERVAL '30 days';
      $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension not available — cleanup-stale-imports job NOT scheduled. Install pg_cron or schedule cleanup via an external cron + Edge Function.';
  END IF;
END $outer$;

-- =============================================================================
-- Section 12 — Storage bucket setup note (MANUAL STEP REQUIRED)
-- =============================================================================
-- =============================================================================
-- MANUAL STEP REQUIRED: Create the 'contact-imports' Storage bucket
-- =============================================================================
-- This migration does not create the Storage bucket — Storage is managed outside
-- Postgres. After running db push, execute ONE of the following:
--
-- Option A — Supabase CLI (recommended):
--   npx supabase@2.99.0 storage create contact-imports --no-public
--
-- Option B — Dashboard:
--   Supabase Dashboard → Storage → New bucket
--   Name: contact-imports
--   Public: OFF (private — signed URLs only)
--
-- Path policy (per-org isolation, IMP-19):
--   Storage RLS policy: authenticated users may only access paths that start
--   with their org_id. Apply via Supabase Dashboard → Storage → contact-imports
--   → Policies, or via supabase/seed.ts using the service-role client:
--
--   Bucket policy name: contact_imports_org_path_isolation
--   Expression (INSERT/SELECT/UPDATE/DELETE):
--     (storage.foldername(name))[1] = (SELECT public.get_current_org_id()::text)
--
--   Canonical path pattern enforced by Phase 74 upload action:
--     contact-imports/{org_id}/{import_id}/{filename}
--
-- The bucket and policy are documented here so they are not missed during
-- environment provisioning. The SUMMARY for this plan must record whether the
-- bucket was created and the policy applied.
-- =============================================================================

-- =============================================================================
-- Section 13 — Footer notes
-- =============================================================================
-- NOTE: No GIN index on mapping jsonb in v1 — deferred until query patterns
-- are known in production. A future migration can add:
--   CREATE INDEX idx_contact_imports_mapping ON public.contact_imports USING gin(mapping);
-- once jsonb path queries appear in the application.
--
-- NOTE: contact_import_errors has no updated_at column because errors are
-- append-only. If an error message needs correcting, the row should be
-- replaced (delete + insert) rather than updated. This avoids the overhead
-- of an updated_at trigger on a high-volume append-only table.
--
-- NOTE: progress_percent is GENERATED ALWAYS AS STORED. It recomputes
-- automatically on every UPDATE to processed_rows or total_rows. Writers
-- must NEVER include progress_percent in INSERT or UPDATE payloads — Postgres
-- will reject such writes with "column progress_percent can only be updated
-- to DEFAULT". Phase 74 server actions and Phase 75 worker are responsible
-- for enforcing this.
--
-- Hetzner portability: this migration uses only standard Postgres features
-- plus pg_cron (which is installable on self-hosted Postgres). Supabase
-- Storage is the only non-portable element; it can be swapped for S3/MinIO/R2
-- by replacing SupabaseImportStorage (Phase 73-02) with storage-node.ts
-- without changing any schema or application logic.
