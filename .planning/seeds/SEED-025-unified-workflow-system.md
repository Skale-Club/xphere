---
id: SEED-025
status: active
planted: 2026-05-20
planted_during: post-SEED-024 push notifications; nav-level "Workflows" unification complete (fa1f826) but data model still split
trigger_when: explicit user request OR before any major workflow-builder UX investment OR before SEED-026 AI authoring can ship
scope: Large
priority: critical
depends_on: [SEED-019 (visual flow engine), SEED-002 (action engine)]
blocks: [SEED-026, SEED-027]
phases_shipped: [A, B, D, E]
phases_pending: [C, F]
last_commit: e558768
---

# SEED-025: Unified Workflow System — Single Data Model, Single Engine, Single UI

The product currently ships **two parallel automation systems** that the user must learn separately. SEED-025 collapses them into one canonical "Workflow" abstraction. Single-action automations become flows-of-one-node; multi-step flows remain flows. The Action Engine becomes a special case of the Flow Engine.

This is **the foundation for SEED-026 (AI authoring)** and unblocks SEED-027 (calendar triggers/actions). Without this seed, AI surfaces have to learn two models, two execution paths, and two log tables — making robust AI authoring infeasible.

## The two systems today

| Dimension                | "Automations" (Action Engine)                       | "Visual Flows"                                            |
|--------------------------|------------------------------------------------------|------------------------------------------------------------|
| Table                    | `tool_configs`                                       | `workflows` + `workflow_versions`                          |
| Model                    | 1 tool = 1 atomic action                             | 1 flow = DAG of N nodes with branching                    |
| Trigger                  | AI agent tool-call, voice/chat webhook               | Event, schedule, manual run                                |
| Engine                   | `lib/action-engine/` (resolve-tool → execute-action) | `lib/flows/engine.ts` (DAG executor)                       |
| Logs                     | `action_logs`                                        | `workflow_runs` + `workflow_run_steps`                     |
| UI                       | Tools table (rows)                                   | Drag-and-drop canvas                                        |
| Author                   | Manual form, sometimes agent registration             | Manual canvas, AI builder (SEED-019 Phase C)                |

## The unified model

Everything is a **Workflow**. A workflow has:

- **A trigger** — `tool_call` (invokable by name from agents/webhooks), `event` (e.g. `meeting.confirmed`), `schedule` (cron), `manual`, `webhook_url`
- **A graph** — one or more nodes connected by edges; single-action workflows have exactly one action node
- **A version** — every save creates a new immutable `workflow_versions` row; live execution uses `current_version_id`
- **Health gating** — integration nodes are validated against connection status before publishing (see "Integration gating" below)

The `tool_configs` table is migrated into `workflows` (with `kind = 'tool'` distinguishing migrated single-action workflows). The Action Engine `resolve-tool(name) → execute-action(config)` collapses to `resolve-workflow(name) → run-workflow(workflow_id)` — where for a single-action workflow that's a one-step run.

## Integration gating + connection health

A workflow that uses a disconnected integration cannot run, and **cannot be authored** by the AI in the first place.

- Each integration row gets a `health_status: 'connected' | 'degraded' | 'disconnected'` column with `last_checked_at` and `last_error`
- A scheduled job (Edge Function `integration-health`) pings each active integration every 15 min: OAuth token refresh probe, ManyChat ping, Evolution `/instance/connectionState`, GoHighLevel token validity, Vapi key check
- The workflow builder (manual + AI) consumes a filtered "available capabilities" view: only `connected` integrations expose their nodes
- The spec.json/api consumed by SEED-026 is **org-filtered** — the AI literally cannot generate a node referencing a disconnected integration
- When health flips to `disconnected`, every published workflow that references that integration is marked `blocked` (not deleted, not deactivated — recoverable on reconnect). UI shows a "Reconnect to resume" banner

## Goals

1. One mental model: "Workflow" — no more "automation vs flow" distinction in product or docs
2. One data path: every execution writes to `workflow_runs`
3. One UI surface: single list, single builder, no tabs
4. Zero downtime migration: existing tools keep working by name during and after migration
5. AI-native spec: machine-readable, org-filtered, validated — see SEED-026
6. Backwards compatible: every webhook caller (Vapi/ManyChat/Evolution/Twilio/etc.) keeps resolving tools by name; resolver is rewritten internally but external contract unchanged

## Non-goals

- Not changing trigger semantics for existing tools (Vapi keeps calling tools by name)
- Not removing legacy `/automations/*` redirects (kept indefinitely for stale bookmarks)
- Not rebuilding the canvas — SEED-019 builder is reused as-is

## Phases

### Phase A — Unified schema (migration only, no runtime impact)
- Migration 080: extend `workflows` table
  - Add `kind text NOT NULL DEFAULT 'flow' CHECK (kind IN ('flow', 'tool'))`
  - Add `tool_name text` (nullable; unique per `(org_id, tool_name) WHERE kind = 'tool'`)
  - Add `trigger_type text` (`tool_call | event | schedule | manual | webhook_url`)
  - Add `trigger_config jsonb DEFAULT '{}'`
  - Add `health_blocked boolean DEFAULT false` and `health_blocked_reason text`
