ALTER TABLE public.google_business_profiles
  ADD COLUMN IF NOT EXISTS widget_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
