-- Migration 1075: Platform email settings table
-- Stores platform-level Resend configuration (super admin only, service role access)
-- No RLS needed: accessed exclusively via service role key in platform admin actions

CREATE TABLE IF NOT EXISTS platform_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_encrypted text,          -- AES-256-GCM via src/lib/crypto.ts
  default_from_name text,
  default_from_email text,
  default_reply_to text,
  provider text NOT NULL DEFAULT 'resend',
  is_active boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one row allowed (singleton table for platform config)
-- Access is controlled at the application layer: only PLATFORM_ADMIN_EMAIL may read/write
-- via server actions that use the service role client
