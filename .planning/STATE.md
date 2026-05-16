---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Multi-Bot Platform
status: defining
stopped_at: Defining requirements for v2.0 (chat-side agent abstraction; voice stays in Vapi)
last_updated: "2026-05-16T00:31:45.862Z"
last_activity: 2026-05-16
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Operator - State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-16 — Milestone v2.0 started (promoted from SEED-002)

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
- v2.0 Multi-Bot Platform: 🚧 Active — defining requirements

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/ROADMAP.md` for phase details.
See `.planning/seeds/SEED-002-multi-bot-platform.md` for the original seed (rich background, tradeoffs, breadcrumbs).

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v2.0 Scope

Promote agent to a first-class entity in Operator for **text channels only** — web widget, WhatsApp, Meta DMs, ManyChat, Telegram. Each agent has its own prompt, scoped tools (subset of action-engine), KB scope, and per-channel overrides. Multi-agent delegation (chat-first): an agent can call partner agents as sub-routines with loop detection and depth limits.

**Voice (Vapi) is explicitly out of scope.** `assistant_mappings` continues unchanged. Operator does NOT try to be source of truth for Vapi assistants.

The "voice and chat as peers" principle is satisfied by chat catching up to voice in capability — not by unifying their runtimes.

### Critical pieces

- New schema: `agents`, `agent_tools` (junction with permissions), `agent_partners` (recursive junction), `agent_prompt_versions` (history)
- `runAgent(agentId, channel, context)` channel-agnostic chat runtime in `src/lib/agent-runtime/`
- Tool scoping: new layer over `src/lib/action-engine/resolve-tool.ts` checking agent_tools junction
- Refactor `src/lib/chat/` to consume `runAgent()` instead of monolithic prompt
- Wire each text-channel inbound handler (web widget, ManyChat, Meta, WhatsApp future) to call `runAgent()` with the right `channel` parameter
- Multi-agent delegation protocol: tool-call shape that lets an agent invoke `runPartnerAgent(targetAgentId, sharedContext)` with depth/loop guards
- `/dashboard/agents` CRUD UI + multi-channel test playground at `/dashboard/agents/[id]/test`
- Per-agent observability: cost, latency, tool-call counts, delegation graphs

### Pattern references

- Action engine pattern: `src/lib/action-engine/execute-action.ts` (action_logs insert, tool resolution)
- Chat streaming pattern: `src/lib/chat/stream/anthropic.ts` and `openrouter.ts` (provider abstraction to preserve)
- Knowledge base scope pattern: `src/lib/knowledge/query-knowledge.ts` (org-scoped semantic search to extend with agent-scope)
- Inbound channel handlers: `src/app/api/manychat/`, `src/app/api/meta/`, `src/app/api/chat/[token]/`
- RLS template: any v1.x migration with `get_current_org_id()` SECURITY DEFINER pattern

### Reserved for future milestones (NOT in v2.0)

- Cross-org agent templates / marketplace (v2.x)
- Prompt A/B testing UI (versioning schema is in scope; testing UX is not)
- Multi-agent delegation in voice (Vapi-native, separate research)
- Replacing Vapi as a voice provider
- Agent marketplace billing / monetization

## Decisions

- [v2.0] Naming: **agent** (not "bot", not "assistant" — avoids collision with Vapi/OpenAI Assistants)
- [v2.0] Voice stays in Vapi 100% — Operator does NOT sync agent definitions to Vapi; `assistant_mappings` unchanged
- [v2.0] Agents are always org-scoped; cross-org templates deferred to v2.x
- [v2.0] Channel-specific overrides allowed via `channel_overrides` JSONB field (avoid forking the agent for SMS-vs-web tone differences)
- [v2.0] Multi-agent delegation is chat-only in v2.0 (voice handoff is Vapi-native)
- [v2.0] Tool scoping is the new abstraction over the existing action-engine — `agent_tools` junction with permissions; `resolve-tool` checks it before executing
- [v2.0] Phase numbering continues from Phase 33 (no `--reset-phase-numbers`); v1.x phases preserved for traceability
- [v2.0] Success criterion (verbatim from SEED-002): *"the shape of the app is around voice and that needs to end — text chat is just as important"*

## Pending Todos

- ⚠️ (v1.7) Register Google OAuth app in Google Cloud Console + set GOOGLE_CLIENT_ID/SECRET in Vercel
- ⚠️ (v1.9) Operator: complete 5 HUMAN-UAT items in `.planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-HUMAN-UAT.md` (Vercel env vars + GitHub secrets + first dispatch + SMS test + first scheduled tick)
- 🧹 Pre-existing tech debt: `npm run lint` broken (Next.js 16 removed `next lint`) — wire eslint.config.js when convenient

## Session Continuity

Last session: 2026-05-16T00:31:45.862Z
Stopped at: Defining requirements for v2.0 (chat-side agent abstraction; voice stays in Vapi)

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 30 | 04 | 8 min | 2/2 | 3 |
| 31 | 01 | 12 min | 1/1 | 2 |
| 32 | 02 | 25 min | 4/4 | 6 |
| 32 | 03 | 30 min | 1/1 | 2 |
| 32 | 04 | 12 min | 4/4 | 5 |
