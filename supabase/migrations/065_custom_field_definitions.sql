-- =============================================================================
-- Migration 065: Custom Field Definitions — Metadata Layer over jsonb
-- (SEED-017 / v2.4 CRM Expansion / Phase 68 CUSTOMFIELDS-SCHEMA)
--
-- Introduces the structured metadata layer for the existing custom_fields jsonb
-- columns on contacts (051), opportunities (056), and accounts (064). One row
-- per (org, entity, key) describes the field's type, validation, ordering,
-- visibility, archive state, etc. Storage stays as jsonb on the entity tables.
--
-- Idempotent: safe to re-run. Hetzner-portable: pure Postgres, no Vercel-
-- specific constructs.
--
-- Addresses: CF-11 (reserved-key validation at the schema layer),
--            CF-14 (cross-org RLS isolation).
-- =============================================================================

-- ----- custom_field_type ENUM (13 values, order matters) ---------------------
-- Postgres lacks CREATE TYPE IF NOT EXISTS; guard via pg_type lookup (canonical
-- pattern from 034_agents.sql).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_field_type') THEN
    CREATE TYPE public.custom_field_type AS ENUM (
      'text',
      'long_text',
      'number',
      'integer',
      'boolean',
      'date',
      'datetime',
      'select',
      'multi_select',
      'url',
      'email',
      'phone',
      'currency'
    );
  END IF;
END $$;

-- ----- custom_field_entity ENUM (3 values, pipelines/stages intentionally absent)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_field_entity') THEN
    CREATE TYPE public.custom_field_entity AS ENUM (
      'contact',
      'opportunity',
      'account'
    );
  END IF;
END $$;

-- ----- Table: public.custom_field_definitions --------------------------------
-- 21 columns matching SEED-017 §Schema exactly. Two CHECK constraints (key
-- format + key-not-reserved) are declared in separate DO blocks below so they
-- can be probed by name in tests and stay idempotent on re-run.

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity          public.custom_field_entity NOT NULL,
  key             text NOT NULL,
  label           text NOT NULL,
  type            public.custom_field_type NOT NULL,
  required        boolean NOT NULL DEFAULT false,
  unique_per_org  boolean NOT NULL DEFAULT false,
  position        int NOT NULL DEFAULT 0,
  group_name      text,
  help_text       text,
  default_value   jsonb,
  options         jsonb,
  validation      jsonb,
  visible_in_list boolean NOT NULL DEFAULT false,
  filterable      boolean NOT NULL DEFAULT false,
  archived        boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_field_definitions_org_entity_key_unique UNIQUE (org_id, entity, key)
);

-- ----- CHECK: key format (slug regex) ----------------------------------------
-- Lowercase slug starting with letter, only [a-z0-9_], max 63 chars total.
-- Postgres lacks ADD CONSTRAINT IF NOT EXISTS; guard via pg_constraint (same
-- pattern as opp_has_contact_or_account in 064_accounts.sql).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'custom_field_definitions_key_format'
      AND conrelid = 'public.custom_field_definitions'::regclass
  ) THEN
    ALTER TABLE public.custom_field_definitions
      ADD CONSTRAINT custom_field_definitions_key_format
      CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$');
  END IF;
END $$;

-- ----- CHECK: key is not reserved (per-entity) -------------------------------
-- CF-11 schema-layer enforcement. Universal-reserved set checked once before
-- the CASE; per-entity native-column sets checked inside the CASE. Reserved
-- sets are the exact values locked in Phase 68 plan; DO NOT alter without a
-- companion migration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'custom_field_definitions_key_not_reserved'
      AND conrelid = 'public.custom_field_definitions'::regclass
  ) THEN
    ALTER TABLE public.custom_field_definitions
      ADD CONSTRAINT custom_field_definitions_key_not_reserved
      CHECK (
        key NOT IN ('id','org_id','created_at','updated_at','created_by')
        AND CASE entity
          WHEN 'contact'     THEN key NOT IN (
            'name','phone','email','company','notes','tags',
            'custom_fields','source','external_id','account_id'
          )
          WHEN 'opportunity' THEN key NOT IN (
            'contact_id','pipeline_id','stage_id','title','value','currency',
            'status','expected_close_date','assigned_to','position',
            'custom_fields','account_id'
          )
          WHEN 'account'     THEN key NOT IN (
            'name','domain','website','industry','size','phone','address',
            'notes','tags','custom_fields','source','external_id','assigned_to'
          )
        END
      );
  END IF;
END $$;

-- ----- Partial indexes -------------------------------------------------------
-- SEED-017 §Indexes. Both indexes are scoped to active (non-archived)
-- definitions because archived rows are never rendered in the UI.

CREATE INDEX IF NOT EXISTS idx_cfd_org_entity_position
  ON public.custom_field_definitions (org_id, entity, position)
  WHERE archived = false;

CREATE INDEX IF NOT EXISTS idx_cfd_org_entity_filterable
  ON public.custom_field_definitions (org_id, entity)
  WHERE filterable = true AND archived = false;

-- ----- RLS -------------------------------------------------------------------
-- Canonical pattern, identical to contacts/accounts: org isolation via the
-- SECURITY DEFINER helper public.get_current_org_id().

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_field_definitions_org_isolation ON public.custom_field_definitions;
CREATE POLICY custom_field_definitions_org_isolation ON public.custom_field_definitions
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_cfd_set_updated_at ON public.custom_field_definitions;
CREATE TRIGGER trg_cfd_set_updated_at
  BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ----- Footer ---------------------------------------------------------------
-- NOTE: No GIN index on `<entity>.custom_fields jsonb` is added by this
-- migration. SEED-017 §"Decisions to make" #1 defers that decision; a separate
-- migration can land it once query patterns are observed in production.
--
-- NOTE: pipelines and stages are intentionally absent from custom_field_entity.
-- SEED-017 §"Reserved for future milestones" explicitly defers per-pipeline
-- custom fields; a future migration can extend the ENUM if/when needed (ENUM
-- values can be added without rewriting existing data).
--
-- NOTE: contacts.custom_fields / opportunities.custom_fields /
-- accounts.custom_fields jsonb columns are NOT redefined here. They were
-- introduced in 051 / 056 / 064 respectively and the Phase 69 validator
-- writes against them directly using the definitions in this table.
--
-- Hetzner portability: this migration uses only standard Postgres features
-- (no Vercel KV, no Vercel Blob, no Edge Runtime). It carries forward
-- unchanged to a self-hosted Postgres on Hetzner.
