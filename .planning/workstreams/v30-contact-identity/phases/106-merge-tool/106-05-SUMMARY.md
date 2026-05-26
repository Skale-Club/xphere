---
phase: 106-merge-tool
plan: 05
subsystem: ui
tags: [admin, merge, contacts, banner, sidebar]
requirements: [CID-04, CID-06]
dependency_graph:
  requires:
    - "Phase 106-01..04 (SQL function, types, audit actions, server actions)"
    - "src/components/ui/{card,button,badge,alert-dialog}.tsx"
    - "src/lib/supabase/{server,admin}.ts"
  provides:
    - "/admin/contacts/conflicts page (operator surface for CID-04)"
    - "MergedBanner component (reusable archive visibility for CID-06)"
    - "getSurvivorDisplayName server action (chat-scoped survivor name lookup)"
  affects:
    - "src/components/chat/contact-info-panel.tsx (banner injected at scroll-area top)"
    - "src/components/admin/admin-sidebar.tsx (Conflicts nav entry)"
tech_stack:
  added: []
  patterns:
    - "Server action invoked from client component via useEffect (panel is 'use client')"
    - "Service-role client for cross-org cluster fetch on admin page"
    - "RSC + client component split: page.tsx fetches, ClusterCard handles interactions"
    - "AlertDialog confirmation for destructive actions (merge, mark-as-separate)"
    - "useTransition for pending state during server action calls"
key_files:
  created:
    - "src/components/contacts/merged-banner.tsx"
    - "src/app/(dashboard)/chat/_actions/survivor.ts"
    - "src/app/(admin)/admin/contacts/conflicts/page.tsx"
    - "src/app/(admin)/admin/contacts/conflicts/_components/cluster-card.tsx"
  modified:
    - "src/components/chat/contact-info-panel.tsx"
    - "src/components/admin/admin-sidebar.tsx"
decisions:
  - "Resolved survivor name server-side via dedicated action rather than hardcoding null fallback in panel"
  - "MergedBanner placed at top of scroll-area (above Info section) for maximum visibility"
  - "Used service-role client on page.tsx (admin acts cross-org); auth gate inherited from /admin layout"
  - "Used multi-row insert loop for merge of N contacts in cluster (loop calls mergeContacts per archived id)"
metrics:
  duration_seconds: 458
  completed: 2026-05-26
  tasks: 3
  files_changed: 6
  commits: 3
---

# Phase 106 Plan 05: Merge Tool UI Summary

Shipped the operator-facing surface for Phase 106: the `/admin/contacts/conflicts` admin page with cluster cards + AlertDialog confirms, a reusable MergedBanner integrated into the chat contact-info-panel via a tiny `getSurvivorDisplayName` server action, and a Conflicts nav entry in the admin sidebar. Empty-state copy is the day-1 experience (prod has 0 clusters) and is intentionally designed, not broken.

## What was built

**Task 1 — MergedBanner + survivor server action + panel wiring (commit b83c16b)**
- `src/components/contacts/merged-banner.tsx` — reusable banner with AlertCircle icon, amber-tinted styling, and a link to the survivor's `/contacts/[id]` page. Falls back to the literal word "survivor" only if the resolved name is null.
- `src/app/(dashboard)/chat/_actions/survivor.ts` — `getSurvivorDisplayName(survivorId)` server action with preference order `name -> first_name + last_name -> email -> null`. Returns null on any error so caller renders the fallback gracefully.
- `src/components/chat/contact-info-panel.tsx` modifications: added imports for MergedBanner + getSurvivorDisplayName, added `useState<string|null>(survivorName)`, added `useEffect` keyed on `contact?.identity_status` and `contact?.merged_into_contact_id` that calls the server action with a cancellation flag, and a conditional JSX block at the top of the ScrollArea (above the Info section) that renders `<MergedBanner survivorId={...} survivorName={survivorName}/>` only when `identity_status === 'archived_duplicate'` AND `merged_into_contact_id` is non-null. The `survivorName` prop receives the state variable — NOT a literal `null`.

