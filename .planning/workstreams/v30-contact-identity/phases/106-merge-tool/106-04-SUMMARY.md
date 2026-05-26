---
phase: 106-merge-tool
plan: 04
subsystem: contact-identity
tags: [identity, merge, admin, server-actions, dashboard-write-paths]
requires: [106-01, 106-02, 106-03]
provides:
  - resolveLiveContactId helper (src/lib/contacts/server.ts)
  - mergeContacts/markAsSeparate/refreshAudit admin server actions
  - D-04 write-path invariant enforced across 7 dashboard surfaces
affects:
  - 7 dashboard server actions (chat, contacts, pipeline, scheduling, companies, tags, twilio voice)
  - 6 library files flagged TODO Phase 110
tech-stack:
  added: []
  patterns:
    - "import 'server-only' at top of resolveLiveContactId for client-bundle safety"
    - "vi.mock('server-only', () => ({})) in Vitest test files that import server-only modules"
    - "User-scoped supabase client for SECURITY DEFINER RPCs so auth.uid() forwards"
    - "Service-role client for cross-org admin upserts (contact_merge_exclusions)"
    - "Canonical (a<b sorted) pair ordering before contact_merge_exclusions upsert"
key-files:
  created:
    - src/lib/contacts/server.ts
    - tests/resolve-live-contact-id.test.ts
    - src/app/(admin)/admin/contacts/conflicts/_actions/conflicts.ts
  modified:
    - src/app/(dashboard)/chat/actions.ts
    - src/app/(dashboard)/contacts/actions.ts
    - src/app/(dashboard)/pipeline/actions.ts
    - src/app/(dashboard)/scheduling/_actions/bookings.ts
    - src/app/(dashboard)/companies/actions.ts
    - src/app/(dashboard)/settings/tags/actions.ts
    - src/app/api/twilio/voice/route.ts
    - src/lib/whatsapp/process-message.ts
    - src/lib/telegram/process-update.ts
    - src/lib/evolution/process-event.ts
    - src/lib/flows/engine.ts
    - src/lib/action-engine/executors/pipeline-actions.ts
    - src/lib/copilot/tools/pipeline.ts
    - src/types/database.ts
decisions:
  - "Added refresh_contact_duplicate_audit function type to database.ts (Plan 03 omission, Rule 3 blocking fix)"
  - "Skipped TODO marker in 3 library files because their contact_id columns are NOT contacts FKs (ghl_events.contact_id is text external GHL id; campaigns/outbound.ts uses campaign_contact_id; ghl-reengagement uses ghl_contact_id text)"
  - "Defensive empty-string guard in resolveLiveContactId returns input without querying DB"
metrics:
  duration: ~10min
  completed: 2026-05-25
---

# Phase 106 Plan 04: Application Layer (Helper + Admin Actions + Dashboard Wraps) Summary

Identity-aware contact id resolution plus the three admin server actions that drive the conflicts UI; wired into 7 dashboard write paths so archived contact ids redirect to survivors per D-04.

## Outcomes

- `resolveLiveContactId(contactId)` helper lives at `src/lib/contacts/server.ts`. Single-hop chain follow, defensive on errors, gated by `import 'server-only'`.
- Three admin server actions exported from `src/app/(admin)/admin/contacts/conflicts/_actions/conflicts.ts`: `mergeContacts`, `markAsSeparate`, `refreshAudit`. All assert against `PLATFORM_ADMIN_EMAIL`. `mergeContacts` uses user-scoped client so `auth.uid()` forwards into SECURITY DEFINER (Pitfall 11). `markAsSeparate` canonicalizes pair ordering (a<b) and upserts via service-role client.
- 7 dashboard write paths now call `resolveLiveContactId` before any `contact_id` / `linked_contact_id` write reaches the DB.
- 6 library write paths flagged with `// TODO Phase 110: wrap with resolveLiveContactId` for follow-up.

## Helper File

**Path:** `src/lib/contacts/server.ts`

```ts
export async function resolveLiveContactId(contactId: string): Promise<string>
```

Returns:
- Input unchanged when contact is live, not found, DB error, or empty string.
- `merged_into_contact_id` when contact has `identity_status='archived_duplicate'`.
- Recurses defensively (single hop expected — merge guard prevents chains).

**Test file:** `tests/resolve-live-contact-id.test.ts` — 6 cases. Contains literal `vi.mock('server-only', () => ({}))` before SUT import (REQUIRED — `server-only` throws on import outside Next bundling).

## Admin Actions File

**Path:** `src/app/(admin)/admin/contacts/conflicts/_actions/conflicts.ts`

Signatures:
- `mergeContacts(survivorId: string, archivedId: string): Promise<void>`
- `markAsSeparate(orgId: string, contactIds: string[]): Promise<void>`
- `refreshAudit(): Promise<void>`

