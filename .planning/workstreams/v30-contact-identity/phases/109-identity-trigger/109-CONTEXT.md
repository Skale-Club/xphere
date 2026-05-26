# Phase 109: IDENTITY-TRIGGER - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Enforce the identity invariant — "every non-archived contact must have phone OR email OR at least one channel identity" — via three DB triggers. Auto-promote `channel_only → identified` when phone or email is populated. Block deletion of the last channel identity of a phone/email-less contact.

Delivers:
- Migration 1061: 3 triggers + 3 trigger functions + pre-flight invariant check.
- Trigger #1 `enforce_contact_identity_at_commit` (CONSTRAINT TRIGGER, AFTER INSERT/UPDATE on contacts, DEFERRABLE INITIALLY DEFERRED) — checks invariant at COMMIT.
- Trigger #2 `prevent_channel_identity_orphan` (BEFORE DELETE on contact_channel_identities, NOT deferrable) — blocks orphan creation.
- Trigger #3 `promote_channel_only_on_identity` (BEFORE UPDATE on contacts, NOT deferrable) — auto-bumps status when phone/email added.
- Pre-flight `RAISE EXCEPTION` guard in migration body to catch any existing violators.
- Zod-schema comment in `src/lib/contacts/zod-schemas.ts` documenting intentional stricter-than-DB Zod refine.
- Vitest covering: deferrable transaction (insert contact+identity together), orphan delete blocked, promotion on phone/email add, archived rows exempt.

Does NOT deliver (deferred):
- Verified state, conflict UI, badges — Phase 110.
- `contacts.source` column drop — Phase 110.
- Auto-downgrade `identified → channel_only` when phone/email cleared — out of scope (data-hygiene problem, not invariant violation).
- Form UI for channel-only contact creation — webhooks-only path for now.
- Trigger telemetry / counters — Phase 110.

</domain>

<decisions>
## Implementation Decisions

### Trigger Architecture
- **D-01:** Three triggers, three SQL functions:
  1. `enforce_contact_identity_at_commit` — `CREATE CONSTRAINT TRIGGER ... AFTER INSERT OR UPDATE ON contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`. Function checks `phone_e164 IS NULL AND email_normalized IS NULL AND identity_status <> 'archived_duplicate' AND NOT EXISTS (SELECT 1 FROM contact_channel_identities WHERE contact_id = NEW.id)` → RAISE EXCEPTION. Deferred-at-commit semantics allow `INSERT contact (channel_only) → INSERT channel_identity → COMMIT` in same transaction (Phase 108 webhook pattern).
  2. `prevent_channel_identity_orphan` — `CREATE TRIGGER ... BEFORE DELETE ON contact_channel_identities FOR EACH ROW`. Function checks: if `(SELECT count(*) FROM contact_channel_identities WHERE contact_id = OLD.contact_id) = 1` AND contact has no phone_e164/email_normalized AND identity_status <> 'archived_duplicate' → RAISE EXCEPTION. Not deferrable — fails fast on delete.
  3. `promote_channel_only_on_identity` — `CREATE TRIGGER ... BEFORE UPDATE ON contacts FOR EACH ROW WHEN (OLD.identity_status = 'channel_only')`. Function checks: if `NEW.phone_e164 IS NOT NULL OR NEW.email_normalized IS NOT NULL` → `NEW.identity_status := 'identified'`. Not deferrable, mutates NEW row before write.
- **D-01a:** `enforce_contact_identity_at_commit` is a CONSTRAINT TRIGGER (different syntax from regular trigger: `CREATE CONSTRAINT TRIGGER`). Constraint triggers are AFTER row triggers that can be deferred.
- **D-01b:** Trigger functions are SECURITY INVOKER (default) — they run as the role that triggered the operation, and RLS still applies to their internal SELECTs. Function body uses fully-qualified table names (`public.contact_channel_identities`) for safety.

