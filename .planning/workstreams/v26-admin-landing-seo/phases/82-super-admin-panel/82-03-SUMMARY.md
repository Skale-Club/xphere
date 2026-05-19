---
plan: 82-03
status: complete
completed_at: "2026-05-19"
requirements_satisfied:
  - ADM-03
  - ADM-04
---

# Summary: 82-03 — Org detail page (members + feature flags)

## What was done

**`src/app/(admin)/admin/_actions/get-org-detail.ts`**: two server actions using service role:
- `getOrgDetail(orgId)` — fetches org row + 3 parallel count queries + org_members + `auth.admin.listUsers()` to resolve member emails; returns `OrgDetail` shape
- `updateOrgSettings(orgId, settings)` — patches `organizations.settings` jsonb

**`src/app/(admin)/admin/orgs/[orgId]/page.tsx`**: server component, async params (Next.js 16 pattern), error boundary.

**`src/components/admin/org-detail-view.tsx`**: client component with:
- Two-column layout: `grid grid-cols-3 gap-6` — main (col-span-2) + sidebar (col-span-1)
- 4 metric cards in `grid grid-cols-2 gap-4` (Contacts, Calls, Conversations, Members)
- Members table — Email | Role | Joined with empty state "No members in this organization."
- Feature flags panel: 3 flags (ai_calling_enabled, bulk_import_enabled, advanced_pipeline_enabled), each with Switch + label + description (48px min-height rows), "Save Feature Flags" CTA (`bg-red-600`)
- Org metadata card — ID + Created date
- Back link "← Back to Organizations" at top
- `useTransition` for async save with toast feedback

## Verification

- `npm run build` exits 0 ✅
- `/admin/orgs/[orgId]` route registered ✅
- All ADM-03 + ADM-04 requirements covered ✅
