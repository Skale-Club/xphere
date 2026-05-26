---
phase: 108-channel-identities
plan: 03
subsystem: contact-identity
status: complete
completed: 2026-05-26
tags: [helpers, contacts, server-only, channel-identity, lookup-first, idempotent-insert]
requirements: [CID-09, CID-10, CID-11]
dependency-graph:
  requires: [108-01, 108-02]
  provides: [findByChannelIdentity-helper, attachChannelIdentity-helper]
  affects: [108-04, 108-05]
tech-stack:
  added: []
  patterns: [insert-catch-23505, merged-into-chain-resolution, supabase-client-injection]
key-files:
  created: []
  modified:
    - src/lib/contacts/server.ts
decisions:
  - "findByChannelIdentity resolves merged_into chain internally (symmetric with resolveLiveContactId) — webhook callers always get a live id"
  - "Chain resolution follows ONE level only (defense-in-depth; merge_contacts() guards prevent deeper chains)"
  - "attachChannelIdentity uses .insert() + catch 23505, NEVER .upsert() — .upsert would silently re-point contact_id on conflict (Pitfall 7, D-03a)"
  - "Post-INSERT SELECT returns the canonical row's contact_id (may differ from caller's input under race) — caller decides how to handle divergence"
  - "Both helpers take explicit SupabaseClient<Database> arg (webhook-friendly, no createClient() coupling) — mirrors findByPhone/findByEmail signature shape"
  - "Empty-string guards on externalId / contactId return null without DB call (text NOT NULL would fail otherwise)"
  - "Non-23505 errors logged via console.error and return null (webhook-safe, never throws — matches CLAUDE.md inbound webhook contract)"
metrics:
  duration: "~4 min"
  tasks: 2
  files: 1
---

# Phase 108 Plan 03: findByChannelIdentity + attachChannelIdentity Helpers Summary

Added two lookup-first helpers to `src/lib/contacts/server.ts` next to the Phase 107 `findByPhone`/`findByEmail` family. Both typed with `ChannelProvider` (Plan 02 export) for compile-time provider validation. Two atomic commits, `npm run build` green twice.

## Task 1 — `findByChannelIdentity` (commit `b46d91e`)

Appended after `findByEmail`. Signature:

```ts
export async function findByChannelIdentity(
  supabase: SupabaseClient<Database>,
  orgId: string,
  provider: ChannelProvider,
  externalId: string,
): Promise<
  | { contact_id: string; identity_status: ContactIdentityStatus; merged_into_contact_id: string | null }
  | null
>
```

Flow:
1. Guard empty `externalId` → null.
2. SELECT `contact_id` from `contact_channel_identities` by `(org_id, provider, external_id)`.
3. SELECT `id, identity_status, merged_into_contact_id` from `contacts` by that id.
4. If `identity_status === 'archived_duplicate'` AND `merged_into_contact_id != null` → follow ONE level to survivor and return survivor's fields.
5. Otherwise return the (possibly live) original.

Import line updated to:
```ts
import type { Database, ContactIdentityStatus, ChannelProvider } from '@/types/database'
```

## Task 2 — `attachChannelIdentity` (commit `a382cc6`)

Appended after `findByChannelIdentity`. Signature:

```ts
export async function attachChannelIdentity(
  supabase: SupabaseClient<Database>,
  orgId: string,
  contactId: string,
  provider: ChannelProvider,
  externalId: string,
): Promise<{ contact_id: string } | null>
```

Flow:
1. Guard empty `externalId` or `contactId` → null.
2. INSERT into `contact_channel_identities`.
3. If `error.code !== '23505'` (some other DB error): `console.error` + return null. **Never throws** — webhook-safe.
4. On 23505 OR success: SELECT the canonical row by `(org_id, provider, external_id)` and return its `contact_id`.
5. The returned `contact_id` may differ from the input — caller (Plan 04 webhook handlers) decides how to surface divergence.

## No `.upsert()` Anywhere

```text
$ grep -n "\.upsert(" src/lib/contacts/server.ts
(no matches)
```

`.upsert()` was deliberately avoided. With a full `UNIQUE (org_id, provider, external_id)` constraint, `.upsert()` would overwrite the existing row's `contact_id` on conflict — silently re-pointing identities across contacts. Identity dedup is **not** enrichment; the existing row wins.

## Total Exports in `src/lib/contacts/server.ts`

```text
$ grep -n "^export async function" src/lib/contacts/server.ts
25:export async function resolveLiveContactId(contactId: string): Promise<string> {
54:export async function findByPhone(
81:export async function findByEmail(
107:export async function findByChannelIdentity(
174:export async function attachChannelIdentity(
```

5 exports total — Plan 04 (`webhook retrofit + linkConversationsToContacts`) can import the two new ones directly.

## Verification

| Check | Result |
|-------|--------|
| `grep -c "export async function findByChannelIdentity" src/lib/contacts/server.ts` | 1 |
| `grep -c "export async function attachChannelIdentity" src/lib/contacts/server.ts` | 1 |
| `grep -q "ChannelProvider" src/lib/contacts/server.ts` | yes (import + 2 parameters) |
| `grep -q "merged_into_contact_id" src/lib/contacts/server.ts` | yes (chain resolution) |
| `grep -q "if (!externalId) return null"` | yes (Task 1 guard) |
| `grep -q "if (!externalId \\|\\| !contactId) return null"` | yes (Task 2 guard) |
| `grep -q "error.code !== '23505'"` | yes (Task 2 23505 recovery) |
| `grep -n "\\.upsert(" src/lib/contacts/server.ts` | no matches (D-03a / Pitfall 7) |
| `npm run build` after Task 1 | exit 0 |
| `npm run build` after Task 2 | exit 0 |

## Deviations from Plan

None — plan executed exactly as written. Helpers added verbatim from RESEARCH.md Pattern 2.

## Hand-Off to Plan 04

Plan 04 webhook retrofit can now:

```ts
import {
  findByPhone,
  findByEmail,
  findByChannelIdentity,
  attachChannelIdentity,
  resolveLiveContactId,
} from '@/lib/contacts/server'
```

D-03 lookup-first flow: `findByChannelIdentity` → `findByPhone` → INSERT contact → `attachChannelIdentity`. All five helpers are now in place. Plan 04 should also pass the returned `contact_id` from `attachChannelIdentity` back through to downstream writes (if it differs from the input, the identity already pointed at another contact — log + use the existing one).

## Self-Check: PASSED

- File `src/lib/contacts/server.ts` exists and contains both new helpers (verified via grep).
- Commit `b46d91e` exists: `feat(108-03): add findByChannelIdentity helper`.
- Commit `a382cc6` exists: `feat(108-03): add attachChannelIdentity helper`.
- `npm run build` exited 0 after each task.
- No `.upsert(` in server.ts.
