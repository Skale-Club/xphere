---
phase: 137-product-cards-order-status
verified: 2026-07-17T18:05:00Z
status: passed
score: 5/5 must-haves verified
requirements_verified: [UIX-01, UIX-02, UIX-03]
human_verification:
  - test: "Live product cards render in the widget on a host storefront"
    expected: "search → ≤5 cards render with thumbnails/prices/View anchor (target=_top)/Add-to-cart; Add routes a chat message through the agent"
    why_human: "Needs both stacks up (xphere widget embedded on the stuscle storefront); jsdom proves the DOM contract but not real-browser rendering + host-page navigation. E2E-deferred per 137-VALIDATION.md."
  - test: "Order-status round trip against a running Stuscle backend"
    expected: "logged-in visitor: '#N: <status> — fulfillment … payment … Total …' from real HMAC-signed /agent/orders/status; guest: login prompt; foreign display_id: 'I couldn't find that order.'"
    why_human: "Needs a live signed round trip (real HMAC verify, real fulfillment/payment aggregation, real 404). Unit tests mock medusaAgentFetch. E2E-deferred per 137-VALIDATION.md."
---

# Phase 137: Product Cards & Order Status Verification Report

**Phase Goal:** Rich product cards in the widget + order status (logged-in only) + CRM contact linking.
**Verified:** 2026-07-17T18:05:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Final phase of the medusa-commerce workstream.**

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Product tools emit `ui`/`product_cards` SSE (≤5 items, contract-§6 shape, country-fallback url) on the streaming path only | ✓ VERIFIED | search-products.ts:90-93 (`products.slice(0,5)`, guarded by `ctx.emitStructured`), get-product.ts:102-108 & 122-128 (single-item, both id/handle branches); `buildCardItem` emits `{id,variantId,title,thumbnail,price,handle}` + url only when country known (search:49, get:53) |
| 2 | Widget renders `.opps-cards` after `done` via createElement/textContent + img.src/anchor ONLY (no innerHTML in renderer); "Add to cart" → submitMessage; widget.js committed + zero drift | ✓ VERIFIED | index.ts:894-942 `renderCards` (createElement/textContent/img.src/anchor, zero innerHTML), buffer branch :1005-1007, done flush :1012, safety flush :1035, Add→`submitMessage` :935; public/widget.js clean + rebuilds with zero git drift; bundle contains `opps-cards` (x2) |
| 3 | Order status is logged-in-only (pinned `commerce.cus` guard FIRST), R9 fail-closed, renders §4.2 fields only (no address/payment leak) | ✓ VERIFIED | get-order-status.ts:43-46 (owner guard before R9, guest→login, no fetch/no R9), :49 (`ord:read:` 5/86400 `failMode:'closed'`), :52-57 (display_id params>last_order>omit), :20-31 response type declares only §4.2 fields; grep for email/guest_ref/order_id/shipping_address/payment_method = clean |
| 4 | `medusa_get_order_status` is a real dispatch (last stub gone), exhaustive `default:never` compiles, NOT side-effecting, spec NODE exposes `{display_id?}` only | ✓ VERIFIED | execute-action.ts:518-523 real `getOrderStatus(params, medusaCreds, ctx)`, no "not available yet" stub remains, `default: never` :524-528; absent from SIDE_EFFECTING_ACTIONS/COMMERCE_WRITE_ACTIONS (idempotency.ts:23-45); spec.ts:453-459 params `{display_id}` only; run-agent.ts:242 ACTION_DESCRIPTIONS entry (DATA-not-instructions) |
| 5 | Verified-email chat context links a CRM contact via ONE canonical helper (conversations.contact_id only-if-null + visitor_email, throttled, fail-soft); no third duplicate | ✓ VERIFIED | route.ts:215 `linkVerifiedContact` after writeCommerceContext, inside `if (claims)` + fail-soft try/catch :206-222; link-verified-contact.ts throttle :29 + `.is('contact_id', null)` :41 + try/catch :42-44; shared find-or-create-by-email.ts (email_normalized :37, archived_duplicate filter :38, insert-race re-select :60-68); events.ts:14,72 delegates to the SAME helper (no inline email_normalized) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/lib/medusa/regions.ts` | `resolveRegion` (id + fallback country); `resolveRegionId` delegates | ✓ VERIFIED | resolveRegion :14-27, resolveRegionId delegates :29-35, signature unchanged |
| `src/lib/medusa/actions/search-products.ts` | ≤5-item product_cards emit | ✓ VERIFIED | slice(0,5) emit :90-93, guarded, text return unchanged |
| `src/lib/medusa/actions/get-product.ts` | single-item emit both branches | ✓ VERIFIED | :102-108 (id), :122-128 (handle) |
| `src/lib/medusa/actions/get-order-status.ts` | pinned-cus-only signed order status | ✓ VERIFIED | owner-guard-first, R9 closed, §4.2-only render, never-throws catch ladder |
| `src/lib/action-engine/execute-action.ts` | real dispatch, last stub removed | ✓ VERIFIED | :518-523; exhaustive switch compiles |
| `src/lib/agent-runtime/run-agent.ts` | ACTION_DESCRIPTIONS entry | ✓ VERIFIED | :242 |
| `src/lib/workflows/spec.ts` | display_id-only NODE | ✓ VERIFIED | :453-459 |
| `src/lib/contacts/find-or-create-by-email.ts` | canonical email upsert | ✓ VERIFIED | :24-70 |
| `src/lib/contacts/link-verified-contact.ts` | throttled/only-if-null/fail-soft linker | ✓ VERIFIED | :14-45 |
| `src/app/api/chat/[token]/route.ts` | linkVerifiedContact call after writeCommerceContext | ✓ VERIFIED | :215 |
| `src/lib/commerce/events.ts` | delegates to shared helper (no third copy) | ✓ VERIFIED | :14 import, :72 call, inline email_normalized removed |
| `public/widget.js` | rebuilt bundle with renderer | ✓ VERIFIED | committed, zero drift, `opps-cards` present |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| search-products.ts / get-product.ts | `ctx.emitStructured` SSE | `{event:'ui', component:'product_cards', items}` | ✓ WIRED |
| both executors | regions.ts `resolveRegion` | id + fallback country in one call | ✓ WIRED |
| execute-action.ts case | get-order-status.ts `getOrderStatus` | org+supabase+creds guard → dispatch | ✓ WIRED |
| spec.ts NODE | LLM tool spec | `integration_required:['medusa']`, `{display_id?}` | ✓ WIRED |
| chat route | link-verified-contact.ts | `if (claims.email) await linkVerifiedContact(...)` | ✓ WIRED |
| link-verified-contact.ts | find-or-create-by-email.ts | shared upsert (no fork) | ✓ WIRED |
| events.ts | find-or-create-by-email.ts | same canonical helper | ✓ WIRED |
| widget renderCards Add button | `submitMessage('Add "<title>" to my cart')` | agent send path, never direct API | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 137 + 136 unit suites | `vitest run` on the 9 target files | 9 files / 114 tests passed | ✓ PASS |
| Widget bundle carries renderer | `grep -c opps-cards public/widget.js` | 2 | ✓ PASS |
| Widget bundle zero drift | fresh `npm run build:widget` + `git status --porcelain` | empty | ✓ PASS |
| Full type + widget gate | `npm run build` | completed through postbuild (verify-sw OK), no type errors | ✓ PASS |
| All 9 documented commit hashes | `git cat-file -t` | all present | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| UIX-01 | 137-01, 137-05 | Product tools emit `ui`/`product_cards` (≤5); widget renders safely; Add routes via agent send | ✓ SATISFIED | Truths 1 & 2; tests medusa-product-cards + widget green |
| UIX-02 | 137-02, 137-03 | `medusa_get_order_status` → signed `/agent/orders/status` pinned-customer-only; guests log in; R9 5/day closed | ✓ SATISFIED | Truths 3 & 4; tests medusa-order-status + dispatch + wiring + spec green |
| UIX-03 | 137-04 | Verified email → contact find-or-create + conversations.contact_id + visitor_email | ✓ SATISFIED | Truth 5; tests chat-route-contact-linking + commerce-events (136 regression) green |

No orphaned requirements — REQUIREMENTS.md maps only UIX-01/02/03 to this phase, all claimed by plans and all marked `[x]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | none | — | No TODO/FIXME/placeholder/stub across the 6 core source files; the last `medusa_*` "not available yet" stub was removed in 137-03 |

