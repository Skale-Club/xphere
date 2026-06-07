-- Migration 1143: rename scheduling_profiles → calendar_profiles
-- Full rename: table, indexes, RLS policy, trigger.

ALTER TABLE public.scheduling_profiles RENAME TO calendar_profiles;

ALTER INDEX IF EXISTS idx_scheduling_profiles_org_id RENAME TO idx_calendar_profiles_org_id;
ALTER INDEX IF EXISTS idx_scheduling_profiles_slug   RENAME TO idx_calendar_profiles_slug;

DROP POLICY IF EXISTS scheduling_profiles_org_isolation ON public.calendar_profiles;
CREATE POLICY calendar_profiles_org_isolation ON public.calendar_profiles
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

ALTER TRIGGER trg_scheduling_profiles_set_updated_at
  ON public.calendar_profiles
  RENAME TO trg_calendar_profiles_set_updated_at;
