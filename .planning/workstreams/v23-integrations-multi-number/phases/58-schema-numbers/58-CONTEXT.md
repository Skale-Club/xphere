# Phase 58: SCHEMA-NUMBERS - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning
**Mode:** Infrastructure phase — decisions locked from pre-planning conversation

<domain>
## Phase Boundary

Deliver a first-class `twilio_phone_numbers` table per-org and back-fill every currently-configured `integrations.config.from_number` into it as the org's default number.

What this phase delivers:
- Migration `058_twilio_phone_numbers.sql` (DDL + RLS + indexes + backfill)
- `src/types/database.ts` updated to include the new table
- Manual smoke verification of RLS and unique-default invariants

What this phase does NOT deliver (deferred to Phase 59+):
- Server actions to read/write the new table (Phase 59)
- Refactor of `voice.ts`, `send-sms.ts`, integration view (Phase 59)
- UI for managing numbers (Phase 60)
- Removal of `config.from_number` from `integrations.config` (deferred one release — see roadmap)

</domain>

<decisions>
## Implementation Decisions

### Schema Shape (locked)

- Table name: `twilio_phone_numbers` (plural, snake_case — matches repo convention: `org_invites`, `agent_invocations`, etc.)
- PK: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- Org FK: `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` — cascade matches existing pattern (numbers are owned by the org)
- Phone number: `e164 TEXT NOT NULL` — application validates the regex `^\+[1-9]\d{6,14}$`, no DB CHECK constraint (matches `manychat_rules`/`meta_channels` pattern in the repo)
- Twilio Phone Number SID: `phone_sid TEXT` — optional column; format `PN[a-f0-9]{32}` validated only when present, no DB constraint
- Display label: `friendly_name TEXT NOT NULL` — operators need to distinguish "Vendas BR" from "Suporte US"; required (default "Number 1" if backfilled and friendly_name missing — see Backfill rule)
- Capability flags: three boolean columns `capability_sms BOOLEAN NOT NULL DEFAULT false`, `capability_mms BOOLEAN NOT NULL DEFAULT false`, `capability_voice BOOLEAN NOT NULL DEFAULT false`
- Routing default: `default_routing_mode TEXT` — nullable; CHECK constraint restricts to `('browser','sip','forward')` or NULL
- Forward target: `forward_to_number TEXT` — required only when `default_routing_mode='forward'`; this is enforced in the application Zod, not at the DB layer (avoids cross-column CHECK constraint complexity)
- Default selection: `is_default BOOLEAN NOT NULL DEFAULT false`
- Soft delete: `is_active BOOLEAN NOT NULL DEFAULT true`
- Notes: `notes TEXT` — optional operator notes
- Timestamps: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — matches existing convention

### Constraints & Indexes (locked)

- `UNIQUE (organization_id, e164)` — prevents duplicate number registrations per org; this is the conflict target for backfill `ON CONFLICT DO NOTHING`
- Partial unique index `twilio_phone_numbers_one_default_per_org` on `(organization_id) WHERE is_default = true` — DB-level enforcement of "exactly zero or one default per org"; race-safe vs an app-level toggle
- Index `twilio_phone_numbers_org_idx` on `(organization_id)` — standard per-tenant lookup
- Index `twilio_phone_numbers_e164_active_idx` on `(e164) WHERE is_active = true` — supports `resolveTwilioOrgByToNumber` lookups by inbound destination number

### RLS (locked)

- Enabled via `ALTER TABLE twilio_phone_numbers ENABLE ROW LEVEL SECURITY;`
- Policy `select_own_org` — `SELECT` allowed where `organization_id = get_current_org_id()`
- Policy `insert_own_org` — `INSERT` allowed where `organization_id = get_current_org_id()`
- Policy `update_own_org` — `UPDATE` allowed where `organization_id = get_current_org_id()` (both USING and WITH CHECK)
- Policy `delete_own_org` — `DELETE` allowed where `organization_id = get_current_org_id()` — kept for completeness even though app does soft delete via UPDATE `is_active=false`
- No explicit service_role bypass policy needed — `service_role` bypasses RLS by default in Supabase

