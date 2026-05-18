---
phase: 67-accounts-detail-ui
plan: "03"
subsystem: accounts-crm
tags: [accounts, crm, opportunities, contacts, dialog, combobox, domain-suggest]
dependency_graph:
  requires: [67-02]
  provides: [add-opportunity-dialog, account-id-contact-form, domain-auto-suggest]
  affects: [pipeline-opportunities, contacts-linking, account-combobox]
tech_stack:
  added: []
  patterns: [two-path-dialog, domain-merge-dedup, server-action-patch, searchParams-preload]
key_files:
  created:
    - src/components/accounts/add-opportunity-dialog.tsx
  modified:
    - src/app/(dashboard)/contacts/new/page.tsx
    - src/components/accounts/account-combobox.tsx
    - src/components/accounts/account-opportunities-tab.tsx
    - src/app/(dashboard)/accounts/[id]/page.tsx
    - src/app/(dashboard)/pipeline/actions.ts
decisions:
  - "setOpportunityAccount added to pipeline/actions.ts as a dedicated server action — createOpportunity does not accept account_id in OpportunityFormInput (v2.4 compatibility), so we patch account_id immediately after creation via a second server call"
  - "AccountCombobox domain filter uses q= fallback (not a separate domain key) since AccountListFilters does not have a public domain field in v2.4; getAccounts already searches domain via domain.ilike.%${escaped}% in the q filter"
  - "AddOpportunityDialog uses a wrapping span with onClick rather than DialogTrigger asChild to avoid nesting interactive elements inside asChild Button triggers, which caused double-render issues"
  - "AccountOpportunitiesTab is a server component — AddOpportunityDialog is 'use client', imported directly; the server component renders the dialog trigger without wrapping it in a client boundary because Next.js handles this at module boundary"
metrics:
  duration_minutes: 22
  completed_date: "2026-05-18"
  tasks_completed: 2
  files_created: 1
  files_modified: 5
---

# Phase 67 Plan 03: Add Flows + Domain Auto-Suggest Summary

One-liner: contacts/new reads account_id searchParam to pre-link company; AddOpportunityDialog offers two-path creation (contact picker or direct account link) with post-create account_id patch; AccountCombobox extracts email domain and merges domain-matched results first.

## What Was Built

### `contacts/new` page — account_id searchParam (ACC-10, D-07)

Added `account_id?: string` to `NewContactPageProps.searchParams`. When present and non-empty, it is passed as `defaultValues.account_id` to `NewContactPageForm`, which forwards it to `ContactForm` → `AccountCombobox.value`. This causes the combobox to display the pre-linked account on first render (controlled by `defaultAccountName` + `value`), so clicking "Add contact" from `/accounts/[id]` arrives with the company already selected.

### `AccountCombobox` domain auto-suggest (ACC-12, D-09)

Enhanced the debounced `useEffect` search. When `inputValue` contains `@`, the domain part (e.g. `acme.com` from `alice@acme.com`) is extracted and a second `getAccounts({ q: domainFromEmail })` call is fired in parallel with the existing name search. Results are merged — domain matches appear first — deduplicated by `id`, capped at 15 entries.

Domain filter uses `q=` fallback since `AccountListFilters` has no separate `domain` key in v2.4. The q filter already does `domain.ilike.%${escaped}%` on the server, so domain-matched accounts surface correctly.

### `setOpportunityAccount` server action (`src/app/(dashboard)/pipeline/actions.ts`)

New exported async function that patches `account_id` on an existing opportunity row. Required because `createOpportunity` inserts only fields from `OpportunityFormInput`, which does not include `account_id` (v2.4 compatibility). Called immediately after `createOpportunity` returns a valid `id`.

### `AddOpportunityDialog` (`src/components/accounts/add-opportunity-dialog.tsx`) (ACC-11, D-08)

`'use client'` dialog with two-step flow:

**Step 1 — Path selector:** Two card buttons:
- "Link to a contact" (disabled when account has no contacts) — sets `path = 'contact'`
- "Link directly to company" — sets `path = 'account'`

**Step 2 — Deal form** (shown after path selected):
- Back button to reset to step 1
- Contact picker `<Select>` over `accountContacts` (only for `path === 'contact'`, required before submit)
- Title input (required)
- Value input (numeric)
- Stage select populated from `getDefaultPipeline()` + `getStages()`

**Submit flow:**
1. `createOpportunity({ title, value, currency, pipeline_id, stage_id, contact_id })` — contact_id is `selectedContactId` or `null`
2. `setOpportunityAccount(res.id, accountId)` — patches `account_id` on the new row
3. `toast.success`, close, `router.refresh()`

### `AccountOpportunitiesTab` — wired trigger (ACC-11)

Replaced `<Button asChild><Link href="#">…</Link></Button>` stub with `<AddOpportunityDialog accountId={accountId} accountContacts={contacts}>`. Props updated to include `contacts: AccountContact[]`.

### Page shell — contacts passed to tab

`contacts` (already fetched by `getAccountDetail`) is now passed to `<AccountOpportunitiesTab>` so the dialog can populate its contact picker.

## Deviations from Plan

### Auto-added: `setOpportunityAccount` server action (Rule 2 — missing critical functionality)

- **Found during:** Task 2 (plan spec calls `updateOpportunity(id, { account_id })`)
- **Issue:** `updateOpportunity` only patches fields in `OpportunityFormInput`; `account_id` is not in that type, so calling `updateOpportunity(id, { account_id })` would be a no-op
- **Fix:** Added `setOpportunityAccount(opportunityId, accountId)` directly to `pipeline/actions.ts` — minimal targeted patch using `opportunities.update({ account_id })` scoped by row ID
- **Files modified:** `src/app/(dashboard)/pipeline/actions.ts`
- **Commit:** be7cb9d

## Known Stubs

None — all stubs from plans 67-01 and 67-02 are resolved by this plan:
- Opportunities tab "Add opportunity" button: now wired to `AddOpportunityDialog`
- Activities and Opportunities tab placeholder text: replaced with live data (67-02)
- `contacts/new` missing `account_id` preload: resolved

## Self-Check: PASSED

Files exist:
- FOUND: src/components/accounts/add-opportunity-dialog.tsx
- FOUND: src/app/(dashboard)/contacts/new/page.tsx (modified)
- FOUND: src/components/accounts/account-combobox.tsx (modified)
- FOUND: src/components/accounts/account-opportunities-tab.tsx (modified)
- FOUND: src/app/(dashboard)/accounts/[id]/page.tsx (modified)
- FOUND: src/app/(dashboard)/pipeline/actions.ts (modified)

Commit: be7cb9d — feat(phase-67): add opportunity dialog + contact form account_id param + domain auto-suggest (ACC-10, ACC-11, ACC-12)

Build: Passed — `npm run build` exit code 0, TypeScript check clean (`npx tsc --noEmit` exit code 0).
