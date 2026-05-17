---
phase: 22-foundation
plan: 01
subsystem: database
tags: [supabase, postgres, rls, manychat, migration, typescript, vitest]

requires:
  - phase: 19-db-foundation (v1.5)
    provides: update_updated_at() trigger function and RLS pattern reused here
  - phase: 07-db-foundation (v1.3)
    provides: meta_channels migration template (channel table + org_isolation policy)
provides:
  - manychat_channels table (one row per org, encrypted API key + webhook secret)
  - manychat_events append-only table (RLS SELECT+INSERT, no UPDATE/DELETE)
  - integration_provider enum extended with 'manychat'
  - TypeScript Database types for manychat_channels and manychat_events
  - Wave 0 RED test stubs (11 tests covering CHANNEL-01/05, WEBHOOK-01..04)
affects: [phase-22-plan-02, phase-23-routing, phase-24-dashboard-ui, phase-25-outbound-actions, phase-26-rules-event-log]

tech-stack:
  added: []
  patterns:
    - "manychat_events append-only audit table (no UPDATE/DELETE policies)"
    - "Wave 0 RED test stubs imported via dynamic import to allow modules-to-be-built"
    - "manychat_events.Update typed as Record<string, never> to enforce append-only at TS layer"

key-files:
  created:
    - supabase/migrations/026_manychat_foundation.sql
    - tests/manychat/webhook.test.ts
    - tests/manychat/channel-actions.test.ts
  modified:
    - src/types/database.ts
    - src/app/(dashboard)/integrations/actions.ts
    - src/components/integrations/integration-form.tsx

key-decisions:
  - "manychat_events.Update typed as Record<string, never> to mirror the SQL append-only policy in TypeScript"
  - "manychat_channels enforces UNIQUE(org_id) — one ManyChat account per org for v1.6 (relaxable later)"
  - "Wave 0 tests dynamically import the not-yet-existing route module so failure mode is ERR_MODULE_NOT_FOUND, not import-time failure during collection"

patterns-established:
  - "Append-only event tables: SELECT + INSERT RLS only, plus TS Update type as Record<string, never>"
  - "Enum extension cross-cuts: when integration_provider grows, integrations.provider Row/Insert and any IntegrationForDisplay-style display types must grow with it"

requirements-completed: [CHANNEL-01, CHANNEL-05, WEBHOOK-01, WEBHOOK-02, WEBHOOK-03, WEBHOOK-04]

duration: 14min
completed: 2026-05-06
---

# Phase 22 Plan 01: Foundation Summary

**Migration 026 creates manychat_channels (one-per-org, AES-256-GCM API key + webhook secret) and the append-only manychat_events audit log, with RLS via get_current_org_id(); database.ts and Wave 0 RED test stubs are aligned for Wave 2 to turn GREEN.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-06T18:59:52Z
- **Completed:** 2026-05-06T19:13:25Z
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Migration 026_manychat_foundation.sql written: extends `integration_provider` enum with `'manychat'`, creates `manychat_channels` (UNIQUE per org_id, RLS `org_isolation`, `update_updated_at()` trigger reused) and `manychat_events` (append-only — SELECT + INSERT policies only, no UPDATE/DELETE).
- TypeScript `Database` types extended in `src/types/database.ts`: new `manychat_channels` and `manychat_events` table definitions plus enum union update; `manychat_events.Update` typed as `Record<string, never>` to enforce append-only at the TS layer.
- Wave 0 test stubs created in `tests/manychat/` covering all 6 plan requirements (5 webhook tests + 6 channel-action tests = 11 stubs); all fail with `ERR_MODULE_NOT_FOUND` (correct RED state — Wave 2 implementation will turn them GREEN).
- `npm run build` passes with zero TypeScript errors after every commit.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 026_manychat_foundation.sql** — `f924e43` (feat)
2. **Task 2: Extend database.ts with manychat types** — `fdbd00f` (feat) — includes Rule 3 blocking-issue auto-fixes for cross-cutting type unions
3. **Task 3: Write Wave 0 RED test stubs** — `c6f942b` (test)

## Files Created/Modified

**Created:**
- `supabase/migrations/026_manychat_foundation.sql` — DB schema: enum extension, manychat_channels, manychat_events, RLS policies, updated_at trigger.
- `tests/manychat/webhook.test.ts` — 5 RED stubs for WEBHOOK-02/03/04 (403 on missing/invalid secret, 200 on valid secret, event log insert, always-200 on malformed JSON).
- `tests/manychat/channel-actions.test.ts` — 6 RED stubs for CHANNEL-01/05 (encrypt + maskApiKey called, raw key never stored, auth gate; delete by id, delete auth gate).

**Modified:**
- `src/types/database.ts` — added manychat_channels + manychat_events table definitions; extended `integration_provider` enum union and `integrations.provider` Row/Insert with `'manychat'`.
- `src/app/(dashboard)/integrations/actions.ts` — extended `IntegrationForDisplay.provider` union with `'manychat'` (cross-cutting type that hardcoded the enum).
- `src/components/integrations/integration-form.tsx` — added `manychat: 'ManyChat'` entry to `PROVIDER_LABELS` (required by `Record<Provider, string>` type).

## Decisions Made

