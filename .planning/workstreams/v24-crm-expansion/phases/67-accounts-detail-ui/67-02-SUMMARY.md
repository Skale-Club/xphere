---
phase: 67-accounts-detail-ui
plan: "02"
subsystem: accounts-crm
tags: [accounts, crm, opportunities, activities, server-component, tabs, pipeline]
dependency_graph:
  requires: [67-01]
  provides: [account-opportunities-tab, account-activities-tab, getAccountOpportunities, getAccountActivities]
  affects: [pipeline-navigation, activity-timeline]
tech_stack:
  added: []
  patterns: [union-or-query, promise-all-parallel-fetch, server-component, rls-scoped-query, lucide-icons, relativeTime-helper, formatCurrency-helper]
key_files:
  created:
    - src/components/accounts/account-opportunities-tab.tsx
    - src/components/accounts/account-activities-tab.tsx
  modified:
    - src/app/(dashboard)/accounts/[id]/actions.ts
    - src/app/(dashboard)/accounts/[id]/page.tsx
decisions:
  - "OpportunityWithStage interface declared in actions.ts and exported so tab components can import the type without a separate types file"
  - "cast via `as unknown as OpportunityWithStage[]` used for the joined Supabase result because the inferred type for nested selects does not structurally match the manually declared interface — same pattern as ContactRow in plan 67-01"
  - "ActivityItem is a local interface in account-activities-tab.tsx (not imported from database.ts) to keep props minimal and avoid coupling the component to the full Row shape"
metrics:
  duration_minutes: 18
  completed_date: "2026-05-18"
  tasks_completed: 3
  files_created: 2
  files_modified: 2
---

# Phase 67 Plan 02: Opportunities + Activities Tabs Summary

One-liner: Two server-component tabs wired into `/accounts/[id]` — Opportunities unions direct account_id and contact-linked deals with stage/value/status display, Activities renders a 100-item newest-first feed aggregated across all linked opportunities.

## What Was Built

### `getAccountOpportunities` + `getAccountActivities` (`src/app/(dashboard)/accounts/[id]/actions.ts`)

Two new exported `'use server'` async functions appended to the existing module. Both share the same two-step fan-out pattern:

1. Fetch contact IDs linked to the account (`contacts.account_id = accountId`)
2. Build an `.or()` filter joining `account_id.eq.{id}` with `contact_id.in.(...)` when contacts exist, falling back to a simple `.eq('account_id', ...)` when none are found

`getAccountOpportunities` joins `pipeline_stages` and `contacts` via the Supabase `select` join syntax and returns `OpportunityWithStage[]` (interface exported from the same file).

`getAccountActivities` collects opportunity IDs in a second query then fetches `opportunity_activities` ordered `created_at DESC`, limited to 100 rows. Returns `[]` early when no linked opportunities exist.

`OpportunityWithStage` interface exported: extends `OpportunityRow` with nullable `stage` and `contact` join shapes.

### `AccountOpportunitiesTab` (`src/components/accounts/account-opportunities-tab.tsx`)

Server component. Props: `opportunities: OpportunityWithStage[]`, `accountId: string`.

- Header row: count text + placeholder "Add opportunity" `<Button asChild>` with `id="add-opportunity-btn"` (href wired in 67-03)
- Empty state: centered card "No opportunities linked to this company yet."
- List: `divide-y` bordered card; each row is a `<Link href={/pipeline/[id]}>` with stage color dot, stage name, title (font-medium), `formatCurrency` value (tabular-nums), status pill (green/blue/red), `relativeTime(updated_at)`

### `AccountActivitiesTab` (`src/components/accounts/account-activities-tab.tsx`)

Server component. Props: `activities: ActivityItem[]` (local interface — 5 fields).

- Empty state: "No activities recorded for this company yet."
- List: `divide-y` bordered card; each item has a circular icon container with a Lucide icon keyed to `type` (Phone, FileText, ArrowRight, Plus, MessageSquare, Activity), content truncated at 120 chars defaulting to `activity.type`, `relativeTime(created_at)`, and a type badge

### Page Shell (`src/app/(dashboard)/accounts/[id]/page.tsx`)

Replaced single `getAccountDetail` call with `Promise.all` across all three fetches. Graceful fallback to `[]` when `oppsResult.ok` or `activitiesResult.ok` is false. Tab triggers updated to show live counts for all three tabs.

## Deviations from Plan

None — plan executed exactly as written.

The `as unknown as OpportunityWithStage[]` cast was required because the Supabase inferred return type for nested `.select()` joins does not structurally match the manually declared interface. This is the same pragmatic approach used in 67-01 for `ContactRow`. No behavioral difference.

## Known Stubs

- **"Add opportunity" button** (`src/components/accounts/account-opportunities-tab.tsx`): `href="#"` placeholder — intentional, wired in Plan 67-03 per plan spec.

The stub does not prevent plan goal (ACC-09 Opportunities + Activities tabs) from being achieved.

## Self-Check: PASSED

Files exist:
- FOUND: src/components/accounts/account-opportunities-tab.tsx
- FOUND: src/components/accounts/account-activities-tab.tsx
- FOUND: src/app/(dashboard)/accounts/[id]/actions.ts (modified)
- FOUND: src/app/(dashboard)/accounts/[id]/page.tsx (modified)

Commit: 0e31ab6 — feat(phase-67): add Opportunities + Activities tabs for account detail (ACC-09)

Build: Passed — `npm run build` exit code 0, TypeScript check clean, `/accounts/[id]` route present in output.
