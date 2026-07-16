---
phase: 129-provider-synchronization-integrity
verified: 2026-07-16T02:45:00Z
status: passed
score: 13/13 must-haves verified
human_verification:
  - test: "Connect a Google Calendar account for an org via Settings (OAuth flow)"
    expected: "Connection succeeds and an integrations row with provider='google_calendar' is created (previously silently failed for every org before the 1253 enum fix)"
    why_human: "Requires live Google OAuth consent + real production callback; the enum fix is verified live but the end-to-end connect UX cannot be exercised programmatically. NOT a phase-129 gap — this is an optional smoke-test of the in-flight deviation fix."
---

# Phase 129: Provider Synchronization Integrity Verification Report

**Phase Goal:** Provider connections and statuses preserve tenant isolation and calendar lifecycle semantics.
**Verified:** 2026-07-16T02:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Plan | Status | Evidence |
| --- | ----- | ---- | ------ | -------- |
| 1 | Booking-conflict check honors every organizer-selected conflict calendar, not just Google primary | 129-01 | ✓ VERIFIED | `fetchBusyTimes` accepts `calendarIds: string[] = ['primary']`, issues ONE freeBusy request (`items: ids.map(id => ({id}))`), merges via `ids.flatMap` (google-calendar.ts:97-135); all 3 call sites pass `conflictCalendarIds` |
| 2 | Slot-display (getAvailableSlots/getDebugSlots) and validation (resolveAndValidateSlot) agree on busy slots | 129-01 | ✓ VERIFIED | Identical `conflict_calendar_ids` read + `['primary']` fallback at booking-validation.ts:114-122/177-183, bookings.ts:271-277/319-324, bookings.ts:364-370/398 |
| 3 | Native booking synced to Google has its event id durably stored | 129-02 | ✓ VERIFIED | createBooking (bookings.ts:558-560) + createBookingInternal (bookings.ts:771-773) persist via follow-up `.update({google_event_id})`; migration 1254 live; database.ts typed |
| 4 | Booking whose Google sync fails/unconfigured/no-id still succeeds (persistence strictly non-fatal) | 129-02 | ✓ VERIFIED | `if (googleEventId)` guard inside existing try/catch; `getCalendarTokens` returns null when unconnected → `createCalendarEvent` returns null → no update. Test 13 green |
| 5 | Org A member cannot read org B's google_calendar integration row (tokens/config) | 129-03 | ✓ VERIFIED | Real-DB test 1 GREEN against production (RLS `integrations_select` scoped to `get_current_org_id()`) |
| 6 | Anon request cannot read any org's google_calendar integration row | 129-03 | ✓ VERIFIED | Real-DB test 2 GREEN (0 rows returned) |
| 7 | Org A member cannot insert an integrations row claiming org B's organization_id | 129-03 | ✓ VERIFIED | Real-DB test 3 GREEN (insert rejected, forged id absent) |
| 8 | Unrecognized Xkedule status is logged + skipped, never coerced to 'confirmed' | 129-04 | ✓ VERIFIED | `KNOWN_XKEDULE_STATUSES` guard (route.ts:57-59, 212-215) returns `{skipped:'unknown_status'}` BEFORE any DB access beyond auth/parse |
| 9 | Xkedule status change to existing mirrored booking routes through Phase-127 lifecycle service | 129-04 | ✓ VERIFIED | `runXkeduleTransition` dispatches confirmBooking/cancelBooking/markNoShow/markShowed (route.ts:88-100, 281); `status` removed from `mutable`; insert path intact; update-failure returns before transition (no event) |
| 10 | No file under src/lib/ghl/** or src/app/api/ghl/** writes to bookings today | 129-05 | ✓ VERIFIED | grep for `.from('bookings')` in both roots → 0 matches; guardrail test GREEN |
| 11 | Future GHL bookings write is forced through lifecycle by a failing CI test | 129-05 | ✓ VERIFIED | tests/ghl-no-bookings-writes.test.ts present + GREEN, scans recursively for write patterns |
| 12 | bookings.google_event_id migration is applied to production | 129-06 | ✓ VERIFIED | Orchestrator SQL-verified (column exists, text, nullable); migration 1254 file present on branch, idempotent |
| 13 | Real-DB regression suites for this phase pass against production schema after apply | 129-06 | ✓ VERIFIED | tests/integrations-rls.test.ts 3/3 GREEN live (not soft-skipped) |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/calendar/google-calendar.ts` | Multi-calendar fetchBusyTimes, one request, merged intervals, fail-open | ✓ VERIFIED | Signature + `items: ids.map` + `ids.flatMap` + `if (!tokens) return []` + `if (!res.ok) return []` |
| `tests/google-calendar-busy.test.ts` | 4 tests: default-primary, multi-merge/single-request, missing-cal, non-ok | ✓ VERIFIED | Suite GREEN |
| `src/lib/calendar/booking-validation.ts` | resolveAndValidateSlot reads conflict_calendar_ids, passes 5th arg | ✓ VERIFIED | Lines 114-122, 177-183 |
| `src/app/(dashboard)/calendar/_actions/bookings.ts` | 3 call sites wired + 2 google_event_id persist sites | ✓ VERIFIED | 4 conflict_calendar_ids refs + 2 non-fatal google_event_id updates |
| `supabase/migrations/1254_bookings_google_event_id.sql` | Nullable google_event_id TEXT, idempotent | ✓ VERIFIED | `ADD COLUMN IF NOT EXISTS`, tracked on branch, applied to prod |
| `supabase/migrations/1253_google_calendar_provider_enum.sql` | Idempotent enum ADD VALUE (deviation fix) | ✓ VERIFIED | `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'google_calendar'`, tracked, applied+re-verified live |
| `src/types/database.ts` | bookings.google_event_id + calendar_profiles cols typed | ✓ VERIFIED | google_event_id at Row/Insert/Update (4541/4567/4588); conflict_calendar_ids/sync_mode/default_location_type (5009-5031) |
| `tests/integrations-rls.test.ts` | Real-DB, tx-wrapped org-ownership proof, soft-skip | ✓ VERIFIED | 3/3 GREEN live; describe.skip branch + ROLLBACK present |
| `src/app/api/xkedule/webhook/route.ts` | Unknown-status guard + lifecycle dispatch | ✓ VERIFIED | KNOWN_XKEDULE_STATUSES + runXkeduleTransition present, always-200 preserved |
| `tests/xkedule-webhook.test.ts` | Lifecycle-routing + unknown-status coverage (27 tests) | ✓ VERIFIED | Suite GREEN |
| `tests/ghl-no-bookings-writes.test.ts` | Static guardrail + D-03 header | ✓ VERIFIED | Suite GREEN |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| resolveAndValidateSlot | fetchBusyTimes | conflict_calendar_ids as 5th arg | ✓ WIRED (booking-validation.ts:177-183) |
| getAvailableSlots / getDebugSlots | fetchBusyTimes | same conflict_calendar_ids read | ✓ WIRED (bookings.ts:319-324, 398) |
| createBooking / createBookingInternal | bookings.google_event_id | createCalendarEvent return → follow-up .update() | ✓ WIRED (bookings.ts:558-560, 771-773) |
| tests/integrations-rls.test.ts | integrations RLS policies | SET LOCAL ROLE + jwt.claims, rolled-back tx | ✓ WIRED (3/3 GREEN live) |
| xkedule/webhook | transition.ts lifecycle fns | runXkeduleTransition dispatch, existing-row only | ✓ WIRED (route.ts:88-100, 281) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase 129 mocked suites (5) + regression (4) | `npx vitest run` (9 files) | 114/114 passing | ✓ PASS |
| Real-DB integrations RLS org-ownership | `npx vitest run tests/integrations-rls.test.ts` | 3/3 passing live | ✓ PASS |
| Production build + type check | `npm run build` | Compiled + TypeScript finished, no errors | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| SYNC-01 | 129-01, 129-02, 129-03, 129-06 | Google calendar org ownership + conflict calendars + external event id storage | ✓ SATISFIED | RLS proof (real-DB) + conflict_calendar_ids honored at 3 sites + google_event_id column live + persisted at both native creation paths |
| SYNC-02 | 129-04, 129-05 | Xkedule/GHL preserve provider status semantics + canonical lifecycle path | ✓ SATISFIED | Unknown-status guard + lifecycle-routed existing-row transitions; GHL scope-locked guardrail (no bookings writes) |

No orphaned requirements — REQUIREMENTS.md maps SYNC-01..02 to Phase 129; both are claimed by plans and satisfied.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder/stub markers in the phase's modified source files. All state variables flow to real reads/writes; no hollow props or empty-return stubs.

### Deviations Reviewed

- **Migration 1253 (`ALTER TYPE integration_provider ADD VALUE 'google_calendar'`)** — legitimate in-flight deviation from 129-03. The production enum never actually had this value despite database.ts listing it, silently breaking the Google OAuth callback for every org. Verified: file exists on branch, idempotent (`ADD VALUE IF NOT EXISTS`), tracked, applied + re-verified live by orchestrator. Treated as documented, correct, in-scope for SYNC-01.
- **Migration 1254 renumber** (plan placeholder `<next>` → 1254, since 1253 consumed mid-phase) — correct resolution; file present + idempotent + applied.

### Known Pre-Existing Issues (excluded — not phase 129 gaps)

- tests/action-engine.test.ts 8 failures (Vapi tools) — documented in Phase 127 deferred-items; files untouched by Phase 129.
- 2 pre-existing TS errors in tests/workflows/*.test.ts — outside app tsconfig, untouched by Phase 129; `npm run build` (app type check) is clean.

### Human Verification Required

Optional smoke-test only (does NOT block phase):
1. **Google Calendar OAuth connect** — Connect a Google account for an org via Settings; expect a `google_calendar` integrations row to be created. This exercises the production behavior unblocked by the 1253 enum deviation fix (which is already verified live at the schema level).

### Gaps Summary

No gaps. All 13 must-have truths across the 6 plans are verified against the actual codebase and live production database. Both requirement IDs (SYNC-01, SYNC-02) are satisfied. Multi-calendar conflict detection is wired identically across all 3 call sites; google_event_id is persisted non-fatally at both native creation paths and the column is live; integrations org-ownership is proven by a real-DB RLS suite passing against production; the Xkedule webhook rejects unknown statuses before any DB access and routes existing-row transitions through the canonical Phase-127 lifecycle service while preserving the insert path and always-200 contract; the GHL surface has a passing structural guardrail proving zero direct bookings writes. Build and all relevant test suites are green.

---

_Verified: 2026-07-16T02:45:00Z_
_Verifier: Claude (gsd-verifier)_
