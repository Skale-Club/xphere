# Cross-Phase Integration Check — medusa-commerce (Phases 131–137)

**Checked:** 2026-07-17
**Scope:** CODE coherence across phase boundaries + byte-for-byte cross-repo fidelity against the FROZEN contract (.planning/research/INTEGRATION-CONTRACT.md v1.1). Live-DB / Docker E2E (both stacks up together) is separately deferred and NOT in scope here.

## Verdict: COHERENT

All seven phases wire together as one system. Every cross-phase seam checked (exports to imports, pinned-key reads, rate-limit matrix, three crypto families, action dispatch, money units, SSE families) is connected and internally consistent, and every cross-repo convention matches the contract clause and the stuscle counterpart. No DRIFT found. Two non-blocking info-level notes below (neither is a cross-phase break).

---

## 1. Rate-limit matrix (Phase 131 failMode vs every commerce caller) — CONSISTENT

rate-limit.ts exposes failMode open | memory | closed via onRedisUnavailable (closed=deny, memory=bounded fixed-window Map <=10k, open=legacy allow). Every contract section 7 row is enforced with the exact key/limit/window/failMode by the right caller:

| # | Key | Limit/Window | failMode | Caller (phase) | Location |
|---|-----|--------------|----------|----------------|----------|
| R1 | chat:ip: | 20/60 | memory | chat route (131) | route.ts:67 |
| R2 | chat:ip:day: | 200/86400 | memory | chat route (131) | route.ts:72 |
| R3 | chat:sess: | 10/60 | memory | chat route (131) | route.ts:99 |
| R4 | chat:newsess: | 10/3600 | memory | chat route (131) | route.ts:105,178 |
| R5 | chat:org: | 300/60 | open | chat route (131) | route.ts:125 |
| R6 | com:read: | 30/60 | memory | get-cart / search / get-product (132), wishlist-list (135) | 4 sites |
| R7 | com:write: | 10/60 | closed | add/update-cart (134), wishlist-add/remove (135) | 4 sites |
| R8 | com:write:day: | 60/86400 | closed | same 4 writers | 4 sites |
| R9 | ord:read: | 5/86400 | closed | get-order-status (137) | get-order-status.ts:49 |
| R11 | medusa:org: | 120/60 | memory | medusaStoreFetch + medusaAgentFetch (132/135) | client.ts:56,85 |
| R12 | commerce:evt: | 600/60 | open | events route (136) | events/route.ts:25 |

