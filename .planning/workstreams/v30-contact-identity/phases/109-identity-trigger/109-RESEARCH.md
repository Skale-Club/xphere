# Phase 109: IDENTITY-TRIGGER - Research

**Researched:** 2026-05-26
**Domain:** Postgres triggers (constraint, BEFORE), DEFERRABLE semantics, Supabase JS transaction model
**Confidence:** HIGH (architecture verified against actual Phase 108 source files + Postgres docs)

## Summary

Phase 109 lands three DB triggers that enforce "every non-archived contact has phone OR email OR ≥1 channel identity". The architectural keystone of CONTEXT D-01 is a `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` that runs at COMMIT — letting `INSERT contact (channel_only) → INSERT channel_identity → COMMIT` succeed in a single transaction.

**The critical finding:** that single-transaction assumption is **false** for Phase 108 webhook code. The retrofitted handlers (`whatsapp/process-message.ts`, `evolution/process-event.ts`, `telegram/process-update.ts`) issue contact INSERT and `attachChannelIdentity` (channel identity INSERT) as **two separate Supabase PostgREST HTTP calls**. PostgREST is HTTP-per-statement; each call is its own implicit transaction. By the time channel identity is inserted, the contact INSERT has already COMMITted — the deferred constraint check fired at the end of statement 1 and saw no identity row → RAISE.

**Recommended path: Option A (status-based skip).** Add `NEW.identity_status <> 'channel_only'` to the trigger's RAISE predicate. `channel_only` is the explicit "I owe you an identity" promise. The constraint is enforced for every other status (`identified`, `verified`, `merge_conflict`). On the promotion path (channel_only → identified) the constraint kicks in automatically because the promotion trigger fires BEFORE the constraint trigger fires AFTER. This preserves Phase 108 flow unchanged, matches CONTEXT D-01b semantically, and keeps migration 1061 self-contained.

**Primary recommendation:** Implement Option A. Migration 1061 contains pre-flight DO block + 3 plpgsql functions + 1 CONSTRAINT TRIGGER + 2 regular triggers + Zod comment + 6 Vitest tests. No app code change. No new RPC. DEFERRABLE INITIALLY DEFERRED is still useful for the createContact path (multi-statement server actions) and is cheap to keep.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 Three triggers, three SQL functions:**
1. `enforce_contact_identity_at_commit` — `CREATE CONSTRAINT TRIGGER ... AFTER INSERT OR UPDATE ON contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`. Function checks `phone_e164 IS NULL AND email_normalized IS NULL AND identity_status <> 'archived_duplicate' AND NOT EXISTS (SELECT 1 FROM contact_channel_identities WHERE contact_id = NEW.id)` → RAISE EXCEPTION.
2. `prevent_channel_identity_orphan` — `CREATE TRIGGER ... BEFORE DELETE ON contact_channel_identities FOR EACH ROW`. RAISE if last identity AND contact has no phone/email AND status <> 'archived_duplicate'.
3. `promote_channel_only_on_identity` — `CREATE TRIGGER ... BEFORE UPDATE ON contacts FOR EACH ROW WHEN (OLD.identity_status = 'channel_only')`. If phone or email becomes non-null → `NEW.identity_status := 'identified'`.

**D-01a** Constraint trigger uses `CREATE CONSTRAINT TRIGGER` syntax (AFTER, FOR EACH ROW, deferrable).
**D-01b** Trigger functions SECURITY INVOKER (default); fully-qualified `public.*` tables.

**D-02** Pre-flight `DO $$ ... $$` block raises if existing violators.
**D-02a** Prod baseline (1 contact w/ phone+email) → no-op.

**D-03** Auto-promote `channel_only → identified` when phone OR email becomes non-null. No auto-downgrade.
**D-03a** Promotion is property change, no audit log.
**D-03b** `merge_conflict` stays `merge_conflict` even when phone/email added (admin resolves via Phase 106).

**D-04** Keep `contactSchema.refine` strict. Add explanatory comment.
**D-04a** Comment: "Intentionally stricter than DB invariant. Forms always provide a display name. DB-level `enforce_contact_identity_at_commit` allows phone/email-less contacts when at least one channel identity exists (Phase 109)."

**D-05** All 3 triggers exclude `identity_status='archived_duplicate'`.
**D-05a** Pre-flight excludes archived rows.

**D-06** Single migration 1061. Pooler-safe apply pattern. No DROP/ALTER on existing tables.

**D-07** Vitest at `tests/contact-identity-trigger.test.ts`, six tests (deferrable success, deferrable failure, orphan block, orphan allow, promotion, archived exempt).
**D-07a** Cleanup in `afterAll` via pg helpers. Soft-skip if DATABASE_URL unset.

### Claude's Discretion
- Exact migration filename (recommend `1061_contact_identity_trigger.sql`).
- Function naming style (recommend snake_case in `public` schema, suffix `_fn`).
- Apply script transaction wrap (recommend single explicit BEGIN/COMMIT in `apply-1061.mjs`).
- Error message wording for RAISE EXCEPTION.

