---
phase: 133
slug: signed-context-identity-pinning
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-17
---

# Phase 133 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; `tests/**`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `CI=true npx vitest run tests/medusa-context.test.ts tests/chat-api.test.ts --reporter=dot` |
| **Full suite command** | `npm test` |
| **Type/widget gate** | `npm run build` + `npm run build:widget` |
| **Estimated runtime** | quick < 10s |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every wave:** quick run + `npm run build`
- **Before verify-work:** `npm test` + `npm run build` + `npm run build:widget` green; committed `public/widget.js`
- **Max feedback latency:** 90 seconds

---

## CRITICAL cross-repo agreement facts (from research)

1. **HMAC key = raw UTF-8 bytes of the `xph_...` connection-token STRING** (`encoder.encode(connectionToken)`), NOT hex-decoded. This is what makes xphere Web-Crypto `verify` agree with stuscle `node:crypto` `createHmac('sha256', XPHERE_CONNECTION_TOKEN)`. A `node:crypto`-minted cross-repo test VECTOR must be committed in `tests/medusa-context.test.ts` to lock byte-for-byte agreement.
2. **Pinned key names = contract §3 claim names.** Write `memory.commerce = { cart, cus, email, wishlist_ref, country_code, region_id, verified_at }` — matching Phase 132's shipped reader (`get-cart.ts` reads `commerce.cart`; region_id/country_code already agree). Do NOT rename to `cart_id`/`customer_id`. Add a read-back test: write claims → `loadPinnedContext`/`get-cart` reads the pinned cart (proves the IDOR pin is actually usable).
3. `exp` is unix SECONDS (not ms); claims are null-tolerant; JSONB update is read-merge-write to avoid clobbering other `memory` keys.

---

## Per-Task Verification Map

| Task | Requirement | Type | Automated Command | Status |
|------|-------------|------|-------------------|--------|
| verifyCommerceContext (HMAC raw-utf8 key + exp + org) | CTX-01 | unit | `vitest run tests/medusa-context.test.ts` (valid/expired/bad-sig/wrong-org/malformed + cross-repo vector) | ⬜ |
| write/read pinning (contract claim names) | CTX-02 | unit | `vitest run tests/medusa-context.test.ts` (merge preserves other memory keys; read-back via get-cart reader) | ⬜ |
| chat route: commerce_context accept + verify + pin (fail-soft) | CTX-02 | unit | `vitest run tests/chat-api.test.ts` (absent → no cost; invalid → warn+continue; valid → pinned) | ⬜ |
| widget: data-context-endpoint fetch + Opps.setContext + POST field | CTX-03 | manual + build | `npm run build:widget`; `public/widget-test.html` manual; existing `tests/widget.test.ts` stays green (commerce_context only when present) | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `tests/medusa-context.test.ts` (new) — verify + pinning stubs incl. a `node:crypto`-minted cross-repo vector
- [ ] extend `tests/chat-api.test.ts` — commerce_context accept/verify/pin/fail-soft cases
- [ ] extend `public/widget-test.html` — manual context-token forwarding check

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Widget fetches token from data-context-endpoint (same-origin) + sends commerce_context on POST | CTX-03 | Widget runs in a host page; jsdom `tests/widget.test.ts` asserts exact POST body — keep manual to avoid coupling | Load `public/widget-test.html`, set data-context-endpoint, observe the POST includes commerce_context; `Opps.setContext(token)` replaces it |

---

## Validation Sign-Off

- [ ] verify + pin fully unit-tested incl. cross-repo HMAC vector
- [ ] widget change keeps existing tests/widget.test.ts green; build:widget committed
- [ ] No <automated> requires a live stack
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-07-17 (checker: 0 blockers)
