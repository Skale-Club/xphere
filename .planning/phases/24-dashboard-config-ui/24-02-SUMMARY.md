---
phase: 24-dashboard-config-ui
plan: 02
subsystem: integrations-ui
tags: [manychat, settings-page, client-component, server-component, react-hook-form]
dependency_graph:
  requires: [24-01]
  provides: [manychat-settings-ui]
  affects: [integrations-root-page]
tech_stack:
  added: []
  patterns: [react-hook-form + zod + zodResolver, sonner toasts, navigator.clipboard, server actions from client component]
key_files:
  created:
    - src/app/(dashboard)/integrations/manychat/page.tsx
    - src/components/integrations/manychat-settings.tsx
    - src/app/(dashboard)/integrations/manychat/constants.ts
  modified:
    - src/app/(dashboard)/integrations/manychat/actions.ts
    - src/app/(dashboard)/integrations/page.tsx
    - tests/manychat/channel-actions.test.ts
decisions:
  - Extracted MANYCHAT_PAYLOAD_TEMPLATE and ManychatChannelForDisplay type to constants.ts to comply with Next.js 'use server' restriction (only async functions may be exported from a 'use server' file)
  - Used inline payload template copy in manychat-settings.tsx to avoid cross-boundary import of non-function export
metrics:
  duration_minutes: 20
  completed_date: "2026-05-07"
  tasks_completed: 2
  files_created: 3
  files_modified: 3
---

# Phase 24 Plan 02: ManyChat Settings UI Summary

**One-liner:** ManyChat settings page with two-state UI (connect form / connected dashboard) wired to server actions, plus ManyChat card on root integrations page.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create manychat/page.tsx + manychat-settings.tsx | ef88637 | page.tsx, manychat-settings.tsx, constants.ts, actions.ts (modified), test updated |
| 2 | Add ManyChat card to root /integrations page | 3c0b828 | integrations/page.tsx |

## What Was Built

### src/app/(dashboard)/integrations/manychat/page.tsx
Server component that calls `getManychatChannel()` and passes the result to `<ManychatSettings>`. Auth-gated via `getUser()` with redirect to `/login` if unauthenticated.

### src/components/integrations/manychat-settings.tsx
Client component with two render states:
- **Not connected:** react-hook-form + zod form with channel_name and api_key fields; calls `createManychatChannel`; spinner while submitting; `router.refresh()` on success
- **Connected:** read-only fields for webhook URL, webhook secret, JSON payload template; copy buttons using `navigator.clipboard.writeText` + sonner toasts; Test Connection button with spinner calling `testManychatConnection`; Disconnect button calling `deleteManychatChannel` with spinner

### src/app/(dashboard)/integrations/manychat/constants.ts
New shared module (no `'use server'` / `'use client'` directives) exporting `ManychatChannelForDisplay` type and `MANYCHAT_PAYLOAD_TEMPLATE` object. Required because Next.js enforces that `'use server'` files export only async functions.

### src/app/(dashboard)/integrations/page.tsx
ManyChat card added between the existing Meta Messaging card and `<IntegrationsTable>`, using the same `MessageCircleMore` icon already imported. Links to `/integrations/manychat`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Next.js 'use server' object export restriction**
- **Found during:** Task 1 (first npm run build attempt)
- **Issue:** `MANYCHAT_PAYLOAD_TEMPLATE` exported from `actions.ts` (a `'use server'` file) caused build error: "A 'use server' file can only export async functions, found object."
- **Fix:** Moved `MANYCHAT_PAYLOAD_TEMPLATE` and `ManychatChannelForDisplay` type to new `constants.ts` (no server/client directive). Updated `actions.ts` to `export type { ManychatChannelForDisplay } from './constants'`. Removed `MANYCHAT_PAYLOAD_TEMPLATE` from actions.ts. Updated test import for `MANYCHAT_PAYLOAD_TEMPLATE` from actions to constants.
- **Files modified:** `actions.ts`, `constants.ts` (new), `manychat-settings.tsx`, `tests/manychat/channel-actions.test.ts`
- **Commit:** ef88637

## Test Results

- `npm run build`: exit 0, all 33 routes compile
- `npx vitest run tests/manychat/`: 45/45 pass
- `npx vitest run` (full suite): 195 pass / 1 pre-existing failure in `action-engine.test.ts` (unrelated to this plan — existed before wave 1)

## Known Stubs

None — all data is wired to real server actions and the DB channel row.

## Self-Check: PASSED

Files exist:
- FOUND: src/app/(dashboard)/integrations/manychat/page.tsx
- FOUND: src/components/integrations/manychat-settings.tsx
- FOUND: src/app/(dashboard)/integrations/manychat/constants.ts

Commits exist:
- ef88637 — feat(24-02): add ManyChat settings page + client settings component
- 3c0b828 — feat(24-02): add ManyChat card to root /integrations page