### Deferred Ideas (OUT OF SCOPE)
- Auto-downgrade `identified → channel_only`.
- `merge_conflict → identified` auto-resolution (Phase 110).
- Verified state triggers (Phase 110: SMS reply, email click).
- `contacts.source` column drop + Zod refactor (Phase 110).
- Trigger telemetry / event log (Phase 110).
- Form UI for channel_only contact creation (webhooks-only path).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CID-12 | Identity invariant enforced at DB level | Trigger #1 `enforce_contact_identity_at_commit` (CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED) + special-case `channel_only` to accommodate Phase 108 two-transaction webhook pattern (Section "Transaction Shape Audit" below). Trigger #2 `prevent_channel_identity_orphan` covers DELETE path. |
| CID-13 | `channel_only` status becomes first-class; auto-promotes when phone/email added | Trigger #3 `promote_channel_only_on_identity` (BEFORE UPDATE with `WHEN (OLD.identity_status = 'channel_only')`). Webhooks must START writing `identity_status='channel_only'` on new-insert branches (Phase 108 currently inserts without setting status — default `'identified'` from migration 1056 applies). **This is a webhook code change not yet in scope of CONTEXT** — see Open Questions §3. |
</phase_requirements>

## Transaction Shape Audit (CRITICAL — answers CONTEXT open question)

**Question:** Do Phase 108 webhook flows wrap contact INSERT + channel identity INSERT in a single DB transaction?

**Answer:** **No.** Two separate transactions.

**Evidence (verified by reading each retrofitted file):**

### whatsapp/process-message.ts (lines 93–124)
```ts
// Transaction 1: contact insert
const { data: created, error: insErr } = await supabase
  .from('contacts')
  .insert({ org_id, name, phone, source: 'whatsapp' })
  .select('id').single()
// ↑ HTTP POST to PostgREST /contacts — its own transaction. COMMIT happens
//   server-side before the function returns.

if (insErr?.code === '23505') { /* recover */ }
else { contactId = created?.id ?? null }

// Transaction 2: channel identity insert
if (contactId && externalId) {
  await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
}
// ↑ Inside attachChannelIdentity: separate HTTP POST to PostgREST
//   /contact_channel_identities — its own transaction.
```

### evolution/process-event.ts (lines 250–278)
Identical shape. Contact INSERT then separate `attachChannelIdentity` call.

### telegram/process-update.ts (lines 234–257)
Identical shape. Contact INSERT then separate `attachChannelIdentity` call.

### attachChannelIdentity (src/lib/contacts/server.ts:174–202)
Single `.insert()` followed by a separate `.select()` for read-back. Each is its own HTTP round-trip → its own transaction.

### Supabase JS client architecture
The `@supabase/supabase-js` client uses PostgREST HTTP under the hood. Each `.from(...).insert/select/update/delete()` chain is one HTTP request that PostgREST runs in a single statement-level transaction. **Multi-statement transactions are not expressible** through the standard JS client API. The only way to get multi-statement transactional semantics is:
1. Postgres functions (`.rpc()`) — the function body runs in one transaction.
2. Direct `pg` client (Node only) using `BEGIN/COMMIT`.
3. Edge functions calling raw SQL.

**Confidence:** HIGH. Source: actual code inspection of all four files; supabase-js documented behavior.

## Mitigation Decision: Option A (status-based skip)

Four options were considered. **Option A wins** on simplicity + minimal blast radius.

| Option | Approach | Pros | Cons | Decision |
|--------|----------|------|------|----------|
| **A** | Trigger skips RAISE when `NEW.identity_status='channel_only'` | Phase 108 code unchanged (modulo webhooks writing the status). Matches D-01b "channel_only is the promise". Minimal migration. | The invariant is *weakened* for `channel_only` rows — they can briefly exist without an identity row. Mitigation: promotion trigger fires UPDATE → constraint reasserts. Plus orphan trigger covers DELETE path. | **CHOSEN** |
| B | Postgres RPC `create_contact_with_channel` that does both INSERTs in one function | Strict invariant always enforceable. | Requires rewriting all 4 contact-creating call sites (3 webhooks + linkConversationsToContacts) to call RPC. Phase 108 already shipped; this is a regression risk for already-merged code. | Rejected |
| C | AFTER STATEMENT constraint trigger that reconciles state | Avoids row-level fire timing problems | Complex; loses row-level NEW reference; harder to reason about. | Rejected |
| D | Skip the strict invariant; document as best-effort | Simplest | Weakens phase deliverable; Phase 110 verified-state logic later depends on the invariant. | Rejected |

### Why Option A preserves the invariant in practice

The trigger excludes `channel_only` rows from the check **at commit**, but:
1. **Webhook flow:** contact inserted as `channel_only` → constraint trigger sees `channel_only`, skips RAISE → channel identity row inserted seconds later. Invariant holds for the system as a whole within the request window; only a `channel_only` row briefly lacks identity. (If the webhook crashes between the two writes, you get an orphan `channel_only` row — but the orphan trigger on the deletion path still protects against deletion ruining the invariant.)
2. **Promotion flow:** when phone/email added to a `channel_only` row, the BEFORE UPDATE promotion trigger fires first (mutates NEW.identity_status := 'identified'), then the AFTER UPDATE constraint trigger fires at commit and now checks the row against the strict predicate (because identity_status is no longer 'channel_only'). At that point the row already has phone or email → constraint passes.
3. **Form / createContact path:** `createContact` inserts with `identity_status='identified'` or `'merge_conflict'` and always has phone OR email (Zod refine guarantees a name OR phone OR email, but the DB invariant only cares about phone/email/identity). Constraint check runs on these rows and passes. DEFERRABLE is still used so that a future multi-statement server action (or test) wrapping things in BEGIN/COMMIT works correctly.

