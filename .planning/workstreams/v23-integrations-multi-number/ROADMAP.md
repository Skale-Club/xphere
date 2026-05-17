# Operator Roadmap

## Milestones

- ✅ **v1.0 MVP** — 6 phases, 30 plans (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** — LangChain vector pipeline (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** — 6 phases, 21 plans (shipped 2026-04-05)
- ✅ **v1.3 Google Reviews Widget + Meta Messaging** — 7 phases (phases 7–13, shipped 2026-05-05)
- ✅ **v1.4 Chat System Refactor** — 5 phases (phases 14–18, shipped 2026-05-05)
- ✅ **v1.5 Tools Folder System** — shipped 2026-05-06
- ✅ **v1.6 ManyChat Integration** — shipped 2026-05-07
- ✅ **v1.7 Google Contacts Integration** — shipped 2026-05-07
- ✅ **v1.8 Executor Completeness** — 9 phases, 26 plans (shipped 2026-05-08)
- ✅ **v1.9 GHL Lost-Lead Reengagement** — shipped 2026-05-16
- ✅ **v2.0 Multi-Bot Platform** — 10 phases (phases 33–42, shipped 2026-05-17)
- ✅ **v2.1 Calls + Contacts + Pipeline + Design Foundation** — (shipped — collected across v21-* workstreams)
- ✅ **v2.2 Chat Redesign — Schema + Server Actions Foundation** — (in progress on chat work, baseline shipped 2026-05-17)
- 🚧 **v2.3 Integrations Refactor + Twilio Multi-Number** — 6 phases (phases 58–63, active)

---

## v2.3 Integrations Refactor + Twilio Multi-Number

**Milestone Goal:** Eliminate the UX inconsistency on `/integrations` (mixed sheet-inline vs page navigation patterns), introduce true multi-number support for Twilio (numbers as first-class entities with capabilities, default selection, friendly labels, and soft-delete history), and unify the visual language across dedicated integration pages so future integrations follow one canonical pattern.

**Strategic Rationale:**

1. **Operator clarity** — One mental model per category of integration: simple key providers open as inline sheets; multi-resource integrations get dedicated pages. The current state has Twilio appearing in BOTH lists with different flows, which is actively confusing.
2. **Multi-tenant scaling** — Larger client orgs need to operate multiple phone numbers (different teams, campaigns, regions). The current single-`from_number` model is a hard ceiling. Refactoring now is cheaper than after more integrations build on the assumption.
3. **Design language unification** — A shared `<SectionCard>` pattern (already prototyped in `twilio-settings.tsx`) becomes the canonical layout for all dedicated integration pages. Future integrations cost less to ship and feel like part of the same product.

**Non-Goals (explicitly out of scope):**

- Twilio number provisioning (purchasing numbers via Twilio API) — operators register numbers they already bought
- WhatsApp/MMS sending logic changes — only the capability flags are added, not the send paths
- Migrating the API-key sheet UI itself — that pattern stays; only `Twilio` exits the sheet list
- Refactoring Meta, Evolution, ManyChat dedicated pages beyond cosmetic unification

### Phases

- [ ] **Phase 58: SCHEMA-NUMBERS** — Create `twilio_phone_numbers` table with RLS + backfill from `integrations.config.from_number`
- [ ] **Phase 59: NUMBERS-ACTIONS** — CRUD server actions + lib refactors so all Twilio paths read from `twilio_phone_numbers`
- [ ] **Phase 60: NUMBERS-UI** — Multi-number CRUD UI inside `/integrations/twilio` (list + dialog + reorganized sections)
- [ ] **Phase 61: INDEX-CLEANUP** — Remove duplicate Twilio entry from the API-key providers table; surface number count on the dedicated card
- [ ] **Phase 62: VISUAL-UNIFICATION** — Extract `<SectionCard>` to shared component; migrate Google Reviews to the canonical dedicated-page pattern; align typography across pages
- [ ] **Phase 63: POLISH** — Vitest coverage for the new server actions + manual smoke test + `npm run build` green

---

## Phase Details

### Phase 58: SCHEMA-NUMBERS

**Goal**: A first-class `twilio_phone_numbers` table exists per-org with the metadata operators actually need to identify and route numbers, and every currently-configured `integrations.config.from_number` is backfilled into the new table as a default number for its org

**Depends on**: Nothing (foundation phase for v2.3)

**Requirements**:
- New migration `058_twilio_phone_numbers.sql` adds the table, RLS policies (read/write scoped via `get_current_org_id()`, plus `service_role` bypass for webhooks), required indexes, and the backfill INSERT
- Backfill rule: each `integrations` row with `provider='twilio' AND is_active=true AND config->>'from_number' IS NOT NULL AND <> ''` produces one `twilio_phone_numbers` row with `friendly_name=config->>'from_number'`, `capability_sms=true`, `capability_voice=true`, `is_default=true`
- `config.from_number` is kept on `integrations.config` for this release (legacy fallback path; removed in next milestone)
- `src/types/database.ts` is regenerated or manually extended so `twilio_phone_numbers` types compile

**Success Criteria** (what must be TRUE):
1. `npx supabase db push` applies migration `058` cleanly with no errors; the migration is idempotent (re-running on a freshly-pushed DB is a no-op for the backfill via `ON CONFLICT DO NOTHING` on `(organization_id, e164)`)
2. After push, every previously-configured org has exactly one row in `twilio_phone_numbers` with `is_default=true`, and the `UNIQUE (organization_id, e164)` constraint holds
3. RLS smoke: a logged-in user from Org A querying `twilio_phone_numbers` cannot read rows belonging to Org B (verified via `supabase` client with anon key + JWT)
4. The `twilio_phone_numbers_one_default_per_org` unique index rejects an attempt to mark a second row as `is_default=true` for the same org
5. `npm run build` passes — types compile against the new table

**Plans**: TBD
**UI hint**: no

### Phase 59: NUMBERS-ACTIONS

**Goal**: Every Twilio code path that previously read `config.from_number` now reads from `twilio_phone_numbers` (with the legacy field as a fallback), and a clean CRUD surface exists for the upcoming UI to call

**Depends on**: Phase 58

**Requirements**:
- New `src/app/(dashboard)/integrations/twilio/numbers-actions.ts` exports: `listTwilioNumbers`, `createTwilioNumber`, `updateTwilioNumber`, `softDeleteTwilioNumber` (sets `is_active=false`), `setDefaultTwilioNumber` — all Zod-validated server actions
- Validation rules: `e164` matches `^\+[1-9]\d{6,14}$`; at least one capability flag is `true`; if `default_routing_mode='forward'` then `forward_to_number` must be present and valid E.164; setting `is_default=true` atomically clears prior defaults in the same org
- `src/lib/twilio/voice.ts::resolveTwilioOrgByToNumber` queries `twilio_phone_numbers.e164 = toNumber` (joined with `integrations` for credentials), with a documented fallback to `config->>from_number` for unmigrated rows
- `src/lib/twilio/voice.ts` adds `resolveTwilioCredentialsForOrg(orgId, options?: { phoneNumberId?: string })` that returns the requested or default number
- `src/lib/twilio/send-sms.ts` accepts an optional `fromNumberId` parameter and falls back to the org's default `is_default=true` number; explicit error if no default exists and no override is passed
- `src/app/(dashboard)/integrations/twilio/actions.ts::TwilioIntegrationView` gains `numbers: TwilioPhoneNumberRow[]`; `smsConfigured = hasAccountSid && hasAuthToken && numbers.some(n => n.is_active && n.capability_sms)`; `testSendSms` accepts `{ to, fromNumberId? }`
- `src/app/api/automations/ghl-reengagement/run/route.ts` consults the default number when no `GHL_REENGAGEMENT_FROM_NUMBER` env override exists

**Success Criteria** (what must be TRUE):
1. Zod validation rejects bad E.164 input, zero-capability input, and `forward` mode without `forward_to_number` — verified by unit tests
2. The unique-default invariant survives concurrent `setDefaultTwilioNumber` calls — the action wraps the toggle in a transaction or uses the unique partial index as a guard
3. `resolveTwilioOrgByToNumber` finds the correct org for both new-table rows AND legacy `config.from_number`-only orgs (regression test: a row with only `config.from_number` still resolves)
4. `sendSms` called without `fromNumberId` uses the org's default; called with an explicit `fromNumberId` overrides; called for an org with no default surfaces a clear error
5. `npm run build` passes; existing call paths that imported the lib functions don't break (compile-checked across the 18 files identified during planning)

**Plans**: TBD
**UI hint**: no

### Phase 60: NUMBERS-UI

**Goal**: An operator on `/integrations/twilio` can see all phone numbers configured for their org, add new ones with the full metadata, edit any field, mark a different number as default, and soft-delete numbers they no longer use — all without leaving the page

**Depends on**: Phase 59

**Requirements**:
- New client component `src/components/integrations/twilio-phone-numbers.tsx` renders a list view + a create/edit dialog
- List row fields: friendly name (primary), E.164 (mono), capability badges (SMS/MMS/Voice), Default pill if applicable, kebab menu with `Set default`, `Edit`, `Delete` (soft) actions
- Dialog fields: friendly_name (required), e164 (required), phone_sid (optional, validated `PN...`), three capability checkboxes (at least one), default_routing_mode select (None/Browser/SIP/Forward), forward_to_number (conditional on Forward), is_default toggle, notes (optional textarea)
- `twilio-settings.tsx` is reorganized into the section order: Connection status → Account credentials → Phone numbers (new section embedding the component) → Voice SDK → SIP
- The current single `from_number` field is removed from the Account credentials section
- Empty state (zero numbers) uses the shared `<EmptyState>` component with CTA `Add your first number`
- Test SMS row inside the Phone numbers section accepts a "From" picker (the active numbers' E.164) so operators can validate per-number outbound

**Success Criteria** (what must be TRUE):
1. Operator can create a number, see it appear in the list immediately (optimistic or via revalidation), and edit any field with changes persisted
2. Marking number B as default automatically un-marks number A — verified visually and by re-querying the list
3. Soft-deleted numbers disappear from the list but still exist in DB with `is_active=false` (verified via SQL)
4. Form validates client-side (E.164 regex, at least one capability, forward requires `forward_to_number`) — submitting bad input shows inline errors and does not call the server action
5. Visual smoke: the page layout matches the canonical pattern (section cards, status pills, sticky save bar); typography matches the rest of the dedicated integration pages
6. `npm run build` passes; live manual test in the dev server confirms the flow end-to-end

**Plans**: TBD
**UI hint**: yes

### Phase 61: INDEX-CLEANUP

**Goal**: The `/integrations` index page reflects the new model: Twilio appears only once (as a dedicated card), the dedicated card surfaces the live number count for an at-a-glance health signal, and the API-key providers table no longer contains the duplicate Twilio row

**Depends on**: Phase 60

**Requirements**:
- `src/components/integrations/integrations-table.tsx::ALL_PROVIDERS` no longer contains `{ id: 'twilio', ... }`
- A short header comment in `integrations-table.tsx` documents the routing rule: "Single-credential providers only. Setup that spans multiple resources (numbers, instances, pages, embeds) belongs at `/integrations/[provider]`."
- `src/app/(dashboard)/integrations/page.tsx` computes `twilioNumbersCount` server-side and passes it into the Twilio `DedicatedCard`
- The Twilio card displays a subtle sub-label like `X numbers configured` (or hides if 0 + not connected, falls back to current `Not connected` pill)
- `connected` flag for Twilio is now `hasTwilio && numbersCount > 0` (replaces the previous boolean that was just `integration row exists`)

**Success Criteria** (what must be TRUE):
1. The integrations page shows Twilio exactly once — the API-key providers table renders 6 rows (Vapi, GoHighLevel, Cal.com, OpenAI, Anthropic, OpenRouter), not 7
2. The Twilio card's pill flips to `Connected` only when at least one active number exists; an org with credentials but zero active numbers shows `Not connected`
3. The number count badge updates after returning from the dedicated page (router refresh or revalidation flow works)
4. `npm run build` passes; no broken links or stale references to a Twilio sheet flow

**Plans**: TBD
**UI hint**: yes

### Phase 62: VISUAL-UNIFICATION

**Goal**: A shared `<SectionCard>` primitive lives in `@/components/integrations/section-card.tsx`, the Google Reviews dedicated page is rebuilt on top of it (matching the Twilio page's structural language), and typography is consistent enough across the dedicated integration pages that a user moving between them feels they are inside one product

**Depends on**: Phase 60 (uses the SectionCard pattern that Phase 60 stabilizes)

**Requirements**:
- Extract `SectionCard` from `src/components/integrations/twilio-settings.tsx` into `src/components/integrations/section-card.tsx` (props: `icon`, `title`, `description`, `statusReady`, `readyLabel`, `emptyLabel`, `helpLinks`, `children`)
- Re-import `SectionCard` in `twilio-settings.tsx` from the new shared path
- Migrate `src/app/(dashboard)/integrations/google-reviews/page.tsx` from `<Card>` + "Step 1/2/3" hand-rolled headers to `<PageContainer>` + `<PageHeader back>` + `<SectionCard>` sections; preserve the step ordering as visual rhythm but lose the per-step colored bars
- Remove `font-serif` from the h1 if it is now redundant with `<PageHeader>` (audit and align with other dedicated pages)
- Replace the "Almost there." hand-rolled card with `<EmptyState>` from `@/components/empty-states/empty-state`
- Audit Meta, Evolution, ManyChat, Google Contacts dedicated pages — apply `<PageHeader back>` if missing, but do NOT refactor structurally beyond that

**Success Criteria** (what must be TRUE):
1. `SectionCard` is importable from `@/components/integrations/section-card` and used by both `twilio-settings.tsx` and `google-reviews/page.tsx`
2. Google Reviews page renders without visual regression of functionality (key form, business search, status panel, recent reviews, embed snippet still all present and working)
3. A side-by-side visual diff of `/integrations/twilio` and `/integrations/google-reviews` shows identical section-card chrome (same border radius, padding, header layout, status pill placement)
4. No remaining `font-serif` usages on dedicated integration page headings (large hero numbers/metrics may keep it — that is intentional accent usage)
5. `npm run build` passes; manual click-through of each dedicated integration page shows no broken layouts

**Plans**: TBD
**UI hint**: yes

### Phase 63: POLISH

**Goal**: The v2.3 work is safe to merge — server actions are unit-tested, the type-checker is green, the dev server runs through the golden path without errors, and lingering tech debt items are documented

**Depends on**: Phase 62

**Requirements**:
- Vitest tests added for `numbers-actions.ts` covering: Zod validation (e164, capability minimum, forward branch), one-default-per-org invariant, soft-delete behavior, RLS isolation (if a test harness exists for it)
- Manual smoke pass documented in HUMAN-UAT.md: create 2 numbers, mark one as default, send test SMS from non-default, fake an inbound webhook to verify `resolveTwilioOrgByToNumber` matches, verify number count on the index card
- `npm run build` passes with no new type errors
- Any new tech debt or follow-ups documented in `.planning/STATE.md` "Pending Todos"

**Success Criteria** (what must be TRUE):
1. `npx vitest run` reports zero new failures introduced by v2.3; new tests for `numbers-actions.ts` are in the suite and passing
2. `npm run build` exits 0 with no type errors
3. HUMAN-UAT.md exists for Phase 63 and contains the 5 smoke items above, each with a clear pass/fail check
4. STATE.md `Pending Todos` lists any deferred items (e.g., "remove `config.from_number` in next milestone")

**Plans**: TBD
**UI hint**: no

---

## Progress

**Execution Order:** Phases execute in numeric order: 58 → 59 → 60 → 61 → 62 → 63. Phase 61 (index cleanup) intentionally runs before Phase 62 (visual unification) because it is a smaller cleanup that benefits the user immediately once the multi-number UI lands.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 58. SCHEMA-NUMBERS | 0/TBD | Not Started | — |
| 59. NUMBERS-ACTIONS | 0/TBD | Not Started | — |
| 60. NUMBERS-UI | 0/TBD | Not Started | — |
| 61. INDEX-CLEANUP | 0/TBD | Not Started | — |
| 62. VISUAL-UNIFICATION | 0/TBD | Not Started | — |
| 63. POLISH | 0/TBD | Not Started | — |

---

## Locked Decisions (v2.3)

| Decision | Outcome |
|----------|---------|
| Schema location | New table `twilio_phone_numbers`, not JSONB inside `integrations.config` — first-class entity with FK potential for future call/SMS-level number references |
| Default uniqueness | Enforced at DB level via partial unique index, not just app-level — protects against race conditions |
| Backfill capability defaults | `capability_sms=true, capability_voice=true, capability_mms=false` — matches the current single-number behavior; operators can refine in the UI |
| `config.from_number` removal | Kept as legacy fallback this release, removed in next milestone — prevents a forced cutover if any cron/script we missed still reads it |
| Soft vs hard delete | Soft (`is_active=false`) — preserves historical call/SMS records that reference the number |
| Twilio routing rule | Dedicated page only — removed from API-key sheet table; documented in `integrations-table.tsx` header comment |
| Visual unification approach | Extract `<SectionCard>` from Twilio; retrofit Google Reviews; do NOT refactor Meta/Evolution/ManyChat structurally (header alignment only) |
| Test coverage | Unit tests for server actions, manual smoke for end-to-end (no full e2e harness exists) |
| Phase ordering | 58 → 59 → 60 → 61 → 62 → 63 — index cleanup (61) before visual unification (62) so the immediate UX win lands first |

---

*Last updated: 2026-05-17 — v2.3 milestone roadmap created (Phases 58–63)*
