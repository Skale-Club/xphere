-- 1314_seo_action_plan.sql
--
-- SEO module, phase 4: AI-generated action plan per audit.
-- Generated on demand (it costs Copilot credits), stored on the audit so it
-- survives retention pruning (it is small) and is shown on the Overview tab.
-- Shape: { generated_at, model, locale, summary, actions[], rewrites[] } —
-- see src/lib/seo/action-plan.ts. Idempotent.

ALTER TABLE public.seo_audits
  ADD COLUMN IF NOT EXISTS action_plan JSONB;
