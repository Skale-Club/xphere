---
phase: 133-signed-context-identity-pinning
verified: 2026-07-17T17:25:00Z
status: passed
score: 3/3 requirements (14/14 must-have truths) verified
re_verification:
  previous_status: none
  note: "Initial verification — no prior VERIFICATION.md existed"
scoped_gate:
  tests: "tests/medusa-context.test.ts + tests/chat-api.test.ts + tests/widget.test.ts → 52/52 passed"
  build: "npm run build → success (postbuild verify-sw OK)"
  build_widget: "npm run build:widget → success; rebuilt public/widget.js byte-identical to committed (clean git status)"
human_verification:
  - test: "Live cross-repo widget forwarding: load public/widget-test.html against a running xphere + stuscle stack, set data-context-endpoint to stuscle's /api/chat-context mint route, confirm the POST to /api/chat includes commerce_context sourced from the storefront's httpOnly cart/customer cookies, and that the pinned cart is honored by getMedusaCart."
    expected: "commerce_context present on POST only when the same-origin endpoint returns a token; Opps.setContext(token) replaces the cached token; a cart_created SSE forces a re-fetch."
    why_human: "Requires a live same-origin host page with httpOnly cookies + a running stuscle mint route; jsdom cannot exercise a real cross-origin/same-origin cookie fetch. E2E-deferred (no live stack) — NOT a phase sign-off blocker given the scoped automated coverage + build."
---

# Phase 133: Signed Context & Identity Pinning Verification Report

**Phase Goal:** Bind the conversation to the visitor's real cart/customer via the storefront-signed token (IDOR barrier); the widget fetches/forwards the token.
**Verified:** 2026-07-17T17:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

