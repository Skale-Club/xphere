---
phase: 110-app-wiring
plan: 05
subsystem: contacts-list-surface
tags: [identity, conflicts, ui, filter-chip, list-page]
requires: [110-01, 107-02]
provides:
  - getConflictCount helper (head:true count query, RLS-scoped)
  - identity_status filter on contactListFiltersSchema
  - Conflicts filter chip on /contacts list page
  - URL-driven ?identity_status=merge_conflict toggle
affects:
  - src/app/(dashboard)/contacts/page.tsx
  - src/components/contacts/contacts-table.tsx
  - src/lib/contacts/server.ts
  - src/lib/contacts/zod-schemas.ts
  - src/app/(dashboard)/contacts/actions.ts
tech-stack-added: []
patterns:
  - "URL-driven filter chip (mirrors ?source=, ?tag= pattern)"
  - "Disabled-chip CSS-only (opacity-50 + pointer-events-none) — no flash"
  - "3-way parallel fetch (Promise.all)"
key-files-created: []
key-files-modified:
  - src/lib/contacts/zod-schemas.ts
  - src/lib/contacts/server.ts
  - src/app/(dashboard)/contacts/actions.ts
  - src/app/(dashboard)/contacts/page.tsx
  - src/components/contacts/contacts-table.tsx
decisions:
  - D-08 conflict filter chip shipped on /contacts (not new detail page)
  - D-03a list-surface conflict filter implemented
  - Open Question 1 resolved: disabled-chip uses CSS only (no link wrapper at count=0)
  - Pitfall 5 enforced: single canonical ?identity_status param, no ?conflicts=1
metrics:
  duration: ~25min
  completed: 2026-05-26
  tasks_completed: 2/2
  commits: 2 (1 piggy-backed on parallel 110-04 commit, 1 new)
requirements: [CID-15]
---

# Phase 110 Plan 05: Conflict Filter + Counter Summary

Surface merge_conflict contacts on `/contacts` via a live-count filter chip wired to a canonical URL param (`?identity_status=merge_conflict`).

## What Shipped

### 1. Schema diff (`src/lib/contacts/zod-schemas.ts`)

`contactListFiltersSchema` extended with a fourth optional field after `source`:

```ts
identity_status: z
  .enum(['channel_only', 'identified', 'verified', 'merge_conflict'])
  .optional(),
```

`archived_duplicate` intentionally excluded — admins do not filter list surface for archived rows.

### 2. `getConflictCount` helper (`src/lib/contacts/server.ts:174-190`)

Single-shot count query using PostgREST `head: true, count: 'exact'` — no rows returned, just the count. RLS auto-scopes to active org per CLAUDE.md (no manual `org_id` filter).

```ts
export async function getConflictCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('identity_status', 'merge_conflict')
  return count ?? 0
}
```

### 3. `getContacts` filter wiring (`src/app/(dashboard)/contacts/actions.ts:148`)

```ts
if (f.identity_status) query = query.eq('identity_status', f.identity_status)
```

Mirrors the existing `f.source` filter pattern one line above.

### 4. Page-level fetch (`src/app/(dashboard)/contacts/page.tsx`)

- URL param parsed + validated against `VALID_IDENTITY_STATUS` whitelist.
- 3-way `Promise.all`: `getContacts` + `getDefinitions` + `getConflictCount`.
- Both `conflictCount` and `currentIdentityStatus` forwarded to `<ContactsTable>`.

### 5. ConflictsChip render (`src/components/contacts/contacts-table.tsx:235-258` chip placement, `:267-323` component)

Chip rendered in the toolbar row, immediately after `<ContactsFilterPopover>`. Three visual states:

| State | Styling | Click |
| --- | --- | --- |
| `count === 0` | `opacity-50 cursor-not-allowed pointer-events-none`, label "Conflicts: 0" | disabled (no handler) |
| `count > 0`, not active | neutral border/bg, hover lifts | toggles filter on |
| `count > 0`, active | amber accent + clear X | toggles filter off |

Uses plain `<button>` (not Link) so disabled state shows no flash and a11y `aria-pressed` / `aria-label` is correct.

## URL Param Canonicalization

ONLY `?identity_status=merge_conflict` is used. Plan Pitfall 5 enforced — no `?conflicts=1` alias was introduced. Verification:

```bash
$ rg "conflicts=1" src/
# Only matches: 2 documentation comments stating "no ?conflicts=1 flag"
# Zero actual URL constructions.
```

## Verification

- `npm run build` → exit 0 (compiled successfully in 34.5s)
- `rg "identity_status" src/app/(dashboard)/contacts/` → 15 hits across 3 files
- `rg "getConflictCount" src/` → 3 hits across 2 files (export + import + usage)
- `rg "conflicts=1" src/` → 2 hits, both negation comments

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Notable Coordination Observation

**Task 1's changes were already committed by parallel agent 110-04.** A sibling worker (commit `3982a76 feat(110-04): add IdentityStatusBadge + is_verified to getContact`) had bundled the Task 1 deliverables (`getConflictCount` helper, `identity_status` schema field, `f.identity_status` query filter) into its commit. When I attempted to stage and commit Task 1, git reported nothing to commit because the on-disk content already matched HEAD. This is a wave-2 parallelization side effect — Task 1's content is correctly present in the tree under a different commit hash. Task 2 (page.tsx + chip render) was untouched and committed cleanly under `06eb7b8`.

## Decisions Implemented

- **D-03a** — Conflict filter ships on `/contacts/page.tsx` list page (no new detail route).
- **D-08** — Filter chip with live count; click toggles `?identity_status=merge_conflict`.
- **Open Question 1** — Disabled chip is render-disabled (`opacity-50` + `pointer-events-none`), no Link wrapper at count=0, no flash.
- **Pitfall 5** — Single canonical URL param, no `?conflicts=1` alias.

## Commits

| Hash | Task | Message |
| --- | --- | --- |
| `3982a76` | Task 1 (piggy-backed) | `feat(110-04): add IdentityStatusBadge + is_verified to getContact` (bundles getConflictCount + identity_status schema/filter from this plan) |
| `06eb7b8` | Task 2 | `feat(110-05): render Conflicts filter chip on /contacts list page` |

## Known Stubs

None. Chip is fully wired to live data via `getConflictCount`. Filter is fully wired through Zod schema + `getContacts` query builder.

## Self-Check: PASSED

- src/lib/contacts/server.ts:182 `export async function getConflictCount` — FOUND
- src/lib/contacts/zod-schemas.ts:138 `identity_status: z.enum(...)` — FOUND
- src/app/(dashboard)/contacts/actions.ts:148 `f.identity_status` filter — FOUND
- src/app/(dashboard)/contacts/page.tsx — getConflictCount import + 3-way Promise.all + URL param parsing — FOUND
- src/components/contacts/contacts-table.tsx — ConflictsChip component + toolbar placement + new props — FOUND
- Commit 06eb7b8 — FOUND in `git log`
- npm run build — exit 0