- **manychat_events.Update = Record<string, never>**: enforces the append-only RLS pattern in the TypeScript layer too. Future maintainers cannot accidentally introduce an `.update()` call on this table without a deliberate type widening.
- **Tests dynamically import the route module**: the implementation files don't exist yet, but `await import(...)` inside `it()` keeps test collection healthy and surfaces `ERR_MODULE_NOT_FOUND` per-test (clean RED state).
- **`integrations.provider` and `IntegrationForDisplay.provider` were updated to match the enum**: not strictly required by Phase 22 (no `manychat` row will be inserted into `integrations` — it has its own table), but the unions must stay synchronized with the enum or the entire app fails to type-check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] integrations.provider Row/Insert union out of sync with extended enum**
- **Found during:** Task 2 (Extend database.ts)
- **Issue:** After widening `Database['public']['Enums']['integration_provider']` to include `'manychat'`, `src/lib/integrations/get-provider-key.ts` failed to type-check because its `provider: IntegrationProvider` argument no longer assigned to the `eq('provider', provider)` call — `integrations.provider` Row/Insert types had a hardcoded narrower union.
- **Fix:** Replaced both occurrences of the hardcoded provider union in the `integrations` table definition (`Row` and `Insert`) with the same union as the enum. Used `replace_all` on the exact literal.
- **Files modified:** `src/types/database.ts`
- **Verification:** Build progressed past `get-provider-key.ts`; surfaced the next downstream error (`IntegrationForDisplay`).
- **Committed in:** `fdbd00f` (Task 2 commit)

**2. [Rule 3 - Blocking] IntegrationForDisplay.provider hardcoded the old enum union**
- **Found during:** Task 2 (Extend database.ts)
- **Issue:** `src/app/(dashboard)/integrations/actions.ts` exports an `IntegrationForDisplay` type with a hardcoded provider union; mapping `data` (now wider) to `IntegrationForDisplay[]` failed type-check because `'manychat'` was not in the target union.
- **Fix:** Added `| 'manychat'` to `IntegrationForDisplay.provider`.
- **Files modified:** `src/app/(dashboard)/integrations/actions.ts`
- **Verification:** Build progressed past `actions.ts`; surfaced the next downstream error (`PROVIDER_LABELS`).
- **Committed in:** `fdbd00f` (Task 2 commit)

**3. [Rule 3 - Blocking] PROVIDER_LABELS missing 'manychat' key**
- **Found during:** Task 2 (Extend database.ts)
- **Issue:** `src/components/integrations/integration-form.tsx` declares `PROVIDER_LABELS: Record<Provider, string>`. With Provider widened, the literal-object initializer was missing `'manychat'`, breaking exhaustiveness.
- **Fix:** Added `manychat: 'ManyChat'` to `PROVIDER_LABELS`. The label string is harmless even though Phase 22's `integrations` table will never have a `manychat` row (manychat uses its own table); it satisfies the `Record<Provider, string>` constraint and is consistent with the project convention.
- **Files modified:** `src/components/integrations/integration-form.tsx`
- **Verification:** `npm run build` exits 0.
- **Committed in:** `fdbd00f` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All three auto-fixes were strictly required to keep the codebase type-clean after extending the enum. They are tightly scoped to the same conceptual change as Task 2 (enum widening) and were committed alongside the task they originated from. No scope creep — these are not new features, they are required to keep the codebase compiling.

## Issues Encountered

- None during planned work. The three Rule 3 deviations above arose from cross-cutting type unions that hardcoded the enum subset; they were resolved inline during Task 2 verification.

## User Setup Required

None — no external service configuration required for this plan. Migration 026 needs `npx supabase db push` when `SUPABASE_DB_PASSWORD` is available (tracked in STATE.md pending todos), but this is a deployment step, not a code-time prerequisite.

## Known Stubs

- `tests/manychat/webhook.test.ts` and `tests/manychat/channel-actions.test.ts` are intentional RED test stubs: they import not-yet-written modules `@/app/api/manychat/webhook/route` and `@/app/(dashboard)/integrations/manychat/actions`. This is the documented Wave 0 → Wave 2 RED→GREEN protocol for this plan. Wave 2 (Phase 22 Plan 02 + Phase 23) will create these implementation files and turn the tests GREEN. No production code is stubbed.

## Next Phase Readiness

- Wave 2 implementation (Phase 22 Plan 02) can now consume `Database['public']['Tables']['manychat_channels']` and `manychat_events` types directly from `src/types/database.ts`.
- The migration is **written but not pushed** — `SUPABASE_DB_PASSWORD` is not currently available. Build does not depend on the DB being migrated; types match the migration as if applied. Push must happen before any environment that exercises the webhook or channel CRUD against a real DB.
- Test infrastructure in `tests/manychat/` is in place and uses the existing Vitest setup. Wave 2 can run `npx vitest run tests/manychat` to verify the RED→GREEN transition.

## Self-Check: PASSED

- FOUND: `supabase/migrations/026_manychat_foundation.sql`
- FOUND: `tests/manychat/webhook.test.ts`
- FOUND: `tests/manychat/channel-actions.test.ts`
- FOUND commit: `f924e43`
- FOUND commit: `fdbd00f`
- FOUND commit: `c6f942b`
- VERIFIED: `manychat_channels`, `manychat_events`, `org_isolation`, `ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'manychat'` all present in migration 026 (19 grep hits)
- VERIFIED: `integration_provider` enum union and `integrations.provider` columns both include `'manychat'` in `src/types/database.ts`
- VERIFIED: `npm run build` exits 0
- VERIFIED: `npx vitest run tests/manychat` fails with ERR_MODULE_NOT_FOUND (RED state, correct)

---
*Phase: 22-foundation*
*Completed: 2026-05-06*
