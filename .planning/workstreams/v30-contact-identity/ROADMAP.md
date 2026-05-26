# Roadmap: v3.0 Contact Identity — Phone & Email Uniqueness Architecture

**Workstream:** v30-contact-identity
**Phases:** 6 (105–110) | **Source:** [Notion — Contact Identity Project](https://www.notion.so/36bb7a68612181a4a124c5b92d12c904)

**Architectural thesis:** Phone and email are identity fields, not regular fields. Uniqueness enforced at DB level via partial UNIQUE indexes (org-scoped). Channel-only contacts (Instagram/Meta/WhatsApp without phone/email) live in a separate identity table. Normalization happens via generated columns — bypass-proof. Merge conflict is a status, not a workflow.

**Counterproposal vs Notion spec:** rejected polymorphic `contact_identities` table in favor of generated columns on `contacts` + a single `contact_channel_identities` table. Adds explicit org-scoping (omitted in Notion). Includes a migration plan for existing duplicates before adding UNIQUE constraints.

---

## Phase 105: AUDIT-GENERATED-COLUMNS

**Goal:** Audit existing duplicates and add normalization infrastructure without breaking anything. Adds `phone_e164` / `email_normalized` generated columns and `identity_status` enum to `contacts`. No UNIQUE constraints yet.
**Depends on:** Nothing
**Requirements:** CID-01 (audit), CID-02 (normalized columns), CID-03 (status enum)
**UI hint:** no
**Success Criteria:**
1. Audit query produces report of duplicate clusters: `(org_id, phone_e164)` and `(org_id, email_normalized)` with count and sample contact IDs per cluster
2. Migration adds `phone_e164 text GENERATED ALWAYS AS (normalize_phone(phone)) STORED` to `contacts`
3. Migration adds `email_normalized text GENERATED ALWAYS AS (lower(trim(email))) STORED` to `contacts`
4. Migration adds `identity_status text NOT NULL DEFAULT 'identified' CHECK (...)` to `contacts`
5. `normalize_phone()` SQL function exists and is deterministic (E.164 stripping + leading +)
6. All existing rows backfilled — generated columns evaluated on next read
7. `npm run build` exits 0; type regen handled (`src/types/database.ts`)
**Plans:** 4/4 plans complete
- [x] 105-01-PLAN.md — Author migration 1056_contact_identity_audit.sql (normalize_phone, generated columns, identity_status, audit table, refresh function)
- [x] 105-02-PLAN.md — Apply migration on Supabase branch and validate via SQL probes
- [x] 105-03-PLAN.md — Promote migration to main and regenerate src/types/database.ts
- [x] 105-04-PLAN.md — Run refresh_contact_duplicate_audit() on prod and snapshot audit baseline

8. RLS policies unchanged

---

## Phase 106: MERGE-TOOL

**Goal:** Admin merge UI + auto-merge for safe exact-match duplicates. Clears the way for UNIQUE constraints in Phase 107.
**Depends on:** Phase 105
**Requirements:** CID-04 (merge UI), CID-05 (auto-merge), CID-06 (archive strategy)
**UI hint:** yes
**Success Criteria:**
1. `/admin/contacts/conflicts` page lists duplicate clusters from audit (re-runnable)
2. Per-cluster: side-by-side view, field-level pick, "Merge into A / B" or "Mark as separate"
3. Merge operation: chosen survivor keeps id, others get `identity_status='archived_duplicate'` and `merged_into_contact_id` FK
4. All FKs referencing archived contacts get rewritten to survivor (conversations, messages, calls, etc.) — single transaction
5. Auto-merge mode: when all non-identity fields are identical or one is null where other has value, merge automatically
6. Audit log: `contact_merge_log` table records (survivor_id, archived_id, merged_at, merged_by, strategy)
7. Cluster count drops to zero before Phase 107 starts

---

## Phase 107: UNIQUE-CONSTRAINTS

**Goal:** Add partial UNIQUE indexes on `(org_id, phone_e164)` and `(org_id, email_normalized)`, scoped to non-archived contacts. Race-condition-proof.
**Depends on:** Phase 106 (cluster count == 0)
**Requirements:** CID-07 (phone unique), CID-08 (email unique)
**UI hint:** no
**Success Criteria:**
1. `CREATE UNIQUE INDEX contacts_org_phone_uniq ON contacts (org_id, phone_e164) WHERE phone_e164 IS NOT NULL AND identity_status <> 'archived_duplicate'`
2. Same for email_normalized
3. Migration runs without errors on prod-shaped data
4. Test: parallel INSERT of same `(org_id, phone)` produces unique-violation error, not duplicate
5. `createContact` in `src/app/(dashboard)/contacts/actions.ts` switched from SELECT-then-INSERT to INSERT...ON CONFLICT DO UPDATE
6. Webhook handlers (Meta, Vapi, ManyChat) verified to handle unique-violation gracefully (return existing contact)
7. `npm run build` exits 0; full test suite passes
**Plans:** 2/5 plans executed
- [x] 107-01-PLAN.md — Author migration 1058 (partial UNIQUE indexes + audit guard) and apply to prod via apply-1058.mjs
- [x] 107-02-PLAN.md — Add findByPhone/findByEmail helpers + refactor createContact for race-safe ON CONFLICT recovery (returns matched_via)
- [ ] 107-03-PLAN.md — Harden three webhook contact-creation paths (whatsapp/evolution/telegram) with 23505 recovery
- [ ] 107-04-PLAN.md — Update three form callers (new-contact-dialog, new-contact-page-form, new-opportunity-dialog) for new return shape + D-04/D-04a toasts
- [ ] 107-05-PLAN.md — Author race test (tests/contacts-unique-constraint.test.ts) + final phase validation report

---

## Phase 108: CHANNEL-IDENTITIES

**Goal:** Introduce `contact_channel_identities` table for Instagram/Messenger/WhatsApp/Facebook identities. Migrate existing `external_id` + `source` data into it.
**Depends on:** Phase 107
**Requirements:** CID-09 (channel table), CID-10 (migration), CID-11 (webhook integration)
**UI hint:** no
**Success Criteria:**
1. Migration creates `contact_channel_identities (id, org_id, contact_id, provider, external_id, created_at, UNIQUE (org_id, provider, external_id))`
2. RLS policy: scoped to `get_current_org_id()`
3. Backfill: existing contacts with `source IN ('instagram','whatsapp','facebook','messenger')` and non-null `external_id` get a row in `contact_channel_identities`
4. `linkConversationsToContacts` (`src/lib/meta/process-event.ts:945`) updated to upsert channel identity when conversation links to a contact
5. Vapi/ManyChat webhook contact creation paths updated to write channel identity
6. `contacts.source` deprecated comment added; old column retained for now
7. Type regen handled

---

## Phase 109: IDENTITY-TRIGGER

**Goal:** Enforce "every contact must have phone OR email OR channel identity" via DB trigger. Channel-only contacts become first-class.
**Depends on:** Phase 108
**Requirements:** CID-12 (identity invariant), CID-13 (channel_only status)
**UI hint:** no
**Success Criteria:**
1. Trigger `enforce_contact_identity()` fires on INSERT and UPDATE of `contacts`
2. Trigger raises exception if `phone_e164 IS NULL AND email_normalized IS NULL AND NOT EXISTS (channel identity row)`
3. Trigger also runs on DELETE of `contact_channel_identities` to prevent orphaning the contact
4. Contacts created from channel webhooks get `identity_status='channel_only'` until phone/email added
5. Promotion logic: when `phone` or `email` populated on a channel_only contact, `identity_status` auto-bumps to `'identified'` via trigger
6. Zod schema `contactSchema.refine` updated to allow phone/email-less contacts when channel context provided
7. Existing tests pass; new tests cover invariant edge cases

---

## Phase 110: APP-WIRING

**Goal:** Wire up identity-aware paths in the app — verified state, conflict UI, normalization-aware imports. Cleanup loose ends.
**Depends on:** Phase 109
**Requirements:** CID-14 (verified state), CID-15 (conflict surface), CID-16 (import hardening)
**UI hint:** yes
**Success Criteria:**
1. `contact_verifications (contact_id, identifier_type, identifier_value, verified_at, method)` table created
2. Verified state triggered by: SMS reply-yes, email link click, manual admin verification
3. Contact detail page shows identity status badge (channel_only / identified / verified / merge_conflict)
4. Merge conflict surfaces in contact list as a banner + filter
5. CSV import flow: pre-flight dedup runs against normalized columns, surfaces conflicts before commit
6. Placeholder email rejection (`noemail@*`, `test@test.com`, `none@*`) — configurable via `org_settings.blocked_email_patterns`
7. `contacts.source` column removed (data lives in `contact_channel_identities` since Phase 108)
8. `npm run build` exits 0; full e2e regression
