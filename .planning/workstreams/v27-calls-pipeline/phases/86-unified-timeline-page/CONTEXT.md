# Phase 86: Unified Timeline Page - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning
**Mode:** Pre-implemented (merged from claude branch before v2.7 milestone creation)

<domain>
Delivers the `/calls` page with a tab navigation layout (Timeline, Campaigns, Assistants, Settings) and the UnifiedCallTimeline component that lists AI and human calls in a date-grouped feed with type/direction filters and keyword search.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices already made — phase was built prior to milestone formalization.

- Tabs nav extracted to `_nav.tsx` client component using `usePathname` for active detection
- Layout includes auth redirect and PageHeader with Phone icon
- Timeline is a client component with optimistic URL param updates via `router.replace`
- Filters use pill-group toggle buttons (not dropdowns) for type (All/AI/Human) and direction (All/Inbound/Outbound/Missed)
- Date grouping: Today/Yesterday/date labels rendered client-side
- Pagination via URL `?page=N` param with Previous/Next buttons
</decisions>

<specifics>
Key files implementing this phase:
- `src/app/(dashboard)/calls/(tabs)/layout.tsx` — auth gate + PageHeader + CallsNav + slot
- `src/app/(dashboard)/calls/(tabs)/_nav.tsx` — client tabs nav with active state detection
- `src/app/(dashboard)/calls/(tabs)/page.tsx` — server page fetching getUnifiedCalls with searchParams filtering
- `src/components/calls/unified-call-timeline.tsx` — full client component: pill filters, search input, date-grouped list, pagination
</specifics>

<deferred>
None
</deferred>