R6/R7/R8 keys are deliberately shared between cart writes (134) and wishlist writes (135) — one budget, per contract. R11 is shared between the store-API and the signed /agent/* transports. All numbers match section 7.

## 2. Three crypto families (the security core) — CORRECTLY SEPARATED, NO CROSS-WIRING

All three use the SAME raw-UTF8 key convention (encoder.encode(secret), no hex-decode, xph_ prefix retained) but DIFFERENT messages/encodings, and each is imported/used only where intended:

(a) Context-token verify (133) — context.ts hmacKey imports key with ['verify']; recomputes HMAC over the base64url payload STRING and compares against the base64url-DECODED sig via crypto.subtle.verify. Encoding = base64url. Matches contract section 3 mint / stuscle Phase 1. (context.ts:36-40, 76)

(b) cart_created adoption sig (134) — cart-sig.ts signCartSig imports key with ['sign']; message = raw cart_id; output = lowercase HEX. Matches contract section 3/6 / stuscle verifyCartSig (Phase 2). Byte-vectors reproduced in 134-VERIFICATION. (cart-sig.ts:29-39)

(c) /agent/* request sig (135) — agent-sig.ts signAgentBody imports key with ['sign']; message = ts + "." + rawBody; output = bare lowercase HEX. medusaAgentFetch is the SOLE site that prepends the v1= tag (client.ts:98), stringifies once and signs-then-sends the identical bytes. Used by wishlist add/remove/list (135) and get-order-status (137). Matches contract section 4.2 / stuscle verify-hmac.ts (Phase 3).

Separation confirmed: (a) is verify-only + base64url; (b)/(c) are sign + hex. No base64url-where-hex (or vice-versa) cross-wiring exists. The v1= tag is applied in exactly one place.

## 3. Pinned-context key names (133 vs 132/134/135/136/137) — EXACT, NO STALE READERS

writeCommerceContext pins the verbatim contract section 3 claim names: cart, cus, email, wishlist_ref, country_code, region_id, verified_at (+ internal write_count; last_order_display_id added by 136). Every reader uses the exact name:

- get-cart (132): commerce.cart (get-cart.ts:33)
- add/update-cart (134): commerce.cart / region_id / country_code
- wishlist owner (135): commerce.cus else commerce.wishlist_ref (wishlist-owner.ts:19-20)
- order-status (137): commerce.cus (owner) + commerce.last_order_display_id (get-order-status.ts:43,55)
- events annotation (136): matches memory->commerce->>cart, writes last_order_display_id via spread-merge (events.ts:133,143)
- CRM linking (137): claims.email to linkVerifiedContact (route.ts:215)

Grep for commerce.cart_id / commerce.customer_id across src/lib/medusa: ZERO matches. No stale-key reader exists. pinCartId (134), bumpConversationWriteCount, and the 136 annotation all spread-merge, so sibling keys survive.

## 4. action_type enum + exhaustive dispatch (132 to 137) — COMPLETE

- All 9 medusa_* values present in src/types/database.ts action_type enum (2 occurrences each: Enums + Constants).
- execute-action.ts real-dispatches all 9: 3 read (475-484), 2 cart write (492-499), 3 wishlist (504-513), 1 order (518-523). No stubs remain.
- default: const _exhaustive: never = actionType (524-528) — exhaustive check compiles (build-green per phase VERIFICATIONs).
- SIDE_EFFECTING_ACTIONS = cart_add + cart_update + wishlist_add + wishlist_remove (idempotency.ts:23-36) — reads and order-status correctly excluded.
- COMMERCE_WRITE_ACTIONS = cart_add + cart_update only (idempotency.ts:45) — so the per-turn 3 + 25/conversation caps apply to cart writes only, NOT wishlist (which still shares R7/R8). Matches contract.

## 5. Money units (outbound vs inbound) — MAJOR EVERYWHERE, NO DIVIDE-BY-100

- Product prices (132): format.ts formatMoney = Intl.NumberFormat currency style on calculated_price.calculated_amount verbatim; card price string built the same way. No division.
- Cart / order totals (132/137): same formatMoney on total / unit_price verbatim.
- Events ingestion (136): ingestion-schema.ts types total/unit_price as bare z.number() (no transform); receipts.ts stores payload verbatim; events.ts forwards MAJOR units to workflows.

Grep for a divide-by-100 in commerce paths: none. Consistent with contract section 5 v1.1.

## 6. SSE event families (widget vs agent) — SHAPES MATCH, UNKNOWN DEGRADES

- Agent emits commerce from cart executors (134): event=commerce with action cart_created (cartId, itemCount 0, sig) then action cart_updated (cartId, itemCount) (add-to-cart.ts:157,189; update-cart-item.ts:106,122).
- Agent emits ui from product tools (137): event=ui, component=product_cards, items (<=5, storefront-relative url) (search-products.ts:92; get-product.ts:103,123).
- Widget (index.ts:985-1027) handles session/token/done/tool_call/error/commerce/ui. commerce re-dispatches CustomEvent xphere:commerce with detail {action, cartId, itemCount, sig} + cache-bust on cart_created (997-1004). ui/product_cards buffers <=5, flushes via renderCards after done (1005-1012). Detail keys match contract section 6 exactly.
- Unknown events: the if/else-if chain has no trailing else, so unrecognized events are silently ignored (graceful degradation).

---

## Requirements Integration Map

| Requirement | Integration path (cross-phase) | Status |
|-------------|-------------------------------|--------|
| CHT-01 | rate-limit.ts failMode consumed by every commerce R6-R9/R11/R12 caller | WIRED |
| CHT-02/03/04 | chat route R1-R5 + msg cap + SSRF (self-contained in 131) | WIRED |
| MED-01 | action_type enum (9 values) + medusa provider to execute-action switch | WIRED |
| MED-02 | getMedusaCredentialsForOrg to all executors (132 to 137) | WIRED |
| MED-03 | read executors to medusaStoreFetch (R11) to store API; cart id from pinned cart only | WIRED |
| MED-04 | conversationId in ActionContext to loadPinnedContext; ACTION_DESCRIPTIONS + spec NODES | WIRED |
| CTX-01 | verifyCommerceContext (raw-utf8 HMAC, base64url) vs stuscle mint | WIRED |
| CTX-02 | chat route commerce_context (<=2048) to writeCommerceContext pins section 3 keys | WIRED |
| CTX-03 | widget context fetch/forward + Opps.setContext (bundle committed) | WIRED |
| CRT-01 | no-cart to create + signCartSig(hex) + pinCartId + emit cart_created(sig) vs stuscle verifyCartSig | WIRED |
| CRT-02 | R7/R8 closed + qty/<=50 clamps + 3/turn + 25/conversation (COMMERCE_WRITE_ACTIONS) | WIRED |
| CRT-03 | ActionContext.emitStructured (streaming) to commerce SSE section 6 | WIRED |
| CRT-04 | widget re-dispatch xphere:commerce; both writes in SIDE_EFFECTING_ACTIONS | WIRED |
| WSL-01 | wishlist executors to medusaAgentFetch /agent/wishlists/* (v1= hex) vs stuscle verify-hmac.ts; owner from pinned cus/wishlist_ref | WIRED |
| WSL-02 | signAgentBody (ts + . + rawBody) vector; add/remove R7/R8, list R6 | WIRED |
| EVI-01 | /api/v1/commerce/events (commerce:events scope, R12, Idempotency==event_id, MAJOR units) | WIRED |
| EVI-02 | commerce_event_receipts dedupe (23505 to 200 duplicate) | WIRED |
| EVI-03 | emitCommerceEvent to contact find-or-create + cart-match annotation + workflow dispatch | WIRED |
| UIX-01 | product tools to ui/product_cards SSE to widget renderCards (createElement/textContent; Add to Opps.sendMessage) | WIRED |
| UIX-02 | get-order-status to /agent/orders/status pinned cus only; guest to login; R9 closed; display_id > last_order_display_id | WIRED |
| UIX-03 | verified email to linkVerifiedContact to contact_id + visitor_email (shared find-or-create) | WIRED |

**Requirements with no cross-phase wiring:** CHT-02/03/04 are self-contained inside Phase 131 (public chat hardening) with no commerce dependency — by design, not a gap. Every other requirement has at least one cross-phase or cross-repo touchpoint, all WIRED.

---

## Info-level notes (non-blocking; NOT cross-phase drift)

1. Events route oversize response = 413. events/route.ts:16,34 returns HTTP 413 (payload_too_large) for bodies over 64KB, whereas contract section 5 / ROADMAP 136-03 enumerate 201/200/401/403/422. This is HTTP-correct for oversize, is internal to Phase 136 (no cross-phase consumer branches on it), and the stuscle sender is contractually bounded to <=64KB so it is never exercised. Consider aligning to 422 if strict enumeration is desired.
2. Flaky context test (Phase 133). tests/medusa-context.test.ts bad-sig case has a ~6% test-only flake (last base64url char A/B flip decodes to identical bytes) documented in 134-VERIFICATION. Production verifyCommerceContext is correct; test-only, no code impact.

## Deferred (out of this check scope)

Live cross-stack E2E (xphere + stuscle Medusa + Postgres up together): signed /agent/* round trips, widget xphere:commerce bridge adoption, real order.placed/customer.created webhook ingestion. Explicitly deferred per task; every byte-level convention those flows exercise is already proven at the unit/static level and against the stuscle counterparts.
