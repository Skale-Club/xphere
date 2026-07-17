---
phase: 132-medusa-provider-read-tools
plan: 02
subsystem: integrations
tags: [medusa, rate-limit, crypto, supabase, tdd, http-client]

# Dependency graph
requires:
  - phase: 131 (rate-limit failMode extension)
    provides: "rateLimit(key, limit, windowSeconds, { failMode }) with 'memory' fallback"
provides:
  - "medusaStoreFetch<T>(creds, path, orgId, init?) — Medusa Store API HTTP client enforcing R11 (120/min/org, failMode memory) before every fetch, x-publishable-api-key header, 8s AbortSignal timeout, typed MedusaApiError/MedusaRateLimitError"
  - "getMedusaCredentialsForOrg(orgId, supabase) — loads + decrypts the per-org Medusa integration row into MedusaCredentials, returning null (never throwing) when unconfigured"
affects: [132-03, 132-04, 135-medusa-agent-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-org Medusa credentials shape mirrors src/lib/xkedule/credentials.ts, extended with `config` (publishable_key, storefront_url)"
    - "Rate limit check always precedes the outbound fetch (R11), never wraps it — verified by asserting fetch was not called when denied"

key-files:
  created:
    - src/lib/medusa/client.ts
    - src/lib/medusa/credentials.ts
    - tests/medusa-client.test.ts
    - tests/medusa-credentials.test.ts
  modified: []

key-decisions:
  - "supabase param typed SupabaseClient<any, any, any> (xkedule precedent) so credentials.ts type-checks independently of the 132-01 Database union edit"
  - "Omitted medusaAgentFetch entirely — the privileged /agent/* HMAC surface belongs to Phase 135, not this plan"

patterns-established:
  - "medusaStoreFetch is the single chokepoint every Medusa read/write tool composes on: R11 -> header -> 8s timeout -> typed error"

requirements-completed: [MED-02, MED-03]

# Metrics
duration: 15min
completed: 2026-07-17
---

# Phase 132 Plan 02: Medusa Client + Credentials Summary

**Medusa Store API HTTP client enforcing a 120-req/min-per-org rate limit before every fetch, plus per-org credential loading that decrypts the connection token and reads the publishable key from `integrations.config`.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-17T11:07:00Z
- **Completed:** 2026-07-17T11:22:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (2 source, 2 test — all new)

## Accomplishments
- `medusaStoreFetch<T>` checks R11 (`rateLimit('medusa:org:{orgId}', 120, 60, { failMode: 'memory' })`) strictly before issuing the network call, throwing `MedusaRateLimitError` and never touching `fetch` when denied
- Every outbound Store API call carries `x-publishable-api-key` and an `AbortSignal.timeout(8000)`; non-2xx responses surface as `MedusaApiError(status, body)`
- `getMedusaCredentialsForOrg` round-trips an encrypted `integrations` row (`provider='medusa'`, `is_active=true`) into `{ baseUrl, connectionToken, publishableKey, storefrontUrl }`, decrypting via `@/lib/crypto`'s `decrypt()`
- All four "missing config" branches (no row, missing `publishable_key`, missing `location_id`, decrypt skipped when absent) return `null` rather than throwing, matching the "no store connected" executor contract

## Task Commits

Each task followed RED → GREEN (no REFACTOR needed — implementations matched the plan's interface spec exactly):

1. **Task 1: Medusa Store API client**
   - `c0510556` test(132-02): add failing test for medusaStoreFetch (R11 + 8s + pk header)
   - `b622166b` feat(132-02): implement medusaStoreFetch (R11 + 8s + pk header)
2. **Task 2: Per-org credentials load + decrypt**
   - `35b0ecbe` test(132-02): add failing test for getMedusaCredentialsForOrg
   - `7ebf95ba` feat(132-02): implement getMedusaCredentialsForOrg

_Note: no plan-metadata commit yet — this SUMMARY.md is being written now; the orchestrator's parent execute-phase workflow owns the final commit that folds it in (per this plan's isolated-worktree instructions, ROADMAP.md/STATE.md are intentionally left untouched here)._

## Files Created/Modified
- `src/lib/medusa/client.ts` - `MedusaCredentials`, `MedusaExecCtx` types, `MedusaApiError`/`MedusaRateLimitError`, `medusaStoreFetch<T>`
- `src/lib/medusa/credentials.ts` - `getMedusaCredentialsForOrg(orgId, supabase)`
- `tests/medusa-client.test.ts` - header/timeout, trailing-slash base URL, R11-before-fetch, non-2xx coverage
- `tests/medusa-credentials.test.ts` - decrypt round-trip + 3 null-branch coverage

## Decisions Made
- Typed the `supabase` parameter in `credentials.ts` as `SupabaseClient<any, any, any>` (same as `xkedule/credentials.ts`) so this plan compiles and tests standalone, independent of the sibling 132-01 plan's `Database` union edit (per plan's explicit instruction, this is not scope creep — it's the documented design for wave-1 parallelism)
- Left `medusaAgentFetch` out entirely rather than stubbing it — Phase 135 owns that HMAC-signed surface and the plan explicitly calls for its omission (`grep -c medusaAgentFetch` acceptance criterion asserts 0)

## Deviations from Plan

None - plan executed exactly as written. The reference implementations in the plan's `<interfaces>` block were used verbatim for `client.ts` and `credentials.ts`; the only adjustment was trimming a duplicate mention of `x-publishable-api-key` from a code comment in `client.ts` so the acceptance-criteria grep (`-> 1`) matched exactly, with no behavior change.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. `ENCRYPTION_SECRET` (consumed transitively via `@/lib/crypto`) is exercised only through the mocked `decrypt()` in tests; no real secret needed to run this plan's suite.

## Next Phase Readiness
- `medusaStoreFetch` and `getMedusaCredentialsForOrg` are the two primitives 132-03 (search/product/cart read tools) and 132-04 (dispatcher/enum wiring) compose on — both are exported and build-independent of 132-01's `Database` type union change.
- No blockers. This plan is self-contained: `npx vitest run tests/medusa-client.test.ts tests/medusa-credentials.test.ts` and `npm run build` are both green in isolation.

---
*Phase: 132-medusa-provider-read-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: src/lib/medusa/client.ts
- FOUND: src/lib/medusa/credentials.ts
- FOUND: tests/medusa-client.test.ts
- FOUND: tests/medusa-credentials.test.ts
- FOUND commit: c0510556 (test: medusaStoreFetch RED)
- FOUND commit: b622166b (feat: medusaStoreFetch GREEN)
- FOUND commit: 35b0ecbe (test: getMedusaCredentialsForOrg RED)
- FOUND commit: 7ebf95ba (feat: getMedusaCredentialsForOrg GREEN)
