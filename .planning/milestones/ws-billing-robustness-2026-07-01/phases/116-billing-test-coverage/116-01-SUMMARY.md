---
phase: 116-billing-test-coverage
plan: 01
subsystem: testing
tags: [vitest, stripe, webhooks, billing, hmac-signing]

# Dependency graph
requires:
  - phase: 114-metering-architecture
    provides: meterDebit()/generic credit-debit interface used indirectly by the webhook's grantCopilot/resetCopilotForPeriod calls
provides:
  - Full Vitest coverage of the Stripe webhook route (src/app/api/stripe/webhook/route.ts): real-HMAC signature verification, billing_events idempotency guard, all six SUPPORTED_EVENTS branches, topup metadata edge case, legacy invoice-subscription-field fallback, processing-failure path
affects: [117-billing-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real Stripe webhook signing in tests via stripe.webhooks.generateTestHeaderString — never mock constructEvent itself"
    - "Mocked getStripe() delegates webhooks.constructEvent to a real un-mocked Stripe instance (stripeForSigning) while subscriptions.retrieve stays a vi.fn() override per test — two distinct Stripe instances in one test file"
    - "billing_events table mock exposes upsert + select().eq().maybeSingle() + update().eq() on the same from('billing_events') object since the route calls .from() three separate times, not one chain"

key-files:
  created: [tests/billing-webhook.test.ts]
  modified: []

key-decisions:
  - "getStripe() mock must expose a real (delegated) webhooks.constructEvent, not just subscriptions.retrieve — the route calls getStripe().webhooks.constructEvent() for verification, so a bare {subscriptions:{retrieve}} mock breaks signature checking entirely (discovered during first test run, not anticipated by the plan's interface notes)"

patterns-established:
  - "buildSignedRequest(event, secret) + buildFakeAdmin(billingEventsRow) + buildFakeStripe(retrieve) as reusable scaffolding for any future Stripe-webhook-adjacent test file"

requirements-completed: [BTC-01]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 116 Plan 01: Stripe Webhook Handler Test Coverage Summary

**Full Vitest coverage of `src/app/api/stripe/webhook/route.ts` using real HMAC-signed Stripe events (via `generateTestHeaderString`), covering signature verification, idempotency, all six supported event types, and processing-failure recovery — 15 passing tests in one file.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-01T11:44:00Z
- **Completed:** 2026-07-01T12:09:00Z (approx)
- **Tasks:** 2 (combined into one authoring pass — see Deviations)
- **Files modified:** 1

## Accomplishments
- `tests/billing-webhook.test.ts` created with 15 passing tests covering the full BTC-01 requirement: signature verification (missing/wrong-secret/valid), unset-webhook-secret 500, billing_events idempotency guard (unsupported-event pass-through + duplicate short-circuit), all six `SUPPORTED_EVENTS` branches, the copilot-topup missing-metadata no-op edge case, the legacy vs. current invoice→subscription field-shape fallback, and the processing-failure path (500, `processed_at` left unset for Stripe retry).
- Established reusable test scaffolding (`buildSignedRequest`, `buildFakeAdmin`, `buildFakeStripe`) that any future Stripe-webhook test file in this repo can copy.
- No mocking of `stripe.webhooks.constructEvent` — real HMAC signing exercises the actual signature-verification code path, per the phase's anti-pattern guidance.

## Task Commits

Both tasks were authored together in a single test file (see Deviations for rationale) and committed as one atomic commit:

1. **Tasks 1+2: Full webhook test suite (scaffold, signature/idempotency, all six event types)** - `c6a2b5f1` (test)

**Plan metadata:** (pending — this commit)

## Files Created/Modified
- `tests/billing-webhook.test.ts` - New file. 15 tests across 6 `describe` blocks: signature verification, idempotency guard, checkout.session.completed (both modes + edge case), customer.subscription.* (created/updated/deleted via `it.each`), invoice.paid/payment_failed (current + legacy shapes), processing failure.

## Decisions Made
- **getStripe() mock needed a real, delegated `webhooks.constructEvent`.** The plan's interface notes described mocking `getStripe` primarily for `subscriptions.retrieve`, with signature verification handled by a separate `stripeForSigning` instance. In practice, the ROUTE itself calls `getStripe().webhooks.constructEvent(...)` (not a separately-imported `Stripe` instance) — so the mocked `getStripe()` return value must expose a `webhooks.constructEvent` that delegates to the real, un-mocked `stripeForSigning.webhooks.constructEvent`. This preserves "real signing, no mocking of constructEvent" while still allowing `subscriptions.retrieve` to be a per-test `vi.fn()` override. Introduced a `buildFakeStripe(retrieve)` helper to keep this consistent across all six event-type tests.
- Executed both Task 1 (scaffold + signature/idempotency) and Task 2 (all six event types) as a single authoring pass into one file, since the scaffold and full event-type coverage are tightly coupled (the same `buildFakeAdmin`/`buildSignedRequest` helpers are reused across both), and splitting into two separate commits would have required an artificial intermediate state. Committed once, after all 15 tests were green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getStripe() mock missing webhooks.constructEvent caused every signed-request test to fail with 400**
- **Found during:** First test run (all 12 signed-request tests failed with "Invalid signature" / "Cannot read properties of undefined")
- **Issue:** The default `getStripe` mock only returned `{ subscriptions: { retrieve: vi.fn() } }`. Since the route calls `getStripe().webhooks.constructEvent(...)` for its OWN signature verification (not a separately-imported Stripe instance), every request — even correctly-signed ones — failed signature verification because `webhooks` was `undefined`.
- **Fix:** Added a `buildFakeStripe(retrieve)` helper whose `webhooks.constructEvent` delegates to the real `stripeForSigning.webhooks.constructEvent`, preserving genuine HMAC verification while keeping `subscriptions.retrieve` mockable per test. Applied as the default `beforeEach` mock and in all four per-test overrides that need a custom `retrieve`.
- **Files modified:** tests/billing-webhook.test.ts (same file, pre-commit — no extra commit needed)
- **Verification:** All 15 tests pass; `npm test` shows no billing-webhook regressions.
- **Committed in:** c6a2b5f1 (single task commit, fix applied before commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correction to make the "real signing, no mocked constructEvent" strategy actually work against this route's exact call shape (`getStripe().webhooks.constructEvent`, not a module-level import). No scope creep — same file, same commit.

## Issues Encountered
- Initial run: 12/15 tests failed with 400/undefined errors due to the `getStripe` mock gap described above — resolved before any commit was made (see Deviations).
- Full `npm test` run showed 64 pre-existing failures across unrelated files (`tests/auth/callback.test.ts`, `tests/auth/members-actions.test.ts`, and others) — confirmed via `git status`/`git diff` that these files are untouched by this plan's work; out of scope per the deviation rules' scope boundary (pre-existing failures in unrelated files are not this plan's responsibility). All billing-prefixed test files, including this plan's `billing-webhook.test.ts` and the parallel 116-02 plan's three files, pass cleanly (0 failures) in the same full-suite run.

## User Setup Required

None - no external service configuration required. All Stripe interaction in these tests is either fully mocked or uses local, in-process HMAC signing with dummy test secrets (`whsec_test_secret_for_vitest`, `sk_test_dummy`) — no real Stripe API calls, no real credentials needed.

## Next Phase Readiness
- BTC-01 is fully satisfied: `tests/billing-webhook.test.ts` exists, contains `generateTestHeaderString` and `duplicate: true` literal strings (acceptance criteria), and all 15 tests pass under `npx vitest run tests/billing-webhook.test.ts`.
- No blockers for Phase 117 (Billing Observability) — this phase's webhook test coverage gives a regression baseline that observability/alerting work can build on without needing to re-verify webhook correctness from scratch.
- Pre-existing unrelated test failures (auth/callback, auth/members-actions, 35 other files) remain open — not introduced by this plan, flagged here for visibility only.

---
*Phase: 116-billing-test-coverage*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: tests/billing-webhook.test.ts
- FOUND: .planning/workstreams/billing-robustness/phases/116-billing-test-coverage/116-01-SUMMARY.md
- FOUND: c6a2b5f1 (git log --oneline --all)
