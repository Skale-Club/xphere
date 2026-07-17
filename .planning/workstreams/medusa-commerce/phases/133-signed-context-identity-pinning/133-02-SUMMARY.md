---
phase: 133-signed-context-identity-pinning
plan: 02
subsystem: api
tags: [chat-route, hmac, anti-idor, fail-soft, vitest, zod, medusa]

# Dependency graph
requires:
  - phase: 133-01
    provides: "verifyCommerceContext(token, secret, expectedOrg), writeCommerceContext(supabase, conversationId, orgId, claims) in src/lib/medusa/context.ts"
provides:
  - "ChatRequestSchema.commerce_context: z.string().max(2048).optional() on the public chat route"
  - "A fail-soft verify+pin block in the chat route, running after session settle and before runAgent, zero-cost when commerce_context is absent"
  - "9 new chat-api.test.ts cases (commerce context describe block) covering absent/invalid/valid/no-creds/throw/boundary-length behavior"
affects: [133-03-widget-context-forwarding, 134-cart-write-tools, 135-wishlist-tools, 137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route-level fail-soft verify+pin: entire block wrapped in one try/catch, every branch (no creds, invalid claims, write throws) logs a warn and falls through — nothing in the block can turn a 200 SSE response into an error"
    - "Zero-cost-when-absent gating: the whole verify+pin block is skipped by a single `if (commerce_context)` guard, so orgs without a medusa integration never call getMedusaCredentialsForOrg or verifyCommerceContext"

key-files:
  created: []
  modified:
    - src/app/api/chat/[token]/route.ts
    - tests/chat-api.test.ts

key-decisions:
  - "Inserted the verify+pin block as new step '6b' (between the existing step 6 persist-message block and step 7 runAgent call) rather than renumbering all comments — keeps the diff additive-only per the plan's explicit instruction not to move rate-limit/URL-rules/session logic."
  - "Test mocks default mockVerify to resolve null and mockWrite to resolve null in the shared beforeEach — this means the 22 pre-existing tests (none of which send commerce_context) are structurally unaffected, since the whole block is skipped by the absent-token guard before either mock is ever invoked."

patterns-established:
  - "Anti-IDOR re-pin authority: the block's only input is the caller-supplied token, verified via HMAC against the org's decrypted Medusa connection token — no code path in the block reads message text or LLM/model output."

requirements-completed: [CTX-02]

# Metrics
duration: 15min
completed: 2026-07-17
---

# Phase 133 Plan 02: Chat Route Commerce-Context Wiring Summary

**`ChatRequestSchema` gains an optional 2048-char `commerce_context` field, verified and pinned into `conversations.memory.commerce` via Plan 01's `verifyCommerceContext`/`writeCommerceContext` in a single try/catch block that runs after session settle and before `runAgent`, with every failure path (no creds, invalid token, write exception) logging a warn and letting the chat stream 200 regardless.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-17T16:42:00Z (approx.)
- **Completed:** 2026-07-17T16:57:26Z
- **Tasks:** 1 completed (RED → GREEN TDD cycle; no REFACTOR needed)
- **Files modified:** 2

## Accomplishments
- `ChatRequestSchema.commerce_context` accepts an optional token up to 2048 chars; a 2049-char value is rejected with 400, absence is valid, and a 2048-char value is accepted.
- A fail-soft verify+pin block (step 6b) sits between the persist-message block and the `runAgent` call: `getMedusaCredentialsForOrg(org.id, supabase)` → `verifyCommerceContext(commerce_context, creds.connectionToken, org.id)` → `writeCommerceContext(supabase, ctx.dbSessionId, org.id, claims)`, entirely inside one try/catch.
- Zero extra cost when `commerce_context` is absent — proven by a test asserting `getMedusaCredentialsForOrg`/`verifyCommerceContext` are never called on the no-token path.
- Every failure branch (no creds for the org, verify returns null, write throws) logs a distinct warn event (`commerce_ctx_invalid` / `commerce_ctx_error`) and the response still streams a 200 SSE — proven by 5 separate test cases.
- The block's only trust input is the HMAC-verified token; it never reads cart/customer identity from message text or model output.

## Task Commits

Each task followed its own RED → GREEN TDD cycle:

1. **Task 1: commerce_context schema + fail-soft verify+pin block + chat-api tests**
   - `89228631` (test) — failing tests for commerce_context verify+pin block (RED: 3 of 29 fail against the pre-change route)
   - `e7e046e7` (feat) — wired commerce_context schema field + verify+pin block into the route (GREEN: 29/29 pass)

No REFACTOR commit was needed — the GREEN implementation matched the plan's reference block directly and required no cleanup pass.

**Plan metadata:** (this commit, following SUMMARY/STATE/ROADMAP updates)

## Files Created/Modified
- `src/app/api/chat/[token]/route.ts` — added `commerce_context` to `ChatRequestSchema`, destructured it, added the two new imports (`getMedusaCredentialsForOrg`, `verifyCommerceContext`/`writeCommerceContext`), and inserted the fail-soft verify+pin block before `runAgent`.
- `tests/chat-api.test.ts` — mocked `@/lib/medusa/credentials` and `@/lib/medusa/context` via `vi.hoisted`, added `beforeEach` defaults (creds present / verify null / write null), and added a `describe('commerce context (CTX-02)')` block with 7 new cases.

## Decisions Made
- Labeled the new block "6b" in an inline comment rather than renumbering the file's existing step comments — plan explicitly required an additive-only diff (no moving rate-limit/URL-rules/session logic).
- Kept the block's catch handler generic (`log.warn('commerce_ctx_error', ...)`) covering both the `getMedusaCredentialsForOrg` and `writeCommerceContext` failure surfaces, rather than separate try/catch per call — simpler and still satisfies "nothing throws out of the block."

## Deviations from Plan

None - plan executed exactly as written. The interfaces block's exact code (imports, schema field, destructure, and the verify+pin block) was used verbatim; the test cases enumerated in `<behavior>` were all implemented as specified.

## Issues Encountered
None — RED phase failed exactly the 3 assertions that depend on the new schema field/block (verify-called-with-args, write-called-with-args, >2048 rejected); the other 4 new test cases already passed against the unmodified route because they only assert non-invocation or 200-status, which were already true by omission. GREEN phase made all 29 pass on the first implementation pass.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CTX-02 (route half) is fully satisfied: the chat route accepts, verifies, and pins `commerce_context` before `runAgent`, fails soft on every error path, and costs nothing when absent.
- Ready for 133-03 (widget: `data-context-endpoint` same-origin fetch + conditional `commerce_context` POST + `Opps.setContext` + `build:widget` commit) — the route-side contract this plan implements is exactly what the widget will call.
- Scoped test gate green: `npx vitest run tests/chat-api.test.ts tests/medusa-context.test.ts` → 41/41 pass. `npm run build` green. Full `npm test` still carries the ~58 pre-existing unrelated failures noted in 133-RESEARCH.md and remains out of scope for this plan's gate.

---
*Phase: 133-signed-context-identity-pinning*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: src/app/api/chat/[token]/route.ts
- FOUND: tests/chat-api.test.ts
- FOUND: .planning/workstreams/medusa-commerce/phases/133-signed-context-identity-pinning/133-02-SUMMARY.md
- FOUND: commit 89228631 (test: failing commerce_context tests, RED)
- FOUND: commit e7e046e7 (feat: commerce_context verify+pin wiring, GREEN)
