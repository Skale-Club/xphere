---
phase: 26-rules-ui-event-log
plan: "02"
subsystem: integrations/manychat
tags: [event-log, pagination, filters, server-component, sheet, badge]
dependency_graph:
  requires:
    - manychat_events table (RLS-scoped SELECT)
    - getUser / createClient (auth helpers)
    - Plan 26-01 (nav link pattern, ManychatRules for style reference)
  provides:
    - getManychatEvents() server action
    - /integrations/manychat/events page
    - ManychatEvents client component
  affects:
    - Admin can view, filter, and inspect all inbound ManyChat events
    - Phase 26 OBS-01/02/03 requirements fulfilled
    - v1.6 milestone complete
tech_stack:
  added: []
  patterns:
    - Server component page fetches data, passes to client component as props
    - URL query params as filter/pagination state (shareable links)
    - router.push for filter Apply and pagination navigation
    - Sheet for payload inspection
    - Badge with inline Tailwind colors for status chips
key_files:
  created:
    - src/app/(dashboard)/integrations/manychat/event-actions.ts
    - src/app/(dashboard)/integrations/manychat/events/page.tsx
    - src/components/integrations/manychat-events.tsx
  modified: []
decisions:
  - URL-based filter state via router.push — no local re-fetch, server component re-renders with new data on navigation
  - No useTransition needed — router.push triggers full server re-render providing fresh filtered results
  - Pagination count display shows "No events" when total is 0 to avoid "Showing 1–0 of 0"
metrics:
  duration: "8 minutes"
  completed_date: "2026-05-07"
  tasks_completed: 2
  files_changed: 3
---

# Phase 26 Plan 02: ManyChat Event Log Summary

**One-liner:** Paginated, filterable ManyChat event log with status badges, URL-shareable filters, and per-event payload inspection via a Sheet.

## What Was Built

### Task 1: getManychatEvents() server action

Created `src/app/(dashboard)/integrations/manychat/event-actions.ts` as a `'use server'` file exporting:

- `ManychatEventRow` — re-export of `Database['public']['Tables']['manychat_events']['Row']`
- `ManychatEventsFilter` — typed filter shape with `status`, `from`, `to`, `offset`, `limit`
- `getManychatEvents(filter)` — Supabase paginated query using `.select('*', { count: 'exact' })` + `.range(offset, offset + limit - 1)`; conditionally chains `.eq('status')`, `.gte('created_at')`, `.lte('created_at')` filters; returns `{ events, total }`

RLS scopes the query to the active org automatically — no manual `org_id` filter.

### Task 2: Events page + ManychatEvents client component

**`src/app/(dashboard)/integrations/manychat/events/page.tsx`** — server component that:
- Guards auth via `getUser()` + `redirect('/login')`
- Awaits `searchParams` Promise (Next.js 15 App Router pattern)
- Validates `status` param against allowlist `['matched', 'unmatched', 'error']`
- Calls `getManychatEvents({ status, from, to, offset, limit: 25 })` server-side
- Renders nav bar (Settings | Rules | Events with Events underlined) + `<ManychatEvents initialEvents={events} initialTotal={total} searchParams={params} />`

**`src/components/integrations/manychat-events.tsx`** — client component with:
- **Filter bar** — Status Select (all/matched/unmatched/error), From date input, To date input, Apply + Clear buttons
- **Events table** — columns: Received at (toLocaleString), Event type (font-mono), Status (Badge green/amber/red), Action log (truncated UUID or "—")
- **Pagination** — Previous/Next buttons using `router.push(buildPageUrl(offset ± LIMIT))`; Previous disabled on first page, Next disabled when `offset + 25 >= total`
- **Payload Sheet** — opens on row click; SheetTitle "Event Payload", SheetDescription shows event_type + formatted date; body is `<pre>` with `JSON.stringify(event_payload, null, 2)`
- Filter state initialized from `searchParams` props; Apply calls `router.push` with new URL params; Clear resets state and pushes clean URL

## Pagination and Filter Approach

Filters and pagination offset are stored entirely in URL query params (`?status=error&from=2026-05-01&to=2026-05-07&offset=25`). The client component calls `router.push` to update the URL, which causes the Next.js server component to re-render with fresh data. No client-side refetch or `useTransition` needed — keeps the implementation simple and the URL shareable.

## Deviations from Plan

None — plan executed exactly as written. The plan provided the complete implementation spec and it compiled without issues on the first build attempt.

## Build Status

`npm run build` exits 0 with zero type errors. Route `/integrations/manychat/events` listed as dynamic (ƒ).

## Known Stubs

None — all data is wired from real server-side Supabase queries via `getManychatEvents()`.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/app/(dashboard)/integrations/manychat/event-actions.ts` | FOUND |
| `src/app/(dashboard)/integrations/manychat/events/page.tsx` | FOUND |
| `src/components/integrations/manychat-events.tsx` | FOUND |
| Commit `791413e` (Task 1) | FOUND |
| Commit `881010b` (Task 2) | FOUND |
