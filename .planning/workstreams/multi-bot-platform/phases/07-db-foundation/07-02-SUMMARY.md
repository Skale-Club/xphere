---
phase: 07-db-foundation
plan: 02
subsystem: database
tags: [postgres, supabase, migrations, conversations, multi-channel]

# Dependency graph
requires:
  - 07-01 (migrations 018 and 019 created)
provides:
  - conversations.channel column TEXT NOT NULL DEFAULT 'widget' with CHECK constraint
  - conversations.channel_metadata JSONB NOT NULL DEFAULT '{}'
  - Partial index idx_conversations_channel WHERE channel != 'widget'
affects:
  - 11-meta-webhook
  - 12-multi-channel-inbox

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ADD COLUMN IF NOT EXISTS with NOT NULL DEFAULT — safe large-table pattern (PostgreSQL 11+, no table rewrite)"
    - "Partial index on low-cardinality column with dominant default value keeps index small"
    - "CHECK constraint inline on column definition (CONSTRAINT name CHECK (...))"

key-files:
  created:
    - supabase/migrations/020_conversations_channel.sql
  modified: []

key-decisions:
  - "DEFAULT 'widget' makes migration fully backward-compatible — zero data migration needed for existing rows"
  - "Partial index WHERE channel != 'widget' excludes dominant value to minimize index size"
  - "channel_metadata JSONB NOT NULL DEFAULT '{}' carries messenger PSID / instagram IGSID routing identifiers"
  - "No RLS policy change — existing org_isolation on conversations already covers all new rows"

requirements-completed: []

# Metrics
duration: 10min
completed: 2026-05-04
---

# Phase 07 Plan 02: DB Foundation Summary

**Migration 020 adds `channel` and `channel_metadata` columns to `conversations` with backward-compatible DEFAULT 'widget' and partial index for multi-channel inbox support**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-04T18:49:00Z
- **Completed:** 2026-05-04T18:59:00Z
- **Tasks:** 1 completed, 1 blocked by auth gate
- **Files modified:** 1

## Accomplishments

- Created `supabase/migrations/020_conversations_channel.sql` with:
  - `channel TEXT NOT NULL DEFAULT 'widget'` with `CONSTRAINT conversations_channel_check CHECK (channel IN ('widget', 'messenger', 'instagram'))`
  - `channel_metadata JSONB NOT NULL DEFAULT '{}'` for per-channel routing identifiers (PSID for Messenger, IGSID for Instagram)
  - Partial index `idx_conversations_channel ON public.conversations(channel) WHERE channel != 'widget'` to keep index size minimal while enabling fast channel-filtered inbox queries
  - No UPDATE statement — DEFAULT handles all existing rows automatically
  - No RLS policy modification — existing org_isolation policy already covers all rows

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 020 — add channel columns to conversations** - `ea3af13` (feat)
2. **Task 2: Apply all three pending migrations (018, 019, 020) to production** - BLOCKED (auth gate — see below)

## Files Created/Modified

- `supabase/migrations/020_conversations_channel.sql` - ALTER TABLE conversations adding channel + channel_metadata with constraint and partial index

## Decisions Made

- `ADD COLUMN IF NOT EXISTS` used for both columns — safe for re-runs and idempotent
- `CONSTRAINT conversations_channel_check` named explicitly for clear error messages on constraint violation
- Partial index excludes `'widget'` (dominant value, ~99% of rows) — keeps index small while accelerating Meta/Instagram inbox filters
- `channel_metadata JSONB` chosen over individual columns to accommodate divergent metadata shapes per channel type without future schema changes

## Deviations from Plan

None - migration content follows plan exactly.

## Auth Gate Encountered

**Task 2: npx supabase db push**

`npx supabase db push` failed with:
```
unexpected login role status 403: {"message":"Your account does not have the necessary privileges to access this endpoint."}
Connect to your database by setting the env var correctly: SUPABASE_DB_PASSWORD
```

**Resolution:** Set `SUPABASE_DB_PASSWORD` environment variable and re-run `npx supabase db push` manually:

```bash
SUPABASE_DB_PASSWORD=<your-db-password> npx supabase db push
```

The DB password can be found in the Supabase dashboard under Project Settings > Database > Database password for project `mwklvkmggmsintqcqfvu`.

All three migration files (018, 019, 020) are committed and ready. The push will apply them in filename order once the password is set.

## Known Stubs

None.

## Next Phase Readiness

- Migration 020 is committed and ready for manual `npx supabase db push` with `SUPABASE_DB_PASSWORD`
- Once pushed, Phase 11 (Meta Webhook) can use `conversations.channel` to tag inbound DMs
- Phase 12 (Multi-Channel Inbox) can filter conversations by `channel` using the partial index

---
*Phase: 07-db-foundation*
*Completed: 2026-05-04*
