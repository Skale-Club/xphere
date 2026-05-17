---
phase: 33-schema-foundation-legacy-default-agent-backfill
plan: 06
subsystem: schema-foundation
tags: [migration, seed, agents, backfill, v2.0, idempotent]
requirements: [AGENT-09, TOOL-01]
requirements_addressed: [AGENT-09, TOOL-01]
dependency_graph:
  requires:
    - supabase/migrations/001_foundation.sql (organizations, get_current_org_id)
    - supabase/migrations/002_action_engine.sql (tool_configs)
    - supabase/migrations/034_agents.sql (agents, agent_tools, agent_channel enum)
    - supabase/migrations/035_agent_prompt_versions.sql (agent_prompt_versions, agents.active_prompt_version_id)
    - supabase/migrations/036_agent_channel_defaults.sql (agent_channel_defaults)
  provides:
    - One 'Main Agent' row per existing org in public.agents
    - One agent_prompt_versions(version=1) row per Main Agent (system_prompt mirrors agents.system_prompt)
    - agents.active_prompt_version_id populated for every Main Agent
    - One agent_tools row per (Main Agent, active tool_configs) pair (allowed_channels=NULL)
    - One agent_channel_defaults(org, 'web_widget', main_agent_id) row per org
  affects:
    - supabase/migrations/ (adds 040; no edits to prior migrations)
tech-stack:
  added: []
  patterns:
    - pure-SQL DO $migration$ block (no Node helper) for seed iteration
    - idempotent INSERTs via IF EXISTS loop guard + ON CONFLICT DO NOTHING
    - COALESCE(NULLIF(...), 'your team') fallback for NULL/empty org names
    - dollar-quote tag $migration$ instead of $$ (defensive against nested $$)
key-files:
  created:
    - supabase/migrations/040_seed_main_agents.sql
  modified: []
decisions:
  - "D-33-03 applied: ${orgName} resolved at seed time per row of public.organizations"
  - "D-33-04 honored: system_prompt is byte-equal to src/lib/chat/stream.ts:107 with kbContext omitted (kbContext appended at runtime)"
  - "D-33-05 applied: NULL/empty organizations.name -> literal 'your team' via COALESCE(NULLIF(org.name, ''), 'your team')"
  - "D-33-06 applied: INSERT agent -> INSERT version=1 -> UPDATE agents.active_prompt_version_id resolves the FK chicken-and-egg cycle without deferred constraints"
  - "D-33-07/08 applied: agent_tools backfilled for every active tool_config in the org; inactive (is_active=false) skipped"
  - "D-33-09 applied: agent_channel_defaults seeded only with channel='web_widget'"
  - "D-33-10 honored: no other channels seeded (whatsapp, messenger, instagram, manychat, telegram) — Phase 36 admin populates"
  - "Model literal 'anthropic/claude-sonnet-4-6' overrides agents.model default of 'anthropic/claude-haiku-4-5' to match the v1.4 chat default (Sonnet tier)"
  - "Idempotency strategy: top-of-loop IF EXISTS guard on (organization_id, name='Main Agent') skips the whole 5-step recipe; ON CONFLICT DO NOTHING on agent_tools (agent_id, tool_config_id) and agent_channel_defaults (organization_id, channel) defends against partial prior runs"
metrics:
  duration_minutes: ~3
  tasks_completed: 1
  commits: 1
  files_created: 1
  completed_date: 2026-05-15
---

# Phase 33 Plan 06: Wave 3 — Migration 040 Main Agent Backfill Summary

**One-liner:** Pure-SQL idempotent backfill (migration 040) that seeds one `Main Agent` per existing org with byte-identical v1.4 chat behavior — 1 agents row + 1 agent_prompt_versions row + N agent_tools rows (active tool_configs only) + 1 agent_channel_defaults(web_widget) row per org, all guarded by `IF EXISTS` and `ON CONFLICT DO NOTHING`.

## What Was Built

### Migration 040 — `040_seed_main_agents.sql`

A single `DO $migration$ ... $migration$` block that iterates `public.organizations ORDER BY created_at ASC` and for each org:

1. **Idempotency guard:** `IF EXISTS (SELECT 1 FROM public.agents WHERE organization_id=org.id AND name='Main Agent') THEN CONTINUE`
2. **Prompt assembly (D-33-03/04/05):**
   ```sql
   v_prompt := 'You are a helpful assistant for '
            || COALESCE(NULLIF(org.name, ''), 'your team')
            || '. Answer questions accurately and concisely using the provided context. If you don''t know the answer, say so.';
   ```
   Apostrophe in `don't` escaped as `don''t`. `${kbContext}` from stream.ts:107 deliberately omitted — appended at runtime.
