# Deferred Items — Phase 128 (reliable-calendar-scheduling)

## Plan 128-05: pre-existing `npm test` full-suite noise, out of scope

Plan 128-05's own verification target (`npx vitest run tests/calendar-tick-route.test.ts
tests/calendar-tick-window.test.ts tests/calendar-tick-idempotency.test.ts
tests/workflow-seeds-tenant-neutral.test.ts`) is fully green (33/33 tests), and
`npm run build` passes with zero type errors.

The plan's `<verification>` block additionally asks for `npm test` (full suite) to
succeed. Running it produced **62 failing tests across 34 files**, none of which
touch `src/app/api/cron/calendar-tick/`, `src/lib/calendar/tick.ts`, or
`tests/calendar-tick-*.test.ts`. Examples: `tests/widget-config-route.test.ts`,
`tests/zernio-process-event.test.ts`, `tests/auth/callback.test.ts`,
`tests/auth/members-actions.test.ts`, `tests/action-engine.test.ts`,
`tests/contacts-crud.test.ts`, `tests/pipeline-crud.test.ts`,
`tests/agent-schema-seed.test.ts`, `tests/meta-webhook-*.test.ts`, etc.

Confirmed pre-existing / environmental, not caused by this plan's changes:
- `tests/calendar-overlap-constraint.test.ts` (a real-DB test in the same
  `src/lib/calendar/` area as this plan) **fails inside the full-suite run** but
  **passes cleanly in isolation** (`npx vitest run tests/calendar-overlap-constraint.test.ts`
  → 4/4 green). This is consistent with real-DB test connection/isolation
  contention when ~200 test files run in parallel in this worktree environment,
  not a regression introduced by Plan 128-05.
- Other failures span unrelated subsystems (auth callback cookie-scope errors,
  Next.js request-context errors, widget config defaults, Zernio webhook
  processing, members actions, pipeline/contacts CRUD) that this plan's diff
  (`src/app/api/cron/calendar-tick/route.ts`, `tests/calendar-tick-route.test.ts`)
  cannot affect.

Per the executor's scope boundary (only auto-fix issues directly caused by the
current task's changes), these are logged here and left unfixed. Recommend
`/gsd:verify-work` re-run `npm test` in a lower-parallelism mode (or accept the
per-plan targeted suite as the completion gate) rather than treating full-suite
red as a Plan 128-05 regression.