### Human Verification Required

Two items are E2E-deferred by design (137-VALIDATION.md Manual-Only) — they need both stacks live and cannot be exercised programmatically here:

1. **Live widget card render** — search on a host storefront → cards render with thumbnails/prices/View(target=_top)/Add; Add routes a message through the agent. jsdom proves the DOM contract; real-browser rendering + host-page navigation is unverified in this environment.
2. **Order-status live round trip** — logged-in visitor gets a real §4.2 answer via HMAC-signed `/agent/orders/status`; guest gets the login prompt; a foreign display_id returns "I couldn't find that order." Unit tests mock the signed transport.

These do not block `passed`: the four load-bearing invariants (cards emit, widget-safe-render, order-status-no-leak, single-canonical-contact-helper) are all verified against the actual code and green tests.

### Gaps Summary

None. All 5 must-haves verified, all key links wired, all 114 tests across the 9 specified files green, full build passes, widget bundle committed with zero drift, and all 9 documented commit hashes exist. The four security-critical invariants the phase hinges on are confirmed in code:
- **Cards emit** ≤5 items with the frozen §6 shape and a country-fallback url that is omitted (never `//products/...`) when no country resolves.
- **Widget-safe render** uses createElement/textContent + img.src/anchor exclusively in the card renderer (zero innerHTML there; the only innerHTML usages are pre-existing trusted static SVG icons), and every mutation flows through `submitMessage`.
- **Order-status no-leak**: owner guard on pinned `commerce.cus` runs before R9 (guests never touch the store or the rate limiter), and the response type structurally declares only §4.2 fields — no address/payment surface.
- **Single canonical contact helper**: `findOrCreateContactByEmail` is the sole email-upsert implementation; the chat route (via `linkVerifiedContact`) and Phase 136's `emitCommerceEvent` both delegate to it — no third inline copy.

---

_Verified: 2026-07-17T18:05:00Z_
_Verifier: Claude (gsd-verifier)_
