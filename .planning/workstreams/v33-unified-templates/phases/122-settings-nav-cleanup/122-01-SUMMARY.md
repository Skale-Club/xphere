---
phase: 122-settings-nav-cleanup
plan: 01
subsystem: ui
tags: [settings, navigation, lucide-react]

# Dependency graph
requires: []
provides:
  - "Settings sub-nav Communications section reduced to Email Templates only"
  - "Chat Widget nav entry relocated to Build section (alongside Knowledge)"
  - "Redundant Call Center nav item removed (Calls surface already has its own /calls/settings entry)"
affects: [123-whatsapp-templates-relocation, 125-messages-preview-templates-nav-finalization]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: [src/components/settings/settings-sub-nav.tsx]

key-decisions:
  - "Pure data reshuffle within the static SECTIONS array — no route files, no other components, no visual redesign"

patterns-established: []

requirements-completed: [NAV-01, NAV-02]

# Metrics
duration: 6min
completed: 2026-07-03
---

# Phase 122 Plan 01: Settings Nav Cleanup Summary

**Removed the redundant "Call Center" settings nav item and relocated "Chat Widget" from Communications into the Build section of `settings-sub-nav.tsx`.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-03T01:52:07Z
- **Completed:** 2026-07-03T01:58:07Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Communications section now lists only "Email Templates" — the duplicate "Call Center" link (which pointed to `/calls/settings`, already surfaced via the top-level Calls sidebar entry) is gone
- "Chat Widget" now lives under Build, alongside "Knowledge", correctly reflecting it as a buildable/configurable surface rather than a "Communications" channel
- Unused `Phone` icon import removed from the `lucide-react` import block; `MessageSquare` retained since it's still used by the relocated item

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove Call Center and relocate Chat Widget in settings sub-nav** - `da04d9f8` (feat)

**Plan metadata:** (this commit, see final commit below)

## Files Created/Modified
- `src/components/settings/settings-sub-nav.tsx` - Removed Call Center item from Communications, moved Chat Widget item from Communications to Build, removed unused Phone icon import

## Decisions Made
None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `/settings/widget` and `/calls/settings` routes are untouched — only nav placement changed, so no downstream route work is needed.
- Ready for Phase 123 (WhatsApp Templates Relocation + Search/Filter) and Phase 124 (Messages Templates Data Model + CRUD), neither of which depends on this plan's specific changes but both build within the same `settings-sub-nav.tsx` SECTIONS array — future edits should be aware of the current Build/Communications shape established here.
- No blockers.

---
*Phase: 122-settings-nav-cleanup*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: src/components/settings/settings-sub-nav.tsx
- FOUND: .planning/workstreams/v33-unified-templates/phases/122-settings-nav-cleanup/122-01-SUMMARY.md
- FOUND: da04d9f8
