-- ─── migration 1248: email signatures (block-based HTML signature library) ────
-- A per-org library of named HTML email signatures, built with the same
-- block document shape as email_templates (jsonb `document` → compiled
-- `html_snapshot`). Used both internally (auto-appended to agent email
-- replies) and externally (copy/paste into Gmail/Outlook).
--
-- Ownership is per-org (a shared library of named signatures), mirroring the
-- existing per-org sender identity in tenant_email_integrations. At most one
-- signature per org may be flagged `is_default` (the one auto-appended to
-- outbound replies) — enforced by a partial unique index.

CREATE TABLE IF NOT EXISTS public.email_signatures (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  document            jsonb       NOT NULL DEFAULT '{}', -- EmailDocument block tree
  html_snapshot       text,                              -- compiled inline-CSS fragment
  plain_text_snapshot text,
  is_default          boolean     NOT NULL DEFAULT false,
  created_by          uuid        REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_email_signatures" ON public.email_signatures
  USING  (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- At most one default signature per org.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_signatures_one_default
  ON public.email_signatures (org_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_email_signatures_org_updated
  ON public.email_signatures (org_id, updated_at DESC);

CREATE TRIGGER trg_email_signatures_updated_at
  BEFORE UPDATE ON public.email_signatures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
