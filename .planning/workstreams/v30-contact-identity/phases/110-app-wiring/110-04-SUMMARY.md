---
phase: 110-app-wiring
plan: 04
subsystem: contact-identity-ui
tags: [identity, badge, contact-panel, ui, phase-110, cid-14, cid-15, d-07, d-07a]
requirements: [CID-14, CID-15]
dependency_graph:
  requires:
    - "Migration 1056 (contacts.identity_status NOT NULL DEFAULT 'identified')"
    - "Migration 1062 (contact_verifications table — Plan 110-01)"
    - "src/types/database.ts ContactIdentityStatus + contact_verifications types"
    - "shadcn Badge primitive with variants: info, success, warning, default"
    - "@radix-ui/react-tooltip via @/components/ui/tooltip"
  provides:
    - "IdentityStatusBadge React component (standalone, reusable)"
    - "hasVerifications(supabase, contactId) helper in lib/contacts/server.ts"
    - "ContactDetail.is_verified boolean field (single-contact only)"
    - "Identity-status surfacing in chat contact-info-panel header"
  affects:
    - "src/components/chat/contact-info-panel.tsx (badge render)"
    - "src/app/(dashboard)/contacts/actions.ts (getContact + ContactDetail type)"
    - "src/lib/contacts/server.ts (new hasVerifications helper)"
tech_stack:
  added: []
  patterns:
    - "Standalone client component pattern (component is reusable, not embedded)"
    - "Effective-state derivation via prop combination (status + isVerified)"
    - "Defensive null/unknown-status early return (Pitfall 1)"
    - "Admin-gated rendering via showAdminStates prop (default false)"
    - "Single-contact EXISTS count helper, NOT list-page fanout (Pitfall 7)"
key_files:
  created:
    - "src/components/contacts/identity-status-badge.tsx"
  modified:
    - "src/lib/contacts/server.ts (added hasVerifications helper)"
    - "src/app/(dashboard)/contacts/actions.ts (is_verified in getContact + ContactDetail)"
    - "src/components/chat/contact-info-panel.tsx (badge render in header)"
decisions:
  - "D-07: 5-state CONFIG dict maps each ContactIdentityStatus to {variant, label, icon, tooltip, href?}"
  - "D-07a: Badge rendered in contact-info-panel header in its own flex container (line ~490) so Plan 03's MarkVerifiedButton can merge in alongside"
  - "Pitfall 7 honored: is_verified is single-contact only; list/CSV paths never call hasVerifications"
  - "Badge variants used (info, success, warning, default) all exist in project Badge primitive — no mapping needed"
metrics:
  duration_seconds: 366
  completed_date: "2026-05-26"
  tasks_completed: 2
  files_changed: 4
---

# Phase 110 Plan 04: Identity Status Badge Summary

IdentityStatusBadge ships as a standalone 5-state component plus is_verified plumbing into getContact, surfacing every contact's identity state at a glance in the chat contact panel.

## What Shipped

### 1. `src/components/contacts/identity-status-badge.tsx` (created)

Standalone client component. Exports `IdentityStatusBadge` + `IdentityStatusBadgeProps`.

**Props:**
```ts
{
  status: ContactIdentityStatus | null
  showAdminStates?: boolean   // default false; gates archived_duplicate
  isVerified?: boolean         // default false; promotes 'identified' → 'verified'
}
```

**CONFIG dict (per D-07):**

| Status               | Variant   | Icon          | Label         | Link to                          |
| -------------------- | --------- | ------------- | ------------- | -------------------------------- |
| `channel_only`       | `info`    | Link2         | Channel only  | —                                |
| `identified`         | `success` | (none)        | Identified    | —                                |
| `verified`           | `success` | CheckCircle2  | Verified      | —                                |
| `merge_conflict`     | `warning` | AlertTriangle | Conflict      | `/admin/contacts/conflicts`      |
| `archived_duplicate` | `default` | Archive       | Archived      | — (only renders w/ showAdminStates) |

All variants get a Tooltip via `@/components/ui/tooltip` with the D-07 tooltip copy.

**Variant mapping verification:** All 4 Badge variants used (`info`, `success`, `warning`, `default`) exist in `src/components/ui/badge.tsx` (lines 12-36). No project-specific remapping was needed; the RESEARCH spec matches the primitive 1:1.

**Effective-state derivation:**
```ts
const effective = status === 'identified' && isVerified ? 'verified' : status
```
This lets the panel surface the Verified sub-state immediately based on the existence of a `contact_verifications` row, without requiring the DB-side `identity_status` bump to have happened yet.

**Defensive null guard (Pitfall 1):** `if (!status) return null` plus `if (!cfg) return null` for unknown status values.

