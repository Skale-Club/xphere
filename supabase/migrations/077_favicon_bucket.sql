-- Add favicon_url to seo_config
ALTER TABLE public.seo_config
  ADD COLUMN IF NOT EXISTS favicon_url text;

-- Create public branding bucket for favicon/logo assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  2097152, -- 2 MB
  ARRAY[
    'image/png',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/svg+xml',
    'image/webp',
    'image/jpeg'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Public read policy (service role bypasses RLS for writes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'branding_public_read'
  ) THEN
    CREATE POLICY "branding_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'branding');
  END IF;
END $$;
