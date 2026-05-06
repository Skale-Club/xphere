# Deferred Items — Phase 23 Inbound Routing

## Pre-existing failures (out of scope)

### ACTN-12 test failure in tests/action-engine.test.ts

**File:** `tests/action-engine.test.ts:221`
**Test:** `ACTN-12: logAction writes action_logs and swallows errors > logAction() does not throw on Supabase insert error — swallows errors silently`
**Error:** `AssertionError: expected null to be undefined` — `logAction` returns `null` instead of `undefined` when DB insert errors.
**Pre-existing:** Confirmed failing on git stash (before Phase 23-04 changes). Not caused by this plan.
**Action needed:** Fix `logAction` in `src/lib/action-engine/log-action.ts` to return `undefined` (not `null`) on error.
**Discovered during:** Task 3 regression gate (Plan 23-04).
