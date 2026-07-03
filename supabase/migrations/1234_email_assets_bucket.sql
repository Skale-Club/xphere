-- Create the email-assets bucket for images uploaded in the email template
-- builder (v3.4 Email Editor Overhaul). Idempotent — runs cleanly on re-apply.
--
-- Uploads are performed exclusively by the service-role client
-- (src/app/api/email-templates/upload/route.ts), which bypasses RLS — so no
-- INSERT policy is needed. The bucket is public so images render from the public
-- object URL inside the composed email HTML without auth headers (email clients
-- have no session).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-assets',
  'email-assets',
  true,
  10485760, -- 10 MB
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read: email images are referenced via the public object URL
-- (NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/email-assets/...) from the
-- editor preview AND from delivered emails, and must load without auth headers.
DROP POLICY IF EXISTS "email_assets_public_read" ON storage.objects;
CREATE POLICY "email_assets_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'email-assets');
