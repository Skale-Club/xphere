-- Persist product-tour completion per authenticated user so onboarding state
-- survives browser/device/domain changes. Existing users are backfilled as
-- completed: only accounts created after this migration should see dashboard-v1.

CREATE TABLE IF NOT EXISTS public.user_tour_progress (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key     TEXT        NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_key)
);

ALTER TABLE public.user_tour_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_tour_progress_select_own" ON public.user_tour_progress;
CREATE POLICY "user_tour_progress_select_own"
  ON public.user_tour_progress
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_tour_progress_insert_own" ON public.user_tour_progress;
CREATE POLICY "user_tour_progress_insert_own"
  ON public.user_tour_progress
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "user_tour_progress_update_own" ON public.user_tour_progress;
CREATE POLICY "user_tour_progress_update_own"
  ON public.user_tour_progress
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.user_tour_progress TO authenticated;

INSERT INTO public.user_tour_progress (user_id, tour_key)
SELECT id, 'dashboard-v1'
FROM auth.users
ON CONFLICT (user_id, tour_key) DO NOTHING;
