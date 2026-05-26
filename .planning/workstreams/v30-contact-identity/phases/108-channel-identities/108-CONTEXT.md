# Phase 108: CHANNEL-IDENTITIES - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Introduce `contact_channel_identities` table for channel-based identity (Instagram, Messenger, WhatsApp, Telegram, etc.). Migrate existing `contacts.source` + `external_id` data into it. Wire the 3 webhook handlers that create contacts (whatsapp, evolution, telegram) and the Meta link path to read/write channel identities. Add `findByChannelIdentity` helper alongside Phase 107 helpers. Lookup-first webhook pattern attaches channel identity to existing contacts when the same person is reached via different identifiers.

Delivers:
- Migration 1060: `contact_channel_identities` table with `(org_id, provider, external_id)` UNIQUE, RLS scoped to `get_current_org_id()`, FK to contacts. Plus backfill `INSERT...SELECT` from `contacts` where `source IN (channel_sources) AND external_id IS NOT NULL`.
- `contacts.source` deprecation comment in migration (`COMMENT ON COLUMN contacts.source IS 'DEPRECATED Phase 108 — use contact_channel_identities. Removal in Phase 110.'`)
- `findByChannelIdentity(supabase, orgId, provider, externalId)` helper in `src/lib/contacts/server.ts`
- 3 webhook handlers updated for lookup-first pattern: `src/lib/whatsapp/process-message.ts`, `src/lib/evolution/process-event.ts`, `src/lib/telegram/process-update.ts`
- `linkConversationsToContacts` in `src/lib/meta/process-event.ts:945` writes channel identity when linking a conversation
- `src/types/database.ts` regen for `contact_channel_identities` table + `ChannelProvider` type

