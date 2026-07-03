---
phase: 123-whatsapp-templates-relocation-search-filter
plan: 01
subsystem: ui
tags: [nextjs, react, settings-nav, whatsapp, meta-cloud, zernio, client-side-filtering]

# Dependency graph
requires: []
provides:
  - Real Settings nav destination for WhatsApp templates at /settings/whatsapp-templates
  - Generic client-side filter component (WhatsAppTemplatesFilters) reusable across provider row shapes
  - Both external entry points (integration panel, chat template picker) repointed to the new route
affects: [125-messages-preview-templates-nav-finalization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic client component parameterized by a minimal structural interface (FilterableTemplate) so one filter UI serves two differently-shaped provider row types (Meta Cloud TemplateRow, Zernio ZernioTemplateRow) via a renderCard callback prop"
    - "Server Component fetches + passes raw array to a 'use client' filter/group component; grouping-by-status logic lives client-side, parameterized by a per-provider statusOrder array"

key-files:
  created:
    - src/app/(dashboard)/settings/whatsapp-templates/page.tsx
    - src/app/(dashboard)/settings/whatsapp-templates/whatsapp-templates-filters.tsx
    - src/app/(dashboard)/settings/whatsapp-templates/create-template-button.tsx
    - src/app/(dashboard)/settings/whatsapp-templates/sync-templates-button.tsx
    - src/app/(dashboard)/settings/whatsapp-templates/sync-zernio-templates-button.tsx
  modified:
    - src/app/(dashboard)/integrations/whatsapp/actions.ts
    - src/components/settings/settings-sub-nav.tsx
    - src/components/integrations/panels/whatsapp-cloud-panel.tsx
    - src/components/chat/chat-area/send-template-dialog.tsx

key-decisions:
  - "Removed groupCloudByStatus/groupZernioByStatus from page.tsx once grouping moved into the shared client filter component — kept as dead code they would have failed ESLint no-unused-vars in the production build"
  - "Task 1 relocated the page with zero filtering (grouped-render markup inline, unchanged) so the route was independently buildable before Task 2 layered the filter UI on top, per plan sequencing"

patterns-established:
  - "Generic 'use client' filter/group component accepting a renderCard callback to stay agnostic of the exact row shape, only requiring id/name/language/category/status"

requirements-completed: [WAT-01, WAT-02, WAT-03, WAT-04, WAT-05]

# Metrics
duration: 22min
completed: 2026-07-03
---

# Phase 123 Plan 01: WhatsApp Templates Relocation + Search/Filter Summary

**Relocated the WhatsApp templates screen from a nav-orphaned integrations sub-route to a real Settings entry at /settings/whatsapp-templates, and added a generic client-side name/status/category/language filter component shared by the Meta Cloud and Zernio render paths.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-03T01:59:08Z
- **Completed:** 2026-07-03T02:21:14Z
- **Tasks:** 2 completed
- **Files modified:** 12 (5 created/moved, 3 modified in Task 1's scope + 2 files touched again in Task 2; 4 total unique modified files, 5 created)

## Accomplishments
- New Settings nav entry ("WhatsApp Templates" under Communications, MessageCircle icon) landing on `/settings/whatsapp-templates`, replacing the old contextual-only "Manage templates" button as the discovery path
- Byte-identical relocation of the 3-branch (Meta Cloud / Zernio / neither-connected) data-fetching and grouped-by-status rendering logic — zero behavior regression for either provider
- New `WhatsAppTemplatesFilters` client component: name search (case-insensitive substring) + Status/Category/Language native selects, all AND-combinable, filtering an in-memory array with no page reload
- Both external entry points (`whatsapp-cloud-panel.tsx` "Manage templates" button, `send-template-dialog.tsx` "Create template" fallback link) and all 4 `revalidatePath` calls in `actions.ts` repointed to the new route
- Old `/integrations/whatsapp/templates` directory (4 files) fully removed; zero remaining references anywhere in `src/`

## Task Commits

Each task was committed atomically:

1. **Task 1: Relocate WhatsApp templates page and repoint all entry points** - `51622449` (feat)
2. **Task 2: Add name search + status/category/language filters** - `886a511d` (feat)

_Note: no separate plan-metadata commit was made prior to this SUMMARY; this SUMMARY + STATE/ROADMAP update will be committed together as the final metadata commit per the execution protocol._

## Files Created/Modified
- `src/app/(dashboard)/settings/whatsapp-templates/page.tsx` - Relocated Server Component (3-branch data fetching, grouped rendering delegated to WhatsAppTemplatesFilters in each connected-provider branch)
- `src/app/(dashboard)/settings/whatsapp-templates/whatsapp-templates-filters.tsx` - New 'use client' component: search input + 3 selects, generic over provider row shape via `FilterableTemplate`/`renderCard`
- `src/app/(dashboard)/settings/whatsapp-templates/create-template-button.tsx` - Moved byte-for-byte from the old route
- `src/app/(dashboard)/settings/whatsapp-templates/sync-templates-button.tsx` - Moved byte-for-byte from the old route
- `src/app/(dashboard)/settings/whatsapp-templates/sync-zernio-templates-button.tsx` - Moved byte-for-byte from the old route
- `src/app/(dashboard)/integrations/whatsapp/actions.ts` - All 4 `revalidatePath('/integrations/whatsapp/templates')` calls updated to `/settings/whatsapp-templates`
- `src/components/settings/settings-sub-nav.tsx` - Added `MessageCircle` import + new "WhatsApp Templates" nav item under Communications (appended after Phase 122's already-landed Call Center removal / Chat Widget move)
- `src/components/integrations/panels/whatsapp-cloud-panel.tsx` - "Manage templates" link href updated
- `src/components/chat/chat-area/send-template-dialog.tsx` - "Create template" fallback link href updated (target/rel unchanged)

## Decisions Made
- Confirmed live state of `settings-sub-nav.tsx` before editing (per task instructions) — Phase 122 had already landed (Call Center removed, Chat Widget moved to Build), so the Communications array only contained Email Templates at execution time; appended WhatsApp Templates without disturbing that prior change.
- Removed the now-dead `groupCloudByStatus`/`groupZernioByStatus` helper functions from `page.tsx` after Task 2's refactor moved grouping into the shared filter component — leaving them in place would have been unused code failing the production ESLint build step (Rule 1 — bug/build-breaking, auto-fixed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed dead grouping helpers left behind by the Task 2 refactor**
- **Found during:** Task 2 (filter component refactor)
- **Issue:** After delegating grouped rendering to `WhatsAppTemplatesFilters`, `groupCloudByStatus` and `groupZernioByStatus` in `page.tsx` became unused, which fails Next.js's production build (ESLint `no-unused-vars` is enforced during `next build`).
- **Fix:** Deleted both now-dead functions from `page.tsx`; grouping logic already re-implemented generically inside `whatsapp-templates-filters.tsx`.
- **Files modified:** `src/app/(dashboard)/settings/whatsapp-templates/page.tsx`
- **Verification:** `npm run build` passes with zero type errors after removal.
- **Committed in:** `886a511d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/build-breaking)
**Impact on plan:** Necessary cleanup directly caused by the plan's own instructed refactor. No scope creep.

## Issues Encountered
- Intermittent Windows-only `ENOENT` on `.next/server/proxy.js.nft.json` during the "Collecting build traces" step of `npm run build` — occurred on 2 of 5 build attempts with byte-identical source between attempts (confirmed via back-to-back reruns), so this is a pre-existing Next.js file-tracing race condition on this Windows filesystem, not caused by this plan's changes. Worked around by rerunning `npm run build`; final verification run succeeded cleanly (exit 0, zero type errors, correct route manifest).
- A second GSD executor (Phase 124, plan 01) was running concurrently in the same working tree. This caused transient `.next` build-lock contention (`⨯ Another next build process is already running`) and one `git stash pop` conflict on `.planning/workstreams/v33-unified-templates/{STATE,ROADMAP,REQUIREMENTS}.md` (the other executor had already committed its own updates to those files while my stash was held). Resolved by restoring only my own code file (`page.tsx`) from the stash via `git checkout stash@{0} -- <file>` and dropping the stash, leaving the concurrent executor's already-committed `.planning` updates untouched. No code file overlap occurred between the two executors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `/settings/whatsapp-templates` is live, nav-discoverable, and fully functional for both Meta Cloud and Zernio orgs with search/filter.
- Phase 125 (Messages Preview + Templates Nav Finalization) can proceed to rename "Communications" → "Templates" — the section now has both Email Templates and WhatsApp Templates as real entries, satisfying the stated Phase 125 precondition.
- No blockers.

---
*Phase: 123-whatsapp-templates-relocation-search-filter*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created files verified present on disk:
- FOUND: src/app/(dashboard)/settings/whatsapp-templates/page.tsx
- FOUND: src/app/(dashboard)/settings/whatsapp-templates/whatsapp-templates-filters.tsx
- FOUND: src/app/(dashboard)/settings/whatsapp-templates/create-template-button.tsx
- FOUND: src/app/(dashboard)/settings/whatsapp-templates/sync-templates-button.tsx
- FOUND: src/app/(dashboard)/settings/whatsapp-templates/sync-zernio-templates-button.tsx
- CONFIRMED: old src/app/(dashboard)/integrations/whatsapp/templates/ directory removed

All commits verified present in git history:
- FOUND: 51622449 (Task 1)
- FOUND: 886a511d (Task 2)
