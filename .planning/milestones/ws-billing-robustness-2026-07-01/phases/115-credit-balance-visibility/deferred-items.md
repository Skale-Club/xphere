# Deferred Items — Phase 115

Out-of-scope issues discovered during plan execution but not fixed, per the
GSD executor scope boundary (only auto-fix issues directly caused by the
current task's changes).

## Discovered during Plan 01 (2026-07-01)

Pre-existing failures found while running `npx vitest run` (full suite) and
`npx tsc --noEmit` (full project) to verify Plan 01's changes caused no
regressions. None of these touch `src/lib/billing/credits.ts` or
`src/components/billing/credits-card.tsx`; all reproduce identically on the
`dev` branch before Plan 01's changes (verified via `git stash`).

- `tests/auth/callback.test.ts` — 2 failures: `cookies()` called outside a
  request scope (Next.js `E251` — test harness doesn't wrap the route handler
  in a request-scoped context).
- `tests/auth/members-actions.test.ts` — multiple failures: Supabase client
  mock in the test harness doesn't implement `.select()` correctly for the
  `inviteMember`/`listMembers` code paths.
- `npx tsc --noEmit` (full project, non-credits files) — pre-existing type
  errors in `tests/agents/*.test.ts`, `tests/brand.test.ts`,
  `tests/chat-start-conversation.test.ts`, `tests/chat/conversation-pin.test.ts`,
  `tests/chat/conversation-priority.test.ts`,
  `tests/customfields-settings-actions.test.ts`,
  `tests/meta-inbox-bot-toggle.test.ts`, `tests/workflows/run-flow-sync.test.ts`,
  `tests/workflows/schema-validate.test.ts`, `tests/workflows/yaml-to-flow.test.ts`.
  Several `tests/workflows/*.test.ts` files are missing vitest globals imports
  (`describe`/`it`/`expect` reported as "Cannot find name") and
  `tests/chat*.test.ts` reference a module path
  (`src/app/(dashboard)/chat/actions`) that appears to have moved or been
  removed.
- Full project `tsc --noEmit` and `next build`'s internal TypeScript check
  both hit `FATAL ERROR: Ineffective mark-compacts near heap limit` (OOM) at
  default Node heap size on this machine; only resolved by raising
  `NODE_OPTIONS=--max-old-space-size=6144`. This is a local environment
  constraint, not a code defect — flagging in case CI has the same ceiling.

None of the above block Plan 01's `must_haves` or `success_criteria`, which
concern only `src/lib/billing/credits.ts` and
`src/components/billing/credits-card.tsx`.
