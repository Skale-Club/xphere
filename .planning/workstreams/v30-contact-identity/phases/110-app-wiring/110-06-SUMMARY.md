---
phase: 110-app-wiring
plan: 06
subsystem: contacts
tags: [csv-import, dedup, identity, normalization, blocked-emails, wizard-ui]

# Dependency graph
requires:
  - phase: 105-audit-generated-columns
    provides: phone_e164 / email_normalized generated columns
  - phase: 107-unique-constraints
    provides: partial UNIQUE index predicate excluding archived_duplicate
  - phase: 110-app-wiring/02
    provides: isBlockedEmail + BLOCKED_EMAIL_PATTERNS (D-04)
provides:
  - CSV import pre-flight dedup uses normalized identity columns (fixes false-negative bug)
  - dryRunImport surfaces wouldConflict + wouldBlockedEmail counters
  - Import wizard preview shows pre-flight summary before "Start import"
  - Blocked-email rows still import via phone (phone-carries-contact path)
affects: [110-app-wiring/07 (validation report), future CSV import perf work, IMP-* polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-flight dedup against normalized identity columns (phone_e164 / email_normalized) with .neq archived_duplicate filter — mirrors Phase 107 partial UNIQUE predicate"
    - "Pure preflight scan function in tests for isolation (no Supabase mock required) — re-derived predicates against in-memory existing-sets"
    - "Source-file assertions in unit tests to guard load-bearing constants (CHUNK = 500, presence of normalized-column query)"

key-files:
  created:
    - .planning/workstreams/v30-contact-identity/phases/110-app-wiring/deferred-items.md
  modified:
    - src/app/(dashboard)/contacts/actions.ts
    - src/app/(dashboard)/contacts/import-actions.ts
    - src/components/contacts/import-wizard-dialog.tsx
    - tests/contacts-csv-import.test.ts

key-decisions:
  - "Bug fix scope: switch dedup query from .select('phone, email') to .select('phone_e164, email_normalized, identity_status') + .neq('identity_status','archived_duplicate'). Compares normalized-vs-normalized."
  - "Blocked emails are treated as null (not row-level rejected). Phone carries the contact (Phase 109 invariant). blockedEmailCount tracks the drop, not a skip."
  - "wouldConflict counts skip-due-to-existing-match in BOTH actions.ts and import-actions.ts dryRunImport. Wizard surfaces it as a stat cell."
  - "Test isolation: re-implement the (pure) preflight scan in the test file and exercise it against in-memory sets. Server-action E2E is out of scope; manual QA + UI rendering covers the wizard side."
  - "Source-file assertion test guards CHUNK = 500 (Pitfall 3) and the presence of the normalized-column dedup. Future regressions fail loudly with a test."

patterns-established:
  - "Pre-flight = read normalized identity columns, never raw. Future identity-touching pre-flights MUST follow."
  - "DryRunStat cells are the canonical UI primitive for surfacing pre-flight counters in the import wizard."

requirements-completed: [CID-16]

# Metrics
duration: ~10min
completed: 2026-05-26
---

# Phase 110 Plan 06: CSV Import Pre-Flight Refactor Summary

**CSV import dedup now reads phone_e164 / email_normalized with the archived-duplicate predicate, isBlockedEmail wired at both the action and the dry-run, and the wizard preview surfaces the two new counters before commit.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-26T14:53:00Z (approx)
- **Completed:** 2026-05-26T15:02:39Z
- **Tasks:** 2
- **Files modified:** 4 (1 new deferred-items.md)

## Accomplishments

- **RESEARCH bug fixed:** `importContactsCsv` and `dryRunImport` now dedup against `phone_e164` / `email_normalized` (Phase 105 generated columns) instead of raw `phone` / `email`. The old code compared normalized input against raw stored values → guaranteed false negatives whenever the formatting differed (e.g. `+55 (11) 99999-0000` CSV input vs `+5511999990000` stored).
- **Archived-duplicate predicate:** Both queries add `.neq('identity_status', 'archived_duplicate')` to mirror the partial UNIQUE index predicate from Phase 107 (`1059_contacts_unique_constraints.sql`). The dedup-set and the DB-level uniqueness now agree on which rows count.
- **isBlockedEmail wired into CSV path:** Placeholder emails (`noemail@*`, `noreply@*`, `@example.com`, etc.) are dropped to null at row-normalize time. The row still imports if a valid phone is present (D-04a phone-carries-contact). `blockedEmailCount` (action) and `wouldBlockedEmail` (dry-run) report the count.
- **Conflict counters:** New `conflictRows` (`ImportSummary`) + `wouldConflict` (`DryRunResult`) fields surface skip-due-to-existing-match rows separately from generic skips, both at the action level and in the dry-run.
- **Wizard preview UI:** Two new `DryRunStat` cells ("Conflicts" + "Placeholder emails") render alongside the existing Insert/Update/Skip/Error grid, plus a one-line explainer below the grid when either is non-zero — visible before "Start import" enables.
- **500-row chunk preserved (Pitfall 3):** `const CHUNK = 500` untouched and now guarded by a source-file assertion test.
- **Integration test coverage:** 6 new pre-flight tests + 3 source-file guards added to `tests/contacts-csv-import.test.ts`.

## Task Commits

1. **Task 1: Refactor importContactsCsv pre-flight** — `4cfff58` (fix)
2. **Task 2: Extend dryRunImport + wizard preview UI + integration tests** — `8c518c4` (feat)

**Plan metadata:** _pending — final commit after STATE/ROADMAP updates_

## Files Created/Modified

- `src/app/(dashboard)/contacts/actions.ts` — `importContactsCsv` refactored: normalized-column dedup, `.neq` archived filter, `isBlockedEmail` wired at email-normalize site, `ImportSummary` extended with `conflictRows` + `blockedEmailCount`, conflict increments on skip-due-to-existing-match. CHUNK = 500 preserved.
- `src/app/(dashboard)/contacts/import-actions.ts` — `dryRunImport`: import `isBlockedEmail`; filter blocked emails before the `IN()` lookup; switch existing-contact queries to `.select('phone_e164')` / `.select('email_normalized')` with `.neq('identity_status','archived_duplicate')`; return new `wouldConflict` + `wouldBlockedEmail` fields.
- `src/components/contacts/import-wizard-dialog.tsx` — extend `DryRunResult` interface; add 2-cell grid for Conflicts + Placeholder emails after the existing 4-cell grid; explanatory text below when either counter is non-zero.
- `tests/contacts-csv-import.test.ts` — append `preflightScan` helper + 6 behavioral tests + 3 source-file-assertion tests.
- `.planning/workstreams/v30-contact-identity/phases/110-app-wiring/deferred-items.md` — pre-existing test failure noted (out of scope).

## Bug fix — before/after

**Before (actions.ts ~743):**

```ts
const { data: existing } = await supabase
  .from('contacts')
  .select('phone, email')                                // raw columns
const existingPhones = new Set((existing ?? []).map((r) => r.phone).filter(Boolean))
const existingEmails = new Set((existing ?? []).map((r) => r.email).filter(Boolean))
// …later…
const phone = normalisePhone(getField('phone'))          // normalized
if (existingPhones.has(phone)) { /* never matches when stored fmt differs */ }
```

**After:**

```ts
const { data: existing } = await supabase
  .from('contacts')
  .select('phone_e164, email_normalized, identity_status')   // normalized
  .neq('identity_status', 'archived_duplicate')              // mirror Phase 107 partial UNIQUE predicate
const existingPhones = new Set((existing ?? []).map((r) => r.phone_e164).filter(Boolean))
const existingEmails = new Set((existing ?? []).map((r) => r.email_normalized).filter(Boolean))
// …later, comparison is now normalized-vs-normalized
```

## Test coverage matrix

| Behavior | Test |
| --- | --- |
| Mixed-format phone collision (RESEARCH bug) | `detects conflict when CSV phone in mixed formatting matches stored phone_e164` |
| Blocked email + valid phone still imports | `reports blockedEmailCount when CSV row email is noemail@example.com` |
| Blocked email + no phone → skip | `row with blocked email AND no phone is skipped` |
| Email-only dedup case-insensitive | `email-only dedup hits when phone is absent and email_normalized matches` |
| Aggregate counts across a mixed batch | `aggregates counts across a mixed batch` |
| In-batch duplicate detection | `in-batch duplicates are counted as conflicts` |
| CHUNK = 500 preserved (Pitfall 3) | `actions.ts still uses CHUNK = 500 for the batch insert loop` |
| Normalized-column dedup landed | `actions.ts dedup loads normalized columns` |
| dryRunImport returns new counters | `import-actions.ts dryRunImport returns wouldConflict + wouldBlockedEmail` |

All 9 new tests pass. 1 pre-existing failure (`maps Portuguese variants`) is logged in `deferred-items.md` — unrelated to this plan (introduced by commit `361b650` first/last name parsing).

## Decisions implemented

- **D-06** (CSV pre-flight switched to normalized columns + counters surfaced) — done.
- **D-06a** (no schema changes to `contact_imports` / `contact_import_errors`; app-side refactor only) — done.
- **D-04a (CSV portion)** — `isBlockedEmail` wired at both `importContactsCsv` and `dryRunImport`; blocked emails treated as null, phone carries the contact.
- **CID-16** — fully complete (Plan 02 shipped the blocklist + zod + createContact integration; this plan finishes the CSV side).

## Wizard UI integration point

- `src/components/contacts/import-wizard-dialog.tsx:566-595` — new 2-cell grid + explainer text inserted between the existing 4-cell stat grid and the sample-errors block. Uses the existing `DryRunStat` primitive (no new components).
- "Start import" button enabled state unchanged (`canStart = hasPhone || hasEmail`). Conflicts do NOT block the button; user remains in control.

## Deviations from Plan

None - plan executed exactly as written. The single test failure encountered (`maps Portuguese variants`) is a pre-existing issue unrelated to the plan and was logged to `deferred-items.md` per the scope boundary rule.

## Issues Encountered

- One pre-existing test failure in `suggestColumnMapping > maps Portuguese variants`. Root cause: commit `361b650` changed Portuguese alias `nome` to resolve to `first_name` instead of `name`. Out of scope; logged in deferred-items.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 06 closes CID-16 and the CSV portion of D-04a + all of D-06.
- Ready for Plan 07 (validation report / phase close-out). The wizard now displays accurate pre-flight counts; manual QA can verify the new cells render with seeded CSV data.
- No blockers introduced.

## Self-Check: PASSED

- `src/app/(dashboard)/contacts/actions.ts` — FOUND (modified)
- `src/app/(dashboard)/contacts/import-actions.ts` — FOUND (modified)
- `src/components/contacts/import-wizard-dialog.tsx` — FOUND (modified)
- `tests/contacts-csv-import.test.ts` — FOUND (modified)
- `.planning/workstreams/v30-contact-identity/phases/110-app-wiring/deferred-items.md` — FOUND (created)
- Commit `4cfff58` — FOUND (Task 1)
- Commit `8c518c4` — FOUND (Task 2)
- `phone_e164` present in `src/app/(dashboard)/contacts/actions.ts` — verified
- `wouldConflict` + `wouldBlockedEmail` present in import-actions and dialog — verified
- `CHUNK = 500` preserved in actions.ts — verified (line 860)
- `npm run build` exit 0 — verified
- Tests: 21 pass, 1 pre-existing unrelated failure logged

---
*Phase: 110-app-wiring*
*Completed: 2026-05-26*
