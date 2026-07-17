---
phase: 132-medusa-provider-read-tools
verified: 2026-07-17T12:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
requirements:
  MED-01: satisfied
  MED-02: satisfied
  MED-03: satisfied
  MED-04: satisfied
gate:
  tests: 55/55 passed (8 medusa test files)
  build: green (Compiled successfully + TypeScript finished — exhaustive switch + enum widening consistent)
deferred_e2e:
  - "Integrations UI round-trip (save Medusa creds, encrypt, decrypt on read) — needs live dashboard + Supabase"
  - "Live product answer with region price — needs a running Medusa store + connected org"
---

# Phase 132: Medusa Provider & Read Tools Verification Report

**Phase Goal:** An org connects its Medusa store in Integrations, and agents with the tools answer product/cart questions with region-correct prices.
**Verified:** 2026-07-17T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | An org can connect a Medusa store in Integrations (registry entry + per-org credential load/decrypt) | ✓ VERIFIED | `registry.ts:392` medusa entry with Server URL/Publishable Key/Connection Token; `credentials.ts` decrypts `encrypted_api_key` + reads `config.publishable_key`, returns null when unconfigured. Live UI round-trip E2E-deferred (no live stack). |
| 2 | The schema surface carries the provider + all 9 action types | ✓ VERIFIED | Migration 1259 = 10 idempotent `ALTER TYPE ADD VALUE`; both `action_type` unions (database.ts:1349, 8108) carry all 9 `medusa_*`; all 3 `integration_provider` unions (1206, 1224, 8109) carry `'medusa'`. |
| 3 | Agents with the tools can invoke the 3 read tools end-to-end through the dispatcher | ✓ VERIFIED | `run-agent.ts` ACTION_DESCRIPTIONS has 3 medusa entries; `spec.ts` 3 NODES gated `integration_required:['medusa']`; `execute-action.ts:460-468` dispatches to the 3 executors; `conversationId` threaded at both call sites (775→789, 1242→1248). |
| 4 | Prices are region-correct and formatted in MAJOR currency units | ✓ VERIFIED | `region_id` resolved from pinned `memory.commerce` else `resolveRegionId` country-match; `formatMoney` uses `Intl.NumberFormat({style:'currency'})`; grep `/100` and `/ 100` in `src/lib/medusa/` → 0. Live product answer E2E-deferred. |
| 5 | Anti-IDOR: cart id only from pinned context, no visitor-scoped id params in any tool schema | ✓ VERIFIED | `getMedusaCart(creds, ctx)` takes no `params` argument (structural); cart id from `commerce.cart` only; no `cart_id`/`customer_id`/`email`/`order_id` in any medusa `params_schema` (the email/customer matches in spec.ts are all google_contacts nodes). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `supabase/migrations/1259_medusa_integration.sql` | 10 idempotent ALTER TYPE ADD VALUE | ✓ VERIFIED | 1 integration_provider + 9 action_type, no txn wrapper, no seed rows |
| `src/types/database.ts` | unions widened | ✓ VERIFIED | 3× integration_provider + 2× action_type all carry medusa values |
| `src/lib/integrations/registry.ts` | medusa entry, 3 fields | ✓ VERIFIED | location_id (Server URL), publishable_key, api_key (Connection Token); panelType api_key |
| `src/lib/medusa/credentials.ts` | decrypt + read publishable_key | ✓ VERIFIED | null on any missing branch; never throws |
| `src/lib/medusa/client.ts` | medusaStoreFetch | ✓ VERIFIED | R11 before fetch, pk header, 8s timeout, typed errors |
| `src/lib/medusa/actions/{search-products,get-product,get-cart}.ts` | concise NL string executors | ✓ VERIFIED | region-priced, never-throw, R6 read budget |
| `src/lib/medusa/format.ts` | Intl.NumberFormat money helper | ✓ VERIFIED | MAJOR-unit, no /100 |
| `src/lib/action-engine/execute-action.ts` | 9 cases + exhaustive default:never | ✓ VERIFIED | 3 real dispatch + 6 grouped stub + `const _exhaustive: never = actionType` |
| `src/lib/agent-runtime/run-agent.ts` | conversationId + ACTION_DESCRIPTIONS | ✓ VERIFIED | both call sites + 3 descriptors |
| `src/lib/workflows/spec.ts` | 3 NODES integration_required:['medusa'] | ✓ VERIFIED | lines 363/371/379; get_cart schema has empty properties |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| execute-action.ts | medusa executors | import + case dispatch | ✓ WIRED | imports lines 54-57; dispatch 466-468 |
| executors | client.ts | medusaStoreFetch | ✓ WIRED | R11-gated fetch chokepoint |
| client.ts | rate-limit.ts | rateLimit('medusa:org:'+orgId,120,60,memory) | ✓ WIRED | line 50, strictly before fetch (line 54) |
| executors | pinned-context | loadPinnedContext(ctx) → cart/region | ✓ WIRED | single conversations lookup |
| run-agent.ts | execute-action.ts | executeAction(..., {conversationId}) | ✓ WIRED | both blocking + streaming sites |
| spec.ts NODES | integrations.provider | integration_required gating | ✓ WIRED | getWorkflowSpec filter hides until medusa connected |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| 8 medusa test files | `CI=true npx vitest run tests/medusa-*.test.ts --reporter=dot` | 55 passed (8 files) | ✓ PASS |
| Type gate (exhaustive switch + enum widening consistent) | `npm run build` | Compiled successfully + Finished TypeScript, postbuild green | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| MED-01 | 132-01, 132-04 | Migration + database.ts enum widening | ✓ SATISFIED | 1259.sql (10 values) + both action_type unions + 3 integration_provider unions |
| MED-02 | 132-01, 132-02 | Registry entry + per-contract secrets layout | ✓ SATISFIED | registry medusa entry; credentials reads location_id/encrypted_api_key/config.publishable_key |
| MED-03 | 132-02, 132-04 | 3 executors, 8s timeout, R11, cart id from context, no id params | ✓ SATISFIED | client + 3 actions; Intl.NumberFormat; get-cart no-params structural anti-IDOR |
| MED-04 | 132-03 | conversationId at both call sites + ACTION_DESCRIPTIONS + spec NODES | ✓ SATISFIED | run-agent 789/1248; 3 descriptors; 3 gated NODES |

