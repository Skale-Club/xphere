-- Migration 1339: Skale Club Websites integration + site-info agent tool
-- Lets an org connect a Websites tenant (base URL + the same Xphere API key the tenant
-- already holds) and lets its agents read the tenant's public facts: business contact
-- details, published services and active service areas (GET /api/v1/site on the tenant).
-- Read-only, so no idempotency classification.
-- PostgreSQL enum ADD VALUE must run outside a transaction block.

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'websites';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'websites_site_info';
