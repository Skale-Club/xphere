-- Landing page content configuration (singleton row)
-- Lets super admins swap the CTA background image and curate a scroll-animation gallery
-- without redeploying. Reuses the existing public `branding` bucket for storage.

CREATE TABLE IF NOT EXISTS public.landing_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cta_image_url text,
  scroll_images text[] NOT NULL DEFAULT '{}'::text[],
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Seed the singleton row so the admin UI always has a record to update.
INSERT INTO public.landing_config (cta_image_url, scroll_images)
SELECT
  'https://mwklvkmggmsintqcqfvu.supabase.co/storage/v1/object/public/branding/landing/cta-bg.webp',
  '{}'::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.landing_config);

-- Public-read RLS: the unauthenticated landing page needs to fetch the config.
-- Writes happen via the service-role client from server actions.
ALTER TABLE public.landing_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'landing_config' AND policyname = 'landing_config_public_read'
  ) THEN
    CREATE POLICY "landing_config_public_read" ON public.landing_config
      FOR SELECT USING (true);
  END IF;
END $$;

-- Bump the `branding` bucket size limit so hero-sized landing images fit (favicon use stays well within).
UPDATE storage.buckets
SET file_size_limit = 8388608  -- 8 MB
WHERE id = 'branding' AND (file_size_limit IS NULL OR file_size_limit < 8388608);
