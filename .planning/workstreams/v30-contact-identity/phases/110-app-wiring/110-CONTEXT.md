# Phase 110: APP-WIRING - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire up the user-visible identity surface. After 5 phases of DB infrastructure, Phase 110 makes the system useful in the app: identity-status badges, conflict filter in contact list, manual "verified" marker, CSV import pre-flight dedup, and placeholder-email rejection. Scope deliberately reduced from full ROADMAP to a value-dense subset — see "Reduced Scope" in `<deferred>` section.

Delivers:
- Migration 1062: `contact_verifications` table (verification audit log).
- Server action `markContactVerified(contactId, method='manual')` + admin UI button.
- Identity status badge component shown in `contact-info-panel.tsx` (channel_only / identified / verified / merge_conflict).
- Conflict filter chip + counter on `/contacts` list page.
- CSV import pre-flight: surface conflict counts before batch commit using Phase 107 helpers.
- Hardcoded placeholder email rejection in form validation + Zod refine + webhook validation.
- 110-VALIDATION-REPORT.md final v30 milestone close-out.

Does NOT deliver (reduced scope or deferred):
- SMS reply-yes verification trigger — needs inbound SMS infra (defer to follow-up milestone).
- Email link click verification trigger — needs email send + verification endpoint (defer).
- `/contacts/[id]` detail page — doesn't exist today; out of scope for identity work.
- `contacts.source` column DROP — high-risk change, needs comprehensive call-site sweep (defer to next milestone with explicit cleanup audit).
- Per-org `org_settings.blocked_email_patterns` — hardcoded list ships first, configurability later.
- Fixing 65 pre-existing failing tests outside this phase — out of scope.

</domain>

<decisions>
## Implementation Decisions

### Verification Triggers
- **D-01:** Manual verification only. New server action `markContactVerified(contactId, identifierType, identifierValue, method='manual')`:
  - Inserts row in `contact_verifications`
  - Updates `contacts.identity_status` to `'verified'` if currently `'identified'` (and only then — does not downgrade `merge_conflict` or upgrade `channel_only` directly; channel_only must promote to identified first).
- **D-01a:** UI: "Mark verified" button on contact-info-panel (when `identity_status='identified'`). Sonner toast on success.
- **D-01b:** Admin can mark contacts verified from `/admin/contacts/conflicts` cluster cards (when resolving a cluster, optionally mark survivor as verified).
- **D-01c:** SMS reply-yes + email link click triggers deferred to a follow-up milestone (needs Twilio inbound routing + email send infra).

### contacts.source Drop
- **D-02:** **Deferred.** The DEPRECATED comment (Phase 108) stays. Drop happens in a follow-up cleanup milestone with explicit call-site audit (~10 known sites + unknowns).
- **D-02a:** Phase 110 does NOT modify any `contacts.source` reads. Existing code continues to function.

### Detail Page
- **D-03:** No new `/contacts/[id]/page.tsx`. Identity badge ships in `contact-info-panel.tsx` (where MergedBanner from Phase 106 already lives).
- **D-03a:** Conflict filter ships on `/contacts/page.tsx` (list page) — a filter chip "Show conflicts only" + total conflict counter at top. Reuses existing filter state if any.

### Placeholder Email Rejection
- **D-04:** Hardcoded list in `src/lib/contacts/blocked-emails.ts`:
  ```ts
  export const BLOCKED_EMAIL_PATTERNS = [
    /^noemail@/i,
    /^test@test\./i,
    /^none@/i,
    /^example@/i,
    /^placeholder@/i,
    /^noreply@/i,
    /@example\.(com|org)$/i,
  ]
  export function isBlockedEmail(email: string): boolean { ... }
  ```
- **D-04a:** Wire into:
  - `contactSchema` Zod refine (block in forms)
  - `createContact` server action (defense in depth)
  - CSV import (skip blocked emails with error log)
  - Webhook handlers (skip identity attach if email is blocked but accept the contact via phone)
