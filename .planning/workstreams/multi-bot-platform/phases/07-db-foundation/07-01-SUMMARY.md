---
phase: 07-db-foundation
plan: 01
subsystem: database
tags: [postgres, supabase, rls, migrations, google-reviews, meta-messaging]

# Dependency graph
requires: []
provides:
  - google_locations table with review_token public embed token, fetched_at cache tracking, org RLS
  - google_reviews table with rating CHECK, cascade delete, denormalized org_id for RLS efficiency
  - meta_channels table with AES-256-GCM encrypted token, channel_type CHECK, webhook_verified flag
affects:
  - 08-reviews-admin
  - 09-reviews-widget
  - 10-meta-oauth

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RLS via get_current_org_id() USING + WITH CHECK on all new tables"
    - "review_token pattern: replace(gen_random_uuid()::text, '-', '') — matches widget_token convention"
    - "Denormalized org_id on child tables for RLS without joins (see google_reviews)"
    - "encrypted_page_access_token pattern mirrors integrations.encrypted_api_key (AES-256-GCM)"

key-files:
  created:
    - supabase/migrations/018_google_reviews.sql
    - supabase/migrations/019_meta_channels.sql
  modified: []

key-decisions:
  - "org_id denormalized on google_reviews to allow RLS check without JOIN through google_locations"
  - "automation_id on meta_channels references tool_configs ON DELETE SET NULL (not hard-delete)"
  - "fetched_at is nullable TIMESTAMPTZ — NULL means never fetched; Phase 8 sets it on every sync"
  - "channel_type constrained at DB level via CHECK IN ('messenger', 'instagram')"

patterns-established:
  - "New tenant tables always use get_current_org_id() in both USING and WITH CHECK clauses"
  - "Public embed tokens use replace(gen_random_uuid()::text, '-', '') for hyphen-free tokens"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-05-04
---

# Phase 07 Plan 01: DB Foundation Summary

**Two Supabase migration files adding google_locations/google_reviews (018) and meta_channels (019) tables with RLS, all using get_current_org_id() for tenant isolation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-04T18:49:11Z
- **Completed:** 2026-05-04T18:57:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `google_locations` table with `review_token` public embed token (no-hyphen UUID pattern), nullable `fetched_at` for Google Places ToS compliance, and RLS via `get_current_org_id()`
- Created `google_reviews` table with `CHECK (rating BETWEEN 1 AND 5)`, `UNIQUE(location_id, google_review_id)`, cascade delete from `google_locations`, and denormalized `org_id` for efficient RLS without joins
- Created `meta_channels` table with `encrypted_page_access_token NOT NULL` (AES-256-GCM), `channel_type CHECK IN ('messenger', 'instagram')`, `webhook_verified` flag, `automation_id` FK to `tool_configs` ON DELETE SET NULL

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 018 — google_locations and google_reviews tables** - `2a0a4fd` (feat)
2. **Task 2: Create migration 019 — meta_channels table** - `7c06713` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `supabase/migrations/018_google_reviews.sql` - DDL for google_locations + google_reviews with indexes and RLS
- `supabase/migrations/019_meta_channels.sql` - DDL for meta_channels with indexes and RLS

## Decisions Made
- `org_id` denormalized on `google_reviews` — avoids JOINs in RLS USING clause, matching the pattern used in `conversation_messages`
- `automation_id REFERENCES tool_configs(id) ON DELETE SET NULL` — plan referenced `tools` table but actual table in codebase is `tool_configs`; used correct name
- `fetched_at` kept nullable (not `last_fetched_at`) per plan spec — NULL signals "never fetched" for Phase 8 sync logic
- `review_token` uses `replace(gen_random_uuid()::text, '-', '')` — matches `widget_token` pattern in `organizations` table

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Migrations will be pushed in Plan 02.

## Next Phase Readiness
- Migrations 018 and 019 are ready for Plan 02 to push to production via `npx supabase db push`
- Phase 8 (Reviews Admin) and Phase 9 (Reviews Widget) are unblocked once migrations are applied
- Phase 10 (Meta OAuth) is unblocked for `meta_channels` table usage

---
*Phase: 07-db-foundation*
*Completed: 2026-05-04*
