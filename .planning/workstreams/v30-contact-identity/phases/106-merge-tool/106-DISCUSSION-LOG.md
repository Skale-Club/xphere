# Phase 106: MERGE-TOOL - Discussion Log

> **Audit trail only.** Not consumed by downstream agents.

**Date:** 2026-05-25
**Phase:** 106-merge-tool
**Areas discussed:** Auto-merge scope, FK rewrite strategy, Mark-as-separate semantics, merged_into FK app behavior

---

## Area Selection
User replied "faca o recomendado" — discuss all four areas, pick the recommended option for each.

---

## Auto-merge Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Defer auto-merge to a later phase | Build manual-only path now. Auto-merge logic gets designed when real duplicates exist to validate against. | ✓ |
| Build auto-merge now with conservative rules | Ship with "auto-merge only when all non-identity fields are identical or one side is null". Risks: untested against real data. | |
| Build aggressive auto-merge | Merge when all fields are compatible. Higher false-positive risk. | |

**Rationale:** Phase 105 baseline showed 0 clusters in prod. Without real duplicate patterns, any auto-merge rule is theoretical. Build the gate UI now, learn the rules when data appears.

---

## FK Rewrite Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit per-table UPDATE list in SECURITY DEFINER function | One migration, one function, every table named explicitly. Auditable. | ✓ |
| Generic helper that iterates pg_constraint to find FKs | More dynamic but harder to review. RLS interactions less predictable. | |
| ON UPDATE CASCADE on contact_id FKs | Not applicable — contact.id doesn't change, only its identity_status. | |

**Rationale:** ~10 tables reference contacts.id. Each has its own RLS shape. A future engineer reading `merge_contacts()` should see the full impact in plaintext, not infer it through dynamic SQL.

---

## "Mark as Separate" Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| New contact_merge_exclusions table | Persistent, queryable, RLS-scoped. Refresh function filters using it. | ✓ |
| is_intentional_duplicate flag on contacts | Flag-per-row doesn't capture "A and B are intentionally separate" — needs pair representation. | |
| Soft-delete via deleted_at | Wrong semantics — these contacts aren't duplicates, they're distinct. | |

**Rationale:** Exclusion is a relationship between pairs of contacts, not a property of one contact. A dedicated table is the natural shape. Canonical `a<b` ordering prevents duplicate exclusions.

---

## merged_into FK App Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Three-mode behavior (read banner, write redirect, lookup hide) | Reads show banner + link, writes silently follow, lookups exclude archived. | ✓ |
| Hard redirect on every read | URLs to archived contacts 301 to survivor. Loses historical context. | |
| 404 archived contacts | Brutal, loses the "trail of merges" value. | |

**Rationale:** Archived contacts have historical value — past conversations, calls, etc., were once theirs. Showing the page with a banner preserves the trail. Lookups and writes always flow to survivor so new activity isn't fragmented.

---

## Claude's Discretion
- Migration filename (1057_*.sql)
- React Server vs Client component split for conflicts page
- Pagination details for large clusters
- Whether to add `archived_at IS NULL` filter in audit refresh

## Deferred Ideas
- Auto-merge → Phase 106.1 or Phase 110
- Bulk merge UI
- Undo merge
- Inline merge from contact detail page
- Notification on merge
- Workflow event on merge
- Archived contact retention policy