Does NOT deliver (deferred):
- Identity invariant trigger (Phase 109)
- Removal of `contacts.source` column (Phase 110)
- Verified state / SMS-reply / email-click flows (Phase 110)
- Vapi/ManyChat webhook updates (those don't create contacts; nothing to wire here)
- UI changes (no admin badge / channel chip — surface in Phase 110)

</domain>

<decisions>
## Implementation Decisions

### Provider Enum Scope
- **D-01:** CHECK constraint enumerates all known providers now (wide enum):
  - `whatsapp` — WhatsApp Cloud + Business
  - `evolution` — Evolution API
  - `telegram` — Telegram bot platform
  - `instagram` — Instagram DM (future, Meta integration)
  - `messenger` — Facebook Messenger (future, Meta)
  - `facebook` — Facebook Page comments/posts (future)
  - `webchat` — embedded chat widget (existing path, may need channel identity later)
  - `vapi` — Vapi voice channel — for cross-referencing call_logs.contact_id when needed
- **D-01a:** Adding a new provider later only requires `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT`, but listing planned providers now avoids N small migrations.

### ROADMAP Success Criterion #5 Correction
- **D-02:** ROADMAP Phase 108 success #5 says "Vapi/ManyChat webhook contact creation paths updated to write channel identity". This is **wrong** based on Phase 107 research findings — Vapi and ManyChat do NOT create contacts. The actual contact-creating webhooks are whatsapp/evolution/telegram. Phase 108 targets the correct trio plus the Meta link path.
- **D-02a:** Vapi/ManyChat handlers are out of scope for Phase 108. If they later need channel identity attribution (e.g., Vapi attaching the calling number as a `vapi` provider identity), it's a Phase 110 task or beyond.

### Lookup-First Webhook Pattern
- **D-03:** Webhook contact handler flow (whatsapp/evolution/telegram):
  1. Normalize phone/email if available.
  2. `findByChannelIdentity(provider, external_id)` — if hit, return `(contact_id, channel_existed: true)`. Continue downstream work with that contact_id.
  3. Else: `findByPhone(org_id, phone_e164)` or `findByEmail(org_id, email_normalized)` if those values exist. If hit, INSERT channel identity row attaching to the existing contact (idempotent on UNIQUE). Continue.
  4. Else: INSERT new contact, then INSERT channel identity row.
  5. All INSERTs wrap try/catch on 23505 — fall through to SELECT (same defense-in-depth pattern as Phase 107).
- **D-03a:** Channel identity INSERT uses `ON CONFLICT (org_id, provider, external_id) DO NOTHING` because the UNIQUE constraint expects this. If conflict happens, SELECT existing row by `(org_id, provider, external_id)` to recover.
- **D-03b:** "Channel identity attached to existing phone-based contact" is the key value of this phase. Concrete scenario: Lead messages on Instagram (creates contact with instagram channel identity), then later texts on WhatsApp from a known phone — instead of creating a duplicate, the whatsapp channel identity attaches to the existing Instagram-rooted contact.

### Meta `linkConversationsToContacts` Integration
- **D-04:** `src/lib/meta/process-event.ts:945-986` already does post-hoc phone matching. Phase 108 adds: when the linking succeeds, also INSERT a channel identity row for the conversation's source platform (`instagram` or `messenger` based on `conversation.source`).
- **D-04a:** This is the only place where Meta touches channel identities in Phase 108. Meta inbound webhooks (`/api/meta/`) do NOT create contacts in this phase.

### contacts.source Deprecation
- **D-05:** Keep `contacts.source` column for now. Three changes:
  1. Add migration comment: `COMMENT ON COLUMN contacts.source IS 'DEPRECATED in Phase 108 — use contact_channel_identities. Removal in Phase 110.'`
  2. Continue writing source on contact creation (back-compat).
  3. App code reading source for channel-aware logic should switch to `contact_channel_identities` lookups. Migration tracking the call sites is a Phase 108 task.
- **D-05a:** Full removal of `contacts.source` happens in Phase 110 success #7 (column dropped, data lives in `contact_channel_identities`).

### Migration Safety
- **D-06:** No audit-guard needed (Phase 108 doesn't add constraints to existing tables). Backfill is `INSERT...SELECT` with `ON CONFLICT DO NOTHING` for idempotency. In prod (0 contacts with source IN channel_sources + external_id NOT NULL), backfill is no-op.

### Type Regen Strategy
- **D-07:** Manual patch to `src/types/database.ts` continues (CLI/MCP auth blocked precedent from Phases 105/106/107). Add `contact_channel_identities` table type + `ChannelProvider` exported type matching the CHECK enum.

### Claude's Discretion
- Exact migration filename (1060_*.sql).
- Index strategy on `contact_channel_identities (contact_id)` for reverse lookup (recommended yes).
- Whether to namespace `findByChannelIdentity` as separate file or keep in `src/lib/contacts/server.ts` (recommend same file as Phase 107 helpers).
- Specific call sites in app code that read `contacts.source` for channel logic — researcher enumerates.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 105 + 106 + 107 Output (binding)
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-CONTEXT.md`
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-CONTEXT.md`
- `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-CONTEXT.md` (especially D-03a webhook target correction — Phase 108 inherits this)
- `supabase/migrations/1056_contact_identity_audit.sql`
- `supabase/migrations/1057_contact_merge_tool.sql`
- `supabase/migrations/1059_contacts_unique_constraints.sql`

### Repo Files Researcher Must Inspect
- `src/lib/contacts/server.ts` — has `resolveLiveContactId`, `findByPhone`, `findByEmail`. Add `findByChannelIdentity` next to them.
- `src/lib/whatsapp/process-message.ts` — already has 23505 recovery from Phase 107. Add channel identity write.
- `src/lib/evolution/process-event.ts` — same.
- `src/lib/telegram/process-update.ts` — same.
- `src/lib/meta/process-event.ts:945-986` — `linkConversationsToContacts`. Add channel identity insert here.
- `src/types/database.ts` — patch target. `ChannelProvider` type goes near `ContactIdentityStatus`.
- App code reading `contacts.source`: grep for `.source` and `contacts.source` in `src/` to enumerate call sites that may need migration to channel_identities lookups.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Pooler pg apply pattern** — `apply-1060.mjs` based on `apply-1059.mjs`.
- **Type regen manual patch** — Phase 105/106/107 precedent.
- **`findByPhone` / `findByEmail`** in `src/lib/contacts/server.ts` — `findByChannelIdentity` mirrors signature.
- **RLS template** — `(SELECT get_current_org_id() FROM ...)` pattern from Phase 106/107.
- **Try/catch 23505 recovery** — established in createContact (Phase 107) and 3 webhooks. Channel identity insert reuses pattern.

### Established Patterns
- Migration numbering: next is **1060** (1058 = mcp-oauth, 1059 = unique-constraints).
- All new tables: RLS enabled, scoped to `org_id` via `get_current_org_id()`.
- Webhooks always HTTP 200 — no rethrows.
- Vitest with `vi.mock('server-only', () => ({}))`.

### Integration Points
- `contact_channel_identities` is referenced by:
  - 3 webhook contact handlers (lookup-first + insert).
  - Meta `linkConversationsToContacts` (insert on link).
  - Future Phase 109 identity trigger (read for invariant check).
  - Future Phase 110 verified state (read for surfacing).
- FK shape: `contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE`. Cascade because deleting a contact removes its identities.
- `external_id` is text (not uuid) — provider IDs are arbitrary strings.

</code_context>

<specifics>
## Specific Ideas

- Index strategy: `UNIQUE (org_id, provider, external_id)` (per ROADMAP), plus `INDEX (contact_id)` for reverse lookup, plus `INDEX (org_id, provider)` for analytics if needed (defer to planning).
- Backfill query: `INSERT INTO contact_channel_identities (org_id, contact_id, provider, external_id, created_at) SELECT org_id, id, source::text, external_id, created_at FROM contacts WHERE source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL ON CONFLICT DO NOTHING`.
- Provider mapping note: `contacts.source` enum values may differ slightly from channel_identities provider values (e.g., `source='instagram'` maps to `provider='instagram'` — same, but `source='ghl_sync'` doesn't map to any channel). Backfill only captures the channel-provider sources.
- Test: insert two contacts with same `(org_id, provider, external_id)` → second should fail with 23505. Insert same `(org_id, provider, external_id)` from same contact again → DO NOTHING idempotent.

</specifics>

<deferred>
## Deferred Ideas

- **Identity invariant trigger** — Phase 109. Enforces "contact must have phone OR email OR channel identity".
- **`contacts.source` column drop** — Phase 110.
- **Verified state on channel identity** — Phase 110 (e.g., Instagram OAuth verifies the identity).
- **UI surfacing** — channel badges on contact list/detail, channel filter — Phase 110.
- **Vapi/ManyChat channel identity write** — out of scope; those handlers don't create contacts. If they ever need to attribute identity (e.g., Vapi caller-id as `vapi` provider), it's a follow-up task.
- **Bulk reassign channel identities across contacts** — admin tool. Future need.
- **Channel identity audit log** — who attached this identity, when. Future need.
- **`/api/meta/` inbound webhook contact creation** — Phase 108 only touches `linkConversationsToContacts`. Other Meta endpoints (`/api/meta/instagram`, `/api/meta/messenger`) that may create contacts get covered if/when they do — currently they don't per Phase 107 research.

</deferred>

---

*Phase: 108-channel-identities*
*Context gathered: 2026-05-26*
