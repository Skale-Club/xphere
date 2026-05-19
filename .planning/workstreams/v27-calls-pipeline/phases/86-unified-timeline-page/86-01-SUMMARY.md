---
plan: 86-01
status: complete
completed_at: "2026-05-19"
requirements_satisfied: [CALL-03, CALL-04]
---

# Summary: 86-01 — Unified Timeline Page

## What was done

Pre-implemented `/calls` hub with a route-group-based tabs layout (Timeline, Campaigns, Assistants, Settings) and a full-featured UnifiedCallTimeline client component. The layout authenticates via `getUser()` and renders a PageHeader with Phone icon plus a `CallsNav` client component that tracks the active tab via `usePathname`. The timeline page is a server component that parses `type`, `direction`, `q`, and `page` searchParams then calls `getUnifiedCalls`. UnifiedCallTimeline renders two pill-group filter bars (type: All/AI/Human; direction: All/Inbound/Outbound/Missed), a debounced search input, date-grouped call rows with TypeBadge (AI = violet, Human = muted), direction icons, status pills, recording/transcript badges, duration, and URL-based pagination.

## Key files

- `src/app/(dashboard)/calls/(tabs)/layout.tsx` — auth + PageHeader + CallsNav + children slot
- `src/app/(dashboard)/calls/(tabs)/_nav.tsx` — client tabs nav (Timeline/Campaigns/Assistants/Settings) with active detection
- `src/app/(dashboard)/calls/(tabs)/page.tsx` — server page with searchParam parsing and getUnifiedCalls call
- `src/components/calls/unified-call-timeline.tsx` — full timeline component with filters, search, grouped list, pagination

## Deviations from Plan

None - implementation pre-existed and was confirmed correct.
