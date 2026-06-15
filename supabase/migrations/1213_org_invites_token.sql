-- Tokenized org invites.
--
-- Each invite now carries an unguessable token. The "Accept Invitation" link
-- embeds it so acceptance unambiguously identifies WHICH invite/org — a single
-- person can hold pending invites to multiple orgs (common for agency-managed
-- tenants), and the previous email-only matching would accept an arbitrary
-- "most recent" invite regardless of which link was clicked.
--
-- Security model: the token disambiguates which invite; the verified OAuth
-- email still must match the invite's email to authorize joining. The token is
-- not a standalone bearer credential.

alter table public.org_invites add column if not exists token text;

-- Backfill existing rows. Two concatenated UUIDs (sans dashes) = 256 bits.
update public.org_invites
set token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where token is null;

alter table public.org_invites alter column token set not null;

create unique index if not exists org_invites_token_key on public.org_invites (token);
