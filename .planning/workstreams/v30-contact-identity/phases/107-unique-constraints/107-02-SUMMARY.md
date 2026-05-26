---
phase: 107-unique-constraints
plan: 02
subsystem: database
tags: [contacts, dedup, unique-constraints, supabase, postgrest, identity, race-safety]

# Dependency graph
requires:
  - phase: 107-unique-constraints/01
    provides: "Migration 1059 partial UNIQUE indexes contacts_org_phone_uniq + contacts_org_email_uniq with WHERE phone_e164/email_normalized IS NOT NULL AND identity_status <> 'archived_duplicate'"
  - phase: 106-merge-tool
    provides: "resolveLiveContactId helper + identity_status='merge_conflict' CHECK + /admin/contacts/conflicts UI"
  - phase: 105-audit-generated-columns
    provides: "phone_e164 / email_normalized generated columns + normalisePhone/normaliseEmail helpers"
provides:
  - "findByPhone(supabase, orgId, phone) canonical org-scoped lookup helper"
  - "findByEmail(supabase, orgId, email) canonical org-scoped lookup helper"
  - "Race-safe createContact: pre-check + 23505 recovery + multi-conflict insert path"
  - "MatchedVia type ('phone' | 'email' | 'both_same' | 'multi_conflict' | null) for form callers"
  - "Structured collision log line: '[contacts/create] contact.unique_collision source=form ...'"
affects: [107-03-webhook-collision, 107-04-form-callers, contact-import, contact-form-ux]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-check normalized columns + INSERT + catch SQLSTATE 23505 (Supabase-js cannot express partial-index ON CONFLICT)"
    - "Pre-check via Promise.all for parallel phone/email lookup"
    - "Canonical lookup helpers accept SupabaseClient so service-role webhook handlers can reuse"

key-files:
  created: []
  modified:
    - "src/lib/contacts/server.ts (+findByPhone, +findByEmail, +imports)"
    - "src/app/(dashboard)/contacts/actions.ts (createContact refactor + MatchedVia export)"

key-decisions:
  - "Phone wins on D-01c fallback (matches the partial-index priority convention)"
  - "Pre-check runs phone + email in parallel via Promise.all (one round-trip)"
  - "23505 fast path prefers the already-fetched pre-check hit before re-querying (saves a round-trip when the pre-check resolved a contact but its existence races with another inserter)"
  - "details? typed as unknown directly on createContact return (removed the prior `as { ... }` cast)"

patterns-established:
  - "Lookup helper contract: (supabase, orgId, value) -> { id } | null with archived_duplicate filter"
  - "23505 collision log shape: console.log(`[<source>/<component>] contact.unique_collision source=<source> org_id=<id> contact_id=<id> matched_via=<phone|email>`)"

requirements-completed: [CID-07, CID-08]

# Metrics
duration: 7m 18s
completed: 2026-05-26
---

# Phase 107 Plan 02: race-safe createContact + canonical lookup helpers Summary

**Race-safe createContact backed by Phase 107 partial UNIQUE indexes, with `findByPhone`/`findByEmail` canonical lookup helpers that webhook handlers (plan 03) and the form callers (plan 04) will consume.**

## Performance

- **Duration:** 7m 18s (440s)
- **Started:** 2026-05-26T03:04:42Z
- **Completed:** 2026-05-26T03:12:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added two canonical org-scoped lookup helpers (`findByPhone`, `findByEmail`) next to `resolveLiveContactId` in `src/lib/contacts/server.ts`. Both normalise input via the existing zod-schema helpers and filter out `identity_status='archived_duplicate'` so the lookup predicate textually matches the partial UNIQUE index WHERE clause (Pitfall 1).
- Refactored `createContact` (`src/app/(dashboard)/contacts/actions.ts:389-466`) from the race-prone `.eq('phone', data.phone)` SELECT-then-INSERT to the contract specified in 107-CONTEXT.md D-01..D-01c:
  - Parallel pre-check via `Promise.all([findByPhone, findByEmail])`.
  - `both_same` / single-field hits return the existing contact without modification (D-01a).
  - Phone-on-A + email-on-B → INSERT with `identity_status='merge_conflict'` and `matched_via='multi_conflict'` for `/admin/contacts/conflicts` (D-01).
  - 23505 catch: fast path returns the pre-check hit; re-query fallback handles the genuine race window (D-01b).
  - Structured `console.log('[contacts/create] contact.unique_collision …')` on every collision (Pitfall 5).
- Extended return shape to `{ id, existed, matched_via, error, details }` and exported the new `MatchedVia` union for the form callers in plan 04.

## Task Commits

1. **Task 1: add findByPhone/findByEmail helpers** — `b0f7213` (feat)
2. **Task 2: race-safe createContact with pre-check + 23505 recovery** — `f232f8f` (feat)

## Files Created/Modified

- `src/lib/contacts/server.ts` — added `findByPhone`, `findByEmail`, plus the `SupabaseClient` / `Database` / `normalisePhone` / `normaliseEmail` imports; left `resolveLiveContactId` and `'server-only'` intact.
- `src/app/(dashboard)/contacts/actions.ts` — added `MatchedVia` export, imported the two helpers, replaced the `createContact` body (signature + 23505 recovery + multi-conflict insert path + structured collision log).