This is the security-critical anti-IDOR phase. Verification focused on the four load-bearing facts: (1) the raw-UTF-8 HMAC key encoding that makes xphere's Web Crypto `verify` agree byte-for-byte with stuscle's `node:crypto` mint, (2) a committed cross-repo test vector locking that agreement, (3) pinned claim key names (`cart`/`cus`) matching the shipped Phase 132 reader with a read-back proof, and (4) fail-soft server wiring + same-origin conditional widget forwarding.

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | HMAC key = raw UTF-8 bytes of the connection token (no hex-decode) | ✓ VERIFIED | `context.ts:37` `crypto.subtle.importKey('raw', encoder.encode(secret), …)`. No `parseInt`/slice-loop hex logic; the 3 "hex" hits are comments (L10/34/35) warning against it |
| 2 | verify recomputes HMAC over the base64url payload STRING, timing-safe | ✓ VERIFIED | `context.ts:76` `crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), encoder.encode(payloadB64))` (constant-time) |
| 3 | verify checks exp (unix seconds) + org + v===1 | ✓ VERIFIED | `context.ts:82` `c.v !== 1`, `:83` `c.exp <= Math.floor(Date.now()/1000)`, `:84` `c.org !== expectedOrg` |
| 4 | verify returns null (never throws) on invalid/expired/bad-sig/wrong-org/malformed | ✓ VERIFIED | `context.ts:70-88` try/catch → null; every guard returns null. Test "malformed: never throws" asserts `.resolves.toBeNull()` for no-dot/empty/non-b64/non-JSON/v2 |
| 5 | Committed cross-repo node:crypto TEST VECTOR present and green | ✓ VERIFIED | `medusa-context.test.ts:55-73` hardcoded VECTOR_TOKEN `0eybqLBP…qeDA` + `createHmac` mint helper; test passes |
| 6 | writeCommerceContext pins `{cart, cus, email, wishlist_ref, country_code, region_id, verified_at}` | ✓ VERIFIED | `context.ts:118-126` verbatim claim keys |
| 7 | No `cart_id`/`customer_id` in context.ts | ✓ VERIFIED | `grep -c "cart_id\|customer_id"` → 0 |
| 8 | JSONB read-merge-write preserves other memory keys | ✓ VERIFIED | `context.ts:130` `.update({ memory: { ...memory, commerce } })`; test "merge preserves" asserts `memory.existingKey === 1` |
| 9 | Read-back drives the real Phase 132 loadPinnedContext and gets the pinned cart | ✓ VERIFIED | `medusa-context.test.ts:185-203` writes claims → feeds captured memory into real `loadPinnedContext` → `commerce.cart === 'cart_1'`; `get-cart.ts:33` reads the same `commerce.cart` key |
| 10 | Chat route ChatRequestSchema has `commerce_context` (max 2048) | ✓ VERIFIED | `route.ts:45` `commerce_context: z.string().max(2048).optional()`; tests: 2048 accepted, 2049 → 400 |
| 11 | verify+pin block runs after session settle, before runAgent | ✓ VERIFIED | `route.ts:204-219` block; `route.ts:222` `runAgent(…)` — block precedes it; uses `ctx.dbSessionId` |
| 12 | Fully fail-soft: absent → no creds lookup; invalid → warn+continue; never throws | ✓ VERIFIED | `route.ts:204` `if (commerce_context)` guard; `:216-218` catch → warn; tests assert `mockGetCreds`/`mockVerify` not called when absent, 200 stream on invalid/throw |
| 13 | Never pins from message text — only the HMAC-verified token | ✓ VERIFIED | `route.ts:208-210` sole input is `commerce_context` → verify → claims → write; no message/model path into the pin |
| 14 | Widget fetches data-context-endpoint SAME-ORIGIN, conditionally forwards, Opps.setContext, cart_created cache-clear; widget.js rebuilt+committed | ✓ VERIFIED | `index.ts:777` `fetch(contextEndpoint, { credentials: 'same-origin' })` (not apiBase-prefixed); `:633` conditional spread; `:1136` `Opps.setContext`; `:852-855` cart_created clears cache; `public/widget.js` tracked (grep `commerce_context`→1) |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/medusa/context.ts` | verify (raw-utf8 key) + write (contract claim names) + read wrapper | ✓ VERIFIED | Exports `verifyCommerceContext`, `writeCommerceContext`, `readCommerceContext`, `CommerceClaims`. Type-checks in `npm run build` |
| `tests/medusa-context.test.ts` | verify matrix + cross-repo vector + pin/repin/read-back | ✓ VERIFIED | `createHmac` mint helper + committed literal vector; 12 tests green |
| `src/app/api/chat/[token]/route.ts` | schema field + fail-soft verify+pin block before runAgent | ✓ VERIFIED | Imports at L19-20; block L204-219; wired to `getMedusaCredentialsForOrg`/`verify`/`write` |
| `tests/chat-api.test.ts` | absent/invalid/valid/no-creds/throw/boundary cases | ✓ VERIFIED | `describe('commerce context (CTX-02)')` L430+; all green |
| `src/widget/index.ts` | same-origin fetch + conditional forward + setContext + cart_created | ✓ VERIFIED | `_contextEndpoint` capture L476, `ensureContext` L770, `Opps.setContext` L1136 |
| `public/widget.js` | rebuilt + committed, contains commerce_context | ✓ VERIFIED | Tracked in git (commit 292285d9), rebuild is byte-identical (clean status) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| verifyCommerceContext | connection token as raw UTF-8 HMAC key | `importKey('raw', encoder.encode(secret))` | ✓ WIRED | `context.ts:37` — no hex decode |
| writeCommerceContext | `conversations.memory.commerce.cart` (get-cart.ts reads it) | read-merge-write `{...memory, commerce}` with `cart: claims.cart` | ✓ WIRED | `context.ts:119,130`; read-back test proves reachability |
| chat route (after session, before runAgent) | verify + write | `getMedusaCredentialsForOrg(org.id) → verify(token, connectionToken, org.id) → write(supabase, ctx.dbSessionId, org.id, claims)` | ✓ WIRED | `route.ts:206-210` |
| verify+pin block | SSE response (must not block) | try/catch fail-soft, warn + continue | ✓ WIRED | `route.ts:205-218` |
| widget | data-context-endpoint (same-origin) | `fetch(contextEndpoint, {credentials:'same-origin'})` — never apiBase-prefixed | ✓ WIRED | `index.ts:777` |
| widget chat POST | commerce_context (only when present) | `...(commerceContext ? { commerce_context } : {})` | ✓ WIRED | `index.ts:633` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| chat route pin | `claims` | HMAC-verified token (verify returns parsed claims) → `writeCommerceContext` JSONB update | Yes — pin is written to `conversations.memory.commerce` and read back by shipped `loadPinnedContext`/`get-cart.ts` | ✓ FLOWING |
| widget POST body | `commerceContext` | `ensureContext()` same-origin fetch of the mint endpoint | Conditional — token present only when endpoint returns one (E2E-deferred for live cookie source) | ⚠️ STATIC in jsdom / real in prod (deferred) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Scoped test gate | `CI=true npx vitest run tests/medusa-context.test.ts tests/chat-api.test.ts tests/widget.test.ts --reporter=dot` | 52/52 passed (3 files) | ✓ PASS |
| Cross-repo HMAC vector | included in above run | green (raw-utf8 verify = true for node:crypto mint) | ✓ PASS |
| Production build | `npm run build` | success; postbuild verify-sw OK | ✓ PASS |
| Widget bundle build | `npm run build:widget` | success; rebuilt widget.js byte-identical to committed (clean git status) | ✓ PASS |
| widget.js contains commerce_context | `grep -c commerce_context public/widget.js` | 1 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CTX-01 | 133-01 | verifyCommerceContext — HMAC timing-safe + exp + org, fail-soft | ✓ SATISFIED | Truths 1-5; raw-utf8 key + cross-repo vector + null-on-all-invalid, all green |
| CTX-02 | 133-01, 133-02 | Route accepts commerce_context (≤2048), merges verified claims into memory.commerce; re-pin only from verified token | ✓ SATISFIED | Truths 6-13; write under contract keys + read-back + fail-soft route block, all green |
| CTX-03 | 133-03 | Widget fetches token from data-context-endpoint (cache until exp), sends on POST, exposes Opps.setContext; widget rebuilt | ✓ SATISFIED | Truth 14; same-origin conditional forward + setContext + cart_created + committed bundle. Live browser forward E2E-deferred |

No orphaned requirements: REQUIREMENTS.md maps only CTX-01/02/03 to this phase, all claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| context.ts | 10/34/35 | word "hex" | ℹ️ Info | Comments explicitly warning NOT to hex-decode — the opposite of a stub; no hex-decode logic exists |
| index.ts | 852-855, 863 | inert `cart_created` branch / empty `tool_call` branch | ℹ️ Info | `cart_created` emitter ships in Phase 134 (documented, by design); `tool_call` no-op per D-09 |

No blocker or warning anti-patterns. No TODO/FIXME/placeholder/stub in the phase's source.

### Human Verification Required

1. **Live cross-repo widget forwarding (widget-test.html)** — E2E-deferred, NOT a sign-off blocker.
   - **Test:** With xphere + stuscle both running, load `public/widget-test.html`, point `data-context-endpoint` at stuscle's `/api/chat-context` mint route, send a chat.
   - **Expected:** POST to `/api/chat` includes `commerce_context` sourced from the storefront's httpOnly cart/customer cookies; the pinned cart is honored by `getMedusaCart`; `Opps.setContext(token)` replaces the cached token; a `cart_created` SSE forces a re-fetch.
   - **Why human:** Requires a live same-origin host page with httpOnly cookies + a running stuscle mint route; jsdom cannot exercise a real cookie-backed same-origin fetch. Covered structurally by the scoped tests (absent endpoint → byte-identical POST) + the green build.

### Gaps Summary

No gaps. The anti-IDOR core is fully verified against the actual codebase:

- **Raw-UTF-8 HMAC key** (`importKey('raw', encode(secret))`, no hex-decode) is present and locked by a committed `node:crypto` cross-repo vector that verifies green — this is the single fact that makes xphere agree with stuscle's mint, and it holds.
- **Pin key names** (`cart`/`cus`, not `cart_id`/`customer_id`) match the shipped Phase 132 reader, proven by a read-back test that drives the real `loadPinnedContext` and recovers the pinned cart — the pin is usable, not silently dead.
- **Route wiring** verifies+pins after session settle, before `runAgent`, is fully fail-soft (absent = zero cost, invalid = warn+continue, throws swallowed), and pins ONLY from the HMAC-verified token — never message text.
- **Widget** fetches the context endpoint same-origin (not apiBase-prefixed), forwards `commerce_context` only when present, exposes `Opps.setContext`, clears cache on `cart_created`; the rebuilt `public/widget.js` is committed and byte-identical to a fresh build.

Scoped gate: 52/52 tests green; `npm run build` + `npm run build:widget` succeed. The one manual browser check (live cookie-backed forwarding) is E2E-deferred with no live stack and does not block phase sign-off given the scoped automated coverage + build.

---

_Verified: 2026-07-17T17:25:00Z_
_Verifier: Claude (gsd-verifier)_
