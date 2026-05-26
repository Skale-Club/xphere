# Phase 107: UNIQUE-CONSTRAINTS - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Add partial UNIQUE indexes on `(org_id, phone_e164)` and `(org_id, email_normalized)` scoped to non-archived contacts. Refactor `createContact` server action and webhook handlers to use INSERT...ON CONFLICT DO NOTHING + SELECT-on-conflict pattern (no more SELECT-then-INSERT race). Multi-conflict (phone matches A, email matches B) flagged as `identity_status='merge_conflict'` and surfaces in existing Phase 106 admin UI.

Delivers:
- Migration 1058: 2 partial UNIQUE indexes on `contacts`
- Pre-flight audit query before constraint creation (re-runs `refresh_contact_duplicate_audit` and aborts if non-zero)
- `createContact` refactored (`src/app/(dashboard)/contacts/actions.ts`) — pre-checks both identity fields, falls back to ON CONFLICT for race safety
- Webhook update for the unique-violation path in: Meta (`src/lib/meta/process-event.ts`), Vapi (`src/app/api/vapi/*/route.ts`), ManyChat (`src/app/api/manychat/*/route.ts`)
- Vitest tests for the race-protection contract: parallel INSERTs same `(org_id, phone)` → exactly one wins, other gets unique-violation

Does NOT deliver (deferred):
- ON CONFLICT DO UPDATE enrichment paths (later phase if needed)
- Channel identities table — Phase 108
- Identity trigger — Phase 109
- Form-level merge UI / field picker — already covered by Phase 106
- Verified state — Phase 110
- Conflict-resolution UX changes — already covered by Phase 106's `/admin/contacts/conflicts`

</domain>

<decisions>
## Implementation Decisions

### Multi-conflict Resolution
- **D-01:** Pre-check in `createContact` and webhook contact-creation paths: do `findByPhone(phone_e164)` + `findByEmail(email_normalized)` BEFORE insert. If both return contacts AND they are different ids, do NOT pick one — INSERT the new row anyway with `identity_status='merge_conflict'`. The merge_conflict status surfaces in Phase 106's `/admin/contacts/conflicts` UI (already wired).
- **D-01a:** Single-conflict (only phone matches, or only email matches, or both match same contact id): return the existing contact without modification.
- **D-01b:** UNIQUE constraint is defense in depth — pure race window between two pre-checks of the same `(org_id, phone)` is closed by the partial UNIQUE index. Constraint violation handling: SELECT the row that won and return it.
- **D-01c:** Multi-conflict creating a fresh `merge_conflict` row could itself collide on phone or email UNIQUE — this case is documented but rare. Catch via try/catch around the INSERT: if unique violation occurs on the multi-conflict path, fall through to returning the FIRST matched contact (phone match preferred) and log it.

### ON CONFLICT Strategy
- **D-02:** `INSERT ... ON CONFLICT (org_id, phone_e164) WHERE phone_e164 IS NOT NULL AND identity_status <> 'archived_duplicate' DO NOTHING RETURNING id`. If RETURNING is empty (silent skip), SELECT the existing row. Same pattern for the email partial index when phone is null.
- **D-02a:** DO NOTHING, not DO UPDATE. Identity dedup is identity dedup — webhook data does not silently overwrite curated contact fields. Enrichment is an explicit caller decision.
- **D-02b:** Allowed update via DO UPDATE: only `updated_at = now()` (touch). Nothing else.
- **D-02c:** App must handle the dual-index case: contacts with only phone go through ON CONFLICT on phone index. Contacts with only email go through ON CONFLICT on email index. Contacts with both: pre-check decides.

### Webhook Unique-Violation Handling
- **D-03:** When a webhook hits unique-violation, the recovery path is:
  1. Catch the violation.
  2. SELECT the existing contact by `(org_id, phone_e164)` or `(org_id, email_normalized)`.
  3. Proceed with the webhook's actual work (create conversation, message, call) attached to that existing contact id.
  4. Do NOT update the existing contact's fields with webhook data.
  5. Log the collision as a structured metric (event name: `contact.unique_collision`, fields: source, org_id, contact_id, matched_via).
- **D-03a (corrected per RESEARCH.md):** Meta/Vapi/ManyChat handlers do NOT actually create contact rows in this repo — they create conversations or attach to existing contacts. The handlers that DO create contacts (verified via grep) are:
  - WhatsApp Cloud: `src/lib/whatsapp/process-message.ts:68-80`
  - Evolution API: `src/lib/evolution/process-event.ts:230-241`
  - Telegram: `src/lib/telegram/process-update.ts:213-219`
  These three are the unique-violation handler targets, not Meta/Vapi/ManyChat. (Original CONTEXT named the wrong sites; corrected after research scan.)

### Form UX on Duplicate
- **D-04:** When manual contact creation form submits a phone or email that already exists in the same org, `createContact` returns `{ existed: true, contact_id, matched_via: 'phone' | 'email' }`. The form component displays a `sonner` toast: `"Contato já existe — abrir <name>"` with a clickable link to `/contacts/[id]`. Does NOT auto-redirect. Does NOT update the existing contact.
- **D-04a:** Multi-conflict case (different contacts on phone vs email) shows a different toast: `"Conflito de identidade — phone bate com X, email bate com Y. Revisar em /admin/contacts/conflicts"` with admin-only link.

### Migration Safety
- **D-05:** Migration 1058 first SELECTs from `contact_duplicate_audit` table — if any rows exist with `cluster_size > 1`, RAISE EXCEPTION and abort the migration. Forces the admin to merge clusters via Phase 106 UI before constraints can land. Since baseline = 0 clusters in prod, this is a no-op on first apply.
- **D-05a:** The audit refresh runs as the first statement of the migration to ensure freshness. Pattern: `SELECT refresh_contact_duplicate_audit(); ... IF EXISTS (SELECT 1 FROM contact_duplicate_audit) THEN RAISE EXCEPTION ...`.
- **D-05b:** UNIQUE indexes use `CREATE UNIQUE INDEX CONCURRENTLY` is **NOT** required here — prod has 1 contact, index creation is instant. Use plain `CREATE UNIQUE INDEX` for atomicity within transaction.