- **D-04b:** Per-org configurability deferred to a follow-up.

### contact_verifications Table Shape
- **D-05:** Migration 1062 creates:
  ```sql
  CREATE TABLE contact_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    identifier_type text NOT NULL CHECK (identifier_type IN ('phone', 'email')),
    identifier_value text NOT NULL,
    method text NOT NULL CHECK (method IN ('manual', 'sms_reply', 'email_click', 'oauth')),
    verified_at timestamptz NOT NULL DEFAULT now(),
    verified_by uuid REFERENCES auth.users(id)
  )
  ```
  Plus: UNIQUE (org_id, contact_id, identifier_type, identifier_value) — one verification per identifier per contact.
  Plus: RLS scoped to `get_current_org_id()`, 4 policies (SELECT/INSERT/UPDATE/DELETE), org admins write.
  Plus: INDEX (contact_id) for reverse lookup.
- **D-05a:** Method enum includes `sms_reply`, `email_click`, `oauth` for future use, but Phase 110 only writes `manual`. CHECK enumerates all 4 to avoid future ALTER.

### CSV Import Pre-Flight
- **D-06:** Existing CSV import path at `src/app/(dashboard)/contacts/actions.ts:589-741` already loads existing phone/email sets. Phase 110 changes:
  - Switch lookup to use `phone_e164` and `email_normalized` (already populated since Phase 105 generated columns).
  - Pre-flight scan: count rows that would conflict before batch insert. Surface via return value `{ totalRows, conflictRows, willCreate, willSkip }`.
  - UI: existing import wizard shows the counts before "Start import" button enables.
  - Rows that are placeholder emails: skip with `error: 'blocked_email'` recorded.
  - Multi-conflict rows (phone hits A, email hits B): insert as `merge_conflict` (consistent with createContact behavior).
- **D-06a:** Existing `contact_imports`/`contact_import_errors` schema unchanged — this is app-side refactor of the read logic.

### Status Badge UI
- **D-07:** New component `src/components/contacts/identity-status-badge.tsx`:
  - `channel_only` → blue badge "Channel only" (with tooltip explaining)
  - `identified` → green badge "Identified"
  - `verified` → green badge with checkmark "Verified"
  - `merge_conflict` → orange badge "Conflict" with link to `/admin/contacts/conflicts`
  - `archived_duplicate` → gray badge "Archived" (only visible to admins)
- **D-07a:** Rendered in `contact-info-panel.tsx`. Mirrors existing badge usage in the same panel.

### Conflict Filter on Contact List
- **D-08:** Add filter chip on `/contacts/page.tsx`:
  - Chip "Conflicts" with count of contacts where `identity_status='merge_conflict'`
  - Click toggles filter: query gains `.eq('identity_status', 'merge_conflict')`
  - If no conflicts: chip is disabled with count 0 (no flash)

### Claude's Discretion
- Exact migration filename (1062_*.sql).
- Badge styling (Tailwind classes per design system).
- CSV pre-flight UI placement (before vs after column mapping step).
- Whether "Mark verified" requires a confirmation modal or one-click.
- Whether to show banner if any conflicts exist on /contacts page (recommend yes, dismissible).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 105-109 Output (binding)
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-CONTEXT.md` — identity_status 5-value CHECK
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-CONTEXT.md` — merged_into_contact_id, MergedBanner
- `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-CONTEXT.md` — findByPhone, findByEmail, race-safe createContact, matched_via shape
- `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/108-CONTEXT.md` — findByChannelIdentity, attachChannelIdentity
- `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/109-CONTEXT.md` — trigger predicates, channel_only promotion
- `supabase/migrations/1056_contact_identity_audit.sql`
- `supabase/migrations/1057_contact_merge_tool.sql`
- `supabase/migrations/1059_contacts_unique_constraints.sql`
- `supabase/migrations/1060_contact_channel_identities.sql`
- `supabase/migrations/1061_contact_identity_trigger.sql`

