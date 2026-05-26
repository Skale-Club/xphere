# Phase 108: CHANNEL-IDENTITIES - Research

**Researched:** 2026-05-26
**Domain:** PostgreSQL table modeling for channel-keyed identity + lookup-first webhook pattern + Meta link-on-match write
**Confidence:** HIGH

## Summary

Phase 108 lands a single new table — `contact_channel_identities` — plus a backfill, plus a lookup-first pattern in three webhooks (whatsapp / evolution / telegram) plus a Meta `linkConversationsToContacts` write. The infrastructure is small and the prod data is empty (1 contact, 0 channel rows expected on backfill). The work is mostly thin: migration 1060 + one helper (`findByChannelIdentity`) + four code-edit sites + a manual type patch.

Three findings shape the plan more than CONTEXT anticipated:

1. **`linkConversationsToContacts` does NOT live in `src/lib/meta/process-event.ts`.** It lives in `src/app/(dashboard)/contacts/actions.ts:1020-1065` — it is a **server action**, not a webhook handler. It iterates conversations with `contact_id IS NULL`, matches by `visitor_phone` against `contacts.phone`, and sets `contact_id`. CONTEXT D-04 (and ROADMAP success #4) references `process-event.ts:945`; that file is 365 lines and contains no such function. The literal target file/line is wrong; the planner must point at `contacts/actions.ts:1020`.
2. **The conversation→channel mapping is `conversations.channel`, NOT `conversations.source`.** The `conversations` table uses `channel` (values `whatsapp`, `messenger`, `instagram`, `telegram`, `widget`) — verified in `src/types/database.ts:22` (`ConversationChannel`) and in `process-event.ts:54` (`channelType = payload.object === 'instagram' ? 'instagram' : 'messenger'`). `linkConversationsToContacts` does not currently select the channel — it must add it to its SELECT so it can write the right provider value to `contact_channel_identities`.
3. **All three webhook contact-creation sites already exist post-Phase 107 with 23505 recovery on phone.** Phase 108 only needs to (a) insert a `contact_channel_identities` row *after* contact id is resolved, with `ON CONFLICT DO NOTHING`, and (b) add a pre-lookup via `findByChannelIdentity(provider, external_id)` *before* the existing phone lookup. The webhook external_id values differ per provider (WhatsApp uses `fromPhone` or `fromJid`; Evolution uses `remoteJid`; Telegram uses `chatId`). See Webhook Identity Mapping table below.

**Primary recommendation:** ship migration 1060 with the table + backfill + deprecation comment, add `findByChannelIdentity` to `src/lib/contacts/server.ts` next to the Phase 107 helpers, retrofit the three webhook handlers to do lookup-first + write identity, update the **`contacts/actions.ts:1020` `linkConversationsToContacts` server action** (NOT `process-event.ts`) to write the identity row when it succeeds at linking, regen `src/types/database.ts` manually, and add SQL probes plus a vitest covering the lookup-first attach scenario.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (Provider Enum Scope):** CHECK constraint enumerates the wide enum now:
- `whatsapp`, `evolution`, `telegram`, `instagram`, `messenger`, `facebook`, `webchat`, `vapi`

**D-01a:** New providers later are a one-line `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT`. Listing planned providers now avoids N small migrations.

**D-02 (ROADMAP Success #5 Correction):** ROADMAP says "Vapi/ManyChat webhook contact creation paths updated to write channel identity." Wrong per Phase 107 — Vapi/ManyChat do NOT create contacts. The actual contact-creating webhooks are whatsapp/evolution/telegram. Phase 108 targets that trio plus the Meta link path.

**D-02a:** Vapi/ManyChat handlers OUT OF SCOPE for Phase 108. Future task if/when they need identity attribution.

**D-03 (Lookup-First Webhook Pattern):** Webhook handler flow:
1. Normalize phone/email if available.
2. `findByChannelIdentity(provider, external_id)` — if hit, return `(contact_id, channel_existed: true)`. Continue downstream.
3. Else: `findByPhone(org_id, phone_e164)` or `findByEmail(...)`. If hit, INSERT channel identity attaching to existing contact (idempotent on UNIQUE). Continue.
4. Else: INSERT new contact, then INSERT channel identity row.
5. All INSERTs wrap try/catch on 23505 — fall through to SELECT (Phase 107 pattern).

**D-03a:** Channel identity INSERT uses `ON CONFLICT (org_id, provider, external_id) DO NOTHING`. If conflict, SELECT existing row to recover.

**D-03b:** Concrete scenario: Lead messages on Instagram (creates contact with instagram identity), later texts on WhatsApp from a known phone — instead of duplicate, whatsapp identity attaches to existing Instagram-rooted contact.

**D-04 (Meta `linkConversationsToContacts` Integration):** When linking succeeds, also INSERT channel identity row for the conversation's source platform (`instagram` or `messenger` based on `conversation.source`). **RESEARCH NOTE:** the column is actually `conversations.channel`, and the function lives in `src/app/(dashboard)/contacts/actions.ts:1020`, NOT in `src/lib/meta/process-event.ts:945`. See Open Question #1.

**D-04a:** This is the only place Meta touches channel identities in Phase 108. Meta inbound webhooks (`/api/meta/`) do NOT create contacts in this phase.

**D-05 (contacts.source Deprecation):** Keep column for now. Three changes:
1. `COMMENT ON COLUMN contacts.source IS 'DEPRECATED Phase 108 — use contact_channel_identities. Removal in Phase 110.'`
2. Continue writing source on contact creation (back-compat).
3. App code reading source for channel-aware logic should switch to `contact_channel_identities` lookups. Migration tracking call sites is a Phase 108 task. **RESEARCH NOTE:** see Call Site Inventory below — no app code reads `contacts.source` for channel-aware behavior. Only display, CSV export/import, MCP filter, and list filter (`?source=`). No D-05 migration owed in this phase.

**D-05a:** Full removal happens in Phase 110.

**D-06 (Migration Safety):** No audit-guard needed. Backfill is `INSERT...SELECT` with `ON CONFLICT DO NOTHING`. In prod (0 channel rows expected), backfill is no-op.

**D-07 (Type Regen Strategy):** Manual patch to `src/types/database.ts` (CLI/MCP blocked). Add `contact_channel_identities` table type + `ChannelProvider` exported type matching the CHECK enum.

### Claude's Discretion

- Exact migration filename (`1060_*.sql`).
- Index strategy on `contact_channel_identities (contact_id)` for reverse lookup (recommended **yes**, also `(org_id, provider)` for analytics — recommended **defer**, not needed by Phase 108 code paths).
- Whether `findByChannelIdentity` is a separate file or in `src/lib/contacts/server.ts` (recommend **same file** as Phase 107 helpers — already established convention).
- Specific call sites in app code reading `contacts.source` for channel logic — enumerated below (none qualify for forced migration).

### Deferred Ideas (OUT OF SCOPE)

- Identity invariant trigger — Phase 109
- `contacts.source` column drop — Phase 110
- Verified state on channel identity — Phase 110
- UI surfacing (channel badges, filter) — Phase 110
- Vapi/ManyChat channel identity writes — future
- Bulk reassign across contacts — future
- Channel identity audit log — future
- `/api/meta/` direct inbound contact creation — currently doesn't create contacts; not in Phase 108

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CID-09 | `contact_channel_identities` table with `(id, org_id, contact_id, provider, external_id, created_at)`, UNIQUE `(org_id, provider, external_id)`, CHECK on provider enum, FK to contacts ON DELETE CASCADE, RLS scoped to `get_current_org_id()` | Migration 1060 below (Pattern 1). Mirrors 1057 `contact_merge_log` RLS shape. |
| CID-10 | Migration + backfill from `contacts WHERE source IN (channel_sources) AND external_id IS NOT NULL`. Idempotent via `ON CONFLICT DO NOTHING`. Deprecation comment on `contacts.source`. | Pattern 1, Section 5. Prod is 0 rows — no-op. |
| CID-11 | Webhook integration: lookup-first + write identity in whatsapp/evolution/telegram. Meta `linkConversationsToContacts` writes identity on link. | Pattern 2 (helper), Pattern 3 (webhook retrofit), Pattern 4 (Meta link). |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- `npm run build` MUST exit 0 after changes (catches type errors before finish).
- Migrations: never edit old ones; add new numbered ones. Next is **1060** (1056, 1057, 1058 mcp_oauth, 1059 unique constraints all landed).
- After migration: `npx supabase db push` then manually update `src/types/database.ts`.
- Multi-tenant: all queries auto-scoped via RLS + `get_current_org_id()`. Never manually filter `org_id` in authenticated-client queries. New table's `INSERT` and `SELECT` policies use the same predicate.
- Inbound webhooks always return HTTP 200, never throw out.
- Server-only code uses `import 'server-only'` (see `src/lib/contacts/server.ts:1`).
- `vi.mock('server-only', () => ({}))` at top of vitest tests targeting server modules.

## Standard Stack

No new libraries needed. Phase 108 is pure migration + helper + retrofit. All required tooling is already in repo and active in Phases 105–107.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | in deps | Node-postgres for apply-1060.mjs + SQL probes | Used in `apply-105{6,7,9}.mjs`, race tests |
| `vitest` | in devDeps | Lookup-first test | Established harness, `vi.mock('server-only')` precedent |
| `@supabase/supabase-js` | in deps | Server actions + webhook DB client | All target code already uses it |

### Don't Install Anything

Phase 108 deliberately adds no dependencies.

## Architecture Patterns

### Recommended File Touch List

```
supabase/migrations/
└── 1060_contact_channel_identities.sql               # NEW

.planning/workstreams/v30-contact-identity/phases/108-channel-identities/
└── apply-1060.mjs                                    # NEW (copy apply-1059.mjs)

src/lib/contacts/server.ts                            # MODIFY: add findByChannelIdentity helper next to findByPhone/findByEmail
                                                       #         + add channelProviderForChannel helper (conversations.channel → provider)
                                                       #         + add attachChannelIdentity helper (insert + 23505 recovery)

src/lib/whatsapp/process-message.ts                   # MODIFY: lookup-first + write identity. Provider = 'whatsapp' or 'evolution' depending on msg.provider field
src/lib/evolution/process-event.ts                    # MODIFY: lookup-first + write identity. Provider = 'evolution'
src/lib/telegram/process-update.ts                    # MODIFY: lookup-first + write identity. Provider = 'telegram'

src/app/(dashboard)/contacts/actions.ts               # MODIFY: linkConversationsToContacts (lines 1020-1065) writes channel identity row on every successful link
                                                       #         + import attachChannelIdentity from '@/lib/contacts/server'

src/types/database.ts                                 # MODIFY: add ChannelProvider type after ContactIdentityStatus (~line 38)
                                                       #         + contact_channel_identities table block (Row/Insert/Update/Relationships)

tests/contact-channel-identities.test.ts              # NEW: lookup-first attach scenario + UNIQUE + CHECK + RLS + cascade probes
```

### Pattern 1: Migration 1060 (READY-TO-USE SQL)

```sql
-- =============================================================================
-- Migration 1060: Contact Channel Identities (CID-09, CID-10)
--
-- Phase 108 of v3.0 Contact Identity workstream. Introduces the polymorphic
-- channel identity table so contacts can be reached on multiple providers
-- (whatsapp, evolution, telegram, instagram, messenger, facebook, webchat,
-- vapi) without duplicating contact rows.
--
-- Depends on:
--   * 1056 (contact_identity_audit) — identity_status, generated columns
--   * 1057 (contact_merge_tool) — RLS template (FOR SELECT/INSERT/UPDATE/DELETE
--     TO authenticated USING/WITH CHECK (org_id = (SELECT get_current_org_id())))
--   * 1059 (contacts_unique_constraints) — phone/email partial UNIQUEs
--
-- Scope (CID-09, CID-10):
--   * contact_channel_identities table + UNIQUE (org_id, provider, external_id)
--   * INDEX (contact_id) for reverse lookup (contact_id → identities)
--   * CHECK on provider enum (D-01 wide enum)
--   * RLS enabled with 4 policies scoped to get_current_org_id()
--   * Backfill INSERT...SELECT from contacts (idempotent ON CONFLICT DO NOTHING)
--   * COMMENT ON COLUMN contacts.source deprecation note (D-05)
--
-- NOT in scope: identity invariant trigger (Phase 109), source column drop
-- (Phase 110), verified state (Phase 110).
-- =============================================================================

-- ----- Section 1: contact_channel_identities table --------------------------

CREATE TABLE IF NOT EXISTS public.contact_channel_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id)       ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN (
    'whatsapp',
    'evolution',
    'telegram',
    'instagram',
    'messenger',
    'facebook',
    'webchat',
    'vapi'
  )),
  external_id  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, external_id)
);

-- Reverse-lookup index: contact_id → identities (Phase 109 invariant trigger,
-- Phase 110 UI surfacing, and the link-on-match path all read this direction).
CREATE INDEX IF NOT EXISTS idx_cci_contact_id
  ON public.contact_channel_identities (contact_id);

COMMENT ON TABLE public.contact_channel_identities IS
  'Channel-keyed identity for contacts. One contact can have many rows '
  '(one per provider + external_id). UNIQUE (org_id, provider, external_id) '
  'enforces no two contacts share the same channel identity within an org.';

COMMENT ON COLUMN public.contact_channel_identities.provider IS
  'Channel provider enum (Phase 108 D-01 wide enum). Adding a new provider '
  'requires DROP CONSTRAINT + ADD CONSTRAINT — keep ordering stable.';

COMMENT ON COLUMN public.contact_channel_identities.external_id IS
  'Provider-specific identifier. Shape varies: WhatsApp wa_id (digits, no +), '
  'Evolution remoteJid (e.g. "5511...@s.whatsapp.net"), Telegram chat_id '
  '(signed integer as string), Instagram/Messenger PSID, Vapi caller phone.';

-- ----- Section 2: RLS enable + 4 policies (mirrors 1057 template) -----------

ALTER TABLE public.contact_channel_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_channel_identities_select
  ON public.contact_channel_identities
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_channel_identities_insert
  ON public.contact_channel_identities
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_channel_identities_update
  ON public.contact_channel_identities
  FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_channel_identities_delete
  ON public.contact_channel_identities
  FOR DELETE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ----- Section 3: Backfill (D-06 idempotent, prod no-op) --------------------
-- Maps contacts.source values to provider values. Only the four channel-style
-- sources qualify; 'manual', 'sms', 'csv_import', 'ghl_sync' have no channel
-- identity. Cast source::text because ContactSource is a TS enum but stored
-- as text in SQL (no native pg enum). All four legal source values are also
-- valid provider values, so the cast is identity-preserving.

INSERT INTO public.contact_channel_identities
  (org_id, contact_id, provider, external_id, created_at)
SELECT
  c.org_id,
  c.id,
  c.source::text,
  c.external_id,
  c.created_at
FROM public.contacts c
WHERE c.source IN ('instagram','whatsapp','facebook','messenger')
  AND c.external_id IS NOT NULL
ON CONFLICT (org_id, provider, external_id) DO NOTHING;

-- ----- Section 4: contacts.source deprecation comment (D-05) ----------------

COMMENT ON COLUMN public.contacts.source IS
  'DEPRECATED Phase 108 — channel attribution lives in contact_channel_identities. '
  'Column retained through Phase 109 for back-compat; will be dropped in Phase 110. '
  'Continue writing on insert for now; new app code SHOULD lookup via '
  'contact_channel_identities instead.';
```

### Pattern 2: `findByChannelIdentity` + helpers (additions to `src/lib/contacts/server.ts`)

Mirror the `findByPhone` shape exactly. Plus add a tiny helper to translate `conversations.channel` enum to channel `provider` enum (`messenger`/`instagram`/`whatsapp`/`telegram`/`widget` → `messenger`/`instagram`/`whatsapp`/`telegram`/`webchat`), and an `attachChannelIdentity` write helper that webhook + link paths reuse.

```ts
// src/lib/contacts/server.ts (additions)

import type { Database, ContactIdentityStatus } from '@/types/database'
// ChannelProvider new export — added in src/types/database.ts patch.
import type { ChannelProvider } from '@/types/database'

/**
 * Look up a live contact by channel identity (Phase 108 CID-11).
 *
 * Lookup-first webhook pattern (D-03): call BEFORE phone/email lookup.
 * Resolves through merged_into_contact_id chain so callers always get the
 * live survivor id even if the identity row points at an archived contact.
 *
 * Returns null if no identity row matches.
 */
export async function findByChannelIdentity(
  supabase: SupabaseClient<Database>,
  orgId: string,
  provider: ChannelProvider,
  externalId: string,
): Promise<
  | {
      contact_id: string
      identity_status: ContactIdentityStatus
      merged_into_contact_id: string | null
    }
  | null
> {
  if (!externalId) return null
  const { data: identity } = await supabase
    .from('contact_channel_identities')
    .select('contact_id')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .eq('external_id', externalId)
    .maybeSingle()
  if (!identity) return null

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, identity_status, merged_into_contact_id')
    .eq('id', identity.contact_id)
    .maybeSingle()
  if (!contact) return null

  // Resolve through merged_into chain (defensive — chain depth > 1 prevented
  // by merge_contacts() guards in 1057, but follow once for safety).
  if (
    contact.identity_status === 'archived_duplicate' &&
    contact.merged_into_contact_id
  ) {
    const { data: live } = await supabase
      .from('contacts')
      .select('id, identity_status, merged_into_contact_id')
      .eq('id', contact.merged_into_contact_id)
      .maybeSingle()
    if (live) {
      return {
        contact_id: live.id,
        identity_status: live.identity_status,
        merged_into_contact_id: live.merged_into_contact_id,
      }
    }
  }

  return {
    contact_id: contact.id,
    identity_status: contact.identity_status,
    merged_into_contact_id: contact.merged_into_contact_id,
  }
}

/**
 * Insert a channel identity row attaching the contact. Idempotent on the
 * UNIQUE (org_id, provider, external_id) constraint — duplicate INSERT is
 * a no-op (recovers existing row by SELECT). Returns the resolved
 * (contact_id) for the (provider, external_id) pair regardless of insert vs.
 * conflict path.
 *
 * Callers: lookup-first webhook handlers (whatsapp/evolution/telegram) and
 * the linkConversationsToContacts server action.
 */
export async function attachChannelIdentity(
  supabase: SupabaseClient<Database>,
  orgId: string,
  contactId: string,
  provider: ChannelProvider,
  externalId: string,
): Promise<{ contact_id: string } | null> {
  if (!externalId || !contactId) return null
  const { error } = await supabase
    .from('contact_channel_identities')
    .insert({ org_id: orgId, contact_id: contactId, provider, external_id: externalId })
  if (error && error.code !== '23505') {
    console.error(
      `[contacts/attachChannelIdentity] insert failed provider=${provider} external_id=${externalId}: ${error.message}`,
    )
    return null
  }
  // On 23505 or success, the canonical row exists. Return the contact_id
  // pointed to by that row (may differ from `contactId` if another race
  // attached to a different contact — caller decides what to do).
  const { data } = await supabase
    .from('contact_channel_identities')
    .select('contact_id')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .eq('external_id', externalId)
    .maybeSingle()
  return data ? { contact_id: data.contact_id } : null
}
```

**Why the merged_into chain resolution lives in `findByChannelIdentity`, not the caller:** symmetry with `resolveLiveContactId` semantics. Webhook callers expect a live id to attach conversations/messages to; an archived survivor pointer would break downstream writes.

### Pattern 3: Webhook Retrofit (lookup-first + write identity)

All three follow the same shape. Insertion point is the existing `if (!existing) { ...contact-creation... }` block. Pseudocode (whatsapp shown — evolution/telegram mirror exactly with different provider/external_id mapping):

```ts
// src/lib/whatsapp/process-message.ts (around lines 55-103)

import { findByPhone, findByChannelIdentity, attachChannelIdentity } from '@/lib/contacts/server'

// Inside the else branch where no conversation exists:
let contactId: string | null = null

// D-03 step 2: channel identity lookup FIRST.
// For WhatsApp Cloud msg.provider='whatsapp', for Evolution-routed
// msg.provider='evolution'. Use msg.fromJid as external_id (it's the
// stable platform identifier — wa_id format).
// WhatsApp Cloud: msg.fromJid is the WhatsApp wa_id (digits only, no +).
// Evolution route: msg.fromJid is the JID ("55119...@s.whatsapp.net").
// Pick the provider AND the external_id from the message provider tag.
const channelProvider: ChannelProvider =
  msg.provider === 'evolution' ? 'evolution' : 'whatsapp'
const externalId = msg.fromJid  // already the stable per-provider ID
const channelHit = await findByChannelIdentity(supabase, orgId, channelProvider, externalId)
if (channelHit) {
  contactId = channelHit.contact_id
} else {
  // D-03 step 3: phone lookup (current Phase 107 logic).
  const phoneNorm = normalisePhone(fromPhone)
  const phoneHit = phoneNorm ? await findByPhone(supabase, orgId, fromPhone) : null
  if (phoneHit) {
    contactId = phoneHit.id
    // Attach channel identity to existing phone-rooted contact (D-03b scenario).
    await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
  } else {
    // D-03 step 4: insert new contact + identity row.
    const { data: created, error: insErr } = await supabase
      .from('contacts')
      .insert({ org_id: orgId, name: fromName, phone: fromPhone, source: 'whatsapp' })
      .select('id')
      .single()
    if (insErr?.code === '23505') {
      const winner = await findByPhone(supabase, orgId, fromPhone)
      contactId = winner?.id ?? null
      if (winner) {
        console.log(`[whatsapp/process] contact.unique_collision source=whatsapp org_id=${orgId} contact_id=${winner.id} matched_via=phone`)
      }
    } else if (insErr) {
      console.error('[whatsapp/process] insert contact error:', insErr.message)
    } else {
      contactId = created?.id ?? null
    }
    // Attach channel identity (covers both new-insert and 23505-recovery branches).
    if (contactId) {
      await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
    }
  }
}
```

**Note on `evolution` vs `whatsapp` provider value:** the WhatsApp module handles BOTH Cloud and Evolution routes (see existing `msg.provider === 'evolution'` branch at line 124). The provider value written to `contact_channel_identities` matches the source — Cloud routes write `'whatsapp'`, Evolution routes write `'evolution'`. Phase 108 keeps these distinct because Evolution `remoteJid` and Cloud `wa_id` use different formats (see Webhook Identity Mapping below) and a future fork or auth-domain split shouldn't break identity continuity.

**Why attach on phone-match path (D-03b):** the explicit value of this phase — Phase 108 lets identity flow attach to existing contacts on the *first* time we see them via that channel. Without the attach-on-match, the next reach via the same channel would re-do the phone lookup and not benefit from the cached channel→contact mapping.

### Pattern 4: `linkConversationsToContacts` Retrofit (D-04)

The function in `src/app/(dashboard)/contacts/actions.ts:1020-1065`. Key changes:

1. SELECT must include `channel` (and ideally `channel_metadata`) so we can derive the channel identity provider and external_id.
2. The conversation→provider mapping reuses `conversations.channel` directly when it matches a provider enum value (`whatsapp`, `messenger`, `instagram`, `telegram`). When `channel='widget'` map to `'webchat'`.
3. The external_id for the identity row is the conversation's `visitor_phone` for whatsapp/telegram (chat_id stored as phone), and **`channel_metadata.sender_jid`** (whatsapp) or the platform PSID (Instagram/Messenger). For Phase 108 we use a conservative shape: write `visitor_phone` as external_id for whatsapp/telegram (matches what the webhook handlers write), and skip the identity write for `messenger`/`instagram` if no PSID is available in `channel_metadata`.
4. Call `attachChannelIdentity` after the successful `UPDATE conversations SET contact_id`.

```ts
// src/app/(dashboard)/contacts/actions.ts:1020-1065 modified

import { attachChannelIdentity, resolveLiveContactId } from '@/lib/contacts/server'
import type { ChannelProvider } from '@/types/database'

const CHANNEL_TO_PROVIDER: Record<string, ChannelProvider> = {
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  messenger: 'messenger',
  instagram: 'instagram',
  widget: 'webchat',
}

export async function linkConversationsToContacts(): Promise<{ error?: string; linked?: number }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { data: convs, error: cErr } = await supabase
    .from('conversations')
    .select('id, visitor_phone, channel, channel_metadata, org_id')
    .is('contact_id', null)
    .not('visitor_phone', 'is', null)
  if (cErr) return { error: cErr.message }
  if (!convs || convs.length === 0) return { linked: 0 }

  const phones = [...new Set(convs.map((c) => normalisePhone(c.visitor_phone)).filter((p): p is string => Boolean(p)))]
  if (phones.length === 0) return { linked: 0 }

  // Note: continue using raw `phone` for the in-memory map (existing behavior).
  // Phase 110 work item — switch to phone_e164 here.
  const { data: contactRows } = await supabase
    .from('contacts').select('id, phone').in('phone', phones)
  const phoneToId = new Map<string, string>()
  for (const c of contactRows ?? []) {
    if (c.phone) phoneToId.set(c.phone, c.id)
  }

  let linked = 0
  for (const conv of convs) {
    const normalised = normalisePhone(conv.visitor_phone)
    if (!normalised) continue
    const contactId = phoneToId.get(normalised)
    if (!contactId) continue
    const liveContactId = await resolveLiveContactId(contactId)
    const { error } = await supabase
      .from('conversations').update({ contact_id: liveContactId }).eq('id', conv.id)
    if (!error) {
      linked++
      // D-04: write channel identity on successful link.
      const provider = CHANNEL_TO_PROVIDER[conv.channel]
      // Pick external_id: visitor_phone for phone-keyed channels; sender PSID
      // for Meta channels (skip if absent — Phase 108 conservative path).
      let externalId: string | null = null
      if (provider === 'whatsapp' || provider === 'telegram' || provider === 'webchat') {
        externalId = conv.visitor_phone
      } else if (provider === 'instagram' || provider === 'messenger') {
        const meta = conv.channel_metadata as Record<string, unknown> | null
        externalId = typeof meta?.sender_id === 'string' ? meta.sender_id : null
      }
      if (provider && externalId && conv.org_id) {
        await attachChannelIdentity(supabase, conv.org_id, liveContactId, provider, externalId)
      }
    }
  }
  revalidatePath('/contacts')
  return { linked }
}
```

### Pattern 5: TypeScript types regen (manual patch)

Two additions to `src/types/database.ts`:

```ts
// After ContactIdentityStatus (line ~38):

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

And inside `Database['public']['Tables']` (alphabetical insertion or after `contacts`):

```ts
contact_channel_identities: {
  Row: {
    id: string
    org_id: string
    contact_id: string
    provider: ChannelProvider
    external_id: string
    created_at: string
  }
  Insert: {
    id?: string
    org_id: string
    contact_id: string
    provider: ChannelProvider
    external_id: string
    created_at?: string
  }
  Update: {
    provider?: ChannelProvider
    external_id?: string
  }
  Relationships: [
    {
      foreignKeyName: 'contact_channel_identities_org_id_fkey'
      columns: ['org_id']
      isOneToOne: false
      referencedRelation: 'organizations'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'contact_channel_identities_contact_id_fkey'
      columns: ['contact_id']
      isOneToOne: false
      referencedRelation: 'contacts'
      referencedColumns: ['id']
    }
  ]
}
```

### Anti-Patterns to Avoid

- **Using `.upsert({}, { onConflict: 'org_id,provider,external_id' })` for the identity insert.** Works in theory (full UNIQUE, not partial), but `.upsert` overwrites the existing row's `contact_id` if there's a real conflict — silently re-pointing identities across contacts. Use `.insert()` + catch 23505 (Phase 107 pattern; identity dedup is not enrichment).
- **Auto-resolving the `merged_into` chain in the caller.** Centralized in `findByChannelIdentity` — callers should get a live id. Two implementations diverge.
- **Backfill without `ON CONFLICT DO NOTHING`.** Re-running migration 1060 on a half-applied state crashes. Idempotency is cheap; default it.
- **Conflating Evolution and WhatsApp Cloud as the same provider.** Different platforms; different external_id formats (wa_id digits vs. JID strings). Future migration to a single provider value would require data migration; cheap to keep distinct now.
- **Inserting identity row with empty external_id.** `text NOT NULL`; insert will fail. `attachChannelIdentity` guards `if (!externalId) return null`.

## Webhook Identity Mapping

| Webhook | File / Lines | Provider value | external_id source | Notes |
|---------|--------------|----------------|---------------------|-------|
| WhatsApp Cloud | `src/lib/whatsapp/process-message.ts:64-103` | `'whatsapp'` (when `msg.provider !== 'evolution'`) | `msg.fromJid` (wa_id, digits only) | Adapter is `WhatsAppAdapter`; `provider.id` is the Cloud number config |
| Evolution API | `src/lib/whatsapp/process-message.ts:64-103` (Evolution route) AND `src/lib/evolution/process-event.ts:218-262` | `'evolution'` | `msg.fromJid` / `m.key.remoteJid` (e.g. `"5511...@s.whatsapp.net"`) | Two entry points share types but both write `'evolution'` |
| Telegram | `src/lib/telegram/process-update.ts:197-243` | `'telegram'` | `chatId` = `String(msg.chat.id)` (signed int as string for groups, but webhook gates `msg.chat.type !== 'private'`) | Chat_id stored in `visitor_phone` today; `phone_e164` normalization happens to strip the `-` for groups but private chats are unsigned digits. Use chat_id as external_id; matches what `findByChannelIdentity` sees on subsequent reach |
| Meta `linkConversationsToContacts` | `src/app/(dashboard)/contacts/actions.ts:1020-1065` | `'whatsapp'` / `'telegram'` / `'webchat'` from `conversations.channel` directly; `'instagram'` / `'messenger'` derived | `visitor_phone` (whatsapp/telegram/webchat) OR `channel_metadata.sender_id` (instagram/messenger — skip if absent in Phase 108) | Not a webhook — runs as server action |

**Important:** the conversation processing path in WhatsApp/Evolution already reads `msg.fromJid` (whatsapp) and `m.key.remoteJid` (evolution) when populating `channel_metadata.sender_jid`. Reuse that exact value as `external_id` so the channel identity matches future inbound traffic byte-for-byte.

## `contacts.source` Call Site Inventory (D-05 follow-up)

Grep for `\.source` and `contacts.source` enumerates everywhere `contacts.source` is referenced. Filtered to actual contact-source reads (ignoring `flow-store`, `flow-canvas`, `flows/engine`, `flows/schema`, `flows/auto-layout`, `flows/ai-tools`, `workflows/run-flow-sync` — those `e.source` refs are React Flow edge nodes, NOT contacts):

| Site | Read pattern | Channel-aware? | Phase 108 action |
|------|--------------|----------------|------------------|
| `src/components/contacts/contact-detail-sheet.tsx:230` | Display: `` `source: ${contact.source}` `` | Display only | None — defer to Phase 110 UI |
| `src/components/chat/contact-info-panel.tsx:597` | Display | Display only | None — defer to Phase 110 UI |
| `src/components/contacts/contact-form.tsx:53` | Form default value | Form input | None — keep writing |
| `src/lib/mcp/tools/contacts.ts:25` | `q = q.eq('source', f.source)` filter | Filter, not channel logic | None — Phase 110 may switch |
| `src/lib/contacts/zod-schemas.ts:115` | Insert payload field | Write path | None — keep writing on insert (D-05 #2) |
| `src/app/(dashboard)/contacts/page.tsx:20` | URL searchParam `?source=...` | Filter | None |
| `src/app/(dashboard)/contacts/actions.ts:133` | `query.eq('source', f.source)` | Filter | None |
| `src/app/(dashboard)/contacts/actions.ts:495` | Insert payload | Write path | None |
| `src/app/(dashboard)/contacts/actions.ts:1112` | CSV export column | Export | None |
| `src/app/(admin)/admin/contacts/conflicts/_components/cluster-card.tsx:117` | Display in cluster card | Display only | None |

**Conclusion:** **no app code reads `contacts.source` for channel-aware behavior**. All reads are display, form, filter, or CSV. The deprecation comment is sufficient — no forced call-site migration owed in Phase 108. The unrelated `.source` matches (companies, accounts, flows) are out of scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Channel identity write | Custom upsert in each webhook | `attachChannelIdentity()` helper in `src/lib/contacts/server.ts` | One canonical implementation; 4 consumers (3 webhooks + Meta link) |
| Merged_into chain resolution | Per-caller resolution | `findByChannelIdentity` does it internally | Symmetric with `resolveLiveContactId`; webhooks always want live id |
| Provider enum source of truth | Hardcoded strings sprinkled | `ChannelProvider` type in `src/types/database.ts` | Matches CHECK constraint byte-for-byte; mistakes caught at compile time |
| Migration apply script | Hand-write | Copy `apply-1059.mjs` and swap version/path/name | Proven pooler-safe pattern; transaction + schema_migrations record |
| RLS policy template | Custom policy shape | Mirror `contact_merge_exclusions_*` in 1057 with the wider 4-policy set | Established Phase 106/107 pattern |
| Conversation→provider mapping | Inline switches | Single `CHANNEL_TO_PROVIDER` constant in `contacts/actions.ts` (Pattern 4) | Two places need the mapping (link path + future Phase 110 UI) |

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Production `contacts` table: 1 row. Per ROADMAP/Phase 107 audit baseline, 0 rows match `source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL` — backfill is a no-op. Production `conversations` table: not directly probed in this research, but `linkConversationsToContacts` is a manual admin action — running it after deploy is the operator's call. | None — migration is no-op against current data. |
| Live service config | None — no n8n / Datadog / Tailscale state references `contact_channel_identities`. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | `DATABASE_URL` in `.env.local` consumed by `apply-1060.mjs` (same as 1059). | None — already in place. |
| Build artifacts | `src/types/database.ts` requires manual patch (Pattern 5). Insert types in Supabase clients (used by webhook code) must allow the new table — confirmed by reading current shape at lines 1626-1715. | Manual patch is the required action. |

**Nothing else found — verified by repo grep for `contact_channel_identities`, `ChannelProvider`, and `attachChannelIdentity`.**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pg` (node-postgres) | `apply-1060.mjs` + SQL probes | ✓ | in `package.json` deps | — |
| Prod `DATABASE_URL` | Apply script + probes | ✓ | in `.env.local` (per `apply-1059.mjs` pattern) | Skip probes if missing (`hasPg` soft-skip pattern) |
| `npm run build` | Final gate | ✓ | Next.js 16 / TS 5 | — |
| Vitest | `tests/contact-channel-identities.test.ts` | ✓ | in devDeps | — |
| Supabase branching | Pre-prod validation | ✗ | not on project tier | Direct-to-prod with `apply-1060.mjs` transaction (mirror 1059) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Supabase branching → apply-script direct-to-prod.

## Common Pitfalls

### Pitfall 1: Telegram `chatId` vs `phone_e164` normalization
**What goes wrong:** Telegram `chatId` is a signed integer (negative for groups, but Phase 108 only handles private chats). Stored in `contacts.phone`, then `normalize_phone()` strips non-digits — works for private positive ints. Channel identity should use `chatId` as-is (a string), NOT the normalized phone, to avoid the empty-string edge case.
**Why it happens:** Two normalization domains (phone, chat_id) routed through the same column.
**How to avoid:** Write `external_id = String(msg.chat.id)` directly. Do NOT pass through `normalisePhone`. The phone column still gets the same value for back-compat. Verified: telegram webhook at lines 196-216 stores `chatId` in both `phone` and `visitor_phone`. (HIGH confidence — repo verified.)

### Pitfall 2: WhatsApp Cloud `wa_id` vs Evolution `remoteJid` divergence
**What goes wrong:** Cloud and Evolution share the WhatsApp module but have different external_id shapes. Cloud's `msg.fromJid` is the wa_id digits; Evolution's is the full JID `"55119...@s.whatsapp.net"`. If you write `'whatsapp'` for both, future reach on the other route mismatches.
**Why it happens:** Two providers, one module.
**How to avoid:** Use `msg.provider === 'evolution' ? 'evolution' : 'whatsapp'` for the provider enum value. Each provider has its own (provider, external_id) space — no cross-contamination. (HIGH confidence — repo verified at line 124 + types in `whatsapp/types.ts`.)

### Pitfall 3: `linkConversationsToContacts` does not have `conv.org_id` in current SELECT
**What goes wrong:** Pattern 4 calls `attachChannelIdentity(supabase, conv.org_id, ...)` — but the current SELECT at line 1030 is `select('id, visitor_phone')`. Without `org_id` the attach call fails or writes to the wrong org.
**Why it happens:** Easy oversight — the function used to rely on RLS scoping implicitly.
**How to avoid:** SELECT `id, visitor_phone, channel, channel_metadata, org_id` (Pattern 4 above). RLS still ensures only the active org's rows return, so `conv.org_id` will always be correct, but the helper needs the value passed explicitly.

### Pitfall 4: `archived_duplicate` contact gets a fresh channel identity
**What goes wrong:** Webhook fires for an archived contact (a duplicate). `findByChannelIdentity` resolves to the survivor via merged_into chain — good. But if the channel identity write inserts attaching to the archived contact id, future lookups still work (chain follows) but reverse-lookup queries (Phase 109+) see an attachment to an archived row.
**Why it happens:** The merged_into chain resolves on read, but the original identity row still points at the archived contact_id.
**How to avoid:** Phase 108 deliberately defers the strict invariant to Phase 109 (per CONTEXT D-03/deferred). Document the soft expectation: webhook handlers attach identity to the *resolved live contact_id*, not the archived one. The `findByChannelIdentity` chain resolution ensures live id is what callers see; new attaches use that live id. Existing identity rows pointing at archived contacts are healed by Phase 109's invariant trigger or a future bulk reassign tool. (MEDIUM confidence — relies on caller discipline; chain resolution in helper.)

### Pitfall 5: Provider enum and `contacts.source` enum drift
**What goes wrong:** `contacts.source` includes `'manual'`, `'sms'`, `'csv_import'`, `'ghl_sync'` — not in provider enum. Provider includes `'evolution'`, `'webchat'`, `'vapi'` — not in source. A naive backfill `INSERT ... SELECT source::text FROM contacts WHERE source IN (channel_sources)` filtered correctly catches only the 4-way overlap. Still: future code that translates between the two must not assume equivalence.
**Why it happens:** Two enums evolved separately.
**How to avoid:** Backfill explicitly enumerates the 4 channel-overlap values (Pattern 1 Section 3). No type-level translation in app code. The `CHANNEL_TO_PROVIDER` map in Pattern 4 starts from `conversations.channel`, not `contacts.source` — different domain.

### Pitfall 6: `INSERT ... ON CONFLICT (org_id, provider, external_id)` requires the full UNIQUE
**What goes wrong:** Unlike Phase 107's partial UNIQUE indexes, Phase 108 uses a FULL `UNIQUE (org_id, provider, external_id)` constraint inside the table definition. ON CONFLICT inference works with simple column lists for FULL uniques — no predicate matching headaches. The backfill `ON CONFLICT (org_id, provider, external_id) DO NOTHING` is well-formed.
**Why it happens:** Easy to mistakenly use the partial-index ON CONFLICT pattern from Phase 107 here.
**How to avoid:** This is a *full* UNIQUE constraint (declared on the table) — direct ON CONFLICT works. Phase 107's Pitfall 3 (Supabase-js can't express partial-index inference) does NOT apply here. (HIGH confidence — PostgreSQL docs.)

### Pitfall 7: Channel identity insert on phone-match path can fail if another contact already owns the identity
**What goes wrong:** Lead messages on WhatsApp, creates contact A + identity (whatsapp, 5511XXX). Lead's *colleague* later texts from the same WhatsApp account (e.g., shared business line). Phone matches contact A; identity write succeeds (already exists, ON CONFLICT no-op). But if the colleague *changes their phone* before reaching out, scenario inverts: phone doesn't match A, but identity exists pointing to A. The new contact-creation insert succeeds (new phone), but then identity attach fails with 23505 — caller has new contactId but identity row still points at A.
**Why it happens:** Identity uniqueness is global per (org, provider, external_id) — only one contact can own a given identity.
**How to avoid:** `attachChannelIdentity` (Pattern 2) returns the *actual* contact_id pointed to by the identity row after the insert attempt. Caller should compare: if returned contact_id differs from the one it tried to attach, log a `contact.identity_collision` event for analytics (Phase 110 dashboard). Continue downstream work attached to the contact that already owns the identity (it's the live mapping). For Phase 108 minimal scope: log and continue with the existing identity's contact_id. (MEDIUM confidence — rare edge case; documented for future Phase 110 work.)

### Pitfall 8: Backfill `created_at` preservation
**What goes wrong:** Backfill writes `created_at = c.created_at` — the contact's creation timestamp. This is desired (identity existed since the contact existed). But `DEFAULT now()` would silently override if backfill column list is wrong.
**Why it happens:** Defaulting now() loses provenance.
**How to avoid:** Explicit `created_at` in both column list and SELECT (Pattern 1 Section 3). (HIGH confidence — repo verified.)

## Code Examples

All patterns above (Pattern 1-5). External references:

- PostgreSQL docs on `ON CONFLICT` with FULL UNIQUE constraints: https://www.postgresql.org/docs/current/sql-insert.html (HIGH confidence — well-established).
- PostgreSQL docs on `COMMENT ON COLUMN`: https://www.postgresql.org/docs/current/sql-comment.html (HIGH confidence).
- Supabase RLS scoping with `(SELECT auth_helper())` subquery pattern: established in repo migrations 1056/1057 and verified working.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (in devDeps) |
| Config file | `vitest.config.ts` (presumed — verify at planning) |
| Quick run command | `npx vitest run tests/contact-channel-identities.test.ts` |
| Full suite command | `npx vitest run` followed by `npm run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CID-09 | UNIQUE (org_id, provider, external_id) — duplicate insert raises 23505 | SQL probe (vitest + pg) | `npx vitest run tests/contact-channel-identities.test.ts -t 'unique'` | ❌ Wave 0 |
| CID-09 | CHECK on provider — `'invalid'` raises 23514 | SQL probe | same file, `-t 'provider_check'` | ❌ Wave 0 |
| CID-09 | RLS — anon SELECT returns empty rowset | SQL probe via anon `supabase` client | same file, `-t 'rls_anon'` | ❌ Wave 0 |
| CID-09 | ON DELETE CASCADE — DELETE contact removes its identities | SQL probe | same file, `-t 'cascade'` | ❌ Wave 0 |
| CID-10 | Backfill idempotent — second run inserts 0 new rows | SQL probe (apply migration body twice; second is no-op) | manual via apply script, asserted in validation report | ❌ Wave 0 |
| CID-10 | Backfill respects `source IN (channel_sources) AND external_id IS NOT NULL` (insert synthetic contact, run backfill, assert exactly 1 identity row created) | SQL probe | same vitest file | ❌ Wave 0 |
| CID-11 | Lookup-first pattern: contact has phone-matched identity from prior whatsapp reach; new instagram reach with same phone attaches `instagram` identity to existing contact (D-03b scenario) | Integration test (vitest, mocked supabase OR real pg) | same vitest file, `-t 'attach_on_match'` | ❌ Wave 0 |
| CID-11 | `findByChannelIdentity` resolves merged_into chain to live contact | Unit (vitest with real or mocked supabase) | same file, `-t 'merged_chain'` | ❌ Wave 0 |
| All | `npm run build` exits 0 | manual | `npm run build` | ✓ |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/contact-channel-identities.test.ts` (~10s with prod conn, soft-skips without).
- **Per wave merge:** Full vitest suite + `npm run build`.
- **Phase gate:** Full vitest + build + manual probe of `linkConversationsToContacts` against a staging conversation (or document operational dry-run plan).

### Wave 0 Gaps

- [ ] `tests/contact-channel-identities.test.ts` — covers CID-09 (UNIQUE/CHECK/RLS/CASCADE), CID-10 (backfill idempotency), CID-11 (lookup-first attach).
- [ ] `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/apply-1060.mjs` — pooler-safe apply (copy from 1059).
- [ ] `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/108-VALIDATION-REPORT.md` — probe results + GO/NO-GO (mirror 107-05 final report shape).
- No framework install needed (vitest + pg both present).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Channel attribution via `contacts.source` (single value per contact) | `contact_channel_identities` rows (many per contact) | This phase | Same person reachable on multiple channels via the same contact id |
| Phone-only post-hoc linking in `linkConversationsToContacts` | Phone-linking + channel identity attach on every successful link | This phase | Future webhook reach via same channel hits cache directly |
| Webhook contact lookup: phone-only via `findByPhone` | Channel-identity-first via `findByChannelIdentity`, then phone fallback | This phase | Cross-channel identity continuity (D-03b) |

**Deprecated/outdated:**
- `contacts.source` — kept for back-compat through Phase 109; dropped in Phase 110 (D-05a). Comment added in this migration.
- The literal CONTEXT reference to `src/lib/meta/process-event.ts:945` — function does not live there. See Open Question #1.

## Open Questions

1. **Literal target file for `linkConversationsToContacts` is `src/app/(dashboard)/contacts/actions.ts:1020`, not `src/lib/meta/process-event.ts:945`.**
   - What we know: `process-event.ts` is 365 lines; no such function exists there. The function is a server action in `contacts/actions.ts:1020-1065` and does post-hoc phone matching.
   - What's unclear: whether discuss-phase intended a Meta-specific entry point that doesn't exist yet, or simply got the path wrong.
   - Recommendation: planner uses `src/app/(dashboard)/contacts/actions.ts:1020` (the real function) and adds a comment in code citing this divergence. ROADMAP success #4 should be reinterpreted as "wherever the live linkConversationsToContacts function is."

2. **Webhook reach via Evolution and WhatsApp Cloud for the SAME phone — should they share one channel identity?**
   - What we know: provider enum keeps them distinct; D-01 lists both. Same phone reachable on both routes will create 2 channel identity rows (different providers), both pointing at the same contact.
   - What's unclear: whether that's the desired model or whether `'evolution'` should be folded into `'whatsapp'`.
   - Recommendation: keep distinct (current plan). Future migration could collapse if business demands.

3. **`linkConversationsToContacts` for Meta channels with no PSID in `channel_metadata`.**
   - What we know: Pattern 4 conservatively skips identity write when `channel_metadata.sender_id` is absent.
   - What's unclear: whether existing prod conversations have PSID in metadata, or whether the Meta inbound path stores it under a different key.
   - Recommendation: planner inspects `src/lib/meta/process-event.ts` conversation insert (around line 140-200 not read in this research) to confirm the metadata key name. If absent, Phase 108 skips for Meta channels; covered in Phase 110.

4. **Should the webhook handler log when `findByChannelIdentity` returns a contact_id that differs from a concurrent `findByPhone` result?**
   - What we know: D-01 multi-conflict logic from Phase 107 covers phone-vs-email divergence at create time. Phase 108 doesn't add a similar identity-vs-phone divergence path.
   - What's unclear: how common cross-channel identity mismatches will be in prod.
   - Recommendation: defer to Phase 110 observability. Phase 108 keeps the simple "identity wins, phone fallback" hierarchy.

## Sources

### Primary (HIGH confidence)

- `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/108-CONTEXT.md` — D-01..D-07 locked decisions (read in full).
- `.planning/workstreams/v30-contact-identity/ROADMAP.md` — Phase 108 success criteria (read in full).
- `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-CONTEXT.md` — D-03a webhook target correction (inherited).
- `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-RESEARCH.md` — webhook handler locations + findByPhone/findByEmail signatures (read in full).
- `supabase/migrations/1056_contact_identity_audit.sql` — generated columns, identity_status CHECK, audit table (read in full).
- `supabase/migrations/1057_contact_merge_tool.sql` — RLS policy template, merge_log shape (read in full).
- `supabase/migrations/1059_contacts_unique_constraints.sql` — partial UNIQUE pattern, apply-script template (read in full).
- `src/lib/contacts/server.ts` — findByPhone/findByEmail/resolveLiveContactId signatures (read in full).
- `src/lib/whatsapp/process-message.ts` — current 23505-recovery contact-creation block at lines 64-103 (read in full).
- `src/lib/evolution/process-event.ts` — current 23505-recovery contact-creation block at lines 218-262 (read in full).
- `src/lib/telegram/process-update.ts` — current 23505-recovery contact-creation block at lines 197-243 (read in full).
- `src/lib/meta/process-event.ts` — verified does NOT contain `linkConversationsToContacts` (read offsets 1-80 and 250-365 — file is 365 lines).
- `src/app/(dashboard)/contacts/actions.ts:1020-1065` — actual `linkConversationsToContacts` implementation (read in full).
- `src/types/database.ts:1-60, 1600-1715` — ContactSource, ContactIdentityStatus, contacts table types (read for patch shape).
- Grep enumeration of `contacts.source` and `.from('contacts')` usage (60 matches reviewed; 10 contact-source reads classified).

### Secondary (MEDIUM confidence)

- Phase 109/110 plan implications for the `merged_into` chain and the strict identity invariant — inferred from CONTEXT deferred ideas. Not load-bearing for Phase 108.

### Tertiary (LOW confidence)

- Meta `channel_metadata.sender_id` key shape — assumed based on Meta webhook convention; not verified by reading the conversation INSERT path in `process-event.ts:140-250`. Resolved in Open Question #3.

## Metadata

**Confidence breakdown:**
- Migration 1060 shape: HIGH — direct mirror of 1056/1057 + standard UNIQUE table with backfill.
- `findByChannelIdentity` + `attachChannelIdentity` helpers: HIGH — mirror Phase 107 helpers + existing server.ts conventions.
- Webhook retrofit (whatsapp/evolution/telegram): HIGH — three sites read in full, exact insertion points known.
- `linkConversationsToContacts` retrofit: HIGH for the function body (read in full); MEDIUM on Meta `sender_id` metadata key (Open Question #3).
- Type regen: HIGH — pattern established in Phases 105/106/107.
- Pitfalls: HIGH for #1-3, #5, #6, #8; MEDIUM for #4 (Phase 109 dependency), #7 (edge case).

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (30 days — stable infrastructure).
