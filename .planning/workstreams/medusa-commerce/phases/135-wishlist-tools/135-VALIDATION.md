---
phase: 135
slug: wishlist-tools
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 135 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; `tests/**`) |
| **Quick run command** | `CI=true npx vitest run tests/medusa-agent-fetch.test.ts tests/medusa-wishlist.test.ts --reporter=dot` |
| **Full suite** | `npm test` (~58 pre-existing unrelated failures — do NOT gate on it) |
| **Type gate** | `npm run build` |
| **Estimated runtime** | quick < 10s |

---

## CRITICAL cross-repo facts (from research)

1. **Signed-message byte agreement** with stuscle's `verify-hmac.ts`: `X-Xphere-Signature: v1=<hex hmac_sha256(connectionToken, timestamp + "." + rawBodyString)>` + `X-Xphere-Timestamp: <ts>`. `medusaAgentFetch` reuses Phase 134's `cart-sig.ts` raw-UTF8-key/hex Web Crypto convention (byte-verified subtle.sign === Node createHmac). RULES: stringify the body ONCE, sign THAT exact string, send THAT exact string; header `ts` == the signed `ts`; the `v1=` prefix applied exactly once. Commit the CONTEXT vector: `test-secret` / `1750000000` / `{"a":1}` → `v1=1f11cf9a…`.
2. **Owner from pinned context ONLY**: `commerce.cus` (→ body `customer_id`) else `commerce.wishlist_ref` (→ body `guest_ref`); neither → friendly "nothing saved yet + how it works" string. NO owner param in any tool schema.
3. **Idempotent-safe wording**: stuscle can't distinguish "already saved" vs "newly saved" (add returns 200 either way) — tool result strings must not over-claim.
4. **Budgets (contract §7, per research recommendation)**: add/remove are side-effecting → `SIDE_EFFECTING_ACTIONS` + R7 (`com:write:{sessionKey}` 10/60 closed) + R8 (`com:write:day:{convId}` 60/86400 closed), SHARED keys with cart writes. list → R6 (`com:read:{sessionKey}` 30/60 memory). Wishlist writes do NOT join the cart-specific 3/turn + 25/conversation caps (CONTEXT locks only R7/R8 + SIDE_EFFECTING).
5. Errors: stuscle 409 {error:wishlist_full} → "wishlist is full (100 items)"; 401 → generic failure; 200 → success.

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every wave:** quick run + `npm run build`
- **Before verify-work:** scoped tests + `npm run build` green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task | Requirement | Type | Automated Command | Status |
|------|-------------|------|-------------------|--------|
| medusaAgentFetch signed POST (ts+"."+rawBody, v1= hex, header ts==signed ts) | WSL-01, WSL-02 | unit | `vitest run tests/medusa-agent-fetch.test.ts` (+ committed vector) | ⬜ |
| 3 executors (owner from cus/wishlist_ref, list render, friendly no-owner) | WSL-01 | unit | `vitest run tests/medusa-wishlist.test.ts` (mock fetch + pinned ctx) | ⬜ |
| wiring: execute-action real dispatch + ACTION_DESCRIPTIONS + spec NODES + SIDE_EFFECTING + budgets | WSL-01, WSL-02 | unit+build | `vitest run tests/medusa-dispatch.test.ts` + `npm run build` | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `tests/medusa-agent-fetch.test.ts` (new) — signing vector + header/message assertions
- [ ] `tests/medusa-wishlist.test.ts` (new) — the 3 executors

---

## Manual-Only / E2E-Deferred Verifications

| Behavior | Requirement | Why deferred | Instructions |
|----------|-------------|--------------|--------------|
| Live signed /agent/wishlists round trip against stuscle | WSL-01, WSL-02 | Needs both stacks up (stuscle Medusa + Postgres) | E2E pass: agent "save this for later" → stuscle wishlist row; "my wishlist?" → renders items; 401 on tampered sig |

---

## Validation Sign-Off

- [ ] medusaAgentFetch + 3 executors fully unit-tested incl. committed cross-repo signing vector
- [ ] add/remove side-effecting (R7/R8 + SIDE_EFFECTING); list R6; owner from pinned context only
- [ ] No <automated> requires a live stack
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
