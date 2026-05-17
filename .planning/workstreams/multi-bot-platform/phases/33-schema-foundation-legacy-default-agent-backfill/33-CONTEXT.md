# Phase 33: Schema Foundation + Legacy Default Agent Backfill - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 33 lands all v2.0 schema additively in 6 logical migrations (034-039) and seeds a "Main Agent" for every existing org so that, when later phases cut over the chat path, day-1 widget behavior is byte-identical to v1.4.

**This phase delivers schema and data only.** No runtime, no UI, no business logic. The only "code" outside `supabase/migrations/` is regenerated `src/types/database.ts`.

**Success = byte-equal v1.4 chat behavior + new schema present + Vapi paths untouched.**

</domain>

<decisions>
## Implementation Decisions

### Migration Splitting (6 logical migrations)
- **D-33-01:** Ship as **6 separate migrations** rather than one mega-migration. Easier rollback, easier review, each has a single concern.
  - **034** — `agents` + `agent_tools` + `agent_partners` (core entity + immediate junctions)
  - **035** — `agent_prompt_versions` + add `active_prompt_version_id` FK to `agents`
  - **036** — `agent_channel_defaults` (resolver mapping per org per channel)
  - **037** — `agent_invocations` + additive `agent_invocation_id` + `trace_id` columns on `action_logs`
  - **038** — `tool_idempotency_keys` + `agent_model_pricing` (with seed rows for current Anthropic + OpenRouter rates)
  - **039** — Additive nullable `agent_id` columns on `manychat_rules` + `meta_channels` (CHAN-06)
- **D-33-02:** All migrations use `CREATE TABLE IF NOT EXISTS` for idempotency; all enable RLS with the `(SELECT public.get_current_org_id())` pattern from existing migrations.

