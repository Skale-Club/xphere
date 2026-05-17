-- Migration 055: Per-org branding (SEED-010 R7)
-- Allows each organization to customize logo, accent color, and brand name.
-- Used by the dashboard shell to render org-aware visuals (sidebar logo,
-- accent CSS variable override, favicon, and optional white-label name).

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_url       text,
  ADD COLUMN IF NOT EXISTS accent_color   text DEFAULT '#6366F1',
  ADD COLUMN IF NOT EXISTS brand_name     text;

-- Lightweight hex validation: 6-digit RGB hex, case-insensitive.
-- NULL is allowed (falls back to default accent).
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_accent_color_format;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_accent_color_format
  CHECK (accent_color IS NULL OR accent_color ~* '^#[0-9a-f]{6}$');

COMMIT;
