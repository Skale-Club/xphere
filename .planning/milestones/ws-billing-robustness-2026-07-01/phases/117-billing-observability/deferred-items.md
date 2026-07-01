# Deferred Items — Phase 117 Billing Observability

## Pre-existing full-suite test failures (out of scope for 117-01)

**Found during:** Task verification step (`npx vitest run` full suite) for plan 117-01.

**Observation:** `npx vitest run` (full suite, no filter) reports 37 failed test files / 64 failed
tests out of 180 files / 1755 tests. None of the failing tests belong to
`tests/billing-webhook.test.ts` or `tests/billing-credit-rpcs.test.ts` (the two files this plan
touches) — both pass 100% in isolation and together (26/26 tests green).

The failing files span unrelated subsystems: `tests/auth/callback.test.ts`,
`tests/auth/members-actions.test.ts`, `tests/accounts-*.test.ts`, `tests/action-engine.test.ts`,
`tests/agents/*.test.ts`, `tests/contact-*.test.ts`, `tests/meta-webhook-*.test.ts`,
`tests/pipeline-*.test.ts`, `tests/opportunity-move.test.ts`, `tests/calendar-bookings.test.ts`,
`tests/widget-config-route.test.ts`, `tests/security-secdef-isolation.test.ts`, etc.

Representative errors seen:
- `Error: cookies was called outside a request scope` (tests/auth/callback.test.ts) — Next.js 16
  App Router dynamic API used outside a request context in a test harness.
- `TypeError: supabase.from(...).select is not a function` (tests/auth/members-actions.test.ts) —
  mock/client shape mismatch.
- Various assertion failures suggesting these tests depend on a live/seeded Supabase test database
  connection (RLS, cascading delete, dedup-by-phone, SECDEF isolation tests) that may not be
  reachable or seeded correctly in this execution environment.

**Action taken:** None — per plan scope (BOB-01/02/03 only touch the Stripe webhook route and
`meterDebit()`) and per the executor's SCOPE BOUNDARY rule, these are pre-existing failures in
unrelated files, not caused by this plan's changes. Logged here rather than fixed.

**Recommendation:** A follow-up phase/task outside `billing-robustness` should investigate whether
these failures are environment-specific (missing test DB seed/connection in this session) or a
genuine regression, since 64 failing tests across 37 files is a significant signal that shouldn't
be left unexamined long-term.
