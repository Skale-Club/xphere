-- Create the chat-media bucket (idempotent — runs cleanly on re-apply).
-- SEED-030 (Chat Rich Messages) expects this bucket but no migration created it,
-- so inbound MMS media uploads were failing and falling back to the raw (auth-gated,
-- expiring) Twilio media URL, which the browser <img> cannot load.
--
-- Uploads are performed exclusively by the service-role client
-- (src/app/api/chat/upload/route.ts and src/lib/chat/store-media.ts), which
-- bypasses RLS — so no INSERT policy is needed. The bucket is public so images,
-- audio, video and PDFs render from the public object URL without auth headers.
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- Public read: chat attachments are referenced via the public object URL
-- (NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/chat-media/...) from the
-- dashboard and must load without auth headers.
DROP POLICY IF EXISTS "chat_media_public_read" ON storage.objects;
CREATE POLICY "chat_media_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'chat-media');
