-- Migration 1217: Web Push VAPID config via Vault (no hardcoded keys)
--
-- The key VALUES live in Supabase Vault (vault.secrets), set out-of-band and
-- never committed: vapid_public_key, vapid_private_key, vapid_contact.
-- This migration only defines the SECURITY DEFINER reader that the push-sender
-- edge function calls (with the service role) to load them at cold start.
-- Locked down: only service_role may execute it.

create or replace function public.get_push_vapid_config()
returns table(public_key text, private_key text, contact text)
language sql
security definer
set search_path = ''
as $func$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_contact');
$func$;

revoke all on function public.get_push_vapid_config() from public;
revoke all on function public.get_push_vapid_config() from anon;
revoke all on function public.get_push_vapid_config() from authenticated;
grant execute on function public.get_push_vapid_config() to service_role;
