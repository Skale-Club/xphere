---
plan: 42-04
status: complete
completed: 2026-05-16
commit: 8bf54fb
---

# Plan 42-04 Summary: /dashboard/members Page

## What Was Built

Built the admin-only `/members` dashboard page with server actions, member table, invite modal, pending invites section, and sidebar nav entry.

## Key Files Created/Modified

- `src/app/(dashboard)/members/actions.ts` — 5 server actions (listMembers, listInvites, inviteMember, revokeInvite, removeMember)
- `src/app/(dashboard)/members/page.tsx` — Server component page
- `src/app/(dashboard)/members/members-client.tsx` — Client component with table + invite modal
- `src/components/layout/app-sidebar.tsx` — Added Members nav item with Users icon

## Decisions

- `requireAdmin()` helper calls `rpc('get_current_org_id')` then checks org_members.role = 'admin'
- `inviteMember` normalizes email to lowercase before insert (matches callback normalization)
- `revokeInvite` includes `.eq('org_id', orgId)` safety check (defense-in-depth beyond RLS)
- `removeMember` includes self-removal guard (user cannot remove themselves)
- Members page is `force-dynamic` — always fetches fresh data
- Pending invites filtered client-side by `accepted_at === null`

## Self-Check: PASSED

- [x] 5 server actions exported from actions.ts
- [x] All marked 'use server'
- [x] requireAdmin() guards all mutations
- [x] inviteMember normalizes email to lowercase
- [x] revokeInvite includes org_id safety check
- [x] removeMember prevents self-removal
- [x] revalidatePath('/members') after mutations
- [x] MembersClient is 'use client'
- [x] Invite modal with email + role fields
- [x] Pending invites section (filtered by accepted_at)
- [x] Members nav in sidebar with Users icon
- [x] Build passes
