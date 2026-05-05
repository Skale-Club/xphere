-- =============================================================================
-- Migration 021: Platform Settings
-- Global platform-level key/value store for operator-managed configuration.
-- Values are AES-256-GCM encrypted (same pattern as integrations.encrypted_api_key).
-- No organization_id — genuinely global.
-- Writes are service-role only (bypasses RLS). Reads are open to authenticated users.
-- =============================================================================

CREATE TABLE public.platform_settings (
  key          TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  hint         TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (values are encrypted — safe to expose ciphertext)
CREATE POLICY "platform_settings_read"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT / UPDATE / DELETE policy — only service role (bypasses RLS) can write
