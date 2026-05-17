---
phase: 34-agent-runtime-skeleton-day-1-guardrails
plan: 03
subsystem: agent-runtime
tags: [agent-runtime, types, resolver, supabase, channel-overrides, kb-scope]

# Dependency graph
requires:
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    plan: 01
    provides: ai@6.0.184 + @ai-sdk/anthropic@3.0.78 installed
  - phase: 34-agent-runtime-skeleton-day-1-guardrails
    plan: 02
    provides: migration 042 applied; database.ts updated with 'running' enum value + daily_cost_cap_usd_override
provides:
  - src/lib/agent-runtime/types.ts — all shared TypeScript contracts (AgentChannel, AgentRunResult, AgentRunContext, AgentRunOptions, ResolvedAgent, ResolvedToolConfig)
  - src/lib/agent-runtime/resolve-agent.ts — resolveAgent(agentId, orgId, channel) with D-34-06 prompt join + D-34-11 channel_overrides merge
  - src/lib/agent-runtime/resolve-agent-tool.ts — resolveAgentTool(agentId, toolName, channel) with agent_tools junction authorization
affects:
  - 34-04 (guardrails.ts imports ResolvedAgent)
  - 34-05 (invocations.ts imports AgentRunContext, AgentRunResult)
  - 34-06 (run-agent.ts imports all three files)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveAgent uses service-role client + JOIN agent_prompt_versions via active_prompt_version_id FK hint"
    - "channel_overrides deep-merge: system_prompt suffix-append with \\n\\n; model/temperature/max_tokens/max_history replace"
    - "resolveAgentTool: agent_tools junction query with per-tool channel restriction (null=all channels)"
    - "ResolvedToolConfig.credentialsEncrypted maps from integrations.encrypted_api_key"

key-files:
  created:
    - src/lib/agent-runtime/types.ts
    - src/lib/agent-runtime/resolve-agent.ts
    - src/lib/agent-runtime/resolve-agent-tool.ts
  modified: []

key-decisions:
  - "D-34-06 honored: system_prompt read from agent_prompt_versions via active_prompt_version_id FK hint in SELECT; fallback to agents.system_prompt with console.warn structured log if version row missing"
  - "D-34-07 honored: resolveTool() in src/lib/action-engine/ untouched; resolveAgentTool() is entirely new in agent-runtime/"
  - "D-34-11 honored: system_prompt is suffix-appended (\\n\\n + override); model/temperature/max_tokens/max_history replace"
  - "agents table has no max_tokens or temperature columns (not in migration 034): maxTokens defaults to 1024 from override or hardcoded default; temperature is override-only (undefined if not overridden)"
  - "integrations.credentials_encrypted field is actually encrypted_api_key in the DB schema — mapped correctly in resolveAgentTool"

patterns-established:
  - "Agent runtime files use createServiceRoleClient() exclusively — no user-scoped client"
  - "All types imported from single source: src/lib/agent-runtime/types.ts"

requirements-completed:
  - AGENT-04
  - AGENT-05
  - AGENT-06
  - AGENT-07
  - TOOL-05
  - RUNTIME-01
  - RUNTIME-02

# Metrics
duration: 17min
completed: 2026-05-16
---

# Phase 34 Plan 03: types.ts + resolve-agent.ts + resolve-agent-tool.ts Summary

**Three foundational agent-runtime files created: shared TypeScript contracts (types.ts), agent resolver with channel_overrides merge (resolve-agent.ts), and tool attachment authorizer (resolve-agent-tool.ts). All compile clean under npm run build.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-05-16T12:49:11Z
- **Completed:** 2026-05-16
- **Tasks:** 2/2
- **Files created:** 3

## Accomplishments

- Created `src/lib/agent-runtime/types.ts` — single source of truth for all runtime TypeScript contracts (AgentChannel, AgentRunResult, AgentRunContext, AgentRunOptions, ResolvedAgent, ResolvedToolConfig)
- Created `src/lib/agent-runtime/resolve-agent.ts` — reads system_prompt via agent_prompt_versions JOIN (D-34-06), applies channel_overrides deep-merge (D-34-11), includes kb_scope for AGENT-05
- Created `src/lib/agent-runtime/resolve-agent-tool.ts` — queries agent_tools junction, checks per-tool channel restriction, does NOT touch src/lib/action-engine/ (D-34-07)
- `npm run build` exits 0 for all three files
- `resolveTool()` in `src/lib/action-engine/` verified untouched