All three: `assertAdmin()` first, then RPC/upsert, then `revalidatePath('/admin/contacts/conflicts')` (Pitfall 9 order).

## Dashboard Wrap Sites (Task 3a — 7 files)

| # | File | Line(s) | Operation |
|---|---|---|---|
| 1 | `src/app/(dashboard)/chat/actions.ts` | ~186 | `conversations.contact_id` update (linkContactToConversation) |
| 2 | `src/app/(dashboard)/contacts/actions.ts` | ~979 | `conversations.contact_id` auto-link update |
| 3 | `src/app/(dashboard)/pipeline/actions.ts` | ~375, ~528, ~542 | opportunity insert + opportunity_contacts upsert + opportunities denormalize update |
| 4 | `src/app/(dashboard)/scheduling/_actions/bookings.ts` | ~489 | `bookings.linked_contact_id` insert |
| 5 | `src/app/(dashboard)/companies/actions.ts` | ~601 | `contacts.account_id` update routed to live survivor |
| 6 | `src/app/(dashboard)/settings/tags/actions.ts` | ~151, ~156 | `contact_tags` delete + insert |
| 7 | `src/app/api/twilio/voice/route.ts` | ~262, ~272 | `call_logs.contact_id` update + insert |

All seven follow the pattern: `const liveContactId = await resolveLiveContactId(contactId); /* use liveContactId in DB write */`.

## Library TODO Markers (Task 3b — 6 files)

| File | Line | Column |
|---|---|---|
| `src/lib/whatsapp/process-message.ts` | ~95 | `conversations.contact_id` insert |
| `src/lib/telegram/process-update.ts` | ~235 | `conversations.contact_id` insert |
| `src/lib/evolution/process-event.ts` | ~255 | `conversations.contact_id` insert |
| `src/lib/flows/engine.ts` | ~388 | `bookings.linked_contact_id` insert |
| `src/lib/action-engine/executors/pipeline-actions.ts` | ~364 | `opportunities.contact_id` insert |
| `src/lib/copilot/tools/pipeline.ts` | ~52 | `opportunities.contact_id` insert |

**Skipped files (no contacts FK):**
- `src/lib/ghl/process-event.ts` — uses `ghl_events.contact_id` (text, external GHL id per RESEARCH.md FK enumeration)
- `src/lib/campaigns/outbound.ts` — uses `campaign_contact_id` column (campaigns table column, not a contacts FK)
- `src/lib/automations/ghl-reengagement/runner.ts` — uses `ghl_contact_id` (text, external GHL id)

`grep -rln "TODO Phase 110" src/lib` returns 6 files — exceeds the ≥5 floor.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `refresh_contact_duplicate_audit` function type**
- **Found during:** Task 3a build verification
- **Issue:** `npm run build` failed type-check — `refresh_contact_duplicate_audit` not in Database['public']['Functions'] union (Plan 03 added the table types but missed this function)
- **Fix:** Added the function shape (`Args: Record<string, never>; Returns: undefined`) to `src/types/database.ts` right after `merge_contacts`
- **Files modified:** `src/types/database.ts`
- **Commit:** Included in `8a6aa7e` (Task 3a)

**2. [Spec interpretation] companies/actions.ts wrap site**
- **Issue:** The file's `contact_id:` occurrences are either return-shape (line 612) or update-on-contact-itself (line 601). The plan lists the file in the 7-site enumeration but the canonical D-04 pattern (contact-linked-table write) doesn't fit.
- **Decision:** Wrapped the `linkContactToAccount` action so an archived contact's account link is applied to the survivor instead. Preserves D-04 spirit (write redirection) while staying within the 7 enumerated paths.

### Skipped Library Files

See "Library TODO Markers" section. 3 of the 9 listed library files were skipped because grep verified they have no contacts-FK column write — only text/external-id columns.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/resolve-live-contact-id.test.ts` | 6/6 passed, 249ms |
| `npm run build` | Compiled successfully in 8.0s, type check passed |
| `grep -rln "resolveLiveContactId" src/app` | 7 files |
| `grep -rln "TODO Phase 110" src/lib` | 6 files |
| 4 atomic commits | `928eeb2`, `82ee979`, `8a6aa7e`, `edb9798` |

## Self-Check: PASSED

- FOUND: src/lib/contacts/server.ts
- FOUND: tests/resolve-live-contact-id.test.ts
- FOUND: src/app/(admin)/admin/contacts/conflicts/_actions/conflicts.ts
- FOUND: 928eeb2 (Task 1)
- FOUND: 82ee979 (Task 2)
- FOUND: 8a6aa7e (Task 3a)
- FOUND: edb9798 (Task 3b)
