-- =============================================================================
-- Migration 1247: Widget URL authorization rules
-- Lets each org authorize where the embeddable chat widget is allowed to run,
-- by URL (domain + path patterns). Enforced both client-side (widget.js gates
-- rendering) and server-side (config + chat endpoints validate Origin/Referer).
--
--   widget_url_mode:
--     'all'       → widget runs everywhere (default, preserves current behavior)
--     'allowlist' → widget runs ONLY on URLs matching a rule
--     'blocklist' → widget runs everywhere EXCEPT URLs matching a rule
--   widget_url_rules: JSONB array of pattern strings, e.g.
--     ["example.com", "*.example.com", "example.com/checkout", "shop.example.com/app/*"]
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN widget_url_mode TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN widget_url_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_widget_url_mode_check
  CHECK (widget_url_mode IN ('all', 'allowlist', 'blocklist'));

COMMENT ON COLUMN public.organizations.widget_url_mode IS
  'Where the chat widget may run: all | allowlist | blocklist (migration 1247).';
COMMENT ON COLUMN public.organizations.widget_url_rules IS
  'JSONB array of URL patterns (domain + optional path/globs) evaluated against widget_url_mode (migration 1247).';
