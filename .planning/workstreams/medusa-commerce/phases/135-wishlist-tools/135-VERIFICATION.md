---
phase: 135-wishlist-tools
verified: 2026-07-17T00:00:00Z
status: passed
score: 7/7 must-haves verified
requirements:
  WSL-01: satisfied
  WSL-02: satisfied
security:
  signing_vector_byte_match: true
  cross_repo_target: "stuscle apps/backend/src/api/agent/_utils/verify-hmac.ts"
human_verification:
  - test: "Live signed /agent/wishlists/* round trip against a running Stuscle backend"
    expected: "agent 'save this for later' → stuscle wishlist row; 'my wishlist?' → renders items; 401 on tampered signature"
    why_human: "Needs both stacks up (stuscle Medusa + Postgres); E2E-deferred per 135-VALIDATION.md Manual-Only table — NOT a gap"
---

# Phase 135: Wishlist Tools Verification Report

**Phase Goal:** The agent saves/lists/removes wishlist items for the visitor via Stuscle's HMAC-guarded `/agent/*` surface.
**Verified:** 2026-07-17
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `signAgentBody = hex(HMAC(connectionToken, ts + "." + rawBody))` byte-matches stuscle's `verify-hmac.ts` | ✓ VERIFIED | `agent-sig.ts:25-35` signs `encoder.encode(`${ts}.${rawBody}`)`, raw-UTF8 key, `['sign']`, bare lowercase hex. Independent Node `createHmac` recompute of both committed vectors matched (see Behavioral Spot-Checks). Cross-repo: `"v1="+xphereHex === stuscle recompute` → **true**. |
| 2 | `medusaAgentFetch` stringify-once/sign-that/send-that; header ts == signed ts; `v1=` applied once; R11 before fetch; 8s timeout; `MedusaApiError` on non-2xx | ✓ VERIFIED | `client.ts:79-105`: `JSON.stringify` count = 1 (raw reused for sign + body), `X-Xphere-Timestamp: ts`, `X-Xphere-Signature: v1=${sig}` (only `v1=` write-site in `src/lib/medusa/`), R11 `medusa:org:${orgId}` 120/60 memory BEFORE fetch, `AbortSignal.timeout(8000)`, throws `MedusaApiError(res.status, ...)` on `!res.ok`. |
| 3 | 3 executors resolve owner ONLY from pinned `commerce.cus` else `commerce.wishlist_ref`; NO owner param in any tool schema | ✓ VERIFIED | `wishlist-owner.ts:16-22` (cus wins, empty-string falls through, else null). Executors read owner only from `resolveWishlistOwner(commerce)`; `params` supplies only `product_id`/`variant_id`. Spec `params_schema`: add/remove = `{product_id, variant_id}`, list = `{}`. Zero owner param KEYS in any schema. |
| 4 | Friendly no-owner + 409 `wishlist_full` + 401 handling; never throws into tool loop | ✓ VERIFIED | All 3 executors wrap in try/catch; no-owner returns friendly string with NO store call; add maps 409 → "wishlist is full (100 items max)"; 401 falls to generic default (not a user-input error); `MedusaRateLimitError`/`TimeoutError` branches; default returns a string — nothing rethrows. |
| 5 | add/remove in `SIDE_EFFECTING_ACTIONS` but NOT `COMMERCE_WRITE_ACTIONS`; add/remove R7/R8 (closed) shared keys; list R6 (memory) | ✓ VERIFIED | `idempotency.ts:23-36` has add+remove (list absent); `COMMERCE_WRITE_ACTIONS` (`:45`) unchanged = exactly 2 cart writes. add/remove use `com:write:` (R7 10/60 closed) + `com:write:day:` (R8 60/86400 closed); list uses `com:read:` (R6 30/60 memory). Shared keys with cart writes. |
| 6 | `execute-action.ts` real-dispatches wishlist add/remove/list; `get_order_status` sole stub; exhaustive switch compiles | ✓ VERIFIED | `execute-action.ts:503-519`: real dispatch block (never-throw guard → `getMedusaCredentialsForOrg` → executor); `medusa_get_order_status` (`:518`) is the only remaining stub; `default: never` (`:520-524`) — `npm run build` "Compiled successfully" proves all nine `medusa_*` types handled. |
| 7 | `ACTION_DESCRIPTIONS` + 3 spec NODES for the wishlist tools | ✓ VERIFIED | `run-agent.ts:236-241` (3 DATA-framed descriptions); `spec.ts:415-438` (3 `kind:'action'` NODES, `integration_required:['medusa']`, no owner params). |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/lib/medusa/agent-sig.ts` | `signAgentBody` bare-hex HMAC | ✓ VERIFIED | Exists, substantive, imported by `client.ts`; NEVER prepends `v1=` |
| `src/lib/medusa/client.ts` | `medusaAgentFetch` signed POST | ✓ VERIFIED | Exists; signs-then-sends identical string; R11 pre-fetch; 8s abort |
| `src/lib/medusa/wishlist-owner.ts` | `resolveWishlistOwner` exactly-one-key-or-null | ✓ VERIFIED | Imported by all 3 executors |
| `src/lib/medusa/actions/wishlist-add.ts` | `addWishlistItem` | ✓ VERIFIED | Wired in `execute-action.ts:509`; 409/R7/R8/never-throw |
| `src/lib/medusa/actions/wishlist-remove.ts` | `removeWishlistItem` | ✓ VERIFIED | Wired in `execute-action.ts:510`; idempotent-safe wording |
| `src/lib/medusa/actions/wishlist-list.ts` | `listWishlist` (creds, ctx) — no params | ✓ VERIFIED | Wired in `execute-action.ts:511`; R6 memory; empty-state string |
| `src/lib/action-engine/execute-action.ts` | real dispatch | ✓ VERIFIED | 3 imports + real-dispatch block; get_order_status sole stub |
| `src/lib/agent-runtime/idempotency.ts` | SIDE_EFFECTING += add/remove | ✓ VERIFIED | list excluded; COMMERCE_WRITE_ACTIONS untouched |
| `src/lib/agent-runtime/run-agent.ts` | 3 ACTION_DESCRIPTIONS | ✓ VERIFIED | prompt-injection-safe DATA framing |
| `src/lib/workflows/spec.ts` | 3 NodeSpec entries | ✓ VERIFIED | no owner params; medusa-gated |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| wishlist-add.ts | `medusaAgentFetch → /agent/wishlists/add` | signed POST | ✓ WIRED (`:52-57`) |
| client.ts medusaAgentFetch | agent-sig.ts signAgentBody | sign `ts+'.'+rawBody`, header `v1=<hex>` | ✓ WIRED (`client.ts:90,98`) |
| wishlist executors | resolveWishlistOwner(commerce) | owner = cus else wishlist_ref else null | ✓ WIRED (all 3) |
| add/remove | R7 `com:write:` + R8 `com:write:day:` (closed) | shared cart-write keys | ✓ WIRED |
| list | R6 `com:read:` (memory) | shared cart-read key | ✓ WIRED |
| execute-action wishlist block | getMedusaCredentialsForOrg → executors | real dispatch | ✓ WIRED (`:503-511`) |
| spec.ts NODES | LLM selection (medusa-filtered) | `integration_required:['medusa']` | ✓ WIRED |
| idempotency SIDE_EFFECTING_ACTIONS | run-agent idempotency layer | add/remove registered, list excluded | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Committed vector 1 (CONTEXT) | Node `createHmac("sha256","test-secret").update('1750000000.{"a":1}').digest("hex")` | `1f11cf9a…5bff50c4` | ✓ PASS (== expected) |
| Committed vector 2 (realistic add) | Node `createHmac` over `xph_test_connection_token_abc123` / realistic body | `f5817eb8…bdcf5474` | ✓ PASS (== expected) |
| Cross-repo byte agreement | `"v1="+xphereHex === stuscle verify-hmac recompute` | true | ✓ PASS |
| 5 scoped test files | `CI=true npx vitest run …agent-fetch/wishlist/dispatch/wiring/spec` | 66 passed (66) | ✓ PASS |
| Type/build gate | `npm run build` | "✓ Compiled successfully in 27.6s" (exhaustive `default:never` holds) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| WSL-01 | 135-01, 135-02 | `medusa_wishlist_add/remove/list` via signed `/agent/wishlists/*`; owner from pinned context only | ✓ SATISFIED | Truths 1-4, 6, 7 |
| WSL-02 | 135-01, 135-02 | HMAC signing helper (ts+"."+rawBody) unit-tested; add/remove side-effecting (R7/R8); list read (R6) | ✓ SATISFIED | Truths 1, 5; committed vector green |

No orphaned requirements — WSL-01/WSL-02 both claimed by both plans and marked `[x]` in workstream REQUIREMENTS.md.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
| --- | --- | --- | --- |
| — | none | — | No TODO/FIXME/placeholder/empty-return stubs in the 10 touched source files. `owner` appears only as a resolved local var / description prose, never as a tool-schema param key. |

Note on anti-IDOR grep: `customer_id`/`guest_ref`/`owner` DO appear textually (executor local variable `owner`, a spec description string "owner bound to the conversation", and file comments), but ZERO appear as `params_schema` property keys or as `params.*` reads — the anti-IDOR structural guarantee (no caller-supplied identifier channel) holds.

### Human Verification Required

1. **Live signed `/agent/wishlists/*` round trip against a running Stuscle backend** — agent "save this for later" → stuscle wishlist row; "my wishlist?" → renders items; 401 on tampered signature. E2E-deferred per 135-VALIDATION.md (needs stuscle Medusa + Postgres up). This is a documented deferral, NOT a gap — the byte-agreement that this E2E would exercise is already proven against `verify-hmac.ts` at the unit level.

### Gaps Summary

None. All 7 must-haves verified, all 66 scoped tests green, build compiles, and the HMAC signing vector byte-matches stuscle's `verify-hmac.ts` convention (`"v1=" + hex(hmac(secret, ts + "." + rawBody))`) both for the CONTEXT-mandated vector and the realistic-add vector. Owner identity is structurally pinned-only (no owner param in any tool schema). R6/R7/R8 budgets and the SIDE_EFFECTING-vs-COMMERCE_WRITE split match the contract. The only outstanding item is the live cross-stack round trip, which is intentionally E2E-deferred.

---

_Verified: 2026-07-17_
_Verifier: Claude (gsd-verifier)_
