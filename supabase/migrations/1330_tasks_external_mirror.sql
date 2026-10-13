-- Stable task identity for sibling-app mirrors (Xpot and future sources).
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_org_external_identity
  ON public.tasks (org_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
