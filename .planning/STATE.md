---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Multi-Bot Platform
status: executing
stopped_at: Completed 33-06-PLAN.md
last_updated: "2026-05-16T03:43:32.613Z"
last_activity: 2026-05-16
progress:
  total_phases: 10
  completed_phases: 1
  total_plans: 11
  completed_plans: 10
---

# Operator - State

## Current Position

Phase: 33 (schema-foundation-legacy-default-agent-backfill) — EXECUTING
Plan: 3 of 7
Status: Ready to execute
Last activity: 2026-05-16

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: ✅ Shipped 2026-05-07
- v1.7 Google Contacts Integration: ✅ Shipped 2026-05-07 ⚠️ pending Google Cloud credentials
- v1.8 Executor Completeness: ✅ Shipped 2026-05-08
- v1.9 GHL Lost-Lead Reengagement (SMS): ✅ Complete 2026-05-16 ⚠️ pending operator HUMAN-UAT
- v2.0 Multi-Bot Platform: 🚧 Active — Phase 33 ready to plan (9 phases mapped)

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/ROADMAP.md` for phase details.
See `.planning/REQUIREMENTS.md` for v2.0 REQ-IDs + traceability table.
See `.planning/seeds/SEED-002-multi-bot-platform.md` for the original seed (rich background, tradeoffs, breadcrumbs).
See `.planning/research/SUMMARY.md` for the convergent phase ordering rationale.

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v2.0 Phase Map (9 phases, 33-41)

Convergent ordering from research streams (all four agreed): Schema → Runtime → Widget canary → CRUD UI (parallel) → ManyChat/Meta + adapters → Delegation → Playground → Observability UI → Versioning UX.

| # | Phase | REQs | Gates |
|---|-------|------|-------|
| 33 | Schema Foundation + Legacy Default Agent Backfill | 7 | GATE-07 |
| 34 | Agent Runtime Skeleton + Day-1 Guardrails | 17 | GATE-03 |
| 35 | Web Widget Canary Cutover | 1 | GATE-01 |
| 36 | Agent CRUD Dashboard | 7 | — |
| 37 | ManyChat + Meta + Channel Adapters | 4 | — |
| 38 | Multi-Agent Delegation + Intersection Authz + Idempotency | 11 | GATE-02, 04, 05, 06 |
| 39 | Multi-Channel Playground | 5 | — |
| 40 | Per-Agent Observability UI | 5 | — |
| 41 | Prompt Versioning UX | 5 | — |

**Day-1 launch blockers (all baked into Phases 33/34, NOT deferred):**

1. Cost guards + kill switch → Phase 34 (RUNTIME-04..09 + GATE-03)
2. `agent_invocations` writes + `trace_id` → Phase 33 (table) + Phase 34 (writes from day 1)
3. Migration discipline (Legacy Default agent seed) → Phase 33 (GATE-07)
4. `agent_tools` junction → Phase 33 (TOOL-01); intersection model authz → Phase 38 (DELEG-07)

### v2.0 Scope (recap)

Promote agent to a first-class entity in Operator for **text channels only** — web widget, WhatsApp, Meta DMs, ManyChat, Telegram. Each agent has its own prompt, scoped tools (subset of action-engine via `agent_tools` junction), KB scope, and per-channel overrides. Multi-agent delegation (chat-first): an agent can call partner agents as sub-routines with loop detection and depth limits.

**Voice (Vapi) is explicitly out of scope.** `assistant_mappings`, `/api/vapi/*`, and `resolveTool(orgId, toolName)` continue unchanged. Operator does NOT try to be source of truth for Vapi assistants.

The "voice and chat as peers" principle is satisfied by chat catching up to voice in capability — not by unifying their runtimes.

### Critical pieces (from research synthesis)

- New schema: `agents`, `agent_tools` (junction), `agent_partners` (recursive junction), `agent_prompt_versions`, `agent_channel_defaults`, `agent_invocations`, `agent_model_pricing`, `tool_idempotency_keys` + additive `agent_id` columns on `manychat_rules` and `meta_channels` + nullable `agent_invocation_id` / `trace_id` on `action_logs`
- `runAgent(ctx, opts)` channel-agnostic chat runtime in `src/lib/agent-runtime/`
- Tool scoping: NEW `resolveAgentTool(agentId, toolName)` sibling to existing `resolveTool(orgId, toolName)` — Vapi path keeps the org-scoped resolver unchanged
- Refactor `src/lib/chat/stream.ts` to consume an `AgentContext` (Phase 35); existing `createChatStream` preserved as a shim through Phase 38 for safe rollback
- Wire each text-channel inbound handler (web widget Phase 35, ManyChat + Meta Phase 37) to call `runAgent()` with the right `channel` parameter
- Multi-agent delegation: synthetic `call_partner_<slug>` tool injection (Phase 38) with `MAX_DELEGATION_DEPTH=2`, structured handoff payload, intersection authz at `executeAction`
- `/dashboard/agents` CRUD UI (Phase 36) + multi-channel playground (Phase 39)
- Per-agent observability (Phase 40): cost, latency, tool-call counts, delegation graphs

### Tool reuse principle (locked decision)

Agents invoke **existing `tool_configs` rows** via the **existing action-engine**. v2.0 adds an authorization layer (`agent_tools` junction) and a runtime that picks/invokes them, but never replaces or duplicates `tool_configs` or `executeAction`. New tool types in the future continue to be created via the existing `/dashboard/tools` flow, not via an agent-specific creation flow. (Per user direction 2026-05-16.)

### Pattern references

- Action engine pattern: `src/lib/action-engine/execute-action.ts` (action_logs insert, tool resolution)
- Chat streaming pattern: `src/lib/chat/stream/anthropic.ts` and `openrouter.ts` (provider abstraction to preserve)
- Knowledge base scope pattern: `src/lib/knowledge/query-knowledge.ts` (org-scoped semantic search to extend with agent-scope `kb_scope` tag filter)
- Inbound channel handlers: `src/app/api/manychat/`, `src/app/api/meta/`, `src/app/api/chat/[token]/`
- RLS template: any v1.x migration with `(SELECT public.get_current_org_id())` pattern
- Migration cadence: `npx supabase db push` after writing migration; operator runs the push (checkpoint plan pattern)

### Reserved for future milestones (NOT in v2.0)

- Cross-org agent templates / marketplace (v2.x)
- Prompt A/B testing UI (versioning schema is in scope; testing UX is not)
- Multi-agent delegation in voice (Vapi-native, separate research)
- Replacing Vapi as a voice provider
- Token streaming relay from partner to end-user (v2.0 ships heartbeat-only)
- Mock tool responses in playground
- Online eval scoring / dataset-based offline eval suite
- Agent marketplace billing / monetization

## Decisions

- [v2.0] Naming: **agent** (not "bot", not "assistant" — avoids collision with Vapi/OpenAI Assistants)
- [v2.0] Voice stays in Vapi 100% — Operator does NOT sync agent definitions to Vapi; `assistant_mappings` unchanged
- [v2.0] Agents are always org-scoped; cross-org templates deferred to v2.x
- [v2.0] Channel-specific overrides allowed via `channel_overrides` JSONB (avoid forking the agent for SMS-vs-web tone differences)
- [v2.0] Multi-agent delegation is chat-only in v2.0 (voice handoff is Vapi-native)
- [v2.0] Tool scoping uses NEW `agent_tools` junction; `resolveAgentTool` sibling resolver; existing `resolveTool` untouched for Vapi
- [v2.0] Phase numbering continues from Phase 33 (no `--reset-phase-numbers`); v1.x phases preserved for traceability
- [v2.0] `MAX_DELEGATION_DEPTH=2` (env-tunable); `MAX_LLM_CALLS_PER_TURN=6`; per-conversation token cap 200K; per-org daily $ cap default $50 (DB-overridable)
- [v2.0] Idempotency wrappers ship in v2.0 (Phase 38), not deferred — derived as `sha256(agent_invocation_id + tool_call_index)`
- [v2.0] Delegation visibility in widget is ON by default (per-org toggle via `organizations.delegation_visibility`)
- [v2.0] Framework decision: build custom orchestrator; spike `ai@^6` in Phase 34 — adopt only if drop-in fits in <1 day
- [v2.0] Tool reuse principle: agents invoke EXISTING `tool_configs` via EXISTING `executeAction` — no parallel tool registry, no duplicate executor (per user 2026-05-16)
- [v2.0] Success criterion (verbatim from SEED-002): *"the shape of the app is around voice and that needs to end — text chat is just as important"*

## Pending Todos

- ⚠️ (v1.7) Register Google OAuth app in Google Cloud Console + set GOOGLE_CLIENT_ID/SECRET in Vercel
- ⚠️ (v1.9) Operator: complete 5 HUMAN-UAT items in `.planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-HUMAN-UAT.md` (Vercel env vars + GitHub secrets + first dispatch + SMS test + first scheduled tick)
- 🧹 Pre-existing tech debt: `npm run lint` broken (Next.js 16 removed `next lint`) — wire eslint.config.js when convenient. Build gate: `npm run build` is the type-check authority.
- ➡️ (v2.0) Next: `/gsd:plan-phase 33` to decompose Schema Foundation into plans

## Session Continuity

Last session: 2026-05-16T03:43:32.596Z
Stopped at: Completed 33-06-PLAN.md

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 30 | 04 | 8 min | 2/2 | 3 |
| 31 | 01 | 12 min | 1/1 | 2 |
| 32 | 02 | 25 min | 4/4 | 6 |
| 32 | 03 | 30 min | 1/1 | 2 |
| 32 | 04 | 12 min | 4/4 | 5 |
| Phase 33 P01 | 10 min | 3/3 tasks | 3 files |
| Phase 33 P02 | 4m | 2 tasks | 2 files |
| Phase 33 P06 | 3min | 1 tasks | 1 files |
