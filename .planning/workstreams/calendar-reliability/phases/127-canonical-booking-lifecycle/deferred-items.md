# Deferred Items — Phase 127 canonical-booking-lifecycle

Out-of-scope discoveries logged during plan execution but not auto-fixed
(SCOPE BOUNDARY: only fix issues directly caused by the current task's changes).

## 127-07: Pre-existing failures in tests/action-engine.test.ts (unrelated to booking lifecycle)

- **Found during:** Plan 127-07, Task 2 verification (running the full related-test sanity sweep)
- **Failing tests:** 8 tests in `tests/action-engine.test.ts`, all under the `POST /api/vapi/tools — webhook route` describe block (Test 4 "GHL executor throws → fallback_message", Test 6 "logAction via after()", and others in that block)
- **Symptom:** e.g. `expected 'Service unavailable.' to be 'Sorry, unable to help right now.'`, `expected afterMock to be called 1 times, but got 0 times`
- **Confirmed pre-existing:** Reproduces identically running `tests/action-engine.test.ts` in isolation, on a tree with none of this plan's changes applied (booking-lifecycle-actions.ts and execute-action.ts's booking_* registrations touch a completely different code path — the Vapi tools webhook route/GHL-fallback logic is untouched by this plan). `git log --oneline -3 -- tests/action-engine.test.ts` shows no 127-* commit has touched this file.
- **Scope:** Not related to LIFE-01/LIFE-03 (booking lifecycle). Likely drift between the test file's mocking assumptions and the current `/api/vapi/tools` route implementation (e.g. `after()`/`createClient` mock wiring). Not fixed here.
- **Action:** None taken. Flagging for a future maintenance pass on `src/app/api/vapi/tools/route.ts` + `tests/action-engine.test.ts`.
