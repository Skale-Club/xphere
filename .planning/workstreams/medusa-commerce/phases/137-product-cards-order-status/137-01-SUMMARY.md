---
phase: 137-product-cards-order-status
plan: 01
subsystem: commerce
tags: [medusa, sse, product-cards, ui-events, regions]

# Dependency graph
requires:
  - phase: 132-medusa-provider-read-tools
    provides: searchMedusaProducts / getMedusaProduct executors, PRODUCT_FIELDS, resolveRegionId
  - phase: 134-cart-write-tools
    provides: the `ctx.emitStructured?.(...)` null-guarded emit precedent (add-to-cart.ts)
provides:
  - resolveRegion(creds, orgId, countryCode?) → { id?, countryCode? } in regions.ts
  - ≤5-item `{event:'ui', component:'product_cards', items}` SSE emit from searchMedusaProducts (streaming path only)
  - single-item `{event:'ui', component:'product_cards', items}` SSE emit from getMedusaProduct (streaming path only)
affects: [137-05-widget-renderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Card builder (buildCardItem) omits `url` entirely when no country can be determined — never emits a broken `//products/handle` link"
    - "Region resolution captures BOTH region id and a fallback country in one call (resolveRegion), replacing the id-only resolveRegionId call site inside the two read executors"

key-files:
  created:
    - tests/medusa-product-cards.test.ts
  modified:
    - src/lib/medusa/regions.ts
    - src/lib/medusa/actions/search-products.ts
    - src/lib/medusa/actions/get-product.ts

key-decisions:
  - "get-product.ts keeps its own sibling copy of buildCardItem rather than importing search-products.ts's — matches the pair's existing PRODUCT_FIELDS/formatProduct duplication convention, keeps each executor independently testable/importable with zero cross-file coupling"
  - "resolveRegionId now delegates to resolveRegion (id + country) instead of duplicating the /store/regions fetch + fallback logic — zero behavior change for existing add-to-cart.ts/get-cart.ts callers, proven by the unchanged medusa-actions.test.ts suite staying green"

requirements-completed: [UIX-01]

# Metrics
duration: 25min
completed: 2026-07-17
---

# Phase 137 Plan 01: Product Cards Emit Summary

**Search/get-product executors now emit a contract-§6 `ui`/`product_cards` SSE payload (≤5 items, country-fallback URL) alongside their unchanged text return, via a new `resolveRegion` helper that captures both region id and fallback country in one `/store/regions` call.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-17T20:42:00Z
- **Completed:** 2026-07-17T21:07:25Z
- **Tasks:** 2
- **Files modified:** 3 (+1 new test file)

## Accomplishments
- `resolveRegion(creds, orgId, countryCode?)` in `src/lib/medusa/regions.ts` returns `{ id?, countryCode? }` — pinned country wins, else the resolved region's first country, else `undefined`. `resolveRegionId` now delegates to it with byte-identical behavior for existing callers.
- `searchMedusaProducts` emits `{event:'ui', component:'product_cards', items}` (≤5 items) guarded by `ctx.emitStructured?.(...)` — a structural no-op on the blocking path, so the text return and non-throw guarantee are unaffected.
- `getMedusaProduct` emits the same event shape with a single-item array for whichever product it actually rendered (id branch or handle branch).
- Card `url` is `${storefrontUrl ?? ''}/${countryCode}/products/${handle}`, built ONLY when a country is known (pinned `commerce.country_code` or the region-resolved fallback) — omitted entirely otherwise, never a broken `//products/...` link.

## Task Commits

Each task was committed atomically:

1. **Task 1: resolveRegion helper (id + fallback country) in regions.ts** - `c6408bbd` (test — labeled test but is the resolveRegion implementation; TDD RED for this task's describe block was authored together with Task 2's tests in the same file, see Deviations)
2. **Task 2: product_cards emit in search-products.ts and get-product.ts** - `6290a3b3` (feat)

**Plan metadata:** (pending — recorded with this SUMMARY commit)

## Files Created/Modified
- `src/lib/medusa/regions.ts` - adds `resolveRegion`; `resolveRegionId` now delegates
- `src/lib/medusa/actions/search-products.ts` - widened `StoreProductVariant`/`StoreProduct` interfaces, region resolution captures country, ≤5-item emit after the products fetch
- `src/lib/medusa/actions/get-product.ts` - same interface widening, single-item emit in both the id and handle branches
- `tests/medusa-product-cards.test.ts` - resolveRegion coverage (matching country / no-country fallback / no-countries region / resolveRegionId delegation) + emit coverage (≤5 cap, item shape, url pinned/region-fallback/omitted, blocking-path no-throw, get-product single-item)

## Decisions Made
- Card builder duplicated as a private function in each executor file rather than extracted to a shared module — matches the existing `PRODUCT_FIELDS`/`formatProduct` per-file duplication convention in this executor pair (132-04's established pattern); avoids a new cross-file import for two ~15-line functions.
- `resolveRegion`'s single `/store/regions` fetch and country-match-then-`regions[0]` fallback logic is untouched — only the return shape changed (id → `{id, countryCode}`), keeping the delegation regression-safe.

## Deviations from Plan

None — plan executed exactly as written. One process note (not a deviation from the shipped behavior): the plan's Task 1 `<behavior>` describes writing only the `resolveRegion` describe block first, then Task 2 extending the same file with the emit-coverage blocks. This execution authored the full `tests/medusa-product-cards.test.ts` file (both describe blocks) in one pass before implementing either task, then implemented Task 1 (`resolveRegion`) and verified only its describe block green before moving to Task 2, and implemented Task 2 before the final full-file commit. Net result and file/test content are identical to what the plan specifies; only the intra-task RED/GREEN sequencing narrative differs, and Task 1's own commit therefore carries the `test(137-01)` label despite containing the `regions.ts` implementation (the test file itself was committed with Task 2, since that is when the full file first goes green end-to-end).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `resolveRegion` is available for any future country/region-fallback need.
- The SSE `ui`/`product_cards` event is now emitted on the streaming path — Plan 137-05 (widget renderer) is unblocked to buffer and render it.
- `tests/medusa-actions.test.ts` (resolveRegionId's existing cart/product callers) stays green — zero behavior change for Phase 132/134 callers.

---
*Phase: 137-product-cards-order-status*
*Completed: 2026-07-17*

## Self-Check: PASSED

All created/modified files verified present on disk; all task commit hashes verified present in git log.
