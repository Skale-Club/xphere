-- migration 1229: normalize legacy email_templates.status 'ready' -> 'published' (Phase 120, UFE-09)
-- Idempotent: re-running affects 0 rows once no 'ready' rows remain. Data normalization only.
update public.email_templates set status = 'published' where status = 'ready';