### Pre-Flight Invariant Check
- **D-02:** Migration 1061 starts with:
  ```sql
  DO $$
  DECLARE violators int;
  BEGIN
    SELECT count(*) INTO violators FROM contacts c
    WHERE c.phone_e164 IS NULL
      AND c.email_normalized IS NULL
      AND c.identity_status <> 'archived_duplicate'
      AND NOT EXISTS (SELECT 1 FROM contact_channel_identities cci WHERE cci.contact_id = c.id);
    IF violators > 0 THEN
      RAISE EXCEPTION 'Phase 109 pre-flight failed: % contacts violate identity invariant. Resolve via Phase 106 merge tool or add channel identities before applying migration 1061.', violators;
    END IF;
  END $$;
  ```
- **D-02a:** In prod (baseline: 1 contact with phone+email), this is no-op. In dev environments with stale data, forces cleanup first.

### Promotion Semantics
- **D-03:** Auto-promote `channel_only → identified` when **either** `phone_e164` OR `email_normalized` becomes non-null. Trigger does NOT require both. Trigger does NOT auto-downgrade (`identified → channel_only`) when phone/email is nulled out — that's a data-hygiene concern, not an invariant violation; the contact still has channel identities and remains valid.
- **D-03a:** Promotion is a property change, not an audit event. No log row inserted. If telemetry is needed later, add in Phase 110.
- **D-03b:** When phone/email is added to a `merge_conflict` contact, the status remains `merge_conflict` (admin must resolve via Phase 106 UI). Promotion only applies when current status is `channel_only`.

### Zod Schema Strategy
- **D-04:** Keep current `contactSchema.refine` in `src/lib/contacts/zod-schemas.ts` strict (requires `first_name || last_name || name || phone || email`). Reason: forms are human-driven and always supply a name. DB trigger is the universal enforcer with looser semantics (phone | email | channel identity). Webhooks bypass Zod (raw inserts in Phase 108 webhook paths).
- **D-04a:** Add a code comment at the refine: "Intentionally stricter than DB invariant. Forms always provide a display name. DB-level `enforce_contact_identity_at_commit` allows phone/email-less contacts when at least one channel identity exists (Phase 109)." Documents the deliberate divergence so future readers don't 'fix' the Zod by relaxing it.

### archived_duplicate Exclusion
- **D-05:** All three triggers exclude rows with `identity_status='archived_duplicate'` from the invariant check. Archived rows are history — they preserved their phone/email values at merge time but should not block schema enforcement.
- **D-05a:** Pre-flight check also excludes archived rows.

### Migration Safety
- **D-06:** Single migration file 1061 contains all three trigger functions + three CREATE TRIGGER statements + pre-flight DO block. No data inserts. No DROP/ALTER on existing tables. Reversible via reverse migration if needed (DROP TRIGGER + DROP FUNCTION). Apply via pg client (pooler-safe pattern from prior phases).

### Test Strategy
- **D-07:** Vitest at `tests/contact-identity-trigger.test.ts`. Six tests:
  1. Deferrable: BEGIN; insert contact (channel_only) + channel identity; COMMIT → succeeds.
  2. Deferrable failure: BEGIN; insert contact (channel_only) only; COMMIT → RAISE.
  3. Orphan block: insert contact + 1 channel identity; DELETE identity → RAISE.
  4. Orphan allow: insert contact with phone + 1 channel identity; DELETE identity → succeeds (phone covers invariant).
  5. Promotion: insert contact (channel_only) + channel identity; UPDATE phone; assert identity_status='identified'.
  6. Archived exempt: archive a contact (set identity_status='archived_duplicate'); UPDATE phone to NULL; trigger does not raise.
- **D-07a:** All cleanup runs in `afterAll` via existing pg helpers. Soft-skip if `DATABASE_URL` unset (Phase 107/108 precedent).

