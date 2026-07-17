---
phase: 132-medusa-provider-read-tools
plan: 04
subsystem: commerce-agent-tools
tags: [medusa, action-engine, rate-limit, supabase, vitest, typescript-enum]

# Dependency graph
requires:
  - phase: 132-01
    provides: medusa integration_provider enum value, registry entry, migration 1259
  - phase: 132-02
    provides: MedusaCredentials/MedusaExecCtx types, medusaStoreFetch client (R11 + 8s + x-publishable-api-key), getMedusaCredentialsForOrg
provides:
  - Three read-only Medusa Store API tools (search-products, get-product, get-cart) wired into execute-action.ts
  - Shared helpers: formatMoney (MAJOR-unit currency formatting), loadPinnedContext (single conversations lookup -> R6 session key + memory.commerce), resolveRegionId (country_code -> region_id)
  - Widened action_type enum (database.ts) carrying all nine medusa_* values, with an exhaustive dispatcher switch that stays green
affects: [133-signed-context-identity-pinning, 134-cart-write-tools, 135-wishlist-tools, 137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Executor never-throw contract: every medusa_* executor wraps its body in try/catch and returns a friendly NL string on every expected failure (R6 breach, timeout, non-2xx, no pinned cart) -- errors never reach the LLM turn as raw exceptions"
    - "Single conversations lookup per executor call (loadPinnedContext) serves BOTH the R6 rate-limit session key and the pinned commerce context (cart/region/country_code) -- no second round-trip"
    - "Anti-IDOR by signature: getMedusaCart(creds, ctx) takes no params argument at all, so a caller-supplied cart_id has no channel into the function -- verified by an anti-IDOR test and a source grep audit"
    - "Grouped stub switch case for not-yet-built action_type values keeps an exhaustive `default: never` switch compiling ahead of the features that will implement them"

key-files:
  created:
    - src/lib/medusa/format.ts
    - src/lib/medusa/regions.ts
    - src/lib/medusa/pinned-context.ts
    - src/lib/medusa/actions/search-products.ts
    - src/lib/medusa/actions/get-product.ts
    - src/lib/medusa/actions/get-cart.ts
    - tests/medusa-actions.test.ts
    - tests/medusa-dispatch.test.ts
  modified:
    - src/types/database.ts
    - src/lib/action-engine/execute-action.ts
    - "src/app/(dashboard)/workflows/[toolConfigId]/page.tsx"

key-decisions:
  - "R6 keys on session_key ?? conversationId (per 132-RESEARCH.md Open Q1), resolved in the same conversations query that returns pinned memory.commerce -- one round-trip per executor call, not two"
  - "get-cart's anti-IDOR guarantee is structural, not defensive: the function signature is (creds, ctx) with no params object, so there is no code path through which a caller-supplied cart id could reach the store call"
  - "The six not-yet-built medusa_* action types (add_to_cart, update_cart_item, wishlist_add/remove/list, get_order_status) share one grouped switch case returning a placeholder string -- they are absent from ACTION_DESCRIPTIONS and workflows/spec.ts NODES so the LLM can never select them; the case exists purely to satisfy the compiler"
  - "Task 3 landed the database.ts enum widening and all nine execute-action.ts switch cases in a single commit, per the plan's atomicity requirement -- the exhaustive `default: const _exhaustive: never = actionType` check would otherwise fail to compile between those two edits"

patterns-established:
  - "Money formatting: always Intl.NumberFormat(locale, {style:'currency', currency}).format(amount) on Medusa store-API amounts (calculated_price.calculated_amount, cart item unit_price, cart total) -- these are MAJOR units, never divide/multiply by 100"

requirements-completed: [MED-01, MED-03, MED-04]

# Metrics
duration: 30min
completed: 2026-07-17
---

# Phase 132 Plan 04: Read Executors + Exhaustive Dispatcher Summary

**Three Medusa Store API read tools (search/get-product/get-cart) landed behind a never-throwing dispatcher, with the `action_type` Postgres enum and TypeScript union widened atomically so the exhaustive switch (and a second exhaustive `Record` on the tool-config detail page, discovered mid-task) both stay green.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3
- **Files modified:** 11 (8 created, 3 modified)

## Accomplishments

- `searchMedusaProducts`, `getMedusaProduct`, `getMedusaCart` — three concise-NL-string executors calling the Medusa 2.17 Store API via the Wave-1 `medusaStoreFetch` client, all region-priced in MAJOR currency units
- `loadPinnedContext` — the single `conversations` lookup (by `conversationId`) that yields both the R6 rate-limit session key and the pinned `memory.commerce` (cart/region/country_code)
- `execute-action.ts` gained 9 new `action_type` switch cases (3 real dispatch + 6 grouped future-action stubs) while remaining exhaustive; `database.ts`'s two `action_type` unions ending in `'send_zernio_dm'` now carry all nine `medusa_*` values
- 18 new executor/dispatch unit tests (mocked `medusaStoreFetch`, mocked `rateLimit`, chainable supabase stub) plus 2 source-assertion tests confirming the enum + stub cases exist

## Task Commits

Each task was executed as a RED (failing test) commit followed by a GREEN (implementation) commit:

1. **Task 1: Shared helpers + search-products executor**
   - `db988ba2` — test(132-04): add failing test for search-products executor
   - `51c32c14` — feat(132-04): implement search-products executor + shared medusa helpers
2. **Task 2: get-product + get-cart executors**
   - `ba98fc53` — test(132-04): add failing test for get-product + get-cart executors
   - `fd0ae9ff` — feat(132-04): implement get-product + get-cart executors
3. **Task 3: action_type enum + exhaustive dispatcher**
   - `388c3b94` — test(132-04): add failing test for exhaustive medusa dispatch
   - `d987216f` — feat(132-04): widen action_type enum + wire exhaustive medusa dispatch (includes the Rule 3 `ACTION_TYPE_LABELS` fix)

**Plan metadata:** committed alongside this SUMMARY (see final commit below).

## Files Created/Modified

- `src/lib/medusa/format.ts` — `formatMoney(amount, currency, locale?)`, MAJOR-unit `Intl.NumberFormat` wrapper
- `src/lib/medusa/pinned-context.ts` — `loadPinnedContext(ctx)`, single `conversations` lookup -> `{ sessionKey, commerce }`
- `src/lib/medusa/regions.ts` — `resolveRegionId(creds, orgId, countryCode?)`, `/store/regions` country-match fallback
- `src/lib/medusa/actions/search-products.ts` — `GET /store/products` (q, region_id, limit=5), <=5-line NL listing
- `src/lib/medusa/actions/get-product.ts` — `GET /store/products/:id` or `?handle=`, single product detail
- `src/lib/medusa/actions/get-cart.ts` — `GET /store/carts/:id` where id comes only from pinned memory; no `params` argument
- `tests/medusa-actions.test.ts` — 11 tests covering all three executors
- `tests/medusa-dispatch.test.ts` — 7 tests covering dispatch routing, never-throw, and enum/stub source assertions
- `src/types/database.ts` — widened both `action_type` unions ending in `'send_zernio_dm'` with the nine `medusa_*` values
- `src/lib/action-engine/execute-action.ts` — 4 new imports, 3 real dispatch cases, 6 grouped stub cases
- `src/app/(dashboard)/workflows/[toolConfigId]/page.tsx` — `ACTION_TYPE_LABELS` gained the nine medusa display labels (unplanned, see Deviations)

## Decisions Made

See `key-decisions` in frontmatter. Summary: R6 keys on `session_key ?? conversationId` from a single conversations lookup; `get-cart`'s anti-IDOR guarantee is structural (no params argument exists, not just "ignored"); the six future medusa actions are stubbed in one switch case that the LLM can never reach (absent from `ACTION_DESCRIPTIONS`/`spec.ts`); the enum widening and all nine switch cases landed in one commit per the plan's atomicity requirement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `ACTION_TYPE_LABELS` in the tool-config detail page was a second exhaustive `Record<action_type, string>` not called out by the plan**
- **Found during:** Task 3, first `npm run build` after widening `database.ts`
- **Issue:** `src/app/(dashboard)/workflows/[toolConfigId]/page.tsx` defines `const ACTION_TYPE_LABELS: Record<ToolConfigRow['action_type'], string> = {...}` for the dashboard's tool-config log view. Widening the `action_type` union without also updating this object broke `npm run build` with "missing the following properties ... medusa_search_products, medusa_get_product, ...".
- **Fix:** Added the nine medusa display labels (e.g. `medusa_search_products: 'Medusa: Search Products'`) to the object, matching the existing xkedule-entry style.
- **Files modified:** `src/app/(dashboard)/workflows/[toolConfigId]/page.tsx`
- **Verification:** `npm run build` green afterward; no test regressions (55/55 in the phase-gate quick set).
- **Committed in:** `d987216f` (part of the Task 3 atomic commit, since it's a direct consequence of the same enum widening)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to keep `npm run build` green after the enum widening; no scope creep — purely a display-label completion for the new enum values, following the exact pattern of every other action type in that file.

## Issues Encountered

None beyond the deviation above. All acceptance-criteria greps and the plan's `<verification>` commands (targeted vitest runs, the 8-file phase-gate quick set, `npm run build`, anti-IDOR grep audit, MAJOR-unit grep audit) passed. Two of the plan's literal grep-count criteria (`loadPinnedContext` and `com:read:` expected to appear on exactly 1 line) were satisfied in substance but not in exact line count — `loadPinnedContext` naturally appears on 2 lines per file (the import statement plus the call site), which is the correct and only reasonable way to wire it in; this is noted for completeness, not treated as a failure.

## User Setup Required

None - no external service configuration required. (The Medusa integration itself, its registry entry, and the Integrations UI round-trip were already covered by 132-01; this plan only adds the read tools behind it.)

## Next Phase Readiness

- MED-01, MED-03, MED-04 are complete for the read-tool slice; Phase 132 (Medusa Provider & Read Tools) is now fully done — all 4 plans (01-04) landed.
- `run-agent.ts` already passes `conversationId` into `executeAction` at both call sites and registers `ACTION_DESCRIPTIONS` + `spec.ts` NODES for the three read tools (132-03) — the dispatcher cases added here are immediately reachable by an agent with the Medusa tools attached.
- Phase 133 (Signed Context & Identity Pinning) can now build on `loadPinnedContext`'s `commerce` shape directly — no changes needed to this plan's helpers to consume newly-pinned `cart`/`region_id`/`country_code` claims.
- Phase 134 (Cart Write Tools) will replace two of the six stubbed action_type cases (`medusa_add_to_cart`, `medusa_update_cart_item`) with real executors; the remaining four stay stubbed until Phases 135/137.
- Manual/E2E verification (Integrations UI round-trip; live "what hoodies do you have?" against a running stuscle :9000 + xphere) remains deferred per 132-VALIDATION Manual-Only — not a gate for this plan.

---
*Phase: 132-medusa-provider-read-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 9 created files (`format.ts`, `regions.ts`, `pinned-context.ts`, `search-products.ts`, `get-product.ts`, `get-cart.ts`, `medusa-actions.test.ts`, `medusa-dispatch.test.ts`, this SUMMARY) verified present on disk. All 6 task commits (`db988ba2`, `51c32c14`, `ba98fc53`, `fd0ae9ff`, `388c3b94`, `d987216f`) verified present in `git log`.