### 2. `src/lib/contacts/server.ts` (modified)

Added `hasVerifications(supabase, contactId): Promise<boolean>` — small EXISTS-style query:
```ts
const { count } = await supabase
  .from('contact_verifications')
  .select('id', { count: 'exact', head: true })
  .eq('contact_id', contactId)
  .limit(1)
return (count ?? 0) > 0
```

JSDoc explicitly warns about Pitfall 7: single-contact scope only, never call per-row from list pages.

### 3. `src/app/(dashboard)/contacts/actions.ts` (modified)

- Imported `hasVerifications`.
- Added `is_verified: boolean` to the `ContactDetail` interface.
- `getContact(id)` now runs `hasVerifications(supabase, id)` once after the contact fetch and includes `is_verified` in the returned object.

### 4. `src/components/chat/contact-info-panel.tsx` (modified)

- Imported `IdentityStatusBadge`.
- Inserted a new flex container immediately after the tags row (~line 490), inside the header `<div className="min-w-0 flex-1">`:

```tsx
<div className="mt-2 flex items-center gap-2">
  <IdentityStatusBadge
    status={contact.identity_status}
    isVerified={contact.is_verified ?? false}
  />
</div>
```

Plan 03's `MarkVerifiedButton` is designed to render alongside the badge inside this same flex container — the comment notes this so Plan 03 can drop the button in without re-wrapping.

## Insertion Point

`src/components/chat/contact-info-panel.tsx` lines 491-498 (after edit). The badge sits between the existing tags row and the SEED-039 "Create" divider that opens the quick-actions grid.

## is_verified Derivation Strategy

Per Pitfall 7, chose Option A from the plan: small dedicated `hasVerifications` helper in `lib/contacts/server.ts`, called from `getContact` after the main contact fetch (not folded into the `Promise.all`, because we need `id` to be confirmed-loaded first). Single EXISTS-style count query — no JOIN, no fanout. List paths (`getContacts`, CSV) are untouched.

## Decisions Implemented

- **D-07** — Identity Status Badge component with 5 variants, lucide icons, tooltips.
- **D-07a** — Rendered in `contact-info-panel.tsx` next to existing badge surfaces (tags row).
- **CID-14** — Badge layer for the verified state (UI side; verification audit table + write path are Plans 110-01 and 110-03).
- **CID-15** — `merge_conflict` variant wraps `<Link href="/admin/contacts/conflicts">` for direct admin navigation.

## Deviations from Plan

None — plan executed exactly as written. The component matches the RESEARCH.md §"IdentityStatusBadge Component" sketch (with TypeScript-strict tightening on the CONFIG type — `Record<ContactIdentityStatus, BadgeConfig>` instead of inline literal — for safer key access).

Plan Step C noted "if there's an obvious place for a `hasVerifications(contactId)` helper, add it there" — chose to add it to `src/lib/contacts/server.ts` next to `findByPhone`/`findByEmail`/`attachChannelIdentity`, mirroring their export pattern and importing `SupabaseClient` from the same place. No inline shortcut.

## Verification

- `npm run build` → exit 0 (after waiting for a parallel-wave build to finish)
- Grep `IdentityStatusBadge` → 2+ hits (component file + panel import + panel render)
- Grep `is_verified` → 3+ hits (ContactDetail field + getContact return + panel prop)

## Commits

| Task | Hash      | Message                                                                |
| ---- | --------- | ---------------------------------------------------------------------- |
| 1    | `3982a76` | feat(110-04): add IdentityStatusBadge + is_verified to getContact      |
| 2    | `be0cb03` | feat(110-04): render IdentityStatusBadge in contact-info-panel header  |

Both commits used `--no-verify` per parallel-wave protocol.

## Follow-ups (out of scope for this plan)

- Plan 110-03: `markContactVerified` server action + `MarkVerifiedButton` UI rendered next to this badge in the same flex container.
- Plan 110-07: manual UI smoke — load contacts of each `identity_status` and verify all 5 variants render with correct icon/color/tooltip and that `merge_conflict` link navigates to the admin page.
- Future `/contacts/[id]` detail page (deferred per D-03) will reuse `IdentityStatusBadge` unchanged.

## Self-Check: PASSED

- `src/components/contacts/identity-status-badge.tsx` — FOUND
- `src/lib/contacts/server.ts` — modified, `hasVerifications` export FOUND
- `src/app/(dashboard)/contacts/actions.ts` — modified, `is_verified` field FOUND
- `src/components/chat/contact-info-panel.tsx` — modified, `IdentityStatusBadge` import + render FOUND
- Commit `3982a76` — FOUND in git log
- Commit `be0cb03` — FOUND in git log
- `npm run build` — exit 0
