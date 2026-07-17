---
phase: 134
slug: cart-write-tools
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 134 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; `tests/**`) |
| **Quick run command** | `CI=true npx vitest run tests/medusa-cart-write.test.ts --reporter=dot` |
| **Full suite command** | `npm test` (has ~58 pre-existing unrelated failures — do NOT gate on it) |
| **Type/widget gate** | `npm run build` + `npm run build:widget` |
| **Estimated runtime** | quick < 10s |

---

## CRITICAL cross-repo + security facts (from research)

1. **cart_created sig = hex(HMAC_SHA256(connectionToken, cart_id))** — byte-proven to match stuscle's `verifyCartSig`/`adoptAgentCart` (Web Crypto `subtle.sign` with raw-UTF8 key === Node `createHmac`). Commit the vector: `xph_test_connection_token_abc123` + `cart_01ABC` → `f770a654…`. A test locks it.
2. **Two-step create→sign→pin→emit ordering** (single-call create impossible — the sig needs the cart_id): `POST /store/carts {region_id}` → `POST /store/carts/:id {metadata:{xphere_sig}}` → re-pin `memory.commerce.cart` → emit SSE `cart_created` (with sig) → THEN `POST /store/carts/:id/line-items`.
3. **Re-pin is cart-only** — do NOT call the full `writeCommerceContext` (it sets the whole claim set from a verified token). Use a targeted read-merge-write that only updates `commerce.cart` (+ a marker), preserving cus/email/region/etc.
4. **Response shapes:** add/update line-items return the FULL computed `{cart}` (itemCount/≤50 from `cart.items`, no extra GET); DELETE returns `{deleted, parent: cart}` — read `.parent` (common bug).
5. **Caps (contract §7):** qty 1–10/op + ≤50 line items (executor clamps); R7 `com:write:{sessionId}` 10/60 failMode **closed**; R8 `com:write:day:{convId}` 60/86400 **closed**; 3 side-effecting commerce calls/turn (run-agent closure via COMMERCE_WRITE_ACTIONS) + 25/conversation (memory.commerce counter). Both tools in `SIDE_EFFECTING_ACTIONS`.
6. **emitStructured** threads into ActionContext ONLY on the streaming path (`emitStructured: emit`); blocking path omits → executors null-check.

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every wave:** quick run + `npm run build`
- **Before verify-work:** scoped tests + `npm run build` + `npm run build:widget` green; committed `public/widget.js`
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task | Requirement | Type | Automated Command | Status |
|------|-------------|------|-------------------|--------|
| add-to-cart executor (no-cart→create+sign+pin+emit ORDER, clamps) | CRT-01, CRT-02 | unit | `vitest run tests/medusa-cart-write.test.ts` (+ sig vector) | ⬜ |
| update-cart-item executor (fuzzy line match, qty 0→DELETE read .parent, clamp) | CRT-01, CRT-02 | unit | same | ⬜ |
| caps: R7/R8 closed + 3/turn + 25/conversation + SIDE_EFFECTING_ACTIONS | CRT-02 | unit | `vitest run` (redis-down → closed denies; per-turn/convo counters) | ⬜ |
| emitStructured threading + cart_updated emit | CRT-03 | unit | `vitest run` (emitStructured spy asserts commerce events) | ⬜ |
| widget CustomEvent re-dispatch + build:widget | CRT-04 | manual+build | `npm run build:widget` (commerce→xphere:commerce); widget-test.html manual | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `tests/medusa-cart-write.test.ts` (new) — the 2 executors + caps + emit + cross-repo sig vector

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Widget re-dispatches commerce SSE as CustomEvent('xphere:commerce') | CRT-04 | Widget runs in a host page; the storefront bridge (stuscle Phase 2) consumes it live | `public/widget-test.html`: simulate a `commerce`/`cart_created` SSE frame, confirm `window` receives `xphere:commerce` with {action,cartId,itemCount,sig} |

---

## Validation Sign-Off

- [ ] 2 executors + caps + emit fully unit-tested incl. cross-repo cart_created sig vector
- [ ] widget re-dispatch + build:widget committed
- [ ] R7/R8 fail-CLOSED verified with redis down
- [ ] No <automated> requires a live stack
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