### Seed Prompt Strategy (Main Agent backfill)
- **D-33-03:** **Resolve `${orgName}` per-org at seed time**; runtime continues to append `${kbContext}` dynamically when invoking the LLM. Each org's seeded `agents.system_prompt` is a complete sentence with its own org name baked in (e.g., "You are a helpful assistant for Acme Inc. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.").
- **D-33-04:** Source of truth for the v1.4 prompt template is [src/lib/chat/stream.ts:107](src/lib/chat/stream.ts#L107). The seed migration (or Node helper) reads the literal template text from this file (or hardcodes it inline with a comment pointing to the source line) and per-org substitutes `${orgName}` with `organizations.name`.
- **D-33-05:** For orgs where `organizations.name` is NULL or empty, fall back to literal string `"your team"` (matches user's likely intent better than "your organization" / "the team").
- **D-33-06:** A separate `agent_prompt_versions` row with `version=1` is inserted alongside the agent insert; `agents.active_prompt_version_id` is updated to point at it via a follow-up `UPDATE` (handles the FK chicken-and-egg cycle without deferred constraints).

### Tool Auto-Grant (per Main Agent)
- **D-33-07:** For each existing org, grant **every active `tool_configs` row** to that org's Main Agent via `agent_tools` rows with `allowed_channels = NULL` (= all channels). This preserves v1.4 behavior where the chat had access to all of the org's tools.
- **D-33-08:** Inactive `tool_configs` (i.e. `is_active=false`) are NOT granted — they weren't usable at v1.4 either.

### Channel Defaults
- **D-33-09:** For each existing org, insert `agent_channel_defaults(org_id, 'web_widget', main_agent_id)`. **Only `web_widget`** gets a default in this phase — Phase 35 cuts the widget over, so the default needs to exist.
- **D-33-10:** Other channels (whatsapp, messenger, instagram, manychat, telegram) get NO default in Phase 33. Admin will set them via Phase 36 dashboard. This means the channel handlers will need a NULL-aware path during Phase 35-37 — that's a Phase 35/37 concern, not Phase 33's.

### CHAN-06 Backfill (manychat_rules + meta_channels)
- **D-33-11:** Migration 039 adds `agent_id UUID NULL` column to `manychat_rules` and `meta_channels` but does **NOT backfill any rows**. Existing rules/channels keep their pre-v2.0 dispatch behavior (matched via `tool_config_id` only) until admin explicitly opts in via Phase 36 dashboard.
- **D-33-12:** No CHECK constraint enforcing XOR between `agent_id` and `tool_config_id` in Phase 33 — that's a Phase 37 concern (where the dispatcher branches on it). Phase 33 only adds the column.

### Observability Table Indexes
- **D-33-13:** Ship **4 core indexes** on `agent_invocations` from Phase 33:
  - `(organization_id, created_at DESC)` — for dashboard list (Phase 40)
  - `(trace_id)` — for cross-table joins to `action_logs` (Phase 40)
  - `(parent_invocation_id)` — for delegation tree visualization (Phase 40)
  - `(agent_id, created_at DESC)` — for per-agent metrics queries (Phase 40)
- **D-33-14:** `action_logs.trace_id` (the new additive column) gets a single index `(trace_id)` for the join.
- **D-33-15:** `agent_model_pricing.model` is the PRIMARY KEY (per REQUIREMENTS OBS-03) — no extra indexes needed.

### Prompt Versioning Trigger Location
- **D-33-16:** The DB trigger that auto-snapshots on `agents.system_prompt` UPDATE lands in **Phase 41** (Prompt Versioning UX), NOT Phase 33. Phase 33 only ships the `agent_prompt_versions` table and the seed `version=1` row per Main Agent. Manual edits to `agents.system_prompt` between Phase 33 and Phase 41 will NOT be auto-versioned — and that's acceptable because no one should be editing prompts directly in DB during that window (Phase 36 dashboard ships before Phase 41).

### `agent_invocations.status` enum values
- **D-33-17:** PostgreSQL enum `agent_invocation_status` with values: `success`, `error`, `aborted`, `skipped`, `denied`. Covers normal completion, runtime exception, AbortController timeout, schedule-based skip (e.g. inactive agent), and authorization denial (TOOL-06 / DELEG-07).
- **D-33-18:** `agent_invocations.mode` is a separate enum `agent_invocation_mode` with values: `production`, `playground`. Per REQUIREMENTS PLAY-05.

### `agent_channel` enum (already in REQUIREMENTS)
- **D-33-19:** PostgreSQL enum `agent_channel` with values: `web_widget`, `whatsapp`, `messenger`, `instagram`, `manychat`, `telegram`. Used by `agent_channel_defaults.channel`, `agent_invocations.channel`, `agents.allowed_channels[]`, `agent_tools.allowed_channels[]`.

### Backwards Compatibility
- **D-33-20:** `conversations.agent_id` and `conversation_messages.agent_id` columns NOT added in Phase 33. They land in Phase 35 (when widget cutover happens) — that's where the data starts flowing. Phase 33's GATE-07 verification (`SELECT count(*) FROM conversations WHERE agent_id IS NULL = 0`) actually executes in Phase 35, not Phase 33 — but Phase 33 must structure the seed so Phase 35's backfill can succeed.

### Claude's Discretion

These are tactical implementation choices best left to the planner / executor:

- Whether to use a Node helper script (Supabase admin client) vs pure SQL DO block for the seed migration. Pure SQL preferred if it stays under ~150 lines; Node script acceptable if SQL gets unwieldy.
- Exact table-creation order within each migration (parent tables before junctions; FK declarations correct).
- Whether to use `pgcrypto`'s `gen_random_uuid()` (already enabled in this project per migration 001) or `uuid-ossp` — use `gen_random_uuid()` for consistency.
- Cleanup strategy for stale `tool_idempotency_keys` rows (24h TTL): scheduled job vs cron-style daily DELETE vs partition. Defer to planner — could even be a Phase 38 concern if not landed here.
- Type generation: regenerate `src/types/database.ts` after each migration push, or only at the end of all 6. Recommend: at end of all 6 in one regeneration.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.0 Milestone Context
- [.planning/PROJECT.md](.planning/PROJECT.md) — Project vision, validated requirements, locked constraints
- [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md) — All 52 v2.0 REQs + 7 acceptance gates; § Locked Decisions table
- [.planning/research/SUMMARY.md](.planning/research/SUMMARY.md) — Convergent phase ordering rationale; Top 5 launch blockers
- [.planning/research/ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) — Schema sketch reference (the 4-migration sketch in §Schema sketch is what we extended to 6 here)
- [.planning/seeds/SEED-002-multi-bot-platform.md](.planning/seeds/SEED-002-multi-bot-platform.md) — Original seed for context

### Project-Wide Rules
- [./CLAUDE.md](./CLAUDE.md) — Project instructions: Node runtime for webhooks, RLS non-negotiable, AES-256-GCM for credentials, `npm run build` after changes, Supabase migration discipline (`npx supabase db push` after writing)

### Existing Migration Patterns to Mirror
- [supabase/migrations/001_foundation.sql](supabase/migrations/001_foundation.sql) — RLS policy pattern with `get_current_org_id()` SECURITY DEFINER; assistant_mappings shape (untouched, but reference for FK conventions)
- [supabase/migrations/032_ghl_reengagement_sent.sql](supabase/migrations/032_ghl_reengagement_sent.sql) — Most recent v1.x migration — clean reference for v2.0 migration style (RLS policy template, FK CASCADE conventions)
- [supabase/migrations/033_automation_schedules.sql](supabase/migrations/033_automation_schedules.sql) — Recent example of seeded row in migration (the `ghl_reengagement_sms` row in `automation_schedules`)

### Existing v1.4 Chat Pipeline (the prompt the seed must match)
- [src/lib/chat/stream.ts](src/lib/chat/stream.ts):107 — **THE** v1.4 system prompt template. The seed must reproduce this byte-for-byte after `${orgName}` substitution
- [src/lib/chat/stream/anthropic.ts](src/lib/chat/stream/anthropic.ts):13,35,99 — `systemPrompt` consumer (reference only — not modified in Phase 33)
- [src/lib/chat/stream/openrouter.ts](src/lib/chat/stream/openrouter.ts):13,31 — `systemPrompt` consumer (reference only)

### Vapi Path (DO NOT TOUCH)
- [src/app/api/vapi/](src/app/api/vapi/) — entire directory; Phase 33 must not modify
- `assistant_mappings` table (defined in 001_foundation.sql) — Phase 33 must not modify
- [src/lib/action-engine/resolve-tool.ts](src/lib/action-engine/resolve-tool.ts) — keep `(orgId, toolName)` signature; Phase 33 does NOT add the agent-aware sibling (that's Phase 34)

### Type System
- [src/types/database.ts](src/types/database.ts) — must be regenerated after migrations 034-039 are applied; this is the gate for `npm run build` to pass

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`get_current_org_id()` SECURITY DEFINER function** (migration 001): use as-is for all v2.0 RLS policies
- **`gen_random_uuid()`** (pgcrypto, enabled in 001): primary key default for all new tables
- **Migration commit/push pattern** from v1.9 Phase 32: write migrations → operator runs `npx supabase db push` → executor regenerates `database.ts`. Same pattern applies here. SUPABASE_DB_PASSWORD lives in `.env.local` (symlinked to G:\My Drive\...) — see memory `reference_supabase_db_password.md` for PowerShell loader snippet.

### Established Patterns to Mirror
- **Naming convention:** snake_case table + column names; FK columns named `{referenced_table_singular}_id` (e.g. `agent_id`, `tool_config_id`); junction tables named `{a}_{b}s` (e.g. `agent_tools`)
- **Audit columns:** `created_at`, `updated_at` with `DEFAULT now()`; `created_by`, `updated_by` as UUID FK to `auth.users(id)` when relevant
- **RLS template:** `CREATE POLICY "policy_name" ON table_name USING (organization_id = (SELECT public.get_current_org_id()))`
- **FK cascades:** `ON DELETE CASCADE` for org-owned data (RLS-protected); `ON DELETE RESTRICT` or no cascade for cross-system references

### Integration Points (data flow Phase 33 enables)
- Phase 34 will resolve agents from `agent_channel_defaults` → `agents` → apply `channel_overrides` → call LLM (data shape decided here)
- Phase 35 will write to `conversations.agent_id` (column added in Phase 35) and `agent_invocations` (table added here)
- Phase 36 will SELECT from `agents`, `agent_tools`, `tool_configs` joined for the CRUD UI
- Phase 38 will INSERT into `agent_partners` and JOIN `agent_tools` from multiple agents for intersection authz

### Things NOT to Build in Phase 33
- The `runAgent()` function (Phase 34)
- Any TS code touching new tables beyond `database.ts` regeneration
- The `resolveAgentTool` resolver (Phase 34)
- Any CRUD UI (Phase 36)
- The DB trigger for prompt versioning auto-snapshot (Phase 41)
- The cleanup job for `tool_idempotency_keys` TTL (Phase 38 or later)

</code_context>

<specifics>
## Specific Ideas

- The 6-migration split mirrors ARCHITECTURE.md's 4-migration sketch but adds two more (`tool_idempotency_keys`+`agent_model_pricing` as 038, and `manychat_rules`+`meta_channels` agent_id additions as 039) to keep concerns isolated.
- Seed prompt fallback string when `organizations.name` is NULL: literal `"your team"` (warmer than "your organization", less corporate-sounding than "the team").
- `agent_model_pricing` seed should include at minimum: Claude Opus 4.7, Claude Sonnet 4.6, Claude Haiku 4.5, GPT-4o, GPT-4o-mini, Gemini 2.5 Pro/Flash. Source: published rates as of 2026-05-16. The planner/executor should fetch current rates rather than hardcoding stale numbers — flag for verification at execution time.

</specifics>

<deferred>
## Deferred Ideas

- **CHECK constraint enforcing XOR between `manychat_rules.agent_id` and `tool_config_id`** — defer to Phase 37 where the dispatcher actually branches on this column. Adding the constraint in Phase 33 would block the existing rules from continuing to work.
- **DB trigger for prompt versioning auto-snapshot** — defer to Phase 41 (Prompt Versioning UX) per ROADMAP.
- **`tool_idempotency_keys` TTL cleanup mechanism** — defer to Phase 38 (Multi-Agent Delegation + Idempotency) which is where the table starts being written to.
- **`conversations.agent_id` and `conversation_messages.agent_id`** — defer to Phase 35 where data starts flowing through the runtime.
- **Per-org override column for cost cap** (`organizations.daily_cost_cap_usd_override`) — defer to Phase 34 (Runtime Skeleton) where the cap is enforced. Phase 33 only ships the agent-runtime tables; the cap-config column on `organizations` belongs with the runtime work.

</deferred>

---

*Phase: 33-schema-foundation-legacy-default-agent-backfill*
*Context gathered: 2026-05-16*