**Task 2 — Conflicts page + ClusterCard (commit 77db602)**
- `src/app/(admin)/admin/contacts/conflicts/page.tsx` — async RSC, `export const dynamic = 'force-dynamic'`. Uses `createServiceRoleClient` to read `contact_duplicate_audit` ordered by `cluster_size DESC, detected_at ASC`. Enriches each cluster with its contact rows via a single `IN` query. Exports `ClusterRow` for the client component to import. Empty state shows a GitMerge icon, "No duplicate contacts detected" headline, "Click Refresh audit to scan for clusters" body, and last-refresh timestamp. Refresh button is a `<form action={refreshAudit}>` for progressive enhancement.
- `src/app/(admin)/admin/contacts/conflicts/_components/cluster-card.tsx` — `'use client'` component with `useTransition`. Renders a responsive grid (1 / 2 / 3 columns) of contact cards. Each card has phone (raw + e164), email (raw + normalized), source, created date, and a full-width "Merge into this one" button. Cluster footer has a ghost "Mark as separate" button. Both actions open an `AlertDialog` confirm modal (NOT a raw Dialog). On confirm, the action runs inside `startTransition`, dispatches sonner toasts on success/error, and clears the dialog. Merge iterates `mergeContacts(survivor, archived)` for each non-survivor contact in the cluster.

**Task 3 — Admin sidebar nav entry (commit a6598a4)**
- `src/components/admin/admin-sidebar.tsx` — added `GitMerge` to the lucide-react import and a new `navItems` entry `{ href: '/admin/contacts/conflicts', label: 'Conflicts', icon: GitMerge }` between Organizations and Activity. Existing prefix-based isActive logic handles highlighting automatically.

## Acceptance checklist

- [x] `/admin/contacts/conflicts` route compiled by Next (visible in `npm run build` route table)
- [x] `npm run build` exits 0 (run three times — once after each task)
- [x] MergedBanner conditional render covers `identity_status === 'archived_duplicate' && merged_into_contact_id` — both required
- [x] `survivorName={null}` literal does NOT appear anywhere — panel passes the state variable populated from server action
- [x] AlertDialog (not Dialog) used for both confirmations
- [x] EmptyState renders GitMerge icon + "No duplicate contacts detected" + last-refresh timestamp
- [x] Sidebar has Conflicts entry with GitMerge icon linking to `/admin/contacts/conflicts`
- [x] Three atomic commits (one per task)

## Deviations from Plan

**Scope discipline — admin-sidebar.tsx (pre-existing working-tree changes)**

The user had unrelated in-progress modifications to `admin-sidebar.tsx` already in the working tree before this plan started (collapse/expand UX + restyling). To keep this plan's commit scoped to ONLY the GitMerge import + Conflicts nav entry (per the plan's "two-line diff, no other edits" instruction), I stashed the pre-existing changes, applied my targeted edits to the HEAD version, committed, then `git stash pop`'d to restore the user's work. The stash pop produced an expected merge conflict in the import block (the user's stashed version already added GitMerge in a multi-line import format; my committed version used a single-line import). Conflict was resolved by keeping the user's multi-line import block (which already includes GitMerge), and the new nav entry merged cleanly. Final on-disk state has the user's pre-existing in-flight changes intact plus the Conflicts entry. Commit `a6598a4` contains only the minimal two-line diff against HEAD.

**No other deviations.** No bugs to auto-fix, no missing critical functionality, no blocking issues, no architectural changes needed. Plan executed exactly as written.

## Auth Gates

None. All work was local file edits + build verification. Server actions inherit the existing `assertAdmin()` gate from Plan 04 (PLATFORM_ADMIN_EMAIL check).

## Verification Notes

- `npm run build` ran after each task and after Task 3 — all three runs exit 0.
- `/admin/contacts/conflicts` appears in the dynamic route table from the build output.
- Sidebar verification command from plan task 3 (`node -e ...`) returned `OK`.
- Empty state is the day-1 experience (production has 0 clusters per phase 105 baseline). Full integration test (insert synthetic cluster → page renders card → click merge → cluster disappears) is deferred to the phase-level verifier per the plan's `<output>` note.

## Self-Check: PASSED

- FOUND: src/components/contacts/merged-banner.tsx
- FOUND: src/app/(dashboard)/chat/_actions/survivor.ts
- FOUND: src/app/(admin)/admin/contacts/conflicts/page.tsx
- FOUND: src/app/(admin)/admin/contacts/conflicts/_components/cluster-card.tsx
- FOUND commit: b83c16b (Task 1)
- FOUND commit: 77db602 (Task 2)
- FOUND commit: a6598a4 (Task 3)
- contact-info-panel.tsx contains `MergedBanner` (import + usage) and `getSurvivorDisplayName` (import + useEffect call)
- admin-sidebar.tsx contains `GitMerge` and `/admin/contacts/conflicts`
