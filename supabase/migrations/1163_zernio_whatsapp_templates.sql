-- 1163_zernio_whatsapp_templates.sql
-- Stores WhatsApp templates created via the Zernio integration so the platform
-- can track PENDING → APPROVED / REJECTED status without an external dashboard.

CREATE TABLE IF NOT EXISTS zernio_whatsapp_templates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id    UUID        NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  zernio_account_id TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  category          TEXT        NOT NULL CHECK (category IN ('UTILITY','MARKETING','AUTHENTICATION')),
  language          TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'PENDING'
                                  CHECK (status IN ('PENDING','APPROVED','REJECTED','DISABLED')),
  components        JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one record per (org, account, name, language)
ALTER TABLE zernio_whatsapp_templates
  ADD CONSTRAINT zernio_whatsapp_templates_unique_key
  UNIQUE (org_id, zernio_account_id, name, language);

CREATE INDEX ON zernio_whatsapp_templates (org_id, status);
CREATE INDEX ON zernio_whatsapp_templates (integration_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_zernio_whatsapp_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_zernio_whatsapp_templates_updated_at
  BEFORE UPDATE ON zernio_whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION update_zernio_whatsapp_templates_updated_at();

-- RLS: org members only
ALTER TABLE zernio_whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members"
  ON zernio_whatsapp_templates
  FOR ALL
  TO authenticated
  USING (org_id = get_current_org_id())
  WITH CHECK (org_id = get_current_org_id());