### Backfill (locked)

- One row per active Twilio integration with a non-empty `config.from_number`
- `friendly_name` = `config->>'from_number'` (the E.164 itself becomes the label; operators can edit later)
- `capability_sms = true`, `capability_voice = true`, `capability_mms = false` — matches the de-facto capability of the current single-number setup (SMS + voice are the in-use paths)
- `is_default = true` — only one number exists per org at backfill time, so the partial unique index is satisfied
- `is_active = true`
- `ON CONFLICT (organization_id, e164) DO NOTHING` — makes the migration safely re-runnable

### Types (locked)

- Manually extend `src/types/database.ts` with `twilio_phone_numbers` entry (Row / Insert / Update shapes) — codebase already extends this file manually per CLAUDE.md
- Insert/Update shapes mirror Row but mark generated columns optional (`id`, `created_at`, `updated_at`, defaulted booleans)

### Migration File Conventions (from existing migrations)

- Filename: `058_twilio_phone_numbers.sql`
- Header comment block summarizing purpose, owner, and date — matches `057_chat_inbox_features.sql` style
- All statements in one transaction (DDL + RLS + indexes + backfill) — Supabase migration runner wraps automatically; explicit `BEGIN/COMMIT` not needed
- No `IF NOT EXISTS` on the main `CREATE TABLE` — migrations are linear in this repo

### Claude's Discretion

- Exact wording of the migration file's leading comment block
- Exact placement of indexes vs constraints (which `CREATE INDEX` runs first) — order doesn't affect correctness
- Whether to add a trigger for `updated_at` auto-bumping in this phase or defer to Phase 59 (recommend: defer — most existing tables in this repo handle `updated_at` in application code, not DB triggers)
- How to verify the unique-default partial index works in the manual smoke check (suggested: `INSERT` two rows for the same org with `is_default=true` and confirm the second fails)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `get_current_org_id()` SECURITY DEFINER function — used by every RLS policy in this codebase (e.g., `057_chat_inbox_features.sql`)
- Migration cadence: `npx supabase db push` then manually update `src/types/database.ts` — documented in `CLAUDE.md`
- Existing RLS pattern: reference `migration 046_org_invites.sql` or `054_evolution_instances.sql` for a clean per-org table with the four standard policies

### Established Patterns

- Per-org tables: `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` is the universal pattern in this repo
- Encryption: NOT needed for this table — `twilio_phone_numbers` stores no secrets (credentials remain in `integrations.encrypted_api_key`)
- Soft delete: existing precedent in `agents` (`is_active`), `tool_configs` (`is_active`) — kept the same flag name

### Integration Points

- `integrations` table — phase 58 does NOT modify it; legacy `config.from_number` remains untouched in this phase
- `src/types/database.ts` — needs new `twilio_phone_numbers` typed entry; will be consumed by Phase 59
- Inbound webhook resolution at `src/lib/twilio/voice.ts:77` — currently uses `config->>from_number`; Phase 59 will switch to `twilio_phone_numbers.e164` with fallback

</code_context>

<specifics>
## Specific Ideas

- Migration must be idempotent on the backfill via `ON CONFLICT (organization_id, e164) DO NOTHING` — if an operator re-runs `npx supabase db push` for any reason, no duplicate rows
- The partial unique index name must be explicit (`twilio_phone_numbers_one_default_per_org`) so it appears clearly in pg_indexes and in any future migration that references it
- Test data: a manual smoke check on a development DB should create two numbers for the same org and confirm marking the second as default while the first is also default fails — this exercises the partial unique index

</specifics>

<deferred>
## Deferred Ideas

- `updated_at` auto-bumping trigger — deferred (most repo tables handle this in application code; consistency wins over DB-level magic)
- DB-level CHECK constraint on E.164 — deferred (Zod handles it in app layer; matches repo precedent)
- Cross-column CHECK constraint enforcing `forward_to_number IS NOT NULL WHEN default_routing_mode='forward'` — deferred to Zod in Phase 59
- Removal of `integrations.config.from_number` — explicitly deferred to next milestone per locked roadmap decision (keeps legacy fallback for one release)

</deferred>