## Decision Branches Now Covered by createContact

| Pre-check outcome | Return | identity_status on insert |
|---|---|---|
| neither phone nor email hits | `{ id, existed: false, matched_via: null }` after insert | `identified` |
| phone hit only | `{ id: phoneHit.id, existed: true, matched_via: 'phone' }` (no insert) | — |
| email hit only | `{ id: emailHit.id, existed: true, matched_via: 'email' }` (no insert) | — |
| both hit, same id | `{ id, existed: true, matched_via: 'both_same' }` (no insert) | — |
| both hit, different ids | `{ id, existed: false, matched_via: 'multi_conflict' }` after insert | `merge_conflict` |
| INSERT throws 23505 with pre-check hit | `{ id: hit.id, existed: true, matched_via: 'phone' | 'email' }` + log | — |
| INSERT throws 23505 with no pre-check hit | re-query winner; same shape + log | — |
| INSERT other error | `{ error: error.message }` | — |

## Build + Lint Output

- `npm run build` — exits 0. TypeScript pass: "Finished TypeScript in 24.6s". All routes compiled. (One transient `.next/lock` left over from an abandoned prior build process; cleared and rebuilt successfully — see Issues Encountered.)
- `npm run lint` — repo script is broken (`next lint` invokes with bad arg parsing, mistaking the package dir for a project path: "Invalid project directory provided, no such directory: …\lint"). Direct `npx eslint` also fails because the repo has no `eslint.config.*` (ESLint 9 migration unfinished). This is a pre-existing repo-wide condition, not caused by this plan. Build (which runs the full TypeScript check) is the canonical correctness gate per CLAUDE.md.

## Decisions Made
- Used the `Promise.all` parallel pre-check (one round-trip) rather than sequential phone-then-email lookup.
- 23505 fast path uses the already-fetched `phoneHit`/`emailHit` before re-querying, falling back to `findByPhone`/`findByEmail` re-query only when the pre-check missed.
- Typed `details?: unknown` directly on the return shape instead of casting at the call site (the prior `as { error: string; details?: unknown }` cast is no longer needed).
- Kept the rest of `createContact` (auth, zod parse, custom-field validation, tag-name resolution, `setContactTags`, `revalidatePath`) unchanged.

## Deviations from Plan

### Out-of-scope blockers cleared

**1. [Rule 3 — Blocking] Cleared stale `.next/lock` from abandoned prior build**
- **Found during:** Task 2 verification (`npm run build`)
- **Issue:** A prior Next 16 build process had exited without releasing `.next/lock`; subsequent `next build` invocations refused to run with "Another next build process is already running."
- **Fix:** Removed `.next/lock` (and once cleared `.next/` entirely after a separate ENOENT on `pages-manifest.json` from cache corruption).
- **Files modified:** none in repo; cleared build artifact dir only.
- **Verification:** `npm run build` exited 0 with the full route table printed.
- **Committed in:** n/a (build artifact cleanup, not source-tracked).

---

**Total deviations:** 1 cleared blocker (build environment cache cleanup, not a code change).
**Impact on plan:** None on shipped code. Build + TypeScript are clean.

## Issues Encountered
- `npm run lint` is broken at the repo level (next lint argument parsing fails; ESLint 9 config missing). Pre-existing condition, not caused by this plan. Build's TypeScript phase is the effective correctness gate and passes.
- Build cache corruption after the lock removal (missing `pages-manifest.json`) required a one-time `rm -rf .next && npm run build`. Clean rebuild succeeded; no source changes needed.

## User Setup Required
None — no external service configuration required for this plan. Migration 1059 (Plan 01) already landed and provides the partial UNIQUE indexes that this plan relies on.

## Known Stubs
None. All wiring is complete — the new return shape is consumed (or will be) by:
- Form callers (`new-contact-dialog.tsx`, `new-contact-page-form.tsx`, `new-opportunity-dialog.tsx`) in plan 04.
- Webhook handlers (whatsapp / evolution / telegram `process-*.ts`) in plan 03, which will switch to `findByPhone` / `findByEmail`.

## Next Phase Readiness
- Plan 03 (webhook collision handlers in whatsapp/evolution/telegram) can now import `findByPhone`/`findByEmail` from `@/lib/contacts/server` and replicate the 23505 catch pattern.
- Plan 04 (form caller toast UX) can switch on `matched_via` per D-04 / D-04a — the union type is exported.
- No blockers.

## Self-Check: PASSED
- src/lib/contacts/server.ts: FOUND
- src/app/(dashboard)/contacts/actions.ts: FOUND
- Commit b0f7213 (Task 1): FOUND
- Commit f232f8f (Task 2): FOUND
- `findByPhone` / `findByEmail` exported: FOUND (grep hits in server.ts)
- `matched_via` / `23505` / `contact.unique_collision` / `merge_conflict` / `findByPhone` / `findByEmail` in actions.ts: 22 occurrences
- Raw `.eq('phone', data.phone)` lookup removed: 0 occurrences
- `npm run build` exit code: 0

---
*Phase: 107-unique-constraints*
*Completed: 2026-05-26*
