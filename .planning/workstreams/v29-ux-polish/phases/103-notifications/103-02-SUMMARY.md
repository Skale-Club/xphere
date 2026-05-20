---
phase: 103-notifications
plan: 02
subsystem: ui
tags: [notifications, bell, popover, realtime, server-actions]
dependency_graph:
  requires: [103-01]
  provides: [notification-bell, notification-list, notification-item, notifications-actions]
  affects: []
tech_stack:
  added: []
  patterns: [use-client-realtime, server-actions-with-rls, popover-controlled, date-fns-relative]
key_files:
  created:
    - src/app/(dashboard)/notifications/actions.ts
    - src/components/notifications/notification-bell.tsx
    - src/components/notifications/notification-list.tsx
    - src/components/notifications/notification-item.tsx
    - tests/notifications/actions.test.ts
    - tests/notifications/unread-count.test.ts
  modified:
    - src/components/layout/top-bar.tsx
    - src/app/(dashboard)/layout.tsx
decisions:
  - "NotificationBell exports getBadgeLabel as named export for unit testability"
  - "Removed unused React import from top-bar.tsx after removing useState hook"
  - "Only emit notification inside !error condition to avoid double-notify on Vapi retries"
metrics:
  duration: ~20min
  completed: 2026-05-19
  tasks: 3
  files: 8
---

# Phase 103 Plan 02: Notification Bell UI + Server Actions Summary

**One-liner:** NotificationBell component with Supabase Realtime INSERT subscription, numeric badge, Popover list with mark-all/mark-one, server actions using RLS-scoped authenticated client, and TopBar wired via userId from layout.

## Tasks Completed

| Task | Name | Status | Key Output |
|------|------|--------|------------|
| 1 | Server actions for notifications | Done | fetchNotifications, markNotificationRead, markAllNotificationsRead |
| 2 | NotificationBell, NotificationList, NotificationItem | Done | 3 components + getBadgeLabel export |
| 3 | Wire NotificationBell into TopBar and layout | Done | userId prop flows from layout → TopBar → bell |

## Verification Results

- `grep "fetchNotifications\|markNotificationRead\|markAllNotificationsRead" actions.ts` — 3 matches
- `grep "getUser\|createClient" actions.ts` — both from @/lib/supabase/server
- No `.eq('org_id'` in actions.ts — RLS handles org scoping
- `npx vitest run tests/notifications/actions.test.ts` — 5 passed
- `grep "postgres_changes" notification-bell.tsx` — match
- `grep "getBadgeLabel" notification-bell.tsx` — exported
- `grep "Mark all as read" notification-list.tsx` — match
- `grep "router.push" notification-item.tsx` — match
- `npx vitest run tests/notifications/unread-count.test.ts` — 4 passed
- `grep "hasNotifications" top-bar.tsx` — no match (mock removed)
- `grep "userId={user.id}" layout.tsx` — match
- `npm run build` — exits 0

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all three actions fetch from DB, Realtime subscription is live.

## Self-Check: PASSED

- src/app/(dashboard)/notifications/actions.ts: FOUND
- src/components/notifications/notification-bell.tsx: FOUND
- src/components/notifications/notification-list.tsx: FOUND
- src/components/notifications/notification-item.tsx: FOUND
- Commit b6104c1: FOUND
