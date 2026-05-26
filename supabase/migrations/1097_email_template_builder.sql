-- ─── migration 1097: email template builder (block-based editor) ─────────────
-- Adds block-based document columns to existing email_templates table
-- and creates the reusable_email_blocks table.

-- ── Extend email_templates ────────────────────────────────────────────────────

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS description      text,
  ADD COLUMN IF NOT EXISTS document         jsonb    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS html_snapshot    text,
  ADD COLUMN IF NOT EXISTS plain_text_snapshot text,
  ADD COLUMN IF NOT EXISTS created_by       uuid     REFERENCES auth.users(id);

-- ── reusable_email_blocks ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reusable_email_blocks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  block_type  text        NOT NULL, -- 'header' | 'footer' | 'cta' | 'logo' | 'social' | 'legal'
  document    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reusable_email_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members" ON public.reusable_email_blocks
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS idx_reusable_email_blocks_org_id
  ON public.reusable_email_blocks (org_id);

CREATE TRIGGER trg_reusable_email_blocks_updated_at
  BEFORE UPDATE ON public.reusable_email_blocks
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
