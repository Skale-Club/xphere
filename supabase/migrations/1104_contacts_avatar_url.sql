-- 1104_contacts_avatar_url.sql
-- Add avatar_url to contacts so the CRM can upload a profile photo for
-- each lead. Public URL points at an object in the existing 'avatars'
-- Supabase Storage bucket (see 059_avatars_bucket.sql). NULL means
-- "fall back to initials in the UI".

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.contacts.avatar_url IS
  'Public URL of the contact''s profile photo in the avatars storage bucket. NULL = use initials.';