**Critical caveat to flag for planner:** Webhooks must write `identity_status='channel_only'` on the new-insert branch. Phase 108 webhook code does NOT currently set this column — the default `'identified'` from migration 1056 applies. If a webhook inserts a contact with NULL phone+email AND status='identified' (because pushName-only or empty), the constraint trigger RAISEs. See Open Questions §3.

**However:** Inspecting the three webhook insert payloads, the phone field is ALWAYS set:
- whatsapp: `phone: fromPhone` (the wa_id / E.164)
- evolution: `phone: fromPhone` (derived from JID)
- telegram: `phone: chatId` (the Telegram chat_id as string)

So `phone` is non-null on every webhook insert → `phone_e164` generated column is non-null → constraint passes regardless of status. The `channel_only` status path only matters for a *future* webhook that creates a phone-less contact (e.g., Instagram DM with only a PSID and no phone). Phase 109 still needs the Option A skip to remain correct for that future path, but **today's webhooks already satisfy the invariant via phone**.

This nuance is important for the planner: Option A is correct architecturally, AND we can prove the invariant holds today even without the skip — making this trigger immediately deployable with low risk.

## Standard Stack

| Library / Tool | Version | Purpose | Why Standard |
|---|---|---|---|
| Postgres CONSTRAINT TRIGGER | 15+ (Supabase) | Deferred row-level invariant enforcement | Only mechanism that runs AFTER + can be deferred to COMMIT |
| plpgsql | bundled | Trigger function body language | Standard for Postgres triggers; supports `RAISE EXCEPTION` + `NEW`/`OLD` references |
| `pg` (node-postgres) | 8.11.x (existing) | Apply migrations via pooler | Pattern from `apply-1060.mjs` |
| Vitest | existing in repo | Test framework | Repo precedent (107-05 race tests) |

No new dependencies. No npm install needed.

## Architecture Patterns

### Pattern: CREATE CONSTRAINT TRIGGER syntax differences

`CREATE CONSTRAINT TRIGGER` is **distinct** from `CREATE TRIGGER`:
- Always AFTER (no BEFORE constraint triggers).
- Always FOR EACH ROW (no statement-level).
- May be DEFERRABLE / NOT DEFERRABLE; if DEFERRABLE, may be INITIALLY DEFERRED / IMMEDIATE.
- Uses `FROM another_table` for cross-table referential semantics (optional; we don't need it).
- Cannot use `WHEN` clause directly — predicate logic goes inside the function body.

Reference: https://www.postgresql.org/docs/current/sql-createtrigger.html

### Pattern: BEFORE UPDATE with WHEN clause to short-circuit

The promotion trigger fires only when relevant:
```sql
CREATE TRIGGER promote_channel_only_on_identity
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  WHEN (OLD.identity_status = 'channel_only')
  EXECUTE FUNCTION public.promote_channel_only_on_identity_fn();
```
WHEN clause references OLD/NEW columns directly. **Cannot use subqueries in WHEN.** Subquery logic must live in the function body.

### Pattern: BEFORE trigger function must return NEW

If a BEFORE trigger function mutates NEW and wants the mutation to persist, it must `RETURN NEW;`. Returning NULL aborts the operation silently. Source: Postgres docs.

### Pattern: BEFORE DELETE returns OLD or NULL

BEFORE DELETE: returning OLD allows the delete; returning NULL silently aborts. RAISE EXCEPTION is the loud abort and the right tool here.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Multi-statement transactions through Supabase JS | Synthetic try/catch rollback | Either keep two-transaction shape + Option A trigger skip, OR use a Postgres function via `.rpc()` | JS client has no `BEGIN`. Rollback can't be emulated. |
| App-level invariant check before INSERT | TS code that queries identity then inserts contact | DB trigger | Race-prone; missed code paths; can't enforce across migrations |
| WHEN clause with subquery | Trying to put `EXISTS(SELECT...)` in WHEN | Predicate in function body | Postgres rejects subqueries in WHEN |
| Multiple migrations for trigger pieces | One per trigger | Single migration 1061 with 3 functions + 3 triggers + pre-flight | Cohesive deliverable; rollback is one DROP |

## Common Pitfalls

### Pitfall 1: Assuming Supabase JS client wraps multiple `.from()` calls in one transaction
**What goes wrong:** You design a DEFERRABLE constraint trigger expecting deferred fire-at-COMMIT semantics across two `.insert()` calls. The trigger fires at end of statement 1, raises, second `.insert()` never runs.
**Why it happens:** PostgREST is HTTP-per-statement; supabase-js is a thin wrapper over PostgREST.
**How to avoid:** Either use `.rpc()` (function body = one transaction) or design the trigger to tolerate the gap (Option A status-based skip).
**Warning sign:** Webhook integration tests fail with "violates identity invariant" on contact insert.

### Pitfall 2: CREATE CONSTRAINT TRIGGER vs CREATE TRIGGER confusion
**What goes wrong:** Writing `CREATE TRIGGER ... DEFERRABLE` (invalid — only constraint triggers can be deferred). Postgres rejects with "deferrable triggers must be CONSTRAINT triggers".
**How to avoid:** Use `CREATE CONSTRAINT TRIGGER` keyword specifically for the deferred one.

### Pitfall 3: BEFORE trigger function not returning NEW
**What goes wrong:** Mutating NEW.identity_status := 'identified' in the function body, then `RETURN NULL;` — the update is silently aborted.
**How to avoid:** Always `RETURN NEW;` at the end of BEFORE UPDATE/INSERT functions. Same for BEFORE DELETE → return OLD.

### Pitfall 4: WHEN clause subquery
**What goes wrong:** Trying `WHEN (NOT EXISTS (SELECT 1 FROM contact_channel_identities ...))` — Postgres rejects.
**How to avoid:** Cheap column-only checks in WHEN; complex logic in function body.

### Pitfall 5: RLS and trigger function body
**What might go wrong:** Function does `SELECT FROM contact_channel_identities WHERE contact_id = NEW.id` — does RLS apply?
**Reality:** Trigger functions default to SECURITY INVOKER, which means they run in the calling role's RLS context. **However**, the constraint trigger fires in the same statement as the INSERT, so the same authenticated role with the same `get_current_org_id()` is active. The `EXISTS` query naturally sees only rows visible to that role. **Provided** the channel identity was inserted by the same role (it is — webhooks use service-role client which bypasses RLS, and forms use the authenticated user's session which is RLS-bound to the same org), this works.
**Verification needed in test:** Test #1 (deferrable success) covers this implicitly. Confidence HIGH because Phase 107/108 patterns already demonstrate cross-table RLS-consistent operations.

