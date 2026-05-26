---
phase: 106-merge-tool
plan: 03
subsystem: contact-identity
status: complete
completed: 2026-05-25
tags: [types, supabase, hand-edit, phase-105-precedent]
requirements: [CID-04, CID-06]
dependency-graph:
  requires: [106-02]
  provides: [merge_contacts-typing, contact_merge_log-typing, contact_merge_exclusions-typing, merged_into_contact_id-typing]
  affects: [106-04, 106-05]
tech-stack:
  added: []
  patterns: [manual-type-patch]
key-files:
  created: []
  modified:
    - src/types/database.ts
decisions:
  - "Manual hand-edit (no MCP regen) — preserves Phase 105 D-04 precedent (MCP/CLI auth blocked for this project)"
  - "strategy modeled as 'manual' | 'auto' | 'import-dedup' literal union (matches CHECK constraint from migration 1057)"
  - "affected_rows typed as `Json | null` (consistent with existing Json export at line 7)"
  - "merge_contacts Returns: undefined (matches Supabase-gen convention for SQL void returns)"
metrics:
  duration: "~2 min"
  tasks: 1
  files: 1
---

# Phase 106 Plan 03: Type Regen for Migration 1057 Summary

Hand-edited `src/types/database.ts` to add types for migration 1057's schema additions (contacts.merged_into_contact_id, contact_merge_log, contact_merge_exclusions, merge_contacts, _is_cluster_fully_excluded). `npm run build` green.

## Five edits applied to `src/types/database.ts`

### Edit 1 — `contacts.Row` (line 1638)
Added between `identity_status` and `company`:
```ts
merged_into_contact_id: string | null
```

### Edit 2 — `contacts.Insert` + `contacts.Update` (lines 1659, 1678)
Added in both blocks adjacent to `identity_status`:
```ts
merged_into_contact_id?: string | null
```

### Edit 3 — `contacts.Relationships` (lines 1703-1708)
Added third entry after `contacts_account_id_fkey`:
```ts
{
  foreignKeyName: 'contacts_merged_into_contact_id_fkey'
  columns: ['merged_into_contact_id']
  isOneToOne: false
  referencedRelation: 'contacts'
  referencedColumns: ['id']
}
```
(Postgres auto-named the self-FK as `<table>_<column>_fkey` since migration 1057 did not give it an explicit name — confirmed by reading lines 33-35 of `1057_contact_merge_tool.sql`.)

### Edit 4 — New table types (lines 1748-1856)
Inserted `contact_merge_exclusions` and `contact_merge_log` between `contact_duplicate_audit` and `accounts`:
- `contact_merge_exclusions`: composite PK (org_id, contact_id_a, contact_id_b), nullable `excluded_by` + `reason`, 4 Relationships (org, contact_id_a, contact_id_b, excluded_by → users).
- `contact_merge_log`: uuid PK, nullable `merged_by` + `cluster_id` + `affected_rows`, strategy union `'manual' | 'auto' | 'import-dedup'` (matches CHECK at migration line 56), 3 Relationships (org, cluster_id → contact_duplicate_audit, merged_by → users).

### Edit 5 — `Functions` block (lines 5001-5018)
Added alphabetically (`_is_cluster_fully_excluded` first because `_` < `g`, `merge_contacts` after `get_*`):
```ts
_is_cluster_fully_excluded: {
  Args: { p_org_id: string; p_contact_ids: string[] }
  Returns: boolean
}
merge_contacts: {
  Args: { survivor_id: string; archived_id: string }
  Returns: undefined
}
```

## Build verification

```
✓ Compiled successfully in 9.3s
```
Exit code 0. Redis runtime warnings during static collection are pre-existing and unrelated to type changes.

## Acceptance criteria (all pass)

| Check | Result |
|---|---|
| `merged_into_contact_id` appears ≥ 4 times | 5 (Row, Insert, Update, fkey name, columns) |
| `contact_merge_exclusions:` opener | 1 line (1748) |
| `contact_merge_log:` opener | 1 line (1801) |
| `merge_contacts:` Functions entry | 1 line (5012) |
| `_is_cluster_fully_excluded:` Functions entry | 1 line (5001) |
| `'manual' \| 'auto' \| 'import-dedup'` strategy union | 3 lines (Row, Insert, Update) |
| `npm run build` exit 0 | ✓ |

## Deviations

**Rule 0 — Plan precedent (intentional, planned):** Used manual hand-edit instead of MCP `generate_typescript_types`. Plan 106-03 explicitly binds the executor to this Phase 105 D-04 precedent because the Supabase MCP for this project is misconfigured (Phase 105 D-04 / 105-02-SUMMARY.md). Not a deviation from the plan — a deviation from the default workflow that the plan endorses.

No `any` casts introduced. No other deviations.

## Self-Check: PASSED

- src/types/database.ts: FOUND (modified, 131 insertions)
- Commit 7879459: FOUND (`git log --oneline -1`)
- All 7 acceptance criteria: PASS
- npm run build exit 0: VERIFIED
