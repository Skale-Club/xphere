---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Integrations Refactor + Twilio Multi-Number
status: human_uat
stopped_at: All 6 phases complete; awaiting operator HUMAN-UAT
last_updated: "2026-05-17T12:10:00.000Z"
last_activity: 2026-05-17
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 6
  completed_plans: 6
---

# Operator - State

## Current Position

Phase: 63 (POLISH) — complete
Plan: 63-01 complete
Next phase: HUMAN-UAT then milestone audit + complete
Status: All code phases complete; 15/15 Vitest tests passing; types clean; awaiting operator-side smoke (see 63-HUMAN-UAT.md)
Last activity: 2026-05-17

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: ✅ Shipped 2026-05-07
- v1.7 Google Contacts Integration: ✅ Shipped 2026-05-07
- v1.8 Executor Completeness: ✅ Shipped 2026-05-08
- v1.9 GHL Lost-Lead Reengagement (SMS): ✅ Shipped 2026-05-16
- v2.0 Multi-Bot Platform: ✅ Shipped 2026-05-17
- v2.1 Calls + Contacts + Pipeline + Design Foundation: ✅ Shipped (across v21-* workstreams)
- v2.2 Chat Redesign — Schema + Server Actions Foundation: 🚧 In progress (separate workstream)
- v2.3 Integrations Refactor + Twilio Multi-Number: 🚧 Active — Phase 58 ready to plan (6 phases mapped)

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/ROADMAP.md` for current milestone phase details.

**Core value:** Operator is a tenant-aware integration and orchestration platform — reusable platform capabilities over hardcoding any single client's playbook.
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v2.3 Phase Map (6 phases, 58–63)

Execution order: 58 → 59 → 60 → 61 → 62 → 63

| # | Phase | Domain | UI hint |
|---|-------|--------|---------|
| 58 | SCHEMA-NUMBERS | Database migration + RLS + backfill | no |
| 59 | NUMBERS-ACTIONS | Server actions + lib refactors (voice.ts, send-sms.ts, actions.ts) | no |
| 60 | NUMBERS-UI | Multi-number CRUD UI on /integrations/twilio | yes |
| 61 | INDEX-CLEANUP | Remove duplicate Twilio from API-key table; numbers count badge | yes |
| 62 | VISUAL-UNIFICATION | Extract SectionCard; migrate Google Reviews to canonical pattern | yes |
| 63 | POLISH | Vitest coverage + manual smoke + npm run build green | no |

### v2.3 Scope (recap)

Two user-reported problems on `/integrations`:

1. **Click inconsistency** — API-key providers open as inline Sheet (one-flow stays-on-page); dedicated integrations navigate to separate pages. Twilio appears in BOTH lists with conflicting flows. The fix: clear rule — multi-resource integrations get dedicated pages, single-credential ones get sheets. Twilio leaves the table.
2. **Twilio "from number" is too thin** — a single E.164 string in JSONB does not represent the metadata operators actually need (capabilities per number, friendly labels, default selection, phone SID for Twilio API ops, routing mode). Multi-number is required for clients with multiple teams/campaigns/regions.

### Existing Twilio code surface (from pre-planning scout)

- **Read paths** (`from_number` consumers): `src/lib/twilio/voice.ts:66,86,116`, `src/lib/twilio/send-sms.ts:39-41`, `src/app/(dashboard)/integrations/twilio/actions.ts:117,205,334,352`, `src/app/api/automations/ghl-reengagement/run/route.ts:76,121`
- **Inbound webhook resolution**: `resolveTwilioOrgByToNumber` at `src/lib/twilio/voice.ts:77` queries `config->>from_number` — critical fallback path during transition
- **Test SMS row**: `src/components/integrations/twilio-settings.tsx:450` — will need `fromNumberId` prop
- **Schema today**: `integrations` table only; no `twilio_phone_numbers` table yet (verified via `grep CREATE TABLE` in migrations)
- **Migration counter**: highest current is `057_chat_inbox_features.sql`; new migration will be `058`

### Decisions locked before phase planning (from user conversation, 2026-05-17)

- Backfill aggressive: existing single `from_number` → row with capability_sms=true, capability_voice=true, is_default=true
- Keep legacy `config.from_number` this release, remove next milestone
- Soft delete (`is_active=false`) — preserves call/SMS history
- Visual unification (Phase 62) ships in the same milestone, not separate PR
- Test coverage: Vitest for server actions + manual smoke for E2E
- Execution order: 58 → 59 → 60 → 61 → 62 → 63

### Reserved for future milestones (NOT in v2.3)

- Twilio number provisioning via API (operators register existing numbers, don't buy through Operator)
- WhatsApp/MMS send-path changes (only the capability flag is added)
- Refactoring Meta/Evolution/ManyChat dedicated pages structurally
- Removing `config.from_number` (deferred one release)

## Decisions

- [v2.3] Schema: `twilio_phone_numbers` table, NOT JSONB array inside `integrations.config` — first-class entity for future FKs
- [v2.3] Default uniqueness enforced at DB level (partial unique index), not app-level — race-safe
- [v2.3] Twilio leaves API-key-providers table; lives only as dedicated card
- [v2.3] `<SectionCard>` extracted to `@/components/integrations/section-card.tsx` as canonical primitive for all dedicated integration pages
- [v2.3] Google Reviews migrates to the canonical pattern; Meta/Evolution/ManyChat get header alignment only (no structural refactor)
- [v2.3] Phase numbering continues from v2.0's last (42) — picks up at 58 (skipping numbers used by intermediate v2.1/v2.2 work in workstream subdirectories)

## Pending Todos

- ⚠️ (v2.3 HUMAN-UAT) Operator: run all items in `phases/63-polish/63-HUMAN-UAT.md` (schema/RLS smoke, inbound/outbound resolution paths, UI flows, index page state, visual unification) on a dev environment with migration 058 applied
- 🧹 (v2.3 follow-up) Remove `integrations.config.from_number` writes/reads in the next milestone — legacy fallback preserved this release
- 🧹 (v2.3 blocker) `npm run build` is red due to parallel chat-pagination work-in-progress (`src/components/chat/chat-layout.tsx` imports missing `use-infinite-conversations`); unrelated to v2.3 but blocks final build-green verification
- 🧹 (carried) Pre-existing tech debt: `npm run lint` broken (Next.js 16 removed `next lint`) — wire eslint.config.js when convenient. Build gate: `npm run build` is the type-check authority.

## Session Continuity

Last session: 2026-05-17T11:30:00.000Z
Stopped at: Roadmap + State created — ready to invoke `/gsd:autonomous`
