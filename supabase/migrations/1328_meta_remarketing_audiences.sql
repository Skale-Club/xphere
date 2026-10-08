-- 1328: Meta remarketing audiences — CRM contact lists and Pixel website rules.
--
-- meta_audience_config has synced scraped prospects (`xcraper_master`) and
-- hand-picked prospect segments (`prospect_segment`) since 1271. Two more
-- source kinds join them so every tenant can run remarketing from Xphere:
--
--   crm_contacts  — inbound CRM contacts (website forms, API, inbox channels)
--                   selected by lifecycle stage / source / source_type / tags.
--                   Same hash-only membership ledger and ADD/REMOVE diff.
--   pixel_website — a rule audience Meta builds from Pixel events (visitors,
--                   form submitters). Xphere creates it once; no members are
--                   uploaded, so meta_audience_memberships stays empty for it.
--
-- Only the kind check widens; the rest of the 1271 machinery (claim, commit,
-- dry-run, fail RPCs) is kind-agnostic.

ALTER TABLE public.meta_audience_config
  DROP CONSTRAINT IF EXISTS meta_audience_config_audience_kind_check;

ALTER TABLE public.meta_audience_config
  ADD CONSTRAINT meta_audience_config_audience_kind_check
  CHECK (audience_kind IN ('xcraper_master', 'prospect_segment', 'crm_contacts', 'pixel_website'));
