# Phase 122: Settings Nav Cleanup - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss skipped)

<domain>
## Phase Boundary

Settings navigation stops duplicating the Calls surface and stops misfiling Chat Widget under Communications. Scope is limited to `src/components/settings/settings-sub-nav.tsx`: remove the "Call Center" nav item from the Communications section entirely (the underlying `/calls/settings` route and Calls sidebar entry point are untouched), and move the "Chat Widget" nav item from Communications into the existing Build section. No route files change. No other component changes.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
This is a pure infrastructure/data-reshuffling phase — removing one array entry and relocating another within the existing `SECTIONS` array in `settings-sub-nav.tsx`. There is no visual design ambiguity (icons, labels, and routes for the surviving items are unchanged) and no user-facing behavior to decide beyond what the roadmap success criteria already specify verbatim. All implementation choices are at Claude's discretion within that boundary.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/settings/settings-sub-nav.tsx` — the sole `SECTIONS` array definition already has a `Build` heading (currently just "Install App") to move Chat Widget into.

### Established Patterns
- Each `NavItem` is `{ href, label, icon }`; sections are `{ heading, items }`. No other file duplicates this nav (confirmed in prior research pass).

### Integration Points
- None beyond this one file — `/settings/widget` and `/calls/settings` routes are not touched, only their nav entry points.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the roadmap success criteria — infrastructure phase, discuss skipped.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (this phase does not touch the Communications→Templates rename, which is Phase 125's job).

</deferred>
