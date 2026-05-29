-- =============================================================================
-- Migration 1108: Template Organizations
--
-- Lets an operator promote a real, already-configured organization into a
-- reusable industry template, then spin up new organizations from it.
--
-- CORE PRINCIPLE: a template captures STRUCTURE, never live data. The snapshot
-- stored here only ever contains pipelines/stages, custom field definitions,
-- tags, message (email) templates, and workflow definitions. It NEVER contains
-- contacts, conversations, bookings, logs, credentials, phone numbers, or any
-- connected-account data. The capture path (src/lib/org-templates/snapshot.ts)
-- reads through the RLS-scoped client, so it physically cannot reach another
-- tenant's rows.
--
-- Two tables:
--   * org_templates         — a captured template owned by the org that made it
--   * org_template_installs — audit trail of "create org from template" runs
--
-- Multi-tenant: owner_org_id on every row, RLS via get_current_org_id().
-- Idempotent: safe to re-run.
-- =============================================================================

-- ─── org_templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The org the template was captured from. Usually equal to owner_org_id.
  -- Nulled (not deleted) if that source org is later removed.
  source_org_id uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  name          text        NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 120),
  industry      text,
  description   text,
  status        text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','active','archived')),
  -- Which asset groups the snapshot includes / an install should copy.
  asset_groups  text[]      NOT NULL DEFAULT '{}',
  -- Captured structural payload. Structure only — see header. Shape is defined
  -- in src/lib/org-templates/types.ts (OrgTemplateSnapshot).
  snapshot      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  snapshot_at   timestamptz,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_templates_owner
  ON public.org_templates (owner_org_id, status);

ALTER TABLE public.org_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_templates_org_isolation ON public.org_templates;
CREATE POLICY org_templates_org_isolation ON public.org_templates
  FOR ALL
  USING      (owner_org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (owner_org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_org_templates_set_updated_at ON public.org_templates;
CREATE TRIGGER trg_org_templates_set_updated_at
  BEFORE UPDATE ON public.org_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ─── org_template_installs ───────────────────────────────────────────────────
-- One row per "create organization from template" run. Kept for audit/history
-- even if the template or the produced org is later deleted, hence the soft
-- references and the denormalized target_org_name.
CREATE TABLE IF NOT EXISTS public.org_template_installs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owning org that ran the install (the template's owner). Drives RLS.
  owner_org_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id     uuid        REFERENCES public.org_templates(id) ON DELETE SET NULL,
  template_name   text,
  target_org_id   uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  target_org_name text,
  asset_groups    text[]      NOT NULL DEFAULT '{}',
  -- { counts: { pipelines, stages, custom_fields, tags, message_templates,
  --   workflows }, checklist: [{ id, label, done }] }
  summary         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  installed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  installed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_template_installs_owner
  ON public.org_template_installs (owner_org_id, installed_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_template_installs_template
  ON public.org_template_installs (template_id);

ALTER TABLE public.org_template_installs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_template_installs_org_isolation ON public.org_template_installs;
CREATE POLICY org_template_installs_org_isolation ON public.org_template_installs
  FOR ALL
  USING      (owner_org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (owner_org_id = (SELECT public.get_current_org_id()));
