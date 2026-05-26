-- Migration 1076: Tenant email integrations table
-- Per-org Resend credentials, following the same pattern as the integrations table
-- but dedicated to email (provider='resend') with email-specific fields

CREATE TABLE IF NOT EXISTS tenant_email_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_encrypted text,
  key_hint text,
  default_from_name text,
  default_from_email text,
  default_reply_to text,
  provider text NOT NULL DEFAULT 'resend',
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_email_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage tenant email integrations"
  ON tenant_email_integrations
  USING (org_id = get_current_org_id())
  WITH CHECK (org_id = get_current_org_id());