### Race Test Strategy
- **D-06:** Vitest test fires two parallel `Promise.all` INSERTs with same `(org_id, phone_e164)` via pg client. Expectation: exactly one succeeds, the other raises `unique_violation`. The test uses two distinct pg connections to ensure they don't serialize via single session.
- **D-06a:** Test runs against prod (real connection) but creates and tears down synthetic test rows in the same vitest run. Cleanup is guaranteed via try/finally + transaction rollback patterns.
- **D-06b:** Test file: `tests/contacts-unique-constraint.test.ts`. Uses the same `vi.mock('server-only', () => ({}))` pattern from Phase 106.

### Claude's Discretion
- Exact migration filename (1058_*.sql, name picked at planning).
- Whether to wrap the audit-check in a DO block or use a separate guard query.
- Exact log format for collision metrics — pick a stable structured shape compatible with existing logging.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 105 + 106 Output (binding)
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-CONTEXT.md` — D-01..D-04 still locked.
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-CONTEXT.md` — D-01..D-05 still locked, especially identity_status='merge_conflict' usage.
- `supabase/migrations/1056_contact_identity_audit.sql` — `normalize_phone`, generated columns, `identity_status` CHECK.
- `supabase/migrations/1057_contact_merge_tool.sql` — `merge_contacts`, `contact_duplicate_audit` refresh function.

### Repo Files Researcher Must Inspect
- `src/app/(dashboard)/contacts/actions.ts:389-466` — current `createContact` with SELECT-then-INSERT race-prone dedup at lines 412-427. Refactor target.
- `src/lib/contacts/zod-schemas.ts` — `normalisePhone`, `normaliseEmail` TS-side helpers used by app and form.
- `src/lib/meta/process-event.ts:945-986` — `linkConversationsToContacts` — post-hoc phone matching. Needs unique-violation guard.
- `src/lib/meta/process-event.ts` — search for `.from('contacts').insert(...)` patterns.
- `src/app/api/vapi/*/route.ts` (calls, campaigns, tools) — Vapi webhook handlers.
- `src/app/api/manychat/route.ts` (or wherever ManyChat handler lives) — ManyChat webhook handler.
- `src/components/contacts/contact-form.tsx` (or similar) — form UI for D-04 toast behavior.
- `tests/` — existing vitest test structure for D-06 race test placement.
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-AUDIT-BASELINE.md` — baseline confirms 0 clusters (precondition for D-05).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`normalisePhone` / `normaliseEmail`** in `src/lib/contacts/zod-schemas.ts:20-34` — already used everywhere; constraint operates on the same normalized values via generated columns.
- **`createClient`** (cached) and **service-role client** patterns in `src/lib/supabase/server.ts`.
- **`sonner` toasts** for D-04 form UX.
- **`assertAdmin` / `assertOrgMember`** server-side auth helpers established in Phase 106.
- **Pooler-pg apply pattern** — `apply-1056.mjs` and `apply-1057.mjs` are templates for `apply-1058.mjs`.

### Established Patterns
- Migrations numbered, never edit old ones. Next number: **1058**.
- Manual `src/types/database.ts` patch (CLI/MCP type gen blocked on this project).
- Vitest with `vi.mock('server-only', () => ({}))` at top of test file.
- RLS already on `contacts` — no changes needed (UNIQUE indexes are not subject to RLS).

### Integration Points
- `createContact` is consumed by:
  - Contact form (`src/components/contacts/contact-form.tsx` or its handler)
  - CSV import path (`src/app/(dashboard)/contacts/actions.ts:589-741`)
  - Any internal callers
- `findByPhone` / `findByEmail` helpers may need to be created or reused — researcher checks.
- Webhook collision metrics logging: existing pattern in `src/lib/observability/*` or similar.

</code_context>

<specifics>
## Specific Ideas

- Migration body order: (1) refresh audit, (2) raise if clusters exist, (3) CREATE UNIQUE INDEX × 2, (4) brief comment block.
- `createContact` returns shape: `{ id: string, existed: boolean, matched_via: 'phone' | 'email' | 'both_same' | 'multi_conflict' | null }`. Form switches on `matched_via`.
- Race test: Promise.all of two independent pg Client connections, each running INSERT. Assert exactly one succeeds (count(rows) where the result has an id) and one throws 23505 (unique_violation SQLSTATE).
- Collision metric log shape: `{ event: 'contact.unique_collision', source: 'meta'|'vapi'|'manychat'|'form'|'csv_import', org_id, contact_id, matched_via: 'phone'|'email' }`.

</specifics>

<deferred>
## Deferred Ideas

- **ON CONFLICT DO UPDATE for enrichment** — webhook auto-fills missing fields from latest data. Defer to Phase 110 or beyond; conservative DO NOTHING is the safe default.
- **Field-level merge UI on form conflict** — already covered by Phase 106 admin UI; not adding a duplicate inline UI.
- **Auto-resolution of merge_conflict** — Phase 110+, after observing what real conflicts look like.
- **De-duping CSV imports against generated columns** — already partly handled by Phase 105/106; Phase 110 closes the loop.
- **Tracking unique-collision metrics as analytics dashboard** — Phase 110 observability work.
- **Cross-org duplicate detection** — never. Multi-tenancy isolation is sacred.

</deferred>

---

*Phase: 107-unique-constraints*
*Context gathered: 2026-05-26*
