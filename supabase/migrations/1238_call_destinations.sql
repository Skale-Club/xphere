-- Migration 1238: Call destinations registry (v3.5 phase 3)
-- A destination is "somewhere a call can be delivered", referenced by routing
-- chain targets instead of raw numbers typed into config:
--   * personal — belongs to one member; endpoints resolve from their
--     call_settings (Voice SDK identity + phone_forward) at dial time.
--   * shared   — a named org-level number ("Reception", "Store cell") that
--     several people may answer; the number lives on the destination itself.
CREATE TABLE IF NOT EXISTS public.call_destinations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('personal', 'shared')),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  number      text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'personal' AND user_id IS NOT NULL)
    OR (kind = 'shared' AND number IS NOT NULL)
  )
);

-- One personal destination per member per org.
CREATE UNIQUE INDEX IF NOT EXISTS call_destinations_personal_unique
  ON public.call_destinations (org_id, user_id)
  WHERE kind = 'personal';

CREATE INDEX IF NOT EXISTS call_destinations_org_idx
  ON public.call_destinations (org_id);

ALTER TABLE public.call_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_destinations_org ON public.call_destinations;
CREATE POLICY call_destinations_org
  ON public.call_destinations
  FOR ALL
  USING (org_id = (SELECT get_current_org_id()))
  WITH CHECK (org_id = (SELECT get_current_org_id()));

DROP TRIGGER IF EXISTS call_destinations_updated_at ON public.call_destinations;
CREATE TRIGGER call_destinations_updated_at
  BEFORE UPDATE ON public.call_destinations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
