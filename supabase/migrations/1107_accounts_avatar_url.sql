-- 1107_accounts_avatar_url.sql
-- Company logo, mirrors contacts.avatar_url (1104). Public URL into the
-- existing 'avatars' bucket (059). NULL = fall back to the Building2 icon.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.accounts.avatar_url IS
  'Public URL of the company logo in the avatars storage bucket. NULL = use icon.';
