# Phase 107 — Deferred Items (out of scope for 107-04)

Discovered during Plan 107-04 execution. None caused by this plan's changes.

## Pre-existing TypeScript errors

- `src/lib/mcp/tools/tags.ts:139` — `Parameter 'id' implicitly has an 'any' type.` File is untracked (concurrent Phase 109-mcp-coverage work in progress).
- Additional untracked Phase 109 files with similar issues: `src/lib/mcp/tools/accounts.ts`, `ai-calls.ts`, `calls.ts`, `custom-fields.ts`, `pipelines.ts`.
- `tests/workflows/yaml-to-flow.test.ts` — missing `@types/jest` or vitest type imports (~30 errors).
- `tests/agents/*.test.ts`, `tests/accounts-*.test.ts`, `tests/customfields-settings-actions.test.ts` — various pre-existing test typing issues (~50 errors).

## Unrelated working-copy modifications observed

- `src/app/(dashboard)/integrations/twilio/page.tsx`
- `src/components/brand/twilio-logo.tsx`
- `src/components/integrations/twilio-settings.tsx`

Not touched by Plan 107-04. Left for whoever owns the Twilio integration work.

## Per scope-boundary rules

Only the three files in Plan 107-04 (`new-contact-dialog.tsx`, `new-contact-page-form.tsx`, `new-opportunity-dialog.tsx`) were modified and verified clean via `npx tsc --noEmit` filtered to those paths (zero errors).
