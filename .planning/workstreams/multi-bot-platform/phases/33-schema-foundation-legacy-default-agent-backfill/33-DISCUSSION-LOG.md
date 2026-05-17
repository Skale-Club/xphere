# Phase 33: Schema Foundation + Legacy Default Agent Backfill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 33-schema-foundation-legacy-default-agent-backfill
**Areas discussed:** Seed prompt strategy, ManyChat/Meta backfill, Migration splitting, Observability indexes

---

## Seed Prompt Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Resolve org_name per-org at seed time; runtime appends kb_context | Each org gets the prompt with its own name baked in. Closest to v1.4 byte-equal. Drift risk if org renames — minor. | ✓ |
| Template syntax {{org_name}} + {{kb_context}}, runtime interpolates both | Single canonical seed string with placeholders. Runtime needs template engine. Future-proof for user-authored prompts using same {{var}} convention. | |
| Literal '${orgName}' as stored text, runtime does JS-style interpolation | Most portable but introduces 2 syntaxes (JS-style here, {{}} for v1.9 SMS). Inconsistent. | |

**User's choice:** Option 1 (per-org resolved at seed time)
**Notes:** Closest to "byte-equal v1.4" success criterion. Runtime stays minimal — just appends KB context as before. NULL org name fallback to "your team" (Claude's call, recorded as D-33-05).

---

## ManyChat/Meta `agent_id` Backfill (CHAN-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Leave NULL initially; admin opts in via Phase 36 dashboard | Safer. Existing v1.6 ManyChat dispatch + v1.3 Meta processing keep working unchanged. Agent path activates per-rule when admin chooses. | ✓ |
| Backfill to org's Main Agent for all rules/channels | Day-1 of Phase 37 every existing inbound channel jumps to agent runtime. Faster but bigger blast radius. | |

**User's choice:** Option 1 (NULL, admin opt-in)
**Notes:** Phase 33 just adds the column; Phase 37 handles the dispatcher branch. CHECK constraint enforcing XOR between `agent_id` and `tool_config_id` deferred to Phase 37 too (would block existing rules in Phase 33).

---

## Migration Splitting Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 6 logical migrations 034-039 (per ARCHITECTURE +2) | 034: agents+agent_tools+agent_partners; 035: agent_prompt_versions; 036: agent_channel_defaults; 037: agent_invocations + action_logs ext; 038: tool_idempotency_keys + agent_model_pricing seed; 039: manychat_rules.agent_id + meta_channels.agent_id. Easier rollback per concern. | ✓ |
| 1 mega-migration 034 | Everything in one file. Simpler to push but harder to review/rollback. | |

**User's choice:** Option 1 (6 migrations)
**Notes:** Two more than ARCHITECTURE.md's original 4-sketch — split out idempotency_keys+pricing (038) and channel agent_id additions (039) as their own concerns.

---

## Observability Table Indexes

| Option | Description | Selected |
|--------|-------------|----------|
| Ship 4 core indexes upfront | (org_id, created_at DESC), (trace_id), (parent_invocation_id), (agent_id, created_at DESC). Standard for known query patterns. | ✓ |
| Ship minimal (org_id) only; add others when slow queries surface | Less storage overhead now. Risk: hot-add in production when Phase 40 launches. | |

**User's choice:** Option 1 (4 core indexes upfront)
**Notes:** All 4 query patterns are documented in ARCHITECTURE.md and FEATURES.md OBS-04..07. Storage cost negligible vs operational risk of slow dashboard launches.

---

## Claude's Discretion (recorded as D-33-* but not user-selected)

- Source location of v1.4 prompt template: literal text from `src/lib/chat/stream.ts:107` (D-33-04)
- NULL org name fallback: `"your team"` (D-33-05)
- FK chicken-and-egg for `active_prompt_version_id`: nullable column + UPDATE after both rows inserted (D-33-06)
- Tool auto-grant scope: only `is_active=true` tool_configs (D-33-08)
- Channel default seeded only for `web_widget` (D-33-09)
- Status enum values: `success | error | aborted | skipped | denied` (D-33-17)
- Mode enum values: `production | playground` (D-33-18)
- Channel enum: `web_widget | whatsapp | messenger | instagram | manychat | telegram` (D-33-19)

## Deferred Ideas

- CHECK constraint enforcing XOR on `manychat_rules.agent_id` vs `tool_config_id` → Phase 37
- DB trigger for prompt versioning auto-snapshot → Phase 41
- `tool_idempotency_keys` TTL cleanup mechanism → Phase 38
- `conversations.agent_id` + `conversation_messages.agent_id` → Phase 35
- `organizations.daily_cost_cap_usd_override` → Phase 34