3. **Step 1 — INSERT agent:** `(name='Main Agent', slug='main-agent', model='anthropic/claude-sonnet-4-6', is_active=true, allowed_channels=ARRAY['web_widget']::public.agent_channel[], description='Legacy default agent — backfilled from v1.4 chat behavior at Phase 33.')` returning `v_agent_id`.
4. **Step 2 — INSERT version=1:** `agent_prompt_versions(version=1, system_prompt=v_prompt)` returning `v_version_id`.
5. **Step 3 — Close FK cycle (D-33-06):** `UPDATE public.agents SET active_prompt_version_id = v_version_id WHERE id = v_agent_id`.
6. **Step 4 — Grant active tools (D-33-07/08):** `INSERT INTO agent_tools SELECT … FROM tool_configs WHERE organization_id=org.id AND is_active=true ON CONFLICT (agent_id, tool_config_id) DO NOTHING`. `allowed_channels=NULL` preserves v1.4 (all channels).
7. **Step 5 — Channel default (D-33-09):** `INSERT INTO agent_channel_defaults (org, 'web_widget', v_agent_id) ON CONFLICT (organization_id, channel) DO NOTHING`.
8. `RAISE NOTICE` per org for observability during push.

Updated table comment on `public.agents` to reference Migration 040's seed behavior.

## Acceptance Criteria

All 17 plan acceptance grep checks pass:

| Check | Expected | Got |
| ---- | --- | --- |
| File exists | FOUND | FOUND |
| `INSERT INTO public.agents ` | 1 | 1 |
| `INSERT INTO public.agent_prompt_versions` | 1 | 1 |
| `INSERT INTO public.agent_tools` | 1 | 1 |
| `INSERT INTO public.agent_channel_defaults` | 1 | 1 |
| `UPDATE public.agents` | 1 | 1 |
| `You are a helpful assistant for` | 1 | 1 |
| `'your team'` | >=1 | 3 (comment + SQL literal + fallback) |
| `don''t` escape | 1 | 1 |
| `say so\.'` closing delimiter | 1 | 1 |
| `IF EXISTS` | >=1 | 1 |
| `AND name = 'Main Agent'` | >=1 | 1 |
| `ON CONFLICT (agent_id, tool_config_id) DO NOTHING` | 1 | 1 |
| `ON CONFLICT (organization_id, channel) DO NOTHING` | 1 | 1 |
| `tc.is_active = true` | 1 | 1 |
| `'web_widget'` | >=1 | 3 (comment + array literal + channel insert) |
| `'anthropic/claude-sonnet-4-6'` | 1 | 1 |
| `ARRAY['web_widget']::public.agent_channel[]` | 1 | 1 |
| `'main-agent'` slug | 1 | 1 |
| `DO $migration$` tag | 1 | 1 |
| `DROP TABLE|RENAME|DELETE FROM` forbidden | 0 | 0 |

`npm run build` exits 0 — no TS impact (pure SQL).

## Deviations from Plan

None — migration copied verbatim from the plan body via the Write tool. No deviation rules triggered.

## Authentication Gates

None encountered. File-only change, no remote work. Migration is **not** pushed in this plan — Plan 07 owns `npx supabase db push`.

## Commits

| Task | Commit | Files |
| ---- | ------ | ----- |
| 1 | 11bf432 | supabase/migrations/040_seed_main_agents.sql |

Single-agent foreground commit (no `--no-verify` per Wave 3 protocol).

## Byte-Equality Audit (D-33-04)

Source template, src/lib/chat/stream.ts:107:
```
`You are a helpful assistant for ${orgName}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.${kbContext}`
```

Stored system_prompt for org named "Acme Inc" (substituted, kbContext stripped):
```
You are a helpful assistant for Acme Inc. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.
```

Stored system_prompt for NULL/empty org name:
```
You are a helpful assistant for your team. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.
```

These exact strings are what Plan 01's `tests/agent-schema-prompt-byte-equal.test.ts` will assert after Plan 07 push.

## Downstream Impact

- **Plan 07 (Wave 4, push) — depends on this plan:** Runs `npx supabase db push` to apply migrations 034–040 together. After successful push, Plan 01 RED smoke tests (`agent-schema-seed.test.ts`, `agent-schema-prompt-byte-equal.test.ts`) flip GREEN.
- **Phase 34 (Runtime Skeleton):** `runAgent()` will read `agents.system_prompt` directly (still — `active_prompt_version_id` plumbing comes in Phase 41); `resolveAgentForChannel(orgId, 'web_widget')` will return the Main Agent because of the seed row in `agent_channel_defaults`; tool authorization via `agent_tools` will find every previously-active tool granted.
- **Phase 35 (Widget Cutover):** When the widget chat path moves to `runAgent()`, day-1 behavior is byte-identical to v1.4 because the seeded system_prompt and tool set exactly mirror the inline v1.4 implementation.
- **Phase 36 (Admin UI):** Other channels (whatsapp, messenger, instagram, manychat, telegram) get their `agent_channel_defaults` rows here.
- **Phase 41 (Prompt Versioning UX):** The seeded `version=1` row is the starting point for the auto-snapshot timeline; the trigger that creates subsequent versions on `agents.system_prompt` UPDATE lands in Phase 41 per D-33-16.

## Known Stubs

None. The migration is complete and self-contained; the `RAISE NOTICE` is observability scaffolding, not a stub.

## Self-Check: PASSED

- File supabase/migrations/040_seed_main_agents.sql — FOUND
- Commit 11bf432 — FOUND
