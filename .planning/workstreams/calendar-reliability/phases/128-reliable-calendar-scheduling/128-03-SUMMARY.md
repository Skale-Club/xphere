---
phase: 128-reliable-calendar-scheduling
plan: 03
subsystem: workflows
tags: [workflow-seeds, multi-tenancy, yaml, vitest, tenant-neutrality]

# Dependency graph
requires:
  - phase: 128-reliable-calendar-scheduling (128-01, 128-02)
    provides: pure scheduling math + secured calendar-tick endpoint (unrelated file surface, no direct dependency)
provides:
  - Tenant-neutral platform-default booking-confirmation.yaml (no brand, phone, pricing, or hardcoded pipeline stage)
  - 8 Skleanings-only example workflows relocated to .planning/workflows/examples/agendamento/ (git history preserved), unreachable by either seed loader
  - tests/workflow-seeds-tenant-neutral.test.ts regression guard against reintroducing tenant-specific seed content
affects: [calendar-reliability, workflow-authoring, new-org-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recursive YAML collector mirroring scripts/validate-workflows.ts's walk() for filesystem-based regression tests"
    - "git mv for file relocation with subdirectory structure preserved (git rename detection, no content edits)"

key-files:
  created:
    - tests/workflow-seeds-tenant-neutral.test.ts
    - .planning/workflows/examples/agendamento/cleaning-service-reminders.yaml
    - .planning/workflows/examples/agendamento/skleanings-lost-remarketing.yaml
    - .planning/workflows/examples/agendamento/nutricao/skleanings-30d-checkin.yaml
    - .planning/workflows/examples/agendamento/nutricao/skleanings-90d-upsell.yaml
    - .planning/workflows/examples/agendamento/pipeline/skleanings-noshow-reengajamento.yaml
    - .planning/workflows/examples/agendamento/pipeline/skleanings-post-service-review.yaml
    - .planning/workflows/examples/agendamento/pipeline/skleanings-quote-followup.yaml
    - .planning/workflows/examples/agendamento/pipeline/skleanings-quote-parado.yaml
  modified:
    - supabase/seeds/workflows/booking-confirmation.yaml

key-decisions:
  - "Removed tag_customer and create_opportunity nodes entirely from the platform default rather than genericizing them, per RESEARCH.md's recommendation — most orgs won't have a 'customer' tag convention or a matching pipeline stage"
  - "Reworded the plan's own explanatory YAML comment to avoid the literal substring 'Job Confirmed', which would have tripped the plan's own forbidden-pattern regression test"

patterns-established:
  - "Filesystem-based regression tests for tenant-neutrality of seed content (no mocking, no DB) — reusable pattern for future SCH-04-style audits"

requirements-completed: [SCH-04]

# Metrics
duration: 10min
completed: 2026-07-16
---

# Phase 128 Plan 03: Tenant-Neutral Platform-Default Workflow Seeds Summary

**Neutralized the live Skleanings-branded booking-confirmation.yaml platform default and relocated 8 Skleanings-only example workflows out of supabase/seeds/workflows/, closing the SCH-04 gap with a filesystem regression test.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-16T00:35:00-04:00 (approx.)
- **Completed:** 2026-07-16T00:45:18-04:00
- **Tasks:** 2
- **Files modified:** 9 (1 modified, 8 relocated via `git mv`)

## Accomplishments
- `supabase/seeds/workflows/booking-confirmation.yaml` — the currently-live platform default loaded for every new org via `src/lib/workflows/seed-org.ts` — no longer tags contacts "customer", creates a "Job Confirmed" opportunity, or sends a Skleanings-branded email. It now sends a generic confirmation email using only confirmed `MeetingScope` fields (`title`, `starts_date`, `starts_time`, `location.address`, `google_calendar_url`, `attendee_contact.first_name`, `attendee_contact.email`, `id`).
- The 8 Skleanings-only workflows previously nested under `supabase/seeds/workflows/agendamento/**` (a latent risk for the recursive bulk loader `scripts/load-workflow-seeds.ts`) are now at `.planning/workflows/examples/agendamento/**` — preserved as authoring reference material, git history intact, structurally unreachable by either seed loader.
- New `tests/workflow-seeds-tenant-neutral.test.ts` guards against regression: scans every YAML recursively under `supabase/seeds/workflows/` for Skleanings-specific strings, confirms `agendamento/` no longer exists there, and confirms all 8 relocated files exist at the new location.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Write the failing tenant-neutrality regression test** - `b9fdfd2c` (test) — RED, all 3 assertions failed as expected against the pre-existing offending content.
2. **Task 2: Neutralize booking-confirmation.yaml and relocate agendamento/** to .planning/workflows/examples/** - `da2b686b` (feat) — GREEN, all 3 assertions pass.

_No REFACTOR commit needed — implementation was already minimal and clean after GREEN._

## Files Created/Modified
- `tests/workflow-seeds-tenant-neutral.test.ts` - Filesystem regression test; recursive YAML collector + forbidden-pattern scan
- `supabase/seeds/workflows/booking-confirmation.yaml` - Neutralized platform default (generic confirmation email, no tag/opportunity nodes)
- `.planning/workflows/examples/agendamento/cleaning-service-reminders.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/skleanings-lost-remarketing.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/nutricao/skleanings-30d-checkin.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/nutricao/skleanings-90d-upsell.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/pipeline/skleanings-noshow-reengajamento.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/pipeline/skleanings-post-service-review.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/pipeline/skleanings-quote-followup.yaml` - Relocated (unchanged content)
- `.planning/workflows/examples/agendamento/pipeline/skleanings-quote-parado.yaml` - Relocated (unchanged content)

## Decisions Made
- Removed `tag_customer`/`create_opportunity` nodes entirely from the platform default instead of genericizing their config, following RESEARCH.md's recommendation — these assume business-specific platform state (a tag convention, a pipeline stage) most orgs won't have configured.
- Kept the 8 relocated files' content byte-identical (no edits) since they remain valuable as realistic authoring examples — only their location changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's own explanatory YAML comment tripped its own regression test**
- **Found during:** Task 2 verification
- **Issue:** The plan's literal neutralized `booking-confirmation.yaml` text included an explanatory comment containing the substring "Job Confirmed" (describing *why* the pipeline-stage assumption was removed), which matched the `FORBIDDEN_PATTERNS` regex `/Job Confirmed/` from Task 1's own test — a self-inflicted RED after the intended GREEN.
- **Fix:** Reworded the comment to "specific pipeline stage assumed to exist" — same meaning, no longer contains the literal forbidden substring.
- **Files modified:** `supabase/seeds/workflows/booking-confirmation.yaml`
- **Verification:** `npx vitest run tests/workflow-seeds-tenant-neutral.test.ts` — 3/3 passing
- **Committed in:** `da2b686b` (Task 2 commit)

**2. [Rule 1 - Bug] Empty `agendamento/` directory tree survived `git mv` of all its files**
- **Found during:** Task 2 verification
- **Issue:** Git does not track empty directories; after `git mv`-ing all 8 files out of `supabase/seeds/workflows/agendamento/{,nutricao,pipeline}`, the now-empty directory tree remained present on the filesystem (untracked by git but still `existsSync()`-visible), failing Task 1's "agendamento/ no longer exists" assertion.
- **Fix:** `rm -rf supabase/seeds/workflows/agendamento` after the moves completed.
- **Files modified:** none (directory removal only, no git-tracked content affected — the directory had no remaining files)
- **Verification:** `test -d supabase/seeds/workflows/agendamento` fails (as expected); `npx vitest run tests/workflow-seeds-tenant-neutral.test.ts` — 3/3 passing
- **Committed in:** `da2b686b` (Task 2 commit — the directory removal is implicit in git's tree state, no separate diff entry since it was never tracked)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs surfaced by running the plan's own verification steps as written)
**Impact on plan:** Both fixes were required for the plan's own stated `<done>` criteria to actually pass; no scope creep, no architectural changes.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. Per REQUIREMENTS.md's Out-of-Scope note and RESEARCH.md's Runtime State Inventory, no seed loader was run and no `workflows`/`workflow_versions` database rows were touched — this plan only changed git-tracked files.

## Next Phase Readiness
- SCH-04 is closed: new (and any non-Skleanings) organizations onboarded after this change via `seed-org.ts` will receive the tenant-neutral `booking-confirmation` default; the recursive bulk loader (`scripts/load-workflow-seeds.ts` / `npm run seed`) can no longer reach any Skleanings-branded content under `supabase/seeds/workflows/`.
- The Skleanings org's already-installed `workflows` rows (however they got there) are untouched — confirmed by this plan's execution log: no seed loader script was invoked.
- Ready for the next plan in Phase 128 (128-04 or later, per ROADMAP.md wave ordering).

---
*Phase: 128-reliable-calendar-scheduling*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 10 key files verified present on disk (`tests/workflow-seeds-tenant-neutral.test.ts`, 8 relocated `.planning/workflows/examples/agendamento/**` YAMLs, `supabase/seeds/workflows/booking-confirmation.yaml`). Both task commits (`b9fdfd2c`, `da2b686b`) confirmed present via `git log --oneline --all`.