- Migration 081: extend `integrations` with `health_status`, `last_checked_at`, `last_error`
- Migration 082: backfill — every `tool_configs` row creates a matching `workflows` row with `kind='tool'`, a 1-node `workflow_versions` definition, and `tool_name = tool_configs.name`. Existing `tool_configs.id` is stored on the new workflow as `legacy_tool_config_id` so external references survive.
- No code changes yet — both tables coexist. Old code reads `tool_configs`, new code can read from `workflows WHERE kind='tool'`.

### Phase B — Engine unification
- `lib/flows/engine.ts` learns a new node type `tool_action` that wraps `lib/action-engine/execute-action`
- New `lib/workflows/resolve.ts` — `resolveWorkflow(orgId, toolName)` returns the workflow row (replaces `resolve-tool.ts` internally)
- New `lib/workflows/run.ts` — `runWorkflow(workflow, input, context)` — single entry point for all execution
- Action Engine `execute-action` becomes a thin adapter: looks up workflow by name → calls `runWorkflow` → returns result in the legacy shape webhook callers expect
- All `action_logs` writes mirror to `workflow_runs` during transition (dual-write)
- Behind feature flag `unified_workflow_engine` (org-level), default off

### Phase C — Webhook / agent compat layer
- Audit every caller: Vapi (`/api/vapi/tools`, `/api/vapi/calls`), ManyChat (`/api/manychat/webhook`), Evolution (`/api/evolution/webhook`), Meta (`/api/meta/webhook`), Twilio (`/api/twilio/sms`), agent tool-call dispatcher
- Each calls `resolveWorkflow(orgId, toolName)` instead of `resolveTool` — wrapped in compat shim that handles both shapes during rollout
- Enable `unified_workflow_engine` flag globally; observe parity for 7 days via dual-write logs
- Tool-call API used by AI agents (the tools registry returned to assistants) is rewritten to query `workflows WHERE kind IN ('tool', 'flow') AND trigger_type = 'tool_call' AND NOT health_blocked` — flows automatically become callable tools

### Phase D — Integration health system
- Migration 083: integration health columns (already in A) + `integration_health_checks` table for history
- Edge function `integration-health` (Deno, cron every 15 min via pg_cron or Vercel Cron)
  - For each `connected` integration: run integration-specific probe
  - On failure: bump `failure_count`; flip to `degraded` at 2 consecutive, `disconnected` at 4
  - On flip to `disconnected`: mark all workflows referencing this integration as `health_blocked=true`
  - On reconnect (manual via UI or successful probe after degraded): clear `health_blocked`
- UI in `/integrations`: each integration card shows live health badge + "Reconnect" CTA on degraded/disconnected
- Workflow builder: integration palette filtered by `health_status='connected'`; existing nodes referencing disconnected integrations show inline warning

### Phase E — UI merge
- `/workflows` page collapses tabs into a single unified list
- One table/grid showing all workflows with columns: `name | kind | trigger | last_run | status | health`
- Single "New workflow" button → opens canvas; canvas detects single-action save and persists as `kind='tool'` automatically (no separate "new tool" flow)
- `/workflows/{id}` opens canvas for both kinds; canvas hides multi-node UI when `kind='tool'` and offers "Convert to flow" affordance
- Logs unify: `/workflows/logs` shows `workflow_runs` with filter by kind/trigger
- Delete `/workflows/page.tsx` Tabs component; redirect `?tab=automations`, `?tab=flows` to base path

### Phase F — Cutover + cleanup
- `tool_configs` table marked deprecated; reads removed; dual-write removed (writes only go to `workflows`)
- `lib/action-engine/` collapsed into `lib/workflows/` — old paths kept as re-exports for one release
- `action_logs` writes stop (table retained read-only for historical queries; eventually archived to cold storage)
- All `/automations/*` route files deleted except for `/automations` → `/workflows` permanent redirect (already in place)
- Migration 084: drop `tool_configs` foreign-key references; table renamed to `_legacy_tool_configs` (not dropped — kept for 90 days for rollback safety)

## Data migration strategy (Phase A backfill)

Each `tool_configs` row becomes a workflow with this definition:

```jsonc
// workflow_versions.definition
{
  "version": 1,
  "nodes": [
    {
      "id": "trigger",
      "kind": "trigger",
      "trigger_type": "tool_call",
      "config": { "tool_name": "{name}" }
    },
    {
      "id": "action",
      "kind": "tool_action",
      "integration_id": "{integration_id}",
      "action_type": "{action_type}",
      "params": { ... },
      "fallback_message": "{fallback_message}"
    }
  ],
  "edges": [{ "from": "trigger", "to": "action" }]
}
```

Backfill SQL runs in Phase A migration 082; idempotent (re-runnable). New workflow IDs are stable UUIDs derived from `tool_configs.id` for traceability.

## Backwards compatibility contract

