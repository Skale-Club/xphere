# Deferred Items — Phase 134 (Cart Write Tools)

Out-of-scope discoveries logged during plan execution, per the executor's
scope-boundary rule (only auto-fix issues directly caused by the current
task's changes).

## 1. Pre-existing flaky test: `tests/medusa-context.test.ts` "bad sig: a tampered signature returns null"

- **Found during:** 134-01, post-completion regression pass (running the
  broader test suite alongside `tests/medusa-cart-write.test.ts`)
- **File:** `tests/medusa-context.test.ts` (Phase 133 — `CTX-01:
  verifyCommerceContext`), last touched by commit `cc5bd1fe` (Phase 133-01),
  NOT part of this plan's `files_modified`
- **Symptom:** the test occasionally fails when run alongside other test
  files; passes reliably (5/5) in isolation
- **Likely cause (not confirmed/investigated further — out of scope):** the
  test mints a token with `iat: Math.floor(Date.now() / 1000)` (fresh per
  invocation) and tampers the LAST character of the base64url signature by
  flipping between two fixed characters ('A'/'B'). Base64url's final
  character in a 2-byte trailing group only encodes 2 meaningful bits (the
  other 4 are padding, discarded on decode) — depending on which two
  characters a given HMAC output's last base64 char and its flip-target fall
  on, the tamper can sometimes decode to the SAME byte array as the
  untampered signature, making `crypto.subtle.verify` correctly (but
  test-unexpectedly) return `true` for that specific run's signature bytes.
  This is a property of the fixed 'A'<->'B' flip strategy interacting with a
  non-deterministic (`Date.now()`-seeded) signature, not a bug in
  `verifyCommerceContext` itself.
- **Action taken:** none — logged only. Not fixed, since it is unrelated to
  any file this plan (134-01) touches (`cart-sig.ts`, `context.ts`'s new
  `pinCartId`/`bumpConversationWriteCount`, `client.ts`, `idempotency.ts`,
  `guardrails.ts`, the two new executors, `medusa-cart-write.test.ts`,
  `agent-delegation.test.ts`). `verifyCommerceContext` and its `hmacKey`
  helper were not modified by this plan.
- **Suggested fix (for whoever picks this up):** tamper a byte that is
  guaranteed to affect decoded bytes regardless of `iat` (e.g. flip a
  character in the middle of the signature, not the last char), or tamper
  the underlying `Uint8Array` before re-encoding instead of string-editing
  the base64url text.

## 2. ROADMAP.md checkbox/count drift: 131-02-PLAN.md and the workstream plan totals

- **Found during:** 134-03, while updating `.planning/workstreams/medusa-commerce/ROADMAP.md` and `STATE.md`'s progress counters
- **File:** `.planning/workstreams/medusa-commerce/ROADMAP.md` (Phase 131 plan list), `.planning/workstreams/medusa-commerce/STATE.md` (`progress.completed_plans` frontmatter)
- **Symptom:** `131-02-PLAN.md` is checked `[ ]` (incomplete) in ROADMAP.md's Phase 131 plan list, but `131-02-SUMMARY.md` exists on disk (dated 2026-07-17) — the plan was actually completed, the checkbox was just never flipped. This left `STATE.md`'s `completed_plans` counter one behind the true on-disk count (11 instead of 12, pre-134-03) each time it was recalculated by hand.
- **Action taken:** `STATE.md`'s `completed_plans` was corrected to the true on-disk SUMMARY.md count (13, all of 131/132/133/134's plans) as part of this plan's STATE.md update — a factual correction, not a scope expansion. The `131-02-PLAN.md` checkbox in ROADMAP.md itself was left unfixed (out of scope for 134-03, unrelated file section) — its stale `[ ]` should be flipped to `[x]` ✅ 2026-07-17 by whoever next touches Phase 131's ROADMAP.md section.
- **Suggested fix:** flip `131-02-PLAN.md`'s checkbox to `[x]` with a completion date in ROADMAP.md's Phase 131 section.