### Repo Files Researcher Must Inspect
- `src/components/chat/contact-info-panel.tsx` — has MergedBanner integration (Phase 106). New badge goes here.
- `src/app/(dashboard)/contacts/page.tsx` — contact list page. Add filter chip.
- `src/app/(dashboard)/contacts/actions.ts:389-466` — createContact (refactor email block check).
- `src/app/(dashboard)/contacts/actions.ts:589-741` — CSV import. Refactor pre-flight.
- `src/lib/contacts/zod-schemas.ts` — add `isBlockedEmail` to refine.
- `src/lib/contacts/server.ts` — Phase 107/108 helpers already there.
- `src/app/(admin)/admin/contacts/conflicts/page.tsx` — admin merge UI. Optional "Mark verified" on resolution.
- `src/components/admin/admin-sidebar.tsx` — nav already has Conflicts entry (Phase 106).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Pooler-pg apply pattern (apply-1062.mjs).
- Manual type regen (Phase 105-108 precedent) for `contact_verifications` table type.
- Existing UI primitives: shadcn Badge, Card, Button, sonner toast.
- contact-info-panel.tsx has client-component state (Phase 106 added MergedBanner integration).

### Established Patterns
- Migration numbering: next is **1062**.
- RLS via `get_current_org_id()`, 4 policies on new tables.
- Webhooks always HTTP 200.
- Vitest tests via pg.Client + DATABASE_URL.

### Integration Points
- `contact_verifications` is read by:
  - Badge logic (compute "verified" state for badge)
  - Future SMS/email verification flows (write rows when triggered)
- CSV import refactor consumes Phase 107 `findByPhone`/`findByEmail` + Phase 108 normalized columns.
- Status badge component is reused anywhere a contact is displayed (initially just contact-info-panel; future detail page reuses it).

</code_context>

<specifics>
## Specific Ideas

- "Mark verified" UX: button in contact-info-panel header when `identity_status === 'identified'`. After click → status moves to 'verified', button disappears, badge re-renders.
- Conflict filter chip placement: top of `/contacts` list, next to existing filters (search, tag, source). Counter updates on page load via separate count query.
- CSV pre-flight UI: between column mapping step and confirmation step, show "Pre-flight summary: 142 rows, 12 conflicts, 3 placeholder emails, 127 to create".
- BLOCKED_EMAIL_PATTERNS lives at `src/lib/contacts/blocked-emails.ts`, exported. Imported by zod-schemas.ts, actions.ts CSV path, and webhook handlers.

</specifics>

<deferred>
## Deferred Ideas (Reduced Scope)

The following ROADMAP Phase 110 items are explicitly NOT in this phase, deferred to a follow-up milestone:

- **SMS reply-yes verification trigger** — needs inbound Twilio routing + NL parsing of "sim/yes". Track in next milestone.
- **Email link click verification trigger** — needs email send (Resend? SendGrid?) + verification endpoint + token signing. Track in next milestone.
- **`/contacts/[id]` detail page** — does not exist today. Identity badge is in contact-info-panel; full detail page is separate work.
- **`contacts.source` column DROP** — needs comprehensive call-site audit. DEPRECATED comment (Phase 108) stays in schema. Drop in next milestone with explicit cleanup phase.
- **Per-org `org_settings.blocked_email_patterns`** — hardcoded list ships first. Configurability per org is follow-up.
- **Verified contact privileges** — what does verified actually unlock for the contact? UX consequence design is follow-up.
- **Auto-verification on first reply** — when contact replies to outbound message, auto-mark verified. Follow-up.
- **Verified status visible in CSV export** — out of scope.
- **65 pre-existing failing tests in unrelated suites** — out of scope.

</deferred>

---

*Phase: 110-app-wiring*
*Context gathered: 2026-05-26*
