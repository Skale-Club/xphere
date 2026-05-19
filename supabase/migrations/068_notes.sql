-- =============================================================================
-- Migration 068: Notes Table + RLS
-- (v2.5 Tasks & Notes CRM System / Phase 76 DB-FOUNDATION)
--
-- Creates the notes table. Reuses crm_entity_type ENUM introduced in 067.
-- notes.title is nullable (content is the required field).
-- notes.pinned is boolean, defaults to false.
--
-- Idempotent: safe to re-run. Pure Postgres, no Vercel-specific constructs.
--
-- Addresses: NOT-01 (partial — schema only), NOT-08, NOT-11
-- =============================================================================

-- NOTE: crm_entity_type ENUM is defined in migration 067. Do not redefine here.

-- ----- Table: public.notes ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title         text,
  content       text        NOT NULL,
  pinned        boolean     NOT NULL DEFAULT false,
  entity_type   public.crm_entity_type,
  entity_id     uuid,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ----- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_notes_org_pinned_created
  ON public.notes (org_id, pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_org_created
  ON public.notes (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_entity
  ON public.notes (entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

-- Full-text search index for title + content (supports ilike search in NOT-06)
CREATE INDEX IF NOT EXISTS idx_notes_org_content_search
  ON public.notes USING gin(to_tsvector('simple', coalesce(title, '') || ' ' || content));

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_org_isolation ON public.notes;
CREATE POLICY notes_org_isolation ON public.notes
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_notes_set_updated_at ON public.notes;
CREATE TRIGGER trg_notes_set_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ----- Footer ---------------------------------------------------------------
-- NOTE: No FK constraint on entity_id — polymorphic reference across
-- contacts/accounts/opportunities. Application-layer validation enforces
-- referential integrity (same pattern as tasks in 067).
--
-- NOTE: notes.title is intentionally nullable. NOT-01 specifies title as
-- optional; the notes UI falls back to first line of content for display.
