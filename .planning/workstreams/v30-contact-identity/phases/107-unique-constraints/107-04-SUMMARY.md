---
phase: 107-unique-constraints
plan: 04
subsystem: ui
tags: [contacts, sonner, toast, forms, react, nextjs, opportunities]

requires:
  - phase: 107-unique-constraints
    provides: "createContact return shape { id, existed, matched_via } (plan 02)"
  - phase: 106-merge-tool
    provides: "/admin/contacts/conflicts admin UI for multi_conflict review"
provides:
  - "Form UX for duplicate detection per D-04/D-04a (Portuguese toast copy verbatim)"
  - "Single-conflict 'Contato ja existe' toast with Abrir link to /contacts/[id]"
  - "Multi-conflict 'Conflito de identidade' warning toast with admin-only link"
  - "Opportunity quick-create silent auto-select on any matched_via value"
affects: [110-verified-state, conflict-resolution-ux]

tech-stack:
  added: []
  patterns:
    - "Switch on matched_via for form duplicate UX (single-conflict vs multi_conflict)"
    - "sonner toast.warning with action for admin links; toast.message + action for contact links"
    - "No auto-redirect on existed: true (D-04) — toast.action drives navigation"

key-files:
  created: []
  modified:
    - "src/components/contacts/new-contact-dialog.tsx"
    - "src/components/contacts/new-contact-page-form.tsx"
    - "src/components/pipeline/new-opportunity-dialog.tsx"

key-decisions:
  - "new-contact-page-form returns early on existed: true to keep the toast Abrir link actionable (no auto-redirect)"
  - "Opportunity quick-create stays silent even when matched_via === 'multi_conflict'; conflict status will surface via contact card badge in Phase 110"
  - "Toast copy lifted verbatim from D-04/D-04a in 107-CONTEXT.md (Portuguese)"

patterns-established:
  - "Caller pattern for createContact: error -> toast.error; existed -> branch on matched_via; otherwise -> toast.success"

requirements-completed: [CID-07, CID-08]

duration: 6min
completed: 2026-05-26
---

# Phase 107 Plan 04: Form Caller Update Summary

**Three callers of `createContact` now consume `{ id, existed, matched_via }` with Portuguese D-04/D-04a sonner toasts and no auto-redirect on duplicate.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-26T03:21:00Z
- **Completed:** 2026-05-26T03:27:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `new-contact-dialog.tsx` + `new-contact-page-form.tsx` switch on `matched_via`:
  - `'multi_conflict'` -> `toast.warning('Conflito de identidade ...')` with Abrir action to `/admin/contacts/conflicts`
  - `'phone' | 'email' | 'both_same'` -> `toast.message('Contato ja existe', ...)` with Abrir action to `/contacts/[id]`
  - Neither form auto-redirects on `existed: true`; page form returns early so the toast's Abrir link is the only navigation
- `new-opportunity-dialog.tsx` `handleQuickCreate` adapted to new return shape — silently auto-selects the returned id regardless of `matched_via`, no toast, comment documents the Phase 110 follow-up
- `npx tsc --noEmit` clean for all three plan files

## Task Commits

1. **Task 1: matched_via toasts in contact form callers** — `9fb19f9` (feat)
2. **Task 2: opportunity quick-create adapter** — `c67f5eb` (feat)

## Files Created/Modified

- `src/components/contacts/new-contact-dialog.tsx` — new switch on `matched_via` in `onSubmit`; preserved dialog close + `onCreated` callback + `router.refresh`
- `src/components/contacts/new-contact-page-form.tsx` — same switch; early `return` on `existed` so router does not auto-push to `returnTo`
- `src/components/pipeline/new-opportunity-dialog.tsx` — destructures `{ id, existed, matched_via }`, voids the two unused locals to satisfy `noUnusedLocals`, replaces success toast with a comment explaining the deliberate silence

## Decisions Made

- **No auto-redirect on duplicate (D-04 verbatim).** The page form previously navigated unconditionally after the toast — corrected to keep the user on the form so the toast's Abrir link is the actionable path.
- **Silent quick-create even on multi_conflict (per CONTEXT specifics).** A noisy warning toast inside the opportunity dialog flow would be jarring; conflict surfacing is Phase 110 work via a contact-card badge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] page-form auto-redirect contradicted D-04**

- **Found during:** Task 1
- **Issue:** Pre-existing code on `new-contact-page-form.tsx` ran `router.push(returnTo ?? '/contacts')` unconditionally, including on `existed: true`. D-04 explicitly forbids auto-redirect on duplicate (the Abrir toast action must be the navigation).
- **Fix:** Added early `return` in the `existed` branch so the router push only fires for genuine creations.
- **Files modified:** `src/components/contacts/new-contact-page-form.tsx`
- **Verification:** `npx tsc --noEmit` clean; logic inspected.
- **Committed in:** `9fb19f9`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix needed for D-04 compliance. No scope creep.

## Issues Encountered

- `npm run build` reported pre-existing TypeScript errors in unrelated areas (`src/lib/mcp/tools/tags.ts` — untracked file from concurrent Phase 109-mcp-coverage work; `tests/workflows/*`, `tests/agents/*` — missing test typings). Verified via `npx tsc --noEmit` filtered to the three plan files: zero errors. Documented out-of-scope items in `deferred-items.md`. Per scope-boundary rules these are not Plan 107-04's responsibility.

## Manual Smoke Plan

Tester (human) walkthrough — none executed in this run (autonomous):

1. **Single-conflict (phone match)** — Open `/contacts/new`, enter an existing contact's `+55...` phone with a fresh name, submit. Expect `Contato ja existe` toast with description `Vinculado ao contato existente (phone).` and Abrir action navigating to `/contacts/[id]`. Form stays mounted.
2. **Single-conflict (email match)** — same as above with an existing email. Expect description `... (email).`.
3. **Both-same** — phone + email belong to same existing contact. Expect description `... (both_same).`.
4. **Multi-conflict** — phone matches contact A, email matches contact B. Expect `Conflito de identidade ...` warning toast with Abrir action to `/admin/contacts/conflicts`. No redirect.
5. **No duplicate** — fresh values. Expect `Contato criado` success toast and navigation to `returnTo` (page form) / dialog close (dialog).
6. **Opportunity quick-create with duplicate** — open new-opportunity dialog, quick-create with an existing phone. Expect the existing contact auto-selected silently (no toast). Confirm Phase 110 will add a badge.

## Next Phase Readiness

- Plan 05 (the remaining 107 plan, e.g. race test / collision metrics polish) ready to start.
- Phase 110 owns the multi_conflict badge in the opportunity quick-create UI (RESEARCH.md Open Question 3 referenced inline).

## Self-Check: PASSED

- FOUND: `src/components/contacts/new-contact-dialog.tsx` (modified, contains `matched_via`, `multi_conflict`, `Conflito de identidade`, `/admin/contacts/conflicts`, `Contato ja existe`)
- FOUND: `src/components/contacts/new-contact-page-form.tsx` (modified, contains all required strings)
- FOUND: `src/components/pipeline/new-opportunity-dialog.tsx` (modified, contains `matched_via` and `createContact`)
- FOUND: commit `9fb19f9` (Task 1)
- FOUND: commit `c67f5eb` (Task 2)
- TS check on plan files: 0 errors

---
*Phase: 107-unique-constraints*
*Completed: 2026-05-26*
