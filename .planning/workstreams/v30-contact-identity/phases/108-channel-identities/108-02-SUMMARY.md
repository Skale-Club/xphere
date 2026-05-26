---
phase: 108-channel-identities
plan: 02
subsystem: contact-identity
status: complete
completed: 2026-05-26
tags: [types, supabase, hand-edit, phase-105-precedent, channel-identity]
requirements: [CID-09, CID-10, CID-11]
dependency-graph:
  requires: [108-01]
  provides: [ChannelProvider-type, contact_channel_identities-typing]
  affects: [108-03, 108-04, 108-05]
tech-stack:
  added: []
  patterns: [manual-type-patch]
key-files:
  created: []
  modified:
    - src/types/database.ts
decisions:
  - "Manual hand-edit (D-07 precedent from Phases 105/106/107) — Supabase MCP/CLI auth blocked for this project"
  - "ChannelProvider placed adjacent to ContactIdentityStatus (Phase 105/106 pattern for v3.0 identity types)"
  - "contact_channel_identities inserted alphabetically before contact_duplicate_audit in Tables block"
  - "Row.provider + Insert.provider typed as ChannelProvider (not raw string) — gives downstream helpers + webhooks compile-time provider validation"
  - "Update permits only provider? and external_id? (no schema reason to mutate id/org_id/contact_id/created_at)"
metrics:
  duration: "~3 min"
  tasks: 1
  files: 1
---

# Phase 108 Plan 02: Type Regen for Migration 1060 Summary

Hand-edited `src/types/database.ts` to expose `ChannelProvider` union type and `contact_channel_identities` Tables entry from migration 1060. Two atomic diff hunks, `npm run build` green.

## Two edits applied to `src/types/database.ts`

### Edit 1 — `ChannelProvider` export (after `ContactIdentityStatus`, line 38)

Inserted the 8-value D-01 wide enum verbatim from migration 1060 CHECK constraint:

```ts
// v3.0 Phase 108 — channel identity providers (CID-09 D-01 wide enum)
export type ChannelProvider =
  | 'whatsapp'
  | 'evolution'
  | 'telegram'
  | 'instagram'
  | 'messenger'
  | 'facebook'
  | 'webchat'
  | 'vapi'
```

Byte-for-byte match against `1060_contact_channel_identities.sql:33-42` CHECK enum.

### Edit 2 — `contact_channel_identities` Tables entry (before `contact_duplicate_audit`, around line 1712)

Inserted full Row/Insert/Update/Relationships block. Highlights:

- **Row:** id, org_id, contact_id, provider (ChannelProvider), external_id, created_at — all `string` (uuid + text + timestamptz serialize as string in Supabase-gen).
- **Insert:** `id?` and `created_at?` optional (DB defaults), other 4 required.
- **Update:** only `provider?` and `external_id?` allowed; FKs and timestamps stay immutable.
- **Relationships:** two FK entries — `contact_channel_identities_org_id_fkey` → organizations, `contact_channel_identities_contact_id_fkey` → contacts. Both `referencedColumns: ['id']`, `isOneToOne: false`.

## Build verification

```
✓ Compiled successfully in 21.4s
exit=0
```

Pre-existing `[redis] error` warnings during static page collection are unrelated (Vercel KV not configured locally — present before this patch). No new type errors.

## Acceptance criteria (all pass)

| Check                                                                | Result    |
| -------------------------------------------------------------------- | --------- |
| `export type ChannelProvider` exported                               | 1 hit     |
| 8 D-01 provider values present in union                              | All 8 ✓   |
| `contact_channel_identities:` table opener                           | 1 line    |
| `provider: ChannelProvider` typed (not raw string) in Row + Insert   | 2 hits ✓  |
| `contact_channel_identities_org_id_fkey` Relationship                | Present ✓ |
| `contact_channel_identities_contact_id_fkey` Relationship            | Present ✓ |
| referencedRelation 'organizations' + 'contacts'                      | Both ✓    |
| `npm run build` exit 0                                               | ✓         |

## Deviations

**Rule 0 — Plan precedent (intentional, planned):** Used manual hand-edit instead of MCP `generate_typescript_types`. Plan 108-02 explicitly binds the executor to D-07 (Phase 105/106/107 precedent) because the Supabase MCP is misconfigured for this project. Not a deviation — endorsed by the plan.

No `any` casts introduced. No other deviations.

## Downstream Unblocked

- Plan 108-03 (`findByChannelIdentity` helper + 2 sibling helpers) can now `import type { ChannelProvider } from '@/types/database'`.
- Plan 108-04 (3 webhook handler retrofits + `linkConversationsToContacts` channel-identity write) gets compile-time provider validation.
- Plan 108-05 tests can type `provider` parameters as `ChannelProvider`.

## Self-Check: PASSED

- src/types/database.ts: FOUND (modified, +49 lines)
- Commit 82a216c: FOUND (`git log --oneline -1`)
- All 8 acceptance criteria: PASS
- npm run build exit 0: VERIFIED