## Type Shapes Locked

| Type | Key Fields |
|---|---|
| `AgentChannel` | Projection of `Database['public']['Enums']['agent_channel']` |
| `AgentRunResult` | text, usage.{tokensIn,tokensOut}, invocationId, traceId, status (5 values), errorDetail? |
| `AgentRunContext` | orgId, agentId, channel, traceId, mode, _depth, systemPrompt, model, temperature?, maxTokens, maxHistory, fallbackMessage, allowedChannels, userMessage, historyWindow |
| `AgentRunOptions` | orgId, agentId, channel, userMessage + optional fields; _depth and parentInvocationId internal |
| `ResolvedAgent` | agentId, orgId, name, systemPrompt, model, temperature?, maxTokens, maxHistory, fallbackMessage, allowedChannels, isActive, kbScope |
| `ResolvedToolConfig` | toolConfigId, toolName, actionType, config, integrationId, integrationProvider, credentialsEncrypted |

## Task Commits

1. **Task 1: Create types.ts** — `f2d2c91` (feat)
2. **Task 2: Create resolve-agent.ts and resolve-agent-tool.ts** — `89fe889` (feat)

## Files Created/Modified

- `src/lib/agent-runtime/types.ts` — 89 lines, all 6 required types exported
- `src/lib/agent-runtime/resolve-agent.ts` — 95 lines, resolveAgent() with D-34-06/11 compliance
- `src/lib/agent-runtime/resolve-agent-tool.ts` — 72 lines, resolveAgentTool() with junction query

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `Database['public']['Json']` invalid type reference**
- **Found during:** Task 1 build verification
- **Issue:** Plan's type template used `Database['public']['Json']` but `Json` is a top-level export in `database.ts`, not nested under the Database interface's public key
- **Fix:** Changed to `import type { Database, Json }` and used bare `Json` in ResolvedToolConfig.config
- **Files modified:** `src/lib/agent-runtime/types.ts`
- **Commit:** `f2d2c91`

**2. [Rule 1 - Bug] `integrations.credentials_encrypted` vs actual column name `encrypted_api_key`**
- **Found during:** Task 2 implementation
- **Issue:** Plan's resolve-agent-tool.ts template referenced `credentials_encrypted` as the integration column, but the actual DB schema (migration 002) and database.ts types use `encrypted_api_key`
- **Fix:** SELECT uses `encrypted_api_key`; return maps it to `credentialsEncrypted` per ResolvedToolConfig shape
- **Files modified:** `src/lib/agent-runtime/resolve-agent-tool.ts`
- **Commit:** `89fe889`

**3. [Rule 1 - Bug] `agents` table has no `max_tokens` or `temperature` columns**
- **Found during:** Task 2 implementation — reading migration 034_agents.sql
- **Issue:** CONTEXT.md interface section listed `max_tokens INTEGER` and `temperature NUMERIC` as agents table columns, but migration 034 does not include them. The SELECT statement would fail or the TypeScript types would reject undefined column names.
- **Fix:** Removed `max_tokens` and `temperature` from the SELECT list. `maxTokens` defaults to 1024 (override-only or hardcoded default); `temperature` is `undefined` unless present in channel_overrides. Both are still accepted as fields in ResolvedAgent per the locked type shape (channel_overrides can supply them).
- **Files modified:** `src/lib/agent-runtime/resolve-agent.ts`
- **Commit:** `89fe889`

## Known Stubs

None — all fields are wired to real DB columns or channel_override fallbacks. No placeholder data.

## Self-Check: PASSED

| Item | Status |
|---|---|
| `src/lib/agent-runtime/types.ts` | FOUND |
| `src/lib/agent-runtime/resolve-agent.ts` | FOUND |
| `src/lib/agent-runtime/resolve-agent-tool.ts` | FOUND |
| Commit `f2d2c91` (types.ts) | FOUND |
| Commit `89fe889` (resolvers) | FOUND |
| `npm run build` exit 0 | PASSED |
