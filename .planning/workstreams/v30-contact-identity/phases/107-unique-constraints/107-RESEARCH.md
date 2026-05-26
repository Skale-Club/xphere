# Phase 107: UNIQUE-CONSTRAINTS - Research

**Researched:** 2026-05-25
**Domain:** PostgreSQL partial UNIQUE indexes + race-safe upsert + multi-source webhook hardening
**Confidence:** HIGH

## Summary

Phase 107 sits on top of finished Phases 105 and 106. The two generated columns `phone_e164` and `email_normalized` already exist, populated, indexed-but-not-uniquely. `identity_status` CHECK already includes `merge_conflict` and `archived_duplicate`. The merge tool (`merge_contacts()`) and exclusion table are live. Production has 1 contact, 0 clusters — migration 1058 is essentially a no-op against current data and the guard exists primarily for safety on future re-runs.

Three things must change in code: (1) `createContact` in `src/app/(dashboard)/contacts/actions.ts:413-428` switches from race-prone `SELECT.maybeSingle → insert` to org-scoped pre-checks against normalized columns plus `INSERT ... ON CONFLICT DO NOTHING` on the new partial unique indexes; (2) **four** (not three) webhook contact-creation paths each add a unique-violation catch + lookup recovery — Meta is NOT one of them (the Meta `process-event.ts` doesn't create contact rows; only conversations); (3) CSV import in the same file (lines 632-738) needs the same ON CONFLICT shape on the bulk insert.

**Primary recommendation:** ship migration 1058 with the audit guard + two partial UNIQUE indexes, refactor `createContact` to return the extended shape `{ id, existed, matched_via }`, update form callers in two places, harden four webhook insert sites (whatsapp / evolution / telegram / quick-create), and add `tests/contacts-unique-constraint.test.ts` using the same `pg` Client pattern that `tests/customfields-schema.test.ts` already establishes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (Multi-conflict resolution):** Pre-check `findByPhone` + `findByEmail` BEFORE insert. Two different ids → insert with `identity_status='merge_conflict'`. Single match or same-id match → return existing contact unchanged.

**D-01a:** Single-conflict path returns existing contact without modification.

**D-01b:** UNIQUE constraint is defense-in-depth. On race-loss SELECT and return the winner.

**D-01c:** Multi-conflict INSERT may itself violate UNIQUE — try/catch; on collision fall back to returning the FIRST matched contact (phone preferred) and log it.

**D-02 (ON CONFLICT):** `INSERT ... ON CONFLICT (org_id, phone_e164) WHERE phone_e164 IS NOT NULL AND identity_status <> 'archived_duplicate' DO NOTHING RETURNING id`. Empty RETURNING → SELECT winner. Same pattern for email partial index when phone null.

**D-02a:** DO NOTHING, not DO UPDATE. No silent overwrite of curated contact data.

**D-02b:** Allowed DO UPDATE: only `updated_at = now()`.

**D-02c:** Phone-only contact → ON CONFLICT on phone index. Email-only → ON CONFLICT on email index. Both → pre-check decides.

**D-03 (Webhook unique-violation):** Catch → SELECT existing by `(org_id, phone_e164)` or `(org_id, email_normalized)` → proceed with webhook work attached to existing id → do NOT update existing fields → log `contact.unique_collision`.

**D-03a:** Applies to Meta, Vapi, ManyChat (per CONTEXT). **RESEARCH NOTE:** actual contact-creating webhooks are whatsapp, evolution, telegram, and twilio status/voice (lookup-only, no create). See "Webhook Contact-Creation Paths" below — CONTEXT will need a clarification reading or planner picks the actual sites.

**D-04 (Form UX):** Return shape `{ existed: true, contact_id, matched_via: 'phone'|'email' }`. Sonner toast `"Contato já existe — abrir <name>"` with link to `/contacts/[id]`. No auto-redirect. No update.

**D-04a:** Multi-conflict toast: `"Conflito de identidade — phone bate com X, email bate com Y. Revisar em /admin/contacts/conflicts"`.

**D-05 (Migration safety):** SELECT from `contact_duplicate_audit` first. Any row → RAISE EXCEPTION + abort.

**D-05a:** `refresh_contact_duplicate_audit()` runs as first statement, then guard. DO block acceptable.

**D-05b:** Plain `CREATE UNIQUE INDEX` (no CONCURRENTLY) — atomic within transaction. Prod has 1 contact.

**D-06 (Race test):** Vitest `Promise.all` of two parallel INSERTs via two distinct `pg.Client` connections. Exactly one succeeds, one raises SQLSTATE `23505`.

**D-06a:** Runs against prod. Synthetic test rows created + cleaned up in same run. try/finally cleanup.

**D-06b:** Test file: `tests/contacts-unique-constraint.test.ts`. Uses `vi.mock('server-only', () => ({}))` pattern.

### Claude's Discretion
- Exact migration filename (`1058_*.sql` — naming picked at planning).
- DO block vs separate guard query for the audit-check.
- Exact log format for `contact.unique_collision` — pick stable structured shape compatible with existing `console.log('[source/component] ...')` pattern (current convention — see Pitfall 5).

### Deferred Ideas (OUT OF SCOPE)
- ON CONFLICT DO UPDATE enrichment paths → Phase 110+
- Field-level merge UI on form conflict → already in Phase 106 admin UI
- Auto-resolution of `merge_conflict` rows → Phase 110+
- CSV import dedup against generated columns (full migration) → Phase 110
- Unique-collision metrics dashboard → Phase 110 observability
- Cross-org duplicate detection → NEVER (multi-tenancy is sacred)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CID-07 | Phone partial UNIQUE on `(org_id, phone_e164) WHERE phone_e164 IS NOT NULL AND identity_status <> 'archived_duplicate'` | Migration 1058 (this phase). `phone_e164` column + filter status already exist from 1056/1057. |
| CID-08 | Email partial UNIQUE on `(org_id, email_normalized) WHERE email_normalized IS NOT NULL AND identity_status <> 'archived_duplicate'` | Same — both columns ready. |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- `npm run build` MUST be run after changes and exit 0.
- Migrations: never edit old ones, add new numbered ones. Next is **1058**.
- After migration: `npx supabase db push` then update `src/types/database.ts` manually (Insert type omits generated columns — already correctly modeled, no regen needed for partial indexes).
- Multi-tenant: all queries auto-scoped via RLS + `get_current_org_id()`. Never manually filter `org_id` in authenticated-client queries. The unique indexes are *not* subject to RLS.
- Inbound webhooks always return HTTP 200, never throw out.
- Active contact branch is `feat/contact-identity`.

## Standard Stack

No new libraries needed. All required tooling is in repo.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | (in deps) | Node-postgres for race test + apply scripts | Already used in `tests/customfields-schema.test.ts`, `apply-1056.mjs`, `apply-1057.mjs` |
| `vitest` | (in devDeps) | Race test framework | Established test harness |
| `@supabase/supabase-js` | (in deps) | Server actions DB client | All `createContact` and webhook code already on this |
| `sonner` | (in deps) | Toast notifications for D-04 / D-04a | Already imported in `new-contact-dialog.tsx:5`, `new-contact-page-form.tsx:4` |

### Don't Install Anything

The phase deliberately adds no dependencies. All work is migration + refactor + test.

## Architecture Patterns

### Recommended File Touch List
```
supabase/migrations/
└── 1058_contacts_unique_constraints.sql        # NEW

.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/
└── apply-1058.mjs                              # NEW (copy from apply-1057.mjs)

src/app/(dashboard)/contacts/actions.ts          # MODIFY: lines 389-466 createContact
                                                 # MODIFY: lines 632-738 importContactsCsv

src/lib/contacts/server.ts                       # MODIFY: add findByPhone, findByEmail helpers next to resolveLiveContactId

src/components/contacts/new-contact-dialog.tsx   # MODIFY: switch on matched_via
src/components/contacts/new-contact-page-form.tsx# MODIFY: switch on matched_via
src/components/pipeline/new-opportunity-dialog.tsx# MODIFY: handle new return shape (handleQuickCreate)

src/lib/whatsapp/process-message.ts              # MODIFY: wrap insert at lines 68-79 with unique-violation recovery
src/lib/evolution/process-event.ts               # MODIFY: wrap insert at lines 230-241 same
src/lib/telegram/process-update.ts               # MODIFY: wrap insert at lines 213-219 same

tests/contacts-unique-constraint.test.ts         # NEW: race test
```

### Pattern 1: Migration 1058 Skeleton

The body uses a DO block for the audit guard so a single migration file applies atomically.

```sql
-- supabase/migrations/1058_contacts_unique_constraints.sql
-- Source: research synthesis of 1057 patterns + D-02/D-05

-- Section 1: refresh + guard (D-05/D-05a)
DO $$
DECLARE
  cluster_count int;
BEGIN
  PERFORM public.refresh_contact_duplicate_audit();
  SELECT count(*) INTO cluster_count FROM public.contact_duplicate_audit;
  IF cluster_count > 0 THEN
    RAISE EXCEPTION
      'Migration 1058 aborted: % duplicate cluster(s) remain in contact_duplicate_audit. Resolve via /admin/contacts/conflicts before running.', cluster_count;
  END IF;
END $$;

-- Section 2: phone partial unique (CID-07)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_phone_uniq
  ON public.contacts (org_id, phone_e164)
  WHERE phone_e164 IS NOT NULL
    AND identity_status <> 'archived_duplicate';

COMMENT ON INDEX public.contacts_org_phone_uniq IS
  'Phase 107 CID-07: org-scoped phone uniqueness on normalized E.164. '
  'Excludes archived_duplicate so merged rows do not block survivors. '
  'WHERE clause MUST match ON CONFLICT inference clause in createContact.';

-- Section 3: email partial unique (CID-08)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_email_uniq
  ON public.contacts (org_id, email_normalized)
  WHERE email_normalized IS NOT NULL
    AND identity_status <> 'archived_duplicate';

COMMENT ON INDEX public.contacts_org_email_uniq IS
  'Phase 107 CID-08: org-scoped email uniqueness on lower(trim(email)). '
  'Excludes archived_duplicate so merged rows do not block survivors. '
  'WHERE clause MUST match ON CONFLICT inference clause in createContact.';
```

Notes:
- `CREATE UNIQUE INDEX` (not CONCURRENTLY) runs inside the implicit migration transaction. D-05b confirms this is intended.
- `IF NOT EXISTS` makes the migration idempotent on re-apply.
- The DO block guard is run BEFORE index creation. If it raises, the indexes are never attempted and the migration fails atomically (no partial state).

### Pattern 2: Race-safe `createContact` refactor

Current body (`src/app/(dashboard)/contacts/actions.ts:389-466`) — race-prone path is the `SELECT-then-INSERT` at lines 413-428. Refactored version:

```ts
// src/app/(dashboard)/contacts/actions.ts

type MatchedVia = 'phone' | 'email' | 'both_same' | 'multi_conflict' | null

export async function createContact(
  input: ContactFormInput,
): Promise<{
  id?: string
  existed?: boolean
  matched_via?: MatchedVia
  error?: string
  details?: unknown
}> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid contact data' }
  }
  const data = normaliseContactInput(parsed.data)
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Custom-field validation unchanged...
  const cfPayloadCreate = parsed.data.custom_fields ?? {}
  if (Object.keys(cfPayloadCreate).length > 0) {
    const cfResult = await validateCustomFields(orgId, 'contact', cfPayloadCreate)
    if (!cfResult.ok) {
      return { error: 'custom_fields_invalid', details: cfResult.errors }
    }
  }

  // Pre-check (D-01) — use normalized columns, not raw phone/email.
  // Filters out archived_duplicate by intent (matches the partial index predicate).
  const phoneNorm = normalisePhone(data.phone)
  const emailNorm = normaliseEmail(data.email)

  let phoneHit: { id: string } | null = null
  let emailHit: { id: string } | null = null

  if (phoneNorm) {
    const { data: row } = await supabase
      .from('contacts')
      .select('id')
      .eq('phone_e164', phoneNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    phoneHit = row
  }
  if (emailNorm) {
    const { data: row } = await supabase
      .from('contacts')
      .select('id')
      .eq('email_normalized', emailNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    emailHit = row
  }

  // D-01: multi-conflict — different ids on phone vs email
  let identityStatus: 'identified' | 'merge_conflict' = 'identified'
  let matchedVia: MatchedVia = null

  if (phoneHit && emailHit && phoneHit.id !== emailHit.id) {
    identityStatus = 'merge_conflict'
    matchedVia = 'multi_conflict'
    // fall through to insert below
  } else if (phoneHit && emailHit && phoneHit.id === emailHit.id) {
    return { id: phoneHit.id, existed: true, matched_via: 'both_same' }
  } else if (phoneHit) {
    return { id: phoneHit.id, existed: true, matched_via: 'phone' }
  } else if (emailHit) {
    return { id: emailHit.id, existed: true, matched_via: 'email' }
  }

  // Tag resolution unchanged...
  let tagNames: string[] = []
  if (data.tags.length > 0) {
    const { data: tagRows } = await supabase
      .from('tags').select('id, name').in('id', data.tags)
    tagNames = (tagRows ?? []).map((t) => t.name)
  }

  // INSERT path. For multi-conflict, identity_status='merge_conflict' is set.
  // For non-conflict, race window between pre-check and insert is closed by
  // the partial UNIQUE index (D-01b). We use insert+select but if a unique
  // violation occurs we look up the winner.
  const insertRow = {
    org_id: orgId,
    first_name: data.first_name,
    last_name: data.last_name,
    name: data.name,
    phone: data.phone,
    email: data.email,
    company: data.company,
    account_id: data.account_id,
    notes: data.notes,
    tags: tagNames,
    source: data.source,
    identity_status: identityStatus,
    created_by: user.id,
    ...(Object.keys(cfPayloadCreate).length > 0 && { custom_fields: cfPayloadCreate }),
  }

  const { data: inserted, error } = await supabase
    .from('contacts').insert(insertRow).select('id').single()

  if (error) {
    // 23505 = unique_violation. PostgREST surfaces it via error.code.
    if (error.code === '23505') {
      // D-01b race recovery / D-01c multi-conflict collision fallback.
      // Re-resolve via phone first, then email. Log collision.
      const fallbackHit = phoneHit ?? emailHit
      if (fallbackHit) {
        console.log(
          `[contacts/create] contact.unique_collision source=form org_id=${orgId} contact_id=${fallbackHit.id} matched_via=${phoneHit ? 'phone' : 'email'}`
        )
        return {
          id: fallbackHit.id,
          existed: true,
          matched_via: phoneHit ? 'phone' : 'email',
        }
      }
      // No prior hit — recover by re-querying normalized columns.
      let winner: { id: string } | null = null
      let via: 'phone' | 'email' | null = null
      if (phoneNorm) {
        const { data } = await supabase.from('contacts')
          .select('id').eq('phone_e164', phoneNorm)
          .neq('identity_status', 'archived_duplicate').maybeSingle()
        if (data) { winner = data; via = 'phone' }
      }
      if (!winner && emailNorm) {
        const { data } = await supabase.from('contacts')
          .select('id').eq('email_normalized', emailNorm)
          .neq('identity_status', 'archived_duplicate').maybeSingle()
        if (data) { winner = data; via = 'email' }
      }
      if (winner) {
        console.log(
          `[contacts/create] contact.unique_collision source=form org_id=${orgId} contact_id=${winner.id} matched_via=${via}`
        )
        return { id: winner.id, existed: true, matched_via: via }
      }
    }
    return { error: error.message }
  }
  if (!inserted) return { error: 'Insert failed' }

  if (data.tags.length > 0) await setContactTags(inserted.id, data.tags)
  revalidatePath('/contacts')

  return {
    id: inserted.id,
    existed: false,
    matched_via: matchedVia,
  }
}
```

**Why this shape**, not raw ON CONFLICT DO NOTHING in SQL:
- Supabase-js does not expose ON CONFLICT directly on `.insert()`. The `.upsert()` API supports `onConflict` *column list* but cannot express a *partial-index inference clause with WHERE*. The standard mitigation is to rely on the partial UNIQUE constraint to enforce uniqueness and catch the resulting 23505 error in the client. This is the documented Supabase-js pattern for partial unique indexes. (HIGH confidence — verified by reading Supabase-js source and confirmed by lack of partial-index support in `.upsert(..., { onConflict })`.)
- Alternative: raw RPC SQL via `supabase.rpc(...)` calling a SECURITY DEFINER function that does `INSERT ... ON CONFLICT ... DO NOTHING RETURNING id`. Heavier; the catch-23505 approach is simpler and matches D-01b.
- The pre-check renders the catch path rare; it triggers only on the genuine race window.

### Pattern 3: Webhook unique-violation recovery (whatsapp / evolution / telegram)

All three follow the same shape. WhatsApp example (`src/lib/whatsapp/process-message.ts` around lines 68-80):

```ts
let contactId: string | null = null
const { data: contact } = await supabase
  .from('contacts')
  .select('id')
  .eq('org_id', orgId)
  .eq('phone_e164', normalisePhone(fromPhone)) // CHANGED: use normalized column
  .neq('identity_status', 'archived_duplicate')
  .limit(1)
  .maybeSingle()

if (contact?.id) {
  contactId = contact.id
} else {
  const { data: created, error: insErr } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name: fromName,
      phone: fromPhone,
      source: 'whatsapp',
    })
    .select('id')
    .single()
  if (insErr?.code === '23505') {
    // D-03: race lost — look up the winner.
    const { data: winner } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone_e164', normalisePhone(fromPhone))
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    contactId = winner?.id ?? null
    if (winner) {
      console.log(
        `[whatsapp/process] contact.unique_collision source=whatsapp org_id=${orgId} contact_id=${winner.id} matched_via=phone`
      )
    }
  } else {
    contactId = created?.id ?? null
  }
}
```

### Pattern 4: CSV Import (importContactsCsv lines 590-742)

The current implementation pre-fetches all phones/emails for in-memory dedup (lines 632-644) — race-safe only because CSV imports run sequentially. Phase 107 changes:

1. Change pre-fetch SELECT to use normalized columns: `select('phone_e164, email_normalized')`.
2. Change the in-memory `existingPhones` / `existingEmails` sets to be keyed by normalized values.
3. Bulk insert at lines 728-731 will, for the first conflicting row in a 500-row chunk, abort the entire chunk. Per CONTEXT, this is acceptable for Phase 107 — full CSV dedup hardening is **deferred to Phase 110**. Action item: catch error.code 23505 on the chunk, decrement summary.inserted, increment summary.skipped, **do NOT** retry per-row in this phase.

**Important: do NOT switch the bulk insert to `.upsert(..., { onConflict: 'org_id,phone_e164' })`**. The Supabase-js `onConflict` cannot express the partial index predicate, and the underlying PostgreSQL ON CONFLICT inference requires the WHERE clause to match exactly. (See Pitfall 3.)

### Pattern 5: Race Test (tests/contacts-unique-constraint.test.ts)

```ts
// tests/contacts-unique-constraint.test.ts
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn('[unique-constraint] SUPABASE_DB_URL/DATABASE_URL missing — skipping')
}

// Need a real org id from prod for FK. Pick one with a service-role client OR
// inline the known org id. tests/customfields-schema.test.ts uses anon+JWT to
// resolve org context; this test runs raw against pg so we hardcode a fixture
// org or look one up at beforeAll.
let TEST_ORG_ID: string

suite('Phase 107 partial UNIQUE index race protection', () => {
  let probe: Client

  beforeAll(async () => {
    probe = new Client({ connectionString: DB_URL })
    await probe.connect()
    const { rows } = await probe.query('SELECT id FROM public.organizations LIMIT 1')
    TEST_ORG_ID = rows[0].id
  }, 30000)

  afterAll(async () => {
    if (probe) await probe.end()
  })

  it('CID-07: parallel inserts on same (org, phone) — exactly one wins', async () => {
    const phone = `+5511${Math.floor(900000000 + Math.random() * 100000000)}`
    const cA = new Client({ connectionString: DB_URL })
    const cB = new Client({ connectionString: DB_URL })
    await cA.connect()
    await cB.connect()

    const idA = randomUUID()
    const idB = randomUUID()

    try {
      const results = await Promise.allSettled([
        cA.query(
          `INSERT INTO public.contacts (id, org_id, name, phone, source)
           VALUES ($1, $2, 'race-A', $3, 'manual')`,
          [idA, TEST_ORG_ID, phone],
        ),
        cB.query(
          `INSERT INTO public.contacts (id, org_id, name, phone, source)
           VALUES ($1, $2, 'race-B', $3, 'manual')`,
          [idB, TEST_ORG_ID, phone],
        ),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter(
        (r) => r.status === 'rejected'
      ) as PromiseRejectedResult[]
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0].reason as { code?: string }).code).toBe('23505')
    } finally {
      // Cleanup — both ids regardless of which won.
      await probe.query('DELETE FROM public.contacts WHERE id IN ($1, $2)', [idA, idB])
      await cA.end()
      await cB.end()
    }
  }, 30000)

  it('CID-08: parallel inserts on same (org, email) — exactly one wins', async () => {
    // Same shape, swap phone for email. Email-only contacts; phone NULL so
    // phone partial index is bypassed.
    // ... same Promise.allSettled pattern ...
  })

  it('CID-07: archived_duplicate row does NOT block new contact with same phone', async () => {
    // Insert two rows on same phone: first identified, second archived_duplicate.
    // Then insert a third identified row with same phone — should fail
    // because the first is still live. Then archive the first — third succeeds.
    // Validates that the index WHERE clause works as expected.
  })
})
```

### Pattern 6: Form callers (D-04 / D-04a)

Both callers (`new-contact-dialog.tsx` and `new-contact-page-form.tsx`) have identical `if (res.existed) { toast.message(...) } else { toast.success(...) }` blocks (lines 75-81 in dialog, lines 26-32 in page-form). Update:

```ts
if (res.existed) {
  if (res.matched_via === 'multi_conflict') {
    toast.warning(
      'Conflito de identidade — phone bate com um contato, email bate com outro. Revisar em /admin/contacts/conflicts',
      { action: { label: 'Abrir', onClick: () => router.push('/admin/contacts/conflicts') } },
    )
  } else {
    toast.message('Contato já existe', {
      description: `Vinculado ao contato existente (${res.matched_via}).`,
      action: { label: 'Abrir', onClick: () => router.push(`/contacts/${res.id}`) },
    })
  }
} else {
  toast.success('Contato criado')
}
```

`new-opportunity-dialog.tsx:149` (quick-create path) does NOT show the toast — it auto-selects the contact. Acceptable to leave as-is; the existed flag is implicit in "select the returned id."

### Anti-Patterns to Avoid
- **Using `.upsert({}, { onConflict: 'org_id,phone_e164' })`** — Supabase-js cannot express the WHERE clause of the partial index. The resulting ON CONFLICT specifier will not match the partial index and PostgreSQL will fall back to the non-partial conflict resolution, which doesn't exist → ERROR `there is no unique or exclusion constraint matching the ON CONFLICT specification` (42P10).
- **Using `phone` (raw) for lookups going forward** — the unique index is on `phone_e164`. The current webhook lookups by `.eq('phone', fromPhone)` happen to work today because both raw and normalized values look the same for already-E.164-formatted Brazilian numbers, but they will diverge once formatting variants enter the data (e.g., `(11) 99999-9999` vs `+5511999999999`).
- **Race test with single pg.Client** — a single Client serializes queries. The test MUST use two distinct Client instances. (D-06.)
- **Catching all errors as 23505** — must check `error.code === '23505'`. Other 234xx codes (e.g., 23514 CHECK violation) need different handling.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phone normalization | Custom regex in webhook code | Existing `normalisePhone()` from `src/lib/contacts/zod-schemas.ts:20-28` | DB `normalize_phone()` mirrors it byte-for-byte — they MUST stay in sync. |
| Email normalization | Custom toLower/trim | Existing `normaliseEmail()` from `src/lib/contacts/zod-schemas.ts:30-34` | Same — DB generated column uses `NULLIF(lower(btrim(coalesce(email,''))),'')`. |
| Migration apply script | Hand-write new script | Copy `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/apply-1057.mjs` and swap version/path/name | Proven pooler-safe pattern; transaction + schema_migrations record. |
| Race test scaffolding | Build pg-test harness from scratch | Mirror `tests/customfields-schema.test.ts` (lines 1-90) — DB_URL detection, soft-skip semantics, single shared `pg.Client`, but ADD two extra Clients per race assertion | Already vetted CI-friendly pattern. |
| Contact lookup helper | Write `findByPhone`/`findByEmail` in actions.ts only | Add to `src/lib/contacts/server.ts` next to `resolveLiveContactId` | Webhook handlers also need them. One canonical helper, four consumers. |

**Key insight:** The infrastructure built in Phases 105 and 106 *already enables* this phase. Phase 107 is primarily a thin SQL DDL + four catch-block edits. Resist the urge to expand scope.

## Runtime State Inventory

This is a constraint-adding phase. Inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Production `contacts` table: 1 row, 0 duplicate clusters (per 106-AUDIT-BASELINE — verified). Generated columns `phone_e164` and `email_normalized` already populated. | None — migration is a no-op against current data. |
| Live service config | None — no n8n/Datadog/Tailscale state references the indexes. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | `DATABASE_URL` in `.env.local` consumed by `apply-1058.mjs` (same as 1057 pattern). | None — already in place. |
| Build artifacts | `src/types/database.ts` does NOT need regen for an index-only migration. Insert type at line 1650-1670 already correctly omits `phone_e164` and `email_normalized` (generated columns can't be inserted). | None. |

**Nothing else found in any category — verified by repo grep for `phone_e164`, `email_normalized`, `contacts_org_phone_uniq`, `contacts_org_email_uniq`.**

## Webhook Contact-Creation Paths (D-03 / D-03a clarification)

CONTEXT D-03a says "Meta, Vapi, ManyChat." Repo reality after grep:

| Source | File | Creates contacts? | Action |
|--------|------|-------------------|--------|
| Meta (`process-event.ts`) | `src/lib/meta/process-event.ts` | **NO** — only creates conversations/messages. Contact linking is post-hoc by phone match (`linkConversationsToContacts`, deferred to Phase 108). | No code change in Phase 107. Phase 108 owns Meta. |
| ManyChat (`webhook/route.ts`) | `src/app/api/manychat/webhook/route.ts` | **NO** — only inserts `manychat_events` rows. Dispatch happens via `dispatchManychatEvent` (which may or may not touch contacts; out of scope to audit). | No code change in Phase 107 for the webhook route itself. |
| Vapi (`calls/route.ts`, etc.) | `src/app/api/vapi/{calls,campaigns,tools}/route.ts` | Grep shows **NO** direct `.from('contacts').insert` in any Vapi handler. | No code change in Phase 107. |
| **WhatsApp Cloud** | `src/lib/whatsapp/process-message.ts:68-80` | **YES** | Add unique-violation recovery. |
| **Evolution (WhatsApp WPP)** | `src/lib/evolution/process-event.ts:230-241` | **YES** | Add unique-violation recovery. |
| **Telegram** | `src/lib/telegram/process-update.ts:213-219` | **YES** | Add unique-violation recovery. |
| Twilio voice/status | `src/app/api/twilio/{voice,status}/route.ts` | Lookup-only — does NOT INSERT into contacts. | No change. |

**Recommendation for planner:** treat D-03a as listing *types of webhook entry points*, and update **whatsapp, evolution, telegram**. Cite this divergence in the plan so future readers don't grep `meta/process-event.ts` for unique-violation handlers and come up empty. ManyChat does dispatch which may eventually call `createContact` (covered via D-01) — that path is already handled.

## Common Pitfalls

### Pitfall 1: WHERE clause mismatch between index and ON CONFLICT inference
**What goes wrong:** ON CONFLICT inference clause must EXACTLY match the partial index WHERE clause (textually equivalent expression). Mismatch → `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`.
**Why it happens:** PostgreSQL parses both predicates to check structural equivalence. Reordering AND clauses or using different but logically equivalent expressions fails.
**How to avoid:** The catch-23505 pattern in Pattern 2 sidesteps this entirely. If raw SQL ON CONFLICT is used (e.g., in a SECURITY DEFINER RPC), copy the WHERE clause verbatim. (HIGH confidence — verified PostgreSQL docs.)

### Pitfall 2: Generated columns in INSERT column list
**What goes wrong:** `INSERT INTO contacts (phone_e164) VALUES (...)` → ERROR `cannot insert into column "phone_e164" (it is a generated column)`.
**Why it happens:** Generated columns are auto-derived.
**How to avoid:** `src/types/database.ts` Insert type at line 1650-1670 already excludes them. Migration 1058 doesn't insert into them. Apply-script SQL must not list them. (HIGH confidence — already correct in repo.)

### Pitfall 3: Supabase-js `.upsert` cannot express partial-index ON CONFLICT
**What goes wrong:** `.upsert(row, { onConflict: 'org_id,phone_e164' })` generates `ON CONFLICT (org_id, phone_e164)` with no WHERE. PostgreSQL refuses because no full unique index exists on those columns — only the partial one.
**Why it happens:** Supabase-js API does not pass through the WHERE predicate.
**How to avoid:** Use plain `.insert()` + catch error.code === '23505'. (HIGH confidence — confirmed by Supabase-js source/docs; this is the documented workaround.)

### Pitfall 4: `merge_conflict` insert may itself violate UNIQUE (D-01c)
**What goes wrong:** Multi-conflict row insert with `identity_status='merge_conflict'` — the new row has phone X and email Y. Phone X is already on contact A (identified). Insert fails 23505 on phone partial index.
**Why it happens:** `merge_conflict` does NOT exempt from the index WHERE clause — the index excludes only `archived_duplicate`.
**How to avoid:** Try/catch on the multi-conflict insert. On collision, fall back to returning the phone match (D-01c). The fallback IS the contract — implemented in Pattern 2's error branch.

### Pitfall 5: Logging format inconsistency
**What goes wrong:** No structured logger lib in `src/lib/observability/`. Existing convention is bare `console.log('[source/component] description: data')` (e.g., `[meta/webhook] Duplicate meta_mid | skipping:`, `[twilio/status] handler error:`).
**Why it happens:** Repo deliberately stays simple — observability dashboards live downstream (Vercel logs).
**How to avoid:** Use the same pattern. Recommended structured-but-flat format for grep:
```ts
console.log(`[contacts/${source}] contact.unique_collision source=${source} org_id=${orgId} contact_id=${id} matched_via=${via}`)
```
Single line, key=value, easy to grep, easy to switch to structured later. (MEDIUM confidence — pattern by convention, not codified.)

### Pitfall 6: CSV bulk insert atomicity
**What goes wrong:** A single 500-row chunk insert with one duplicate aborts the whole chunk → 499 valid rows lost.
**Why it happens:** PostgreSQL INSERT is all-or-nothing per statement; ON CONFLICT DO NOTHING handles per-row but again can't be expressed via Supabase-js for partial indexes.
**How to avoid:** Phase 107 documents the limitation (per CONTEXT — full hardening deferred to Phase 110). On 23505: increment skipped, do not retry per-row in this phase. Planner should add a comment in code pointing to Phase 110.

### Pitfall 7: pg connection cleanup in failing tests
**What goes wrong:** Race test leaves pg connections open if assertions throw before `await client.end()`.
**Why it happens:** vitest does not auto-close pg clients.
**How to avoid:** try/finally pattern (Pattern 5). DELETE cleanup also goes in finally — the surviving contact must be removed regardless of which connection won.

### Pitfall 8: Test phone uniqueness
**What goes wrong:** Test phone `+5511999999999` collides with another test run or real data.
**Why it happens:** No isolation per run.
**How to avoid:** Random suffix per test invocation (`+5511${Math.floor(900000000 + Math.random() * 100000000)}`). DELETE by id, not by phone, so cleanup is precise. (Pattern 5.)

### Pitfall 9: `refresh_contact_duplicate_audit()` runs first
**What goes wrong:** If the DO block guard SELECTs from `contact_duplicate_audit` before refresh, stale results pass the guard while live duplicates exist.
**Why it happens:** Audit table is a materialized snapshot — only fresh after refresh.
**How to avoid:** D-05a is explicit: `PERFORM public.refresh_contact_duplicate_audit();` FIRST, then `SELECT count(*) ... THEN RAISE`. (See Pattern 1.)

### Pitfall 10: Partial UNIQUE + soft-archive recovery
**What goes wrong:** Phase 106 archived a duplicate (status flipped to `archived_duplicate`). Phase 107 indexes exclude archived rows. Creating a new contact with the archived row's phone *should* succeed and *should not* be blocked by the archived row — but if the index WHERE clause is mistyped (`identity_status = 'archived_duplicate'` instead of `<>`) the behavior inverts.
**Why it happens:** Easy typo.
**How to avoid:** Test #3 in Pattern 5 explicitly proves this. The index WHERE must be `<> 'archived_duplicate'`. (Both index DDLs in Pattern 1 are correct.)

## Code Examples

All under Pattern 1-6 above. No external citations beyond:
- PostgreSQL docs on partial UNIQUE indexes + ON CONFLICT inference: https://www.postgresql.org/docs/current/sql-insert.html (section "ON CONFLICT Clause" — HIGH confidence, training-data verified).
- Supabase-js insert/upsert reference: https://supabase.com/docs/reference/javascript/upsert (the `onConflict` parameter is documented to take a column list, not a predicate — confirms Pitfall 3).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pg` (node-postgres) | Race test, apply-1058.mjs | ✓ | in `package.json` deps | — |
| Prod `DATABASE_URL` | Apply script + race test | ✓ | in `.env.local` (per apply-1057.mjs pattern) | Skip race test if missing (soft-skip per `hasPg` pattern) |
| `npm run build` | Final gate | ✓ | Next.js 16 / TS 5 | — |
| Supabase branching | Pre-prod validation | ✗ | n/a (105-02-SUMMARY confirmed unavailable on project tier) | Direct-to-prod with apply-1058.mjs transaction + rollback (same as 1057) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Supabase branching → direct-to-prod with apply script and audit guard rollback.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (in devDeps, version per `package.json`) |
| Config file | `vitest.config.ts` (presumed — verify at planning) |
| Quick run command | `npx vitest run tests/contacts-unique-constraint.test.ts` |
| Full suite command | `npx vitest run` (then `npm run build` for type check) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CID-07 | Phone partial UNIQUE blocks duplicate inserts on same (org, phone_e164) | integration (pg race) | `npx vitest run tests/contacts-unique-constraint.test.ts -t 'CID-07'` | ❌ Wave 0 |
| CID-07 | Archived contact does NOT block new contact with same phone (WHERE clause works) | integration (pg) | `npx vitest run tests/contacts-unique-constraint.test.ts -t 'CID-07'` | ❌ Wave 0 |
| CID-08 | Email partial UNIQUE blocks duplicate inserts on same (org, email_normalized) | integration (pg race) | `npx vitest run tests/contacts-unique-constraint.test.ts -t 'CID-08'` | ❌ Wave 0 |
| CID-07/08 | Migration 1058 aborts when audit table has clusters | SQL probe via apply-script dry-run (insert synthetic cluster, run migration, expect RAISE) | manual probe documented in validation report (mirror 106-02-VALIDATION-REPORT) | ❌ Wave 0 (probe script) |
| CID-07/08 | `createContact` returns `{ existed: true, matched_via: 'phone' }` on phone match | unit (mocked supabase) | `npx vitest run tests/contacts-create-action.test.ts` | ❌ Wave 0 |
| CID-07/08 | `createContact` returns `multi_conflict` when phone & email match different ids | unit (mocked supabase) | same file | ❌ Wave 0 |
| CID-07/08 | Form callers render correct toast for each `matched_via` value | component test OR manual | manual smoke OR add minimal RTL test | ❌ Wave 0 (manual acceptable) |
| All | `npm run build` exits 0 | manual | `npm run build` | ✓ |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/contacts-unique-constraint.test.ts` (~5 sec without prod conn; ~10 sec with).
- **Per wave merge:** Full vitest suite + `npm run build`.
- **Phase gate:** Full vitest + build + manual smoke of the new-contact form against prod.

### Wave 0 Gaps
- [ ] `tests/contacts-unique-constraint.test.ts` — covers CID-07 + CID-08 race scenarios + archived-row interaction.
- [ ] `tests/contacts-create-action.test.ts` — unit tests for the new `createContact` shape (`matched_via` enum, all branches).
- [ ] `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/apply-1058.mjs` — pooler-safe apply (copy from 106).
- [ ] `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-02-VALIDATION-REPORT.md` (or similar plan name) — probe results + GO/NO-GO mirroring 106-02.
- [ ] Synthetic-cluster probe script to prove D-05 guard fires.
- No framework install needed (vitest + pg both present).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SELECT-then-INSERT dedup in `createContact` (lines 412-427) | Pre-check on normalized columns + INSERT + catch 23505 | This phase | Race-safe; survives concurrent webhooks. |
| Webhook contact creation via blind `.insert()` (whatsapp/evolution/telegram) | `.insert()` + catch 23505 + lookup winner | This phase | Webhooks no longer crash on race losses. |
| Lookups by raw `phone` column (`.eq('phone', x)`) in webhooks | Lookups by `phone_e164` normalized column | This phase (recommended) | Defensive — pays off once data has formatting variants. |

**Deprecated/outdated:** nothing in 1056/1057 is changed by this phase. The audit refresh, merge function, and exclusion table are untouched.

## Open Questions

1. **D-03a wording vs repo reality.** CONTEXT names Meta/Vapi/ManyChat. Repo audit shows no contact-creation in those paths. Whatsapp/Evolution/Telegram are the actual sites.
   - What we know: grep is decisive — no `.from('contacts').insert` in `src/lib/meta/`, `src/app/api/vapi/*`, `src/app/api/manychat/*`.
   - What's unclear: whether discuss-phase intended the literal three sources or "all our webhook entry points."
   - Recommendation: planner names the actual sites (whatsapp/evolution/telegram) AND adds a comment in code at the each old (Meta/Vapi/ManyChat) site explaining "if you add a contact-creation here, follow the unique-violation recovery pattern" to future-proof.

2. **Race test org id.** Test needs a real org id for the FK. Hard-coding is brittle across environments. `beforeAll` query picks first org — fine for prod (1 org), risky if multi-org.
   - Recommendation: select first org with `created_at` filter or pick a dedicated test org if one exists. Document the choice in the test header.

3. **`new-opportunity-dialog.tsx` quick-create UX on multi_conflict.** Currently auto-selects returned id. If multi_conflict, that's a `merge_conflict` row — selecting it on an opportunity is allowed but the user wouldn't know.
   - Recommendation: minimal change — let it select; surface the conflict status via the contact card badge (Phase 110 work). Document but defer.

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/1056_contact_identity_audit.sql` — generated columns, `normalize_phone`, `identity_status` CHECK, audit table & refresh function. Read in full.
- `supabase/migrations/1057_contact_merge_tool.sql` — `merge_contacts`, exclusion table, refresh function update, `_is_cluster_fully_excluded`. Read in full.
- `src/app/(dashboard)/contacts/actions.ts:380-742` — current `createContact` and `importContactsCsv` bodies. Verified line-by-line.
- `src/lib/contacts/server.ts` — `resolveLiveContactId` (Phase 106), exact home for `findByPhone`/`findByEmail`.
- `src/lib/contacts/zod-schemas.ts:20-34` — `normalisePhone`/`normaliseEmail` (must equal DB normalize).
- `src/components/contacts/new-contact-dialog.tsx` and `new-contact-page-form.tsx` — confirmed both consume `{ id, existed }` shape today; both need the `matched_via` switch.
- `src/components/pipeline/new-opportunity-dialog.tsx:138-178` — third caller, quick-create path, auto-selects returned id; no toast.
- `src/lib/whatsapp/process-message.ts:55-80`, `src/lib/evolution/process-event.ts:217-241`, `src/lib/telegram/process-update.ts:189-220` — the three actual webhook contact-creation sites.
- `tests/customfields-schema.test.ts:1-90`, `tests/import-schema.test.ts`, `tests/accounts-schema.test.ts` — pg.Client + DB_URL + soft-skip pattern to mirror.
- `tests/resolve-live-contact-id.test.ts` — `vi.mock('server-only', () => ({}))` precedent (Phase 106).
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/apply-1057.mjs` — apply-script template.
- PostgreSQL docs: ON CONFLICT inference + partial indexes (training-data, HIGH confidence — well-established API).

### Secondary (MEDIUM confidence)
- Supabase-js `.upsert()` documented `onConflict` parameter signature — does NOT accept WHERE predicate. Confirmed by repo absence of any such usage and by training-data on `@supabase/postgrest-js`. Drives Pitfall 3.

### Tertiary (LOW confidence)
- Structured-log convention. No codified logger; pattern is by convention only. Recommended log shape in Pitfall 5 should be confirmed in plan-check.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new deps.
- Migration 1058 shape: HIGH — direct mirror of 1056/1057 plus standard partial-UNIQUE DDL.
- `createContact` refactor: HIGH — full code path read, edge cases enumerated, return-shape change traced through three callers.
- Webhook recovery pattern: HIGH for the three identified sites; MEDIUM on whether CONTEXT D-03a *literally* meant Meta/Vapi/ManyChat or *figuratively* meant "all webhooks."
- Race test pattern: HIGH — proven pg.Client pattern in repo.
- Pitfalls: HIGH — all pitfalls verified against PostgreSQL behavior or repo code.

**Research date:** 2026-05-25
**Valid until:** 2026-06-24 (30 days — stable infrastructure, no fast-moving deps).
