---
plan: 82-02
status: complete
completed_at: "2026-05-19"
requirements_satisfied:
  - ADM-02
---

# Summary: 82-02 — getAllOrgs server action + /admin/orgs page + OrgsTable

## What was done

**`src/app/(admin)/admin/_actions/get-all-orgs.ts`**: `'use server'` action using `createServiceRoleClient()` to bypass RLS. Queries all orgs ordered by `created_at desc`, then runs 4 parallel count queries per org using `{ count: 'exact', head: true }`. FK columns: `org_members.organization_id`, `calls.organization_id`, `contacts.org_id`, `conversations.org_id`.

**`src/app/(admin)/admin/orgs/page.tsx`**: server component that calls `getAllOrgs()` and passes data to `OrgsTable`. Error boundary renders graceful fallback on failure.

**`src/components/admin/orgs-table.tsx`**: client component with:
- Search input (280px, Search icon prefix) filtering by name or slug case-insensitively
- Sort on "Name" and "Created" columns with ChevronUp/Down indicators
- Table columns: Name | Slug | Created | Members | Contacts | Calls | Conversations | →
- Row hover `bg-[#1A1A1D]` + `cursor-pointer` → `router.push('/admin/orgs/${org.id}')`
- `tabular-nums` on all count cells
- Two empty states: "No organizations yet" (no orgs) and "No organizations match your search." (search miss)
- Date formatted as `MMM D, YYYY` via `toLocaleDateString('en-US', ...)`

## Verification

- `npm run build` exits 0 ✅
- `'use server'` directive on get-all-orgs.ts ✅
- Correct FK column names per table ✅
- `tabular-nums` class present ✅
- Both empty state strings present ✅