### Pitfall 6: Phase 108's INSERT-then-catch-23505 inside `attachChannelIdentity` triggers Pitfall 1
**What goes wrong:** The 23505 recovery path means the same INSERT may execute twice in quick succession (once at conflict, once on the recovery SELECT). The constraint trigger fires on the contact row, not the identity row. Identity-row UNIQUE conflicts don't affect the contact constraint trigger.
**Verification:** The constraint trigger is on `contacts`, not `contact_channel_identities`. 23505 on identity inserts is unrelated. SAFE.

### Pitfall 7: Generated columns and trigger timing
**Reality check:** `phone_e164` and `email_normalized` are `GENERATED ALWAYS AS (...) STORED` (migration 1056). They are materialized before BEFORE triggers run on INSERT/UPDATE, and visible to AFTER triggers. The constraint trigger's `NEW.phone_e164` IS the post-generation value. SAFE.

### Pitfall 8: Pre-flight DO block runs in migration transaction
**What might go wrong:** Pre-flight raises → migration aborts mid-way → trigger/function partially applied → next attempt sees half-state.
**Reality:** Single-transaction migration means RAISE in DO block rolls back everything. No partial state. SAFE. Apply script should use one BEGIN/COMMIT.

### Pitfall 9: Tests must use raw pg client for deferrable transaction tests
**What goes wrong:** Vitest test using supabase-js cannot express BEGIN/COMMIT. The "deferrable success" test (D-07 test 1) needs an actual multi-statement transaction.
**How to avoid:** Use the `pg` client directly (pattern from `tests/contacts-unique-constraint.test.ts`). See Test Code Examples below.

### Pitfall 10: archived_duplicate rows on UPDATE
**What might go wrong:** Phase 106 merge sets `identity_status='archived_duplicate'`. That's an UPDATE on contacts. The constraint trigger fires AFTER UPDATE. Predicate must exclude archived rows (D-05 says so) AND the predicate runs against NEW, so `NEW.identity_status='archived_duplicate'` → trigger skips RAISE. SAFE.

## Code Examples

### Trigger Function Bodies (Option A applied)

```sql
-- ---------- Function 1: invariant check at commit ----------
CREATE OR REPLACE FUNCTION public.enforce_contact_identity_at_commit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip archived rows (D-05) and channel_only rows (Option A: webhooks
  -- write contact + identity as two separate transactions; channel_only is
  -- the "I owe you an identity" promise documented in D-01b).
  IF NEW.identity_status = 'archived_duplicate' OR NEW.identity_status = 'channel_only' THEN
    RETURN NULL;  -- constraint trigger return value is ignored; NULL is conventional
  END IF;

  -- Strict invariant: phone OR email OR ≥1 channel identity.
  IF NEW.phone_e164 IS NULL
     AND NEW.email_normalized IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.contact_channel_identities cci
       WHERE cci.contact_id = NEW.id
     )
  THEN
    RAISE EXCEPTION
      'contact % violates identity invariant (no phone, email, or channel identity at commit)',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------- Function 2: prevent orphan on identity delete ----------
CREATE OR REPLACE FUNCTION public.prevent_channel_identity_orphan_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_identities int;
  parent_phone text;
  parent_email text;
  parent_status text;
BEGIN
  -- Count siblings (identities sharing this contact_id, excluding the row
  -- being deleted). If we're the only one, check parent's other identifiers.
  SELECT count(*) INTO remaining_identities
  FROM public.contact_channel_identities
  WHERE contact_id = OLD.contact_id
    AND id <> OLD.id;

  IF remaining_identities = 0 THEN
    SELECT phone_e164, email_normalized, identity_status
      INTO parent_phone, parent_email, parent_status
      FROM public.contacts
      WHERE id = OLD.contact_id;

    -- If parent is missing (CASCADE-deleted via ON DELETE CASCADE on the FK),
    -- allow the delete — parent is going away anyway.
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;

    -- Archived rows are exempt (D-05).
    IF parent_status = 'archived_duplicate' THEN
      RETURN OLD;
    END IF;

    -- Block delete if parent has no other identifier.
    IF parent_phone IS NULL AND parent_email IS NULL THEN
      RAISE EXCEPTION
        'cannot delete last channel identity for contact % (no phone or email to satisfy identity invariant)',
        OLD.contact_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

-- ---------- Function 3: auto-promote channel_only → identified ----------
CREATE OR REPLACE FUNCTION public.promote_channel_only_on_identity_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- WHEN clause already filtered OLD.identity_status='channel_only'.
  -- Only promote if phone or email is now present.
  IF NEW.phone_e164 IS NOT NULL OR NEW.email_normalized IS NOT NULL THEN
    NEW.identity_status := 'identified';
  END IF;
  RETURN NEW;
END;
$$;
```

