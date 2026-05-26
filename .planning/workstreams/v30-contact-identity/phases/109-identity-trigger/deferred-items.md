# Phase 109 Deferred Items

## Out-of-scope build failure (pre-existing)

**File:** `src/components/copilot/copilot-launcher.tsx:111`
**Error:** `Cannot find name 'ChevronRight'.` — missing import (`lucide-react`).
**Status:** Pre-existing modified file in working tree at start of Phase 109; NOT caused by Plan 109-01 changes.
**Why deferred:** Phase 109 introduces only SQL (migration 1061) + planning artifacts. Zero `.ts/.tsx` edits.
**Suggested owner:** Whoever was last editing the copilot launcher UI (file was in `git status M` prior to Phase 109 work).
