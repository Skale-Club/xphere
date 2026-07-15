-- =============================================================================
-- Migration 1247: Unified prospect_rows view
--
-- The prospects list (src/app/(dashboard)/prospects/actions.ts -> getProspects)
-- used to pull up to 1000 rows from EACH of `contacts` and `accounts`
-- (lifecycle_stage = 'prospect'), then merge/sort/paginate them in
-- application memory (see the old PROSPECT_FETCH_CAP constant). That silently
-- caps at 1000 rows per table and re-sorts/re-slices the whole set on every
-- page load — it does not scale for multi-country scraping.
--
-- This view lets Postgres do the union + filter + sort + pagination instead:
-- callers do a single `.from('prospect_rows')` query with a real `.range()`
-- and `{ count: 'exact' }` instead of two capped fetches merged in memory.
--
-- `security_invoker = true` means the view carries NO privileges of its own —
-- every row still goes through the querying user's RLS policies on the
-- underlying `contacts` / `accounts` tables (both scope by
-- `org_id = get_current_org_id()`). There is no org_id filter in this view's
-- WHERE clause, and callers must never add one manually — RLS on the base
-- tables already does that for every caller, same as any other query.
--
-- Column shape mirrors `ProspectRow` in actions.ts. `city` is derived from
-- `custom_fields->>'city'` / `custom_fields->>'state'` the same way
-- `extractLocation()` in actions.ts does today — Google Maps / xcraper
-- enrichment writes there; there is no dedicated city/state column.
--
-- Contact rows are additionally filtered to
-- `identity_status <> 'archived_duplicate'` — once a contact is merged into a
-- survivor (v3.0 contact-identity workstream, migration 1056), the archived
-- duplicate should not resurface as a separate prospect row.
--
-- NOTE (behavior change vs. the old in-memory mapping): contact prospect rows
-- here do NOT fall back to a linked account's name for `company` — the view
-- has no join to `accounts` for contact rows (joining per row here would
-- undercut the whole point of this migration, and prospect-stage contacts are
-- rarely linked to an account yet). If that fallback is needed later, resolve
-- it in the UI/detail view instead of this list-scale view.
-- =============================================================================

DROP VIEW IF EXISTS public.prospect_rows;

CREATE VIEW public.prospect_rows
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.org_id,
  'person'::text                                                            AS kind,
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name)
                                                                             AS name,
  c.email,
  c.phone,
  c.company,
  NULL::text                                                                AS website,
  NULL::text                                                                AS domain,
  NULLIF(TRIM(CONCAT_WS(', ', c.custom_fields->>'city', c.custom_fields->>'state')), '')
                                                                             AS city,
  c.tags,
  c.source,
  c.source_type,
  c.source_id,
  c.engagement_status,
  c.intent_level,
  c.qualification_status,
  c.recommended_channel,
  c.score,
  c.last_contacted_at,
  c.last_replied_at,
  c.created_at,
  c.updated_at
FROM public.contacts c
WHERE c.lifecycle_stage = 'prospect'
  AND c.identity_status <> 'archived_duplicate'

UNION ALL

SELECT
  a.id,
  a.org_id,
  'company'::text                            AS kind,
  a.name,
  a.custom_fields->>'email'                  AS email,
  a.phone,
  COALESCE(a.domain, a.website)              AS company,
  COALESCE(a.domain, a.website)              AS website,
  a.domain,
  NULLIF(TRIM(CONCAT_WS(', ', a.custom_fields->>'city', a.custom_fields->>'state')), '')
                                              AS city,
  a.tags,
  a.source,
  a.source_type,
  a.source_id,
  a.engagement_status,
  a.intent_level,
  a.qualification_status,
  a.recommended_channel,
  a.score,
  a.last_contacted_at,
  a.last_replied_at,
  a.created_at,
  a.updated_at
FROM public.accounts a
WHERE a.lifecycle_stage = 'prospect';

GRANT SELECT ON public.prospect_rows TO authenticated, anon;

COMMENT ON VIEW public.prospect_rows IS
  'Unified read-only view of prospect-stage contacts + accounts for the Prospects list. RLS inherits from base tables via SECURITY INVOKER -- never filter by org_id manually against this view.';

-- ---------------------------------------------------------------------------
-- Indexes to support the view's common sorts within lifecycle_stage='prospect'.
--
-- `idx_contacts_org_lifecycle_stage` / `idx_accounts_org_lifecycle_stage`
-- (both (org_id, lifecycle_stage, created_at DESC) — migration 1151) already
-- cover the default 'recent' sort (created_at DESC) on both branches of the
-- UNION ALL, once RLS narrows to org_id and the view's WHERE narrows to
-- lifecycle_stage = 'prospect'. No duplicate needed.
--
-- There is no equivalent for the 'score' sort (score DESC, created_at DESC
-- tie-break), so add partial indexes scoped to prospect rows only — they
-- stay small even as the base tables grow from multi-country scraping.
--
-- The 'name' sort is intentionally NOT indexed here: the view's `name` for
-- contact rows is a derived expression (COALESCE/TRIM/CONCAT_WS over
-- first_name/last_name/name), not a plain column, and Postgres cannot use a
-- plain-column index to satisfy a sort on a UNION ALL view's derived output
-- expression (no Merge Append plan possible for a non-matching expression).
-- A name-sorted page still does a full sort of the prospect-stage rows, which
-- is acceptable at prospect volumes (admin-only feature, already bounded by
-- pagination downstream); revisit only if it shows up in slow-query logs.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contacts_prospect_score
  ON public.contacts (org_id, score DESC, created_at DESC)
  WHERE lifecycle_stage = 'prospect';

CREATE INDEX IF NOT EXISTS idx_accounts_prospect_score
  ON public.accounts (org_id, score DESC, created_at DESC)
  WHERE lifecycle_stage = 'prospect';
