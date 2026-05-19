-- SEO configuration table — single-row, service-role access only.
-- RLS enabled with no public policies: only service role (admin panel) can read/write.
CREATE TABLE IF NOT EXISTS public.seo_config (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  site_title      text        NOT NULL DEFAULT 'Xphere',
  title_template  text        NOT NULL DEFAULT '%s | Xphere',
  description     text        NOT NULL DEFAULT 'The AI Operations Platform for Modern Agencies',
  og_image_url    text,
  keywords        text[]      NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_config ENABLE ROW LEVEL SECURITY;

-- Seed single config row (idempotent)
INSERT INTO public.seo_config (site_title, title_template, description)
VALUES ('Xphere', '%s | Xphere', 'The AI Operations Platform for Modern Agencies')
ON CONFLICT DO NOTHING;