### Claude's Discretion
- Exact migration filename (1061_*.sql).
- Function naming style (snake_case, public schema).
- Whether to wrap trigger SQL in a single transaction or rely on Postgres auto-transaction (recommend single explicit BEGIN/COMMIT in apply script).
- Error message wording for RAISE EXCEPTION (must be clear and actionable for both humans and the webhook collision-log readers).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 105-108 Output (binding)
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-CONTEXT.md` (D-03 identity_status CHECK has all 5 values)
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-CONTEXT.md` (merged_into_contact_id + archived_duplicate)
- `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-CONTEXT.md` (race-safe pattern)
- `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/108-CONTEXT.md` (D-03 lookup-first webhook flow — Phase 109 trigger must allow this flow under DEFERRABLE)
- `supabase/migrations/1056_contact_identity_audit.sql`
- `supabase/migrations/1057_contact_merge_tool.sql`
- `supabase/migrations/1059_contacts_unique_constraints.sql`
- `supabase/migrations/1060_contact_channel_identities.sql`

### Repo Files Researcher Must Inspect
- `src/lib/contacts/zod-schemas.ts` — `contactSchema.refine` location for D-04 comment.
- `src/lib/whatsapp/process-message.ts`, `src/lib/evolution/process-event.ts`, `src/lib/telegram/process-update.ts` — verify Phase 108 webhook flow uses single transaction OR sequential inserts (informs whether DEFERRABLE is sufficient or need extra changes).
- `src/app/(dashboard)/contacts/actions.ts:389-466` — createContact (Phase 107). With trigger live, archived_duplicate insertion paths must still work.
- `tests/contacts-unique-constraint.test.ts`, `tests/contact-channel-identity.test.ts` — precedent for race-test cleanup pattern.

### Postgres Documentation
- `CREATE CONSTRAINT TRIGGER` syntax: https://www.postgresql.org/docs/current/sql-createtrigger.html (deferred constraint triggers only fire AFTER, not BEFORE)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Pooler-pg apply pattern (apply-1061.mjs based on apply-1060.mjs).
- Race/CASCADE test patterns from Phase 107/108 (apply to D-07 tests).
- Manual type regen still required? — NO, this phase adds no new columns/tables. Types unchanged.

### Established Patterns
- Migration numbering: next is **1061**.
- pg client via DATABASE_URL pooler (transaction-pooled mode supports DEFERRABLE constraint triggers).
- SECURITY INVOKER (default) for trigger functions — safer than DEFINER for this use case.

### Integration Points
- Phase 108 webhook flow: contact INSERT → channel identity INSERT, in separate Supabase calls (no explicit transaction wrap). **Open question:** Are these in same DB transaction? If they're separate transactions, DEFERRABLE doesn't help — the contact INSERT fails immediately because channel identity doesn't exist yet. Researcher must verify and fix if needed (wrap in single transaction or special-case channel_only status to skip immediate check).
- createContact (Phase 107) inserts contact with phone+email — trigger passes without issue.

</code_context>

<specifics>
## Specific Ideas

- Promotion trigger uses `WHEN (OLD.identity_status = 'channel_only')` to fire only when relevant (cheap optimization).
- Constraint trigger uses `OPERATION` predicate: `AFTER INSERT OR UPDATE OF phone_e164, email_normalized, identity_status` to minimize fires.
- Error message format: `'contact % violates identity invariant (no phone, email, or channel identity at commit)'` with `%` as NEW.id.

</specifics>

<deferred>
## Deferred Ideas

- **Auto-downgrade `identified → channel_only`** — not invariant violation; out of scope.
- **`merge_conflict → identified` auto-resolution** — Phase 110.
- **Verified state triggers** — Phase 110 (SMS reply, email click).
- **`contacts.source` column drop + Zod refactor** — Phase 110.
- **Trigger telemetry / event log** — Phase 110.
- **Form UI for channel_only contact creation** — out of scope; webhooks-only path.

</deferred>

---

*Phase: 109-identity-trigger*
*Context gathered: 2026-05-26*
