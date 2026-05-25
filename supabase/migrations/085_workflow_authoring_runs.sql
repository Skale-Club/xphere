CREATE TABLE public.workflow_authoring_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id TEXT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('created', 'edited', 'validation_failed', 'error')),
  workflow_id   UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  validation_error_count INT NOT NULL DEFAULT 0,
  error_types   TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_authoring_runs_org ON public.workflow_authoring_runs(org_id, created_at DESC);
CREATE INDEX idx_workflow_authoring_runs_conversation ON public.workflow_authoring_runs(conversation_id) WHERE conversation_id IS NOT NULL;

ALTER TABLE public.workflow_authoring_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wf_authoring_runs_select" ON public.workflow_authoring_runs
  FOR SELECT USING (org_id = get_current_org_id());
