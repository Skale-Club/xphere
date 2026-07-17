---
phase: 136-commerce-events-ingestion
plan: 02
subsystem: workflows
tags: [workflow-dispatch, contacts, conversations, medusa, event-bus]

# Dependency graph
requires:
  - phase: 133-medusa-context-token
    provides: conversations.memory.commerce pinned `cart` key (context.ts, get-cart.ts, add-to-cart.ts)
  - phase: 135-medusa-agent-surface
    provides: XPHERE_CONNECTION_TOKEN / integrations row / commerce tool wiring
provides:
  - emitCommerceEvent(supabase, orgId, receiptId, type, data) dispatch layer
  - spec.ts TRIGGERS entries for commerce.order.placed / commerce.customer.created
affects: [136-03-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook body `type` mapped explicitly to a differently-namespaced workflow trigger event (WF_EVENT_MAP), never assumed equal"
    - "Conversation annotation via spread-merged JSONB memory, filtered on a nested PostgREST JSON path (memory->commerce->>cart)"

key-files:
  created:
    - src/lib/commerce/events.ts
    - tests/commerce-events-emit.test.ts
  modified:
    - src/lib/workflows/spec.ts

key-decisions:
  - "Used the 136-RESEARCH-corrected `cart` key (not the CONTEXT-locked `cart_id` key) for the conversation annotation filter — shipped Phase 133 code pins the cart under `commerce.cart`, verified directly in src/lib/medusa/context.ts, actions/get-cart.ts, and actions/add-to-cart.ts. This is documented in the plan as a LOCKED OVERRIDE."
  - "emitCommerceEvent defines its own CommerceOrderData/CommerceCustomerData interfaces instead of importing CommerceEventPayload from 136-01's ingestion-schema.ts, keeping the two Wave-1 plans structurally independent (the 136-03 route's parsed payload.data is structurally assignable)."
  - "Does not skip workflow dispatch when no contact could be resolved (unlike emitLeadCaptured's `if (!contact) return`) — commerce events carry their own order/customer namespace independent of contact resolution, so dispatch proceeds with contact:null if email normalisation fails to produce a contact."

patterns-established:
  - "Commerce event dispatch layer mirrors the lead dispatch layer 1:1: workflows query -> event_dispatches audit -> conditional domain-specific annotation -> runFlow/runFlowSync per definitionHasWait -> resumeMatchingWaits, all inside one try/catch that never throws."

requirements-completed: [EVI-03]

# Metrics
duration: 22min
completed: 2026-07-17
---

# Phase 136 Plan 02: Commerce Event Dispatch Layer Summary

**`emitCommerceEvent` dispatches Medusa `order.placed`/`customer.created` webhooks to matching workflows via the corrected `memory.commerce.cart` conversation key, with contact find-or-create and full `event_dispatches` audit trail; `spec.ts` now registers both events as workflow TRIGGERS.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-17T16:01:30Z
- **Completed:** 2026-07-17T16:08:40Z
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- Built `emitCommerceEvent`, a 1:1 mirror of `emitLeadCaptured`: maps the webhook `type` to the differently-namespaced workflow event (`order.placed` → `commerce.order.placed`, `customer.created` → `commerce.customer.created`), finds-or-creates a contact by normalised email (firing `contact.created` on new), audits every dispatch in `event_dispatches`, and runs matched workflows via `runFlow`/`runFlowSync` per `definitionHasWait` — the whole body wrapped in one try/catch that never throws
- Implemented the conversation annotation using the **research-corrected** `memory->commerce->>cart` filter (not the CONTEXT-locked `cart_id` key), spread-merging `last_order_display_id` without clobbering other pinned keys (`cus`, `region_id`, `write_count`)
- Registered `event:commerce.order.placed` and `event:commerce.customer.created` in `spec.ts` TRIGGERS with their variable namespaces, plus optional `order`/`customer` entries in `VARIABLE_NAMESPACES`
- Money (`total`, `unit_price`) flows into the workflow trigger payload verbatim in MAJOR units throughout

## Task Commits

Each task was committed atomically (Task 1 was TDD: `test` → `feat`):

1. **Task 1 RED: failing test for emitCommerceEvent dispatch mechanics** - `5d43aa80` (test)
1. **Task 1 GREEN: implement emitCommerceEvent** - `91de0e08` (feat)
2. **Task 2: register commerce TRIGGERS in spec.ts + extend emit test** - `5d90a023` (feat)

## Files Created/Modified
- `src/lib/commerce/events.ts` - `emitCommerceEvent(supabase, orgId, receiptId, type, data)`
- `src/lib/workflows/spec.ts` - added `event:commerce.order.placed` / `event:commerce.customer.created` TRIGGERS entries + `order`/`customer` VARIABLE_NAMESPACES
- `tests/commerce-events-emit.test.ts` - spy-supabase dispatch query-shape tests + TRIGGERS registration tests

## Decisions Made
- Followed the plan's explicit LOCKED OVERRIDE: filtered the conversation annotation on `memory->commerce->>cart`, not the CONTEXT-decision's `cart_id`, because shipped Phase 133 code (`context.ts`, `get-cart.ts`, `add-to-cart.ts`) proves the pinned key is `cart`. Using `cart_id` would have silently broken every order-to-conversation link.
- Kept `CommerceOrderData`/`CommerceCustomerData` local to `events.ts` rather than importing 136-01's `CommerceEventPayload`, per the plan's explicit instruction to keep the two Wave-1 plans structurally independent.

## Deviations from Plan

None - plan executed exactly as written. All 12 emit-test assertions (10 dispatch/annotation/contact + 2 TRIGGERS) passed on the first implementation attempt; all acceptance-criteria greps (cart-key presence/absence, WF_EVENT literals, `source:'api'`, no money division) matched as specified.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `emitCommerceEvent` and the `spec.ts` TRIGGERS are complete and build-green, independent of 136-01's data/persistence layer.
- Ready for 136-03 (the route that composes 136-01's `insertCommerceReceipt` + this plan's `emitCommerceEvent`).

---
*Phase: 136-commerce-events-ingestion*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 3 created/modified files verified present on disk; all 3 task commit hashes (5d43aa80, 91de0e08, 5d90a023) verified present in git log.