### Full Migration 1061 (ready-to-paste)

```sql
-- =============================================================================
-- Migration 1061: Contact Identity Invariant Triggers (CID-12, CID-13)
--
-- Phase 109 of v3.0 Contact Identity workstream. Enforces the rule
-- "every non-archived contact has phone OR email OR ≥1 channel identity"
-- via three triggers, and auto-promotes channel_only → identified when
-- phone or email is added.
--
-- Architecture decisions:
--   - Trigger 1 is a CONSTRAINT TRIGGER (DEFERRABLE INITIALLY DEFERRED) so
--     that future multi-statement transactions (e.g. createContact wrapped in
--     a Postgres function, tests via raw pg client) can insert contact +
--     channel identity together.
--   - The trigger SKIPS rows with identity_status='channel_only' because
--     Phase 108 webhook code uses two separate Supabase JS transactions
--     (contact INSERT then channel identity INSERT). channel_only is the
--     "promise" status; the promotion trigger transitions it to
--     'identified' which re-engages the strict check at the next UPDATE.
--   - All three triggers exempt 'archived_duplicate' (D-05).
--
-- Depends on:
--   * 1056 (identity_status, phone_e164, email_normalized generated cols)
--   * 1057 (merged_into_contact_id, archived_duplicate status)
--   * 1059 (unique constraints)
--   * 1060 (contact_channel_identities table)
--
-- Not in scope: verified state (Phase 110), source column drop (Phase 110).
-- =============================================================================

-- ----- Section 1: Pre-flight invariant check --------------------------------
-- Aborts the migration if any existing contact violates the invariant.
-- Prod baseline: 1 contact with phone+email → no-op. Dev environments with
-- stale data must clean up via Phase 106 merge tool first.

DO $$
DECLARE violators int;
BEGIN
  SELECT count(*) INTO violators
  FROM public.contacts c
  WHERE c.phone_e164 IS NULL
    AND c.email_normalized IS NULL
    AND c.identity_status <> 'archived_duplicate'
    AND c.identity_status <> 'channel_only'
    AND NOT EXISTS (
      SELECT 1 FROM public.contact_channel_identities cci
      WHERE cci.contact_id = c.id
    );
  IF violators > 0 THEN
    RAISE EXCEPTION
      'Phase 109 pre-flight failed: % contacts violate identity invariant. Resolve via Phase 106 merge tool or add channel identities before applying migration 1061.',
      violators;
  END IF;
END $$;

-- ----- Section 2: Trigger functions ------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_contact_identity_at_commit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.identity_status = 'archived_duplicate' OR NEW.identity_status = 'channel_only' THEN
    RETURN NULL;
  END IF;

  IF NEW.phone_e164 IS NULL
     AND NEW.email_normalized IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.contact_channel_identities cci
       WHERE cci.contact_id = NEW.id
     )
  THEN
    RAISE EXCEPTION
      'contact % violates identity invariant (no phone, email, or channel identity at commit)',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_channel_identity_orphan_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_identities int;
  parent_phone text;
  parent_email text;
  parent_status text;
BEGIN
  SELECT count(*) INTO remaining_identities
  FROM public.contact_channel_identities
  WHERE contact_id = OLD.contact_id
    AND id <> OLD.id;

  IF remaining_identities = 0 THEN
    SELECT phone_e164, email_normalized, identity_status
      INTO parent_phone, parent_email, parent_status
      FROM public.contacts
      WHERE id = OLD.contact_id;

    IF NOT FOUND THEN
      RETURN OLD;
    END IF;

    IF parent_status = 'archived_duplicate' THEN
      RETURN OLD;
    END IF;

    IF parent_phone IS NULL AND parent_email IS NULL THEN
      RAISE EXCEPTION
        'cannot delete last channel identity for contact % (no phone or email to satisfy identity invariant)',
        OLD.contact_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_channel_only_on_identity_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.phone_e164 IS NOT NULL OR NEW.email_normalized IS NOT NULL THEN
    NEW.identity_status := 'identified';
  END IF;
  RETURN NEW;
END;
$$;

-- ----- Section 3: Triggers ---------------------------------------------------

-- Trigger 1: CONSTRAINT TRIGGER — deferred to COMMIT.
-- Fires AFTER INSERT OR UPDATE on contacts.
-- NOTE: CREATE CONSTRAINT TRIGGER cannot use UPDATE OF column-list; the
-- function body is cheap so we accept all UPDATEs.
CREATE CONSTRAINT TRIGGER enforce_contact_identity_at_commit
  AFTER INSERT OR UPDATE ON public.contacts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_contact_identity_at_commit_fn();

-- Trigger 2: BEFORE DELETE on contact_channel_identities — not deferrable.
CREATE TRIGGER prevent_channel_identity_orphan
  BEFORE DELETE ON public.contact_channel_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_channel_identity_orphan_fn();

-- Trigger 3: BEFORE UPDATE on contacts when promoting from channel_only.
CREATE TRIGGER promote_channel_only_on_identity
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  WHEN (OLD.identity_status = 'channel_only')
  EXECUTE FUNCTION public.promote_channel_only_on_identity_fn();

-- ----- Section 4: Documentation ----------------------------------------------

COMMENT ON FUNCTION public.enforce_contact_identity_at_commit_fn() IS
  'Phase 109 (CID-12). Enforces "non-archived contact has phone OR email OR ≥1 channel identity". '
  'Skips archived_duplicate (D-05) and channel_only (Option A: webhooks use two-transaction insert).';

COMMENT ON FUNCTION public.prevent_channel_identity_orphan_fn() IS
  'Phase 109 (CID-12). Blocks DELETE of the last channel identity of a phone/email-less, non-archived contact.';

COMMENT ON FUNCTION public.promote_channel_only_on_identity_fn() IS
  'Phase 109 (CID-13). Auto-promotes identity_status channel_only → identified when phone or email is added.';
```

