---
phase: 103-notifications
plan: 03
subsystem: backend
tags: [notifications, webhook, fan-out, service-role, vapi]
dependency_graph:
  requires: [103-01]
  provides: [insert-notification-helper, missed-call-emitter]
  affects: []
tech_stack:
  added: []
  patterns: [service-role-bypass-rls, webhook-always-200, fan-out-to-org-members, try-catch-swallow]
key_files:
  created:
    - src/lib/notifications/insert.ts
    - tests/notifications/insert.test.ts
  modified:
    - src/app/api/vapi/calls/route.ts
decisions:
  - "Only emit missed_call notification when !error (no duplicate on Vapi retries — 23505 duplicate would set error)"
  - "insertNotification called outside duplicate-error guard so it only fires on first successful insert"
metrics:
  duration: ~10min
  completed: 2026-05-19
  tasks: 2
  files: 3
---

# Phase 103 Plan 03: insertNotification Helper + Missed Call Event Emitter Summary

**One-liner:** Service-role insertNotification() fan-out helper wired into Vapi calls webhook to emit missed_call notifications on no-answer events, with org_members fan-out and try/catch error swallowing.

## Tasks Completed

| Task | Name | Status | Key Output |
|------|------|--------|------------|
| 1 | insertNotification() service helper with fan-out | Done | src/lib/notifications/insert.ts — 4 tests passing |
| 2 | Wire missed_call notification into Vapi calls webhook | Done | src/app/api/vapi/calls/route.ts updated |

## Verification Results

- `grep "SUPABASE_SERVICE_ROLE_KEY" insert.ts` — match
- `grep "org_members" insert.ts` — match (fan-out logic)
- `grep "try {" insert.ts` — match (error swallowing)
- No import from @/lib/supabase/client or @/lib/supabase/server in insert.ts
- `npx vitest run tests/notifications/insert.test.ts` — 4 passed
- `grep "insertNotification" vapi/calls/route.ts` — match
- `grep "missed_call" vapi/calls/route.ts` — match
- `grep "no-answer\|customer-did-not-answer" vapi/calls/route.ts` — match
- Webhook still returns HTTP 200 in all code paths
- `npm run build` — exits 0
- All 16 notification tests passing (rls, unread-count, actions, insert)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — insertNotification is live; new_conversation and flow_failed are infrastructure-ready but intentionally not wired in this plan (NOTIF-04 scope: missed_call is the v1 emitter).

## Self-Check: PASSED

- src/lib/notifications/insert.ts: FOUND
- tests/notifications/insert.test.ts: FOUND
- src/app/api/vapi/calls/route.ts: FOUND (modified)
- Commit 34bdf54: FOUND
