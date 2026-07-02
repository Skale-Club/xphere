# Deferred Items — Phase 119

Out-of-scope discoveries logged during execution (NOT fixed here — not caused by Phase 119 changes).

## Pre-existing `npx tsc --noEmit` errors in test files

`npx tsc --noEmit -p tsconfig.json` reports ~91 errors, ALL in `tests/*` files, none in app source. These predate Phase 119 and are not surfaced by `npm run build` (which does not type-check the `tests/` directory). Vitest runs the suites fine at runtime (no per-test type-check).

Notable:
- `tests/email-template-builder.test.ts` (8 errors): block object literals lack the `id` field that `EmailBlock` gained in Phase 118 (`BaseBlock & { id: string }`). Fix = add `id: 'x'` (or similar) to each literal, or cast. Cosmetic/type-only; runtime suite passes.
- `tests/workflows/yaml-to-flow.test.ts` (40), `tests/workflows/schema-validate.test.ts` (22), and assorted `tests/agents/*`, `tests/chat/*`, etc. — unrelated to email templates.

Recommendation: a dedicated test-types cleanup pass; out of scope for the block-palette DnD phase.