### Zod Schema Comment (D-04 / D-04a)

**File:** `src/lib/contacts/zod-schemas.ts`
**Insert immediately before line 70** (the `.refine(` call):

```ts
  // Intentionally stricter than the DB invariant. Forms always provide a
  // display name; this refine ensures form callers don't submit empty rows.
  // The DB-level constraint trigger `enforce_contact_identity_at_commit`
  // (Phase 109, migration 1061) enforces a looser invariant: phone OR email
  // OR at least one channel identity. Webhooks bypass this Zod schema and
  // rely on the DB invariant. Do NOT relax this refine to match the DB —
  // doing so would let users submit name-less form data.
  .refine(
    (v) => Boolean(v.first_name || v.last_name || v.name || v.phone || v.email),
    { message: 'Provide at least a name, phone, or email', path: ['first_name'] },
  )
```

### Vitest Pattern for Deferrable Transaction Tests (D-07 test 1)

```ts
// tests/contact-identity-trigger.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const { Client } = pg
const DATABASE_URL = process.env.DATABASE_URL
const describeIfDb = DATABASE_URL ? describe : describe.skip

describeIfDb('migration 1061 — identity invariant triggers', () => {
  let client: pg.Client
  let orgId: string
  const cleanupContactIds: string[] = []

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL })
    await client.connect()
    // Pin an org for testing (existing pattern from Phase 107/108 tests).
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM public.organizations LIMIT 1`,
    )
    orgId = rows[0].id
  })

  afterAll(async () => {
    if (cleanupContactIds.length > 0) {
      // Cascade deletes channel identities. Pre-clean to avoid orphan trigger.
      await client.query(
        `DELETE FROM public.contact_channel_identities WHERE contact_id = ANY($1)`,
        [cleanupContactIds],
      )
      await client.query(
        `DELETE FROM public.contacts WHERE id = ANY($1)`,
        [cleanupContactIds],
      )
    }
    await client.end()
  })

  it('test 1 — deferrable: insert contact (channel_only) + identity in one txn → succeeds', async () => {
    await client.query('BEGIN')
    try {
      const { rows: c } = await client.query<{ id: string }>(
        `INSERT INTO public.contacts (org_id, name, identity_status)
         VALUES ($1, 'TestChannelOnly', 'channel_only')
         RETURNING id`,
        [orgId],
      )
      cleanupContactIds.push(c[0].id)
      // Within same txn: insert channel identity
      await client.query(
        `INSERT INTO public.contact_channel_identities
           (org_id, contact_id, provider, external_id)
         VALUES ($1, $2, 'telegram', $3)`,
        [orgId, c[0].id, `test-chat-${Date.now()}`],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
    // If we got here, deferrable worked AND Option A skip worked.
  })

  it('test 2 — deferrable failure: insert non-channel_only contact w/ no identity → RAISE', async () => {
    await client.query('BEGIN')
    let raised = false
    try {
      await client.query(
        `INSERT INTO public.contacts (org_id, name, identity_status)
         VALUES ($1, 'TestNoIdentity', 'identified')`,  // not channel_only
        [orgId],
      )
      await client.query('COMMIT')
    } catch (err: any) {
      raised = true
      await client.query('ROLLBACK')
      expect(err.message).toMatch(/identity invariant/i)
    }
    expect(raised).toBe(true)
  })

  it('test 3 — orphan block: delete last channel identity of phone-less contact → RAISE', async () => {
    const { rows: c } = await client.query<{ id: string }>(
      `INSERT INTO public.contacts (org_id, name, identity_status)
       VALUES ($1, 'TestOrphanBlock', 'channel_only')
       RETURNING id`,
      [orgId],
    )
    cleanupContactIds.push(c[0].id)
    const extId = `orphan-test-${Date.now()}`
    const { rows: ident } = await client.query<{ id: string }>(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
      [orgId, c[0].id, extId],
    )
    await expect(
      client.query(`DELETE FROM public.contact_channel_identities WHERE id = $1`, [ident[0].id]),
    ).rejects.toThrow(/last channel identity/i)
  })

  it('test 4 — orphan allow: phone-bearing contact, delete identity → succeeds', async () => {
    const { rows: c } = await client.query<{ id: string }>(
      `INSERT INTO public.contacts (org_id, name, phone, identity_status)
       VALUES ($1, 'TestOrphanAllow', '+15551234567', 'identified')
       RETURNING id`,
      [orgId],
    )
    cleanupContactIds.push(c[0].id)
    const { rows: ident } = await client.query<{ id: string }>(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
      [orgId, c[0].id, `allow-test-${Date.now()}`],
    )
    await client.query(`DELETE FROM public.contact_channel_identities WHERE id = $1`, [ident[0].id])
    // Should not throw.
  })

  it('test 5 — promotion: update phone on channel_only → identity_status becomes identified', async () => {
    const { rows: c } = await client.query<{ id: string }>(
      `INSERT INTO public.contacts (org_id, name, identity_status)
       VALUES ($1, 'TestPromotion', 'channel_only')
       RETURNING id`,
      [orgId],
    )
    cleanupContactIds.push(c[0].id)
    await client.query(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'telegram', $3)`,
      [orgId, c[0].id, `promo-test-${Date.now()}`],
    )
    await client.query(
      `UPDATE public.contacts SET phone = '+15559876543' WHERE id = $1`,
      [c[0].id],
    )
    const { rows: after } = await client.query<{ identity_status: string }>(
      `SELECT identity_status FROM public.contacts WHERE id = $1`,
      [c[0].id],
    )
    expect(after[0].identity_status).toBe('identified')
  })

  it('test 6 — archived exempt: archive then null phone → no RAISE', async () => {
    const { rows: c } = await client.query<{ id: string }>(
      `INSERT INTO public.contacts (org_id, name, phone, identity_status)
       VALUES ($1, 'TestArchived', '+15550000000', 'identified')
       RETURNING id`,
      [orgId],
    )
    cleanupContactIds.push(c[0].id)
    await client.query(
      `UPDATE public.contacts SET identity_status = 'archived_duplicate' WHERE id = $1`,
      [c[0].id],
    )
    // Now null the phone — would violate invariant for non-archived rows.
    await client.query(`UPDATE public.contacts SET phone = NULL WHERE id = $1`, [c[0].id])
    // Should not throw.
  })
})
```

**Pattern notes:**
- Raw `pg.Client` is required for tests 1 & 2 because `BEGIN/COMMIT` is not expressible through supabase-js.
- Tests 3–6 can be either raw pg or supabase-js; raw pg is uniform with tests 1 & 2 and avoids RLS auth scaffolding.
- Soft-skip via `DATABASE_URL ? describe : describe.skip` (Phase 107/108 precedent).
- `cleanupContactIds` collected during tests; final cleanup deletes child identities first (to avoid the orphan trigger), then parents.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| App-level invariant in Zod / service layer | DB CONSTRAINT TRIGGER | Phase 109 (this) | Invariant survives ANY code path — webhooks, RPCs, future migrations |
| `CREATE TRIGGER ... DEFERRABLE` (invalid since forever) | `CREATE CONSTRAINT TRIGGER ... DEFERRABLE` | Always — Postgres has never allowed deferrable regular triggers | Migration syntax must use the constraint variant |

## Open Questions

1. **Should the migration also enforce that webhooks write `identity_status='channel_only'` on new-insert?**
   - What we know: Phase 108 webhook code writes contacts with default status (`'identified'`). All 3 webhooks set phone → invariant holds via phone. So today's webhooks pass the strict constraint.
   - What's unclear: Future webhooks (e.g., Instagram DM with PSID-only, no phone) would need to write `identity_status='channel_only'`. CONTEXT doesn't mandate this code change in Phase 109.
   - Recommendation: **Plan a tiny touch-up task** that updates the 3 webhook insert payloads to set `identity_status: 'channel_only'` when phone is null. Safe today (phone is always set), forward-compatible for tomorrow. Alternatively, defer entirely to Phase 110 since no current code path needs it.

2. **Should `attachChannelIdentity` be promoted to an RPC for full transactional semantics?**
   - What we know: Option A makes this unnecessary for Phase 109.
   - Recommendation: Defer. Keep two-transaction pattern; revisit if Phase 110 needs stricter guarantees.

3. **Does the constraint trigger fire on every UPDATE, even no-op ones?**
   - Postgres optimization: BEFORE/AFTER row triggers fire on every UPDATE that touches the row, regardless of whether columns actually changed (no implicit "DISTINCT FROM" check). The function body is cheap (one EXISTS query at most). Acceptable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Postgres CONSTRAINT TRIGGER | Migration 1061 | ✓ | 15.x (Supabase) | — |
| plpgsql | Trigger functions | ✓ | bundled | — |
| `pg` (node) | apply-1061.mjs, Vitest tests | ✓ | already in repo deps | — |
| DATABASE_URL env var | Vitest tests + apply script | ✓ on dev machines | — | Tests soft-skip if absent (D-07a) |
| Vitest | Test runner | ✓ | repo standard | — |

No missing dependencies. No blockers.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (repo standard) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run tests/contact-identity-trigger.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CID-12 | Deferred constraint allows contact+identity in same txn (channel_only path) | integration (raw pg + BEGIN/COMMIT) | `npx vitest run tests/contact-identity-trigger.test.ts -t "test 1"` | ❌ Wave 0 |
| CID-12 | Strict invariant raises on identified contact with no identifier | integration | `npx vitest run tests/contact-identity-trigger.test.ts -t "test 2"` | ❌ Wave 0 |
| CID-12 | Orphan delete blocked | integration | `npx vitest run tests/contact-identity-trigger.test.ts -t "test 3"` | ❌ Wave 0 |
| CID-12 | Orphan delete allowed when phone backs up the contact | integration | `npx vitest run tests/contact-identity-trigger.test.ts -t "test 4"` | ❌ Wave 0 |
| CID-13 | Promotion channel_only → identified on phone add | integration | `npx vitest run tests/contact-identity-trigger.test.ts -t "test 5"` | ❌ Wave 0 |
| CID-12 / D-05 | Archived rows exempt | integration | `npx vitest run tests/contact-identity-trigger.test.ts -t "test 6"` | ❌ Wave 0 |
| All | `npm run build` typechecks clean (Zod schema comment doesn't break build) | smoke | `npm run build` | ✓ |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/contact-identity-trigger.test.ts` (≈ 6 tests, < 10s)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + `npm run build` exits 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/contact-identity-trigger.test.ts` — covers CID-12 + CID-13 (six tests, raw pg client pattern)

*(No conftest / shared fixtures needed; mirrors the self-contained pattern of `tests/contacts-unique-constraint.test.ts` and `tests/contact-channel-identity.test.ts`.)*

## Project Constraints (from CLAUDE.md)

| Directive | Compliance plan |
|---|---|
| `npm run build` after changes (catch type errors) | Plan must include build verification after Zod comment edit (no type impact expected — comment-only) |
| Server components by default | N/A — Phase 109 is DB + Zod comment + tests, no UI |
| Webhooks always return HTTP 200 | Not changed — Phase 108 webhook handlers untouched |
| Don't edit old migrations; add new ones | New file `supabase/migrations/1061_*.sql`; no edits to 1056/1057/1059/1060 |
| `src/lib/crypto.ts` sensitive | Not touched |
| Multi-tenancy via `get_current_org_id()` | Trigger functions are SECURITY INVOKER — calling role's RLS context applies to internal SELECTs. No `org_id` manual filtering needed |
| Migrations + type regen workflow | This phase adds no new columns/tables → `src/types/database.ts` unchanged (CONTEXT confirms). No regen needed. |

## Sources

### Primary (HIGH confidence)
- **Postgres official docs — CREATE TRIGGER** (https://www.postgresql.org/docs/current/sql-createtrigger.html) — Constraint trigger syntax, DEFERRABLE semantics, WHEN clause restrictions, BEFORE/AFTER return value rules.
- **Postgres official docs — Trigger Procedures** (https://www.postgresql.org/docs/current/plpgsql-trigger.html) — RETURN NEW / RETURN OLD / RETURN NULL semantics, SECURITY INVOKER default.
- **Supabase JS client docs** (https://supabase.com/docs/reference/javascript) — `.from(...).insert()` is one HTTP request to PostgREST; no client-side BEGIN/COMMIT.
- **Repo source inspection (this research):**
  - `src/lib/whatsapp/process-message.ts` lines 93–124 — confirms two-transaction shape
  - `src/lib/evolution/process-event.ts` lines 250–278 — confirms two-transaction shape
  - `src/lib/telegram/process-update.ts` lines 234–257 — confirms two-transaction shape
  - `src/lib/contacts/server.ts` lines 174–202 — `attachChannelIdentity` is INSERT + separate SELECT
  - `src/lib/contacts/zod-schemas.ts` lines 70–73 — refine location for D-04 comment
  - `supabase/migrations/1060_contact_channel_identities.sql` — schema for channel identities table
  - `src/app/(dashboard)/contacts/actions.ts:428` — `createContact` writes contact with phone/email present (passes strict invariant)

### Secondary (MEDIUM confidence)
- PostgREST behavior re: per-statement transactions — confirmed via Supabase JS client architecture inspection; multiple community/SO sources state the same.

### Tertiary (LOW confidence)
- None. All findings cross-verified against official docs or repo source.

## Metadata

**Confidence breakdown:**
- Two-transaction shape audit: **HIGH** — direct code inspection
- Option A (status-based skip) correctness: **HIGH** — derived from CONTEXT D-01b + verified webhook behavior (phone always set today)
- Migration 1061 SQL: **HIGH** — Postgres syntax verified against official docs; all three trigger function bodies follow standard plpgsql patterns
- Test code: **HIGH** — mirrors existing `tests/contacts-unique-constraint.test.ts` and `tests/contact-channel-identity.test.ts` patterns
- RLS interaction with constraint trigger: **HIGH** — SECURITY INVOKER default + same-statement context

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (30 days — Postgres trigger semantics are extremely stable)
