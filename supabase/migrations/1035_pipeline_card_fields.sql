-- 091_pipeline_card_fields.sql
-- Adds configurable card_fields to pipelines for SEED-029 (Pipeline Card Field Configuration).
-- Array of field keys visible on kanban cards, in display order.

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS card_fields jsonb
    NOT NULL
    DEFAULT '["contact_name","value","days_in_stage"]'::jsonb;

COMMENT ON COLUMN pipelines.card_fields IS
  'Ordered array of field keys visible on kanban cards. Built-in keys: contact_name, value, days_in_stage, expected_close_date, tags, company, status, assigned_to. Custom fields: "custom::{id}".';