No orphaned requirements: REQUIREMENTS.md maps only MED-01..04 to this phase, all claimed by plans.

### Anti-Patterns Found

None blocking. The 6 grouped stub `action_type` cases in execute-action.ts (`medusa_add_to_cart`, `medusa_update_cart_item`, `medusa_wishlist_*`, `medusa_get_order_status`) return "That commerce action is not available yet." by design — they are absent from ACTION_DESCRIPTIONS and spec.ts NODES so the LLM can never select them; they exist only to keep the exhaustive `default: never` switch compiling ahead of Phases 134/135/137. This is documented intent, not a stub gap.

### Human Verification Required (E2E-deferred, NOT gating)

Per task instructions these need a live stack and are deferred to E2E — not required for phase sign-off:

1. **Integrations UI round-trip** — In the Integrations UI add a Medusa integration (Server URL, Publishable Key, Connection Token), save, reload → fields persist; DB `integrations.encrypted_api_key` is ciphertext. Why human: needs the dashboard + Supabase; encryption round-trip is E2E.
2. **Live product answer with region price** — Ask the agent "what hoodies do you have?" on a wired storefront → region-correct prices. Why human: needs a running Medusa store + connected org.

### Gaps Summary

No gaps. All 5 observable truths, all 10 artifacts, all 6 key links, and both behavioral spot-checks (55/55 tests + green build) pass. All four requirement IDs (MED-01..04) are satisfied by the codebase. The only outstanding items are the two live-stack E2E verifications, explicitly out of automated scope and not a gate for this phase.

---

_Verified: 2026-07-17T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