- **Tool name resolution**: `resolveWorkflow(orgId, name)` first looks at `workflows.tool_name`, then falls back to `_legacy_tool_configs.name` until Phase F cleanup. After cleanup, only `workflows.tool_name`.
- **Agent tool registries**: AI agents that fetch the list of available tools receive the same shape (name, description, params schema) — the source of truth shifts from `tool_configs` to `workflows`.
- **Webhook contracts**: Vapi/ManyChat/Evolution external contracts unchanged. Internally everything goes through `runWorkflow`.
- **Action logs**: `action_logs` view (or table) preserved read-only for historical queries; new runs only in `workflow_runs`.

## Risks + mitigations

| Risk                                           | Mitigation                                                                                  |
|------------------------------------------------|---------------------------------------------------------------------------------------------|
| Tool name collision during migration            | Constraint on `(org_id, tool_name)` plus pre-migration audit query                          |
| Webhook latency increase from extra indirection | Benchmark Phase B; if `runWorkflow` overhead > 50ms over `execute-action`, optimize inline  |
| Health check flapping triggers blocked flag    | Require 4 consecutive failures before `disconnected`; rate limit health flips per hour       |
| AI generates workflow for disconnected integration | Spec.json filtered server-side per org; client cannot bypass                              |
| Rollback if cutover regresses                  | `_legacy_tool_configs` kept 90 days; feature flag can re-enable dual-read                    |

## Success criteria

1. ✅ Single "Workflows" UI with no tabs; single builder for both kinds
2. ✅ Every existing webhook/agent caller continues to resolve tools by name with no contract change
3. ✅ Integration health probes run every 15 min; disconnected integrations cannot be referenced by new workflows
4. ✅ All execution writes to `workflow_runs`; `action_logs` is read-only
5. ✅ Spec.json/api endpoint returns org-filtered capabilities; consumed by SEED-026 Copilot
6. ✅ Zero customer-reported regressions during 7-day dual-write parity window
7. ✅ `npm run build` passes; integration tests cover legacy + unified paths

## Open questions (resolve at planning time)

- Do we expose `kind` to users in the UI ("Action" badge on simple workflows) or hide it entirely?
- Should `health_blocked` workflows still appear in the list (greyed out) or hide entirely until reconnect?
- Single-node workflows: do we keep the canvas open by default, or open a simplified form view and offer "Open canvas" toggle?
- `_legacy_tool_configs` retention: 90 days enough, or keep forever as audit trail?

## Files

```
supabase/
  migrations/080_workflows_unified_schema.sql        NEW   Phase A — extend workflows + workflow_versions
  migrations/081_integration_health.sql              NEW   Phase A — health columns on integrations
  migrations/082_backfill_tool_configs.sql           NEW   Phase A — backfill tool_configs → workflows
  migrations/083_integration_health_checks.sql       NEW   Phase D — history table for probes
  migrations/084_legacy_tool_configs_cleanup.sql     NEW   Phase F — rename tool_configs → _legacy_tool_configs
  functions/integration-health/index.ts              NEW   Phase D — Deno edge fn, cron-driven

src/
  lib/
    workflows/
      resolve.ts                                     NEW   Phase B — resolveWorkflow(orgId, name)
      run.ts                                         NEW   Phase B — runWorkflow(workflow, input, ctx)
      health.ts                                      NEW   Phase D — integration health helpers
      spec.ts                                        NEW   Phase B — org-filtered capabilities spec (consumed by SEED-026)
    action-engine/
      resolve-tool.ts                                EDIT  Phase B — thin adapter calling resolveWorkflow
      execute-action.ts                              EDIT  Phase B — thin adapter calling runWorkflow
    flows/
      engine.ts                                      EDIT  Phase B — add tool_action node executor
      schema.ts                                      EDIT  Phase B — add tool_action node type
  app/
    api/
      workflows/
        spec/route.ts                                NEW   Phase B — GET org-filtered spec.json
        run/[id]/route.ts                            NEW   Phase B — manual run endpoint
      integrations/health/route.ts                   NEW   Phase D — read-only health view
    (dashboard)/
      workflows/page.tsx                             EDIT  Phase E — drop tabs, unified list
      workflows/[id]/page.tsx                        EDIT  Phase E — canvas for both kinds
      workflows/logs/page.tsx                        EDIT  Phase E — workflow_runs only
  components/
    workflows/
      workflows-list.tsx                             NEW   Phase E — unified list (replaces tools-table + flows grid)
      workflow-card.tsx                              NEW   Phase E — card with kind/trigger/health badges
      integration-palette.tsx                       EDIT  Phase D — filter by health_status
      health-badge.tsx                              NEW   Phase D — small live-status pill
  app/(dashboard)/integrations/integration-card.tsx EDIT  Phase D — health badge + reconnect CTA
```

## Coordination with sibling seeds

- **SEED-026 (AI authoring)** cannot start until Phase B ships. SEED-026's tools call `runWorkflow` and read from `spec.ts`.
- **SEED-027 (calendar as workflow surface)** cannot start until Phase B ships. SEED-027 adds new trigger types (`event:meeting.confirmed`, etc.) which are registered in the unified spec.
- **SEED-028 (meeting locations)** is independent of SEED-025 but its dynamic variables (`{{meeting.link}}`) are consumed by SEED-027's actions.
