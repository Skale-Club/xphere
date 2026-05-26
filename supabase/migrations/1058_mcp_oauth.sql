-- 1058_mcp_oauth.sql
--
-- OAuth 2.0 (Authorization Code + PKCE + optional Dynamic Client Registration)
-- for the unified MCP server endpoint at /api/mcp.
--
-- Coexists with the legacy bearer-token flow (project_mcp_tokens) | a request
-- to /api/mcp accepts EITHER Authorization: Bearer xph_... (legacy) OR an OAuth
-- access token issued through this table set.
--
-- All token-like values are stored as SHA-256 hashes | plaintext is returned to
-- the client exactly once at the moment of issue.

-- ---------------------------------------------------------------------------
-- Table: mcp_oauth_clients
-- One row per registered OAuth client (an external app or AI connector).
-- Dynamic Client Registration creates rows with org_id = NULL; org binding
-- happens at first authorization through mcp_oauth_codes / mcp_oauth_tokens.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            text NOT NULL UNIQUE,
  client_secret_hash   text,                              -- NULL for public (PKCE-only) clients
  name                 text NOT NULL,
  redirect_uris        text[] NOT NULL DEFAULT ARRAY[]::text[],
  scope                text NOT NULL DEFAULT 'mcp:all',
  created_via          text NOT NULL DEFAULT 'dcr',       -- 'dcr' | 'admin'
  created_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at         timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_oauth_clients_client_id_idx
  ON public.mcp_oauth_clients (client_id);

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;

-- Only the service role touches this table during OAuth flows. Authenticated
-- users can read clients they registered (for an "Authorized apps" UI later).
CREATE POLICY mcp_oauth_clients_owner_select ON public.mcp_oauth_clients
  FOR SELECT
  USING (created_by_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table: mcp_oauth_codes
-- Short-lived (~10min) authorization codes exchanged at /oauth/token.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_oauth_codes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash              text NOT NULL UNIQUE,
  client_id              text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri           text NOT NULL,
  code_challenge         text NOT NULL,
  code_challenge_method  text NOT NULL DEFAULT 'S256',
  scope                  text NOT NULL DEFAULT 'mcp:all',
  expires_at             timestamptz NOT NULL,
  used                   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry_idx
  ON public.mcp_oauth_codes (expires_at)
  WHERE used = false;

ALTER TABLE public.mcp_oauth_codes ENABLE ROW LEVEL SECURITY;

-- No org-user-visible policy | only service role reads/writes during the flow.

-- ---------------------------------------------------------------------------
-- Table: mcp_oauth_tokens
-- Access + refresh tokens issued via Authorization Code (or refresh_token grant).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_oauth_tokens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_hash     text NOT NULL UNIQUE,
  refresh_token_hash    text UNIQUE,
  client_id             text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope                 text NOT NULL DEFAULT 'mcp:all',
  expires_at            timestamptz NOT NULL,
  refresh_expires_at    timestamptz,
  revoked               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_access_idx
  ON public.mcp_oauth_tokens (access_token_hash)
  WHERE revoked = false;
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_refresh_idx
  ON public.mcp_oauth_tokens (refresh_token_hash)
  WHERE revoked = false AND refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_org_idx
  ON public.mcp_oauth_tokens (org_id, user_id);

ALTER TABLE public.mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Users can see (but not modify) their own active tokens for a future
-- "Connected apps" management UI. Service role bypasses RLS for everything else.
CREATE POLICY mcp_oauth_tokens_owner_select ON public.mcp_oauth_tokens
  FOR SELECT
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Extend mcp audit log to cover the unified server: add an 'auth' actor area
-- so OAuth events (register/authorize/token/refresh/revoke) can be tracked.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'project_mcp_area' AND e.enumlabel = 'oauth'
  ) THEN
    ALTER TYPE public.project_mcp_area ADD VALUE 'oauth';
  END IF;
END $$;
