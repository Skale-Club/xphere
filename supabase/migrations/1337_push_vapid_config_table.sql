-- Migration 1337: Web Push VAPID config in a table (Vault leaves with Supabase)
--
-- Migration 1217 reads the three VAPID values from Supabase Vault through
-- get_push_vapid_config(). Vault does not exist in the self-hosted database, so
-- the Node push sender (src/lib/notifications/push-sender.ts) reads this table
-- first and only falls back to the RPC.
--
-- The private key is stored ENCRYPTED with src/lib/crypto.ts (AES-256-GCM,
-- "iv:ciphertext", keyed by ENCRYPTION_SECRET). The public key and the contact
-- are not secret. Nothing here carries a value: scripts/copy-vapid-to-table.ts
-- copies them from Vault. Service role only: RLS is on with no policy, and
-- anon/authenticated have no grant.
--
-- One row at most: `id` is a boolean pinned to true.

create table if not exists public.push_vapid_config (
  id                    boolean primary key default true check (id),
  public_key            text not null,
  private_key_encrypted text not null,
  contact               text not null,
  updated_at            timestamptz not null default now()
);

alter table public.push_vapid_config enable row level security;

revoke all on table public.push_vapid_config from public;
revoke all on table public.push_vapid_config from anon;
revoke all on table public.push_vapid_config from authenticated;
grant select, insert, update, delete on table public.push_vapid_config to service_role;
