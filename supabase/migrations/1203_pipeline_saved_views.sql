-- Migration 1203: pipeline_saved_views — personal saved filter views for the Pipeline module.

CREATE TABLE IF NOT EXISTS public.pipeline_saved_views (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id  uuid        REFERENCES public.pipelines(id) ON DELETE CASCADE,
  owner_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  filters      jsonb       NOT NULL DEFAULT '{}',
  sorting      jsonb       NOT NULL DEFAULT '{}',
  is_default   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_saved_views_owner
  ON public.pipeline_saved_views (org_id, owner_id, pipeline_id);

ALTER TABLE public.pipeline_saved_views ENABLE ROW LEVEL SECURITY;

-- Personal views: each user owns their own saved views.
DROP POLICY IF EXISTS pipeline_saved_views_owner ON public.pipeline_saved_views;
CREATE POLICY pipeline_saved_views_owner ON public.pipeline_saved_views
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_pipeline_saved_views_updated_at ON public.pipeline_saved_views;
CREATE TRIGGER trg_pipeline_saved_views_updated_at
  BEFORE UPDATE ON public.pipeline_saved_views
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
