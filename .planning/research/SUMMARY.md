# Project Research Summary — v2.0 Multi-Bot Platform

**Project:** Operator v2.0 — Channel-Agnostic Agent Abstraction (chat-side text channels only)
**Domain:** Multi-agent / agent-management platform layered onto an existing multi-tenant SaaS (Next.js 15 + Supabase RLS, voice stays in Vapi)
**Researched:** 2026-05-15
**Confidence:** HIGH

---

## Executive Summary

v2.0 must promote **agent** to a first-class entity for **chat channels only** (web widget, WhatsApp via Meta, Messenger, Instagram, ManyChat, Telegram). Voice (Vapi) is explicitly untouched: `assistant_mappings`, `/api/vapi/*`, and `resolveTool(orgId, toolName)` keep working byte-for-byte. The shape that all four research streams converge on is **a thin custom orchestrator** (`src/lib/agent-runtime/`) that wraps the existing `src/lib/chat/stream/` providers, plus **at most one new dependency** (`ai@^6.0.174`, decided in the first phase via spike), plus a small set of new tables (`agents`, `agent_tools`, `agent_partners`, `agent_prompt_versions`, `agent_channel_defaults`, `agent_invocations`).

The dominant composition pattern across every production platform surveyed (Dust, OpenAI Agents SDK, Anthropic sub-agents, Microsoft Agent Framework) is **agent-as-tool / partner agents** — the parent agent exposes a synthetic `call_partner_<slug>` tool, the runtime intercepts it and recursively calls `runAgent()` for the partner, and the partner's reply comes back as a tool result. This is a design choice, not a library — implemented in our code with hard depth caps (default 2-3), per-agent visited set, and structured handoff payloads (NEVER raw history concatenation). All four research streams agree this is the right primitive and that termination is **enforced in the runtime, not in the prompt**.

The biggest risks are operational, not algorithmic: **(1) Vercel Hobby's 10-second wall-clock limit** can kill multi-step chains if the runtime doesn't enforce a per-turn time budget and use the always-200 + `after()` pattern for non-widget channels; **(2) cost runaway** ($47K incident pattern) — every guard (per-conversation token cap, per-org daily $ cap, per-IP rate limit, global kill switch) must ship at launch, not after; **(3) confused-deputy via delegation** — tool authorization must use the **intersection model** across the full delegation chain, enforced at `executeAction`, not just at agent selection. These three plus migration discipline (every existing org gets a seeded "Legacy Default" agent so day-1 behavior is byte-identical) are the day-1 launch blockers.

---

## Key Convergent Findings

Where 2+ research streams independently arrive at the same answer — these are the safest bets.

### 1. Agent-as-tool delegation pattern (FEATURES + STACK + ARCHITECTURE + PITFALLS)
- FEATURES: Dust, OpenAI Agents SDK, CrewAI, Anthropic Claude Code all ship this. User-facing term: "**partner agent**" (from SEED-002).
- STACK: Recommended over LangGraph supervisor or OpenAI handoffs — keeps call/return semantics so the parent finishes the user-facing reply.
- ARCHITECTURE: Pattern 3 — synthetic `call_partner_<slug>` injected into A's tool list; runtime intercepts and recursively invokes `runAgent`.
- PITFALLS: #1 (runaway loops), #4 (cross-agent injection), #7 (context loss) all assume this exact pattern and enforce guards on it.

**Verdict:** Agent-as-tool is the primitive. Loop detection + depth cap + structured handoff payload are mandatory siblings.

### 2. New `agent_invocations` table (NOT extend `action_logs`) (STACK + ARCHITECTURE + PITFALLS)
- STACK §3 — `action_logs` is system-of-record for **tool execution attempts**; mixing LLM-call rows would inflate it 5-10x and break Vapi's existing schema contract.
- ARCHITECTURE Migration 037 introduces `agent_invocations` with `parent_invocation_id` self-FK for delegation tree.
- PITFALLS #12 — explicit "discriminator column on `action_logs` is a regret pattern" — confirmed by OTel spans/events split, LangSmith, MLflow.

**Verdict:** Two-table model. `action_logs` gains nullable `agent_invocation_id` FK (back-reference). `trace_id` propagates through both. **Decide and lock in the very first v2.0 migration** — switching later is costly.

### 3. Tool scoping via `agent_tools` junction with deny-by-default (STACK + FEATURES + ARCHITECTURE + PITFALLS)
- STACK §5 — junction `agent_tools(agent_id, tool_config_id, allowed)` enforced at `resolve-tool.ts`.
- FEATURES TOOL-01..06 — Dust, OpenAI Agents SDK, Botpress all do this; deny-by-default = OpenAI Agents SDK semantics.
- ARCHITECTURE — New `resolveAgentTool(agentId, toolName)` sibling to existing `resolveTool(orgId, toolName)` — Vapi keeps the old signature untouched.
- PITFALLS #3 (confused deputy) — the **intersection model** across the delegation chain MUST be enforced at `executeAction`, not just at agent-tool selection.

**Verdict:** Junction table + intersection authorization at execution time + chain-aware `ActionContext.delegationChain: string[]`.

### 4. Channel overrides as JSONB merge, not row fork (FEATURES + ARCHITECTURE + PITFALLS)
- FEATURES AGENT-07 — universal pattern; per-channel forking is an anti-feature.
- ARCHITECTURE Pattern 4 — `agents.channel_overrides` JSONB shaped as `{ [channel]: Partial<AgentSpec> }`, deep-merged at runtime.
- PITFALLS #6 — **transport-layer constraints** (WhatsApp 1600-char split, no markdown; Meta 24h window; ManyChat blocks) need a separate **channel adapter layer** between runtime and transport — overrides handle the prompt, adapters handle the wire format.

**Verdict:** Both layers ship together. JSONB overrides for prompt/model/max_history; channel adapters for serialization/length/format.

### 5. Append-only `agent_prompt_versions` with `active_prompt_version_id` pointer (STACK + FEATURES + ARCHITECTURE)
- STACK §4 — plain SQL, append-only, immutable; no extension, no JSONB diff.
- FEATURES AGENT-11..15 — Langfuse / LangSmith / Vellum all use linear immutable versions with diff viewer + rollback.
- ARCHITECTURE Migration 035 plus DB trigger on `agents.system_prompt` UPDATE → snapshot.

**Verdict:** Schema in scope for v2.0, A/B testing UI explicitly out (per PROJECT.md).

### 6. Backwards compatibility = "every org always has an agent" (ARCHITECTURE + PITFALLS)
- ARCHITECTURE Phase A seeds a "Main Agent" for every existing org with verbatim copy of `stream.ts` v1.4 prompt template + auto-grant of all current `tool_configs`. Behavior is **byte-identical**.
- PITFALLS #8 — expand-migrate-contract pattern; `ensureDefaultAgent(orgId)` helper called by both backfill migration and org-creation logic; `agent_id` stays nullable until full stabilization.

**Verdict:** No feature flag needed for the cutover IF the seed migration is correct. A `AGENT_RUNTIME_ENABLED` env var as kill switch is still required (see Pitfall 11).

### 7. Custom orchestrator over framework adoption (STACK + ARCHITECTURE)
- STACK HIGH confidence — LangGraph, OpenAI Agents SDK, Mastra all rejected; LangChain agents path is legacy.
- ARCHITECTURE — New peer module `src/lib/agent-runtime/` next to `src/lib/chat/`, not nested inside it.

**Verdict:** Build custom. Optional narrow adoption of `ai@^6.0.174` (Vercel AI SDK v6 `Agent` / `ToolLoopAgent` + native OpenTelemetry) decided via spike in the first phase. If it doesn't drop in cleanly within ~1 day, keep custom and only adopt OpenTelemetry hooks separately.

---

## Key Tensions / Open Decisions

Where the four research streams diverge or surface real tradeoffs requiring an explicit pick.

### T1. Adopt `ai@^6` or stay fully custom? (STACK confidence: MEDIUM)
- **Pro adopt:** Built-in OTel for free Langfuse path, codified `ToolLoopAgent`, native multi-provider via `@ai-sdk/openai` + `@ai-sdk/anthropic`.
- **Con adopt:** v6 just landed (Jan 2026); migrating off the v1.4-shipped `streamOpenRouter` + `streamAnthropic` is a regression risk; OpenRouter via `@ai-sdk/openai + baseURL` is community pattern, not first-class.
- **Recommendation:** Spike in **Phase B (runtime skeleton)**. Adopt only if drop-in fits in <1 day. Otherwise stay custom and add `@opentelemetry/sdk-node` separately if observability tracing is needed.

### T2. Default `MAX_DELEGATION_DEPTH` — 2 or 3?
- ARCHITECTURE recommends 2 (`MAX_DEPTH = 2`).
- STACK §2 recommends 3 (`MAX_DELEGATION_DEPTH = 3`).
- PITFALLS #1 recommends 3 (`MAX_DELEGATION_DEPTH = 3`) plus `MAX_LLM_CALLS_PER_TURN = 6`.
- **Recommendation:** **Depth = 2** for v2.0 (matches Vercel 10s wall-clock budget; depth 3 fits into ~3 LLM calls × 3-4s = unsafe), **MAX_LLM_CALLS_PER_TURN = 6** (covers depth-2 chain + tool roundtrips), config-tunable per env.

### T3. ManyChat / Meta integration — additive `agent_id` column on existing rules?
- ARCHITECTURE Phase E proposes `manychat_rules.agent_id NULL` and `meta_channels.agent_id NULL` as XOR with the existing `tool_config_id`.
- FEATURES does not specify the schema delta.
- **Recommendation:** Adopt the additive XOR per ARCHITECTURE — no breaking changes to v1.6 ManyChat dispatch or v1.3 Meta processing.

### T4. Where do per-agent partner-agent **descriptions** for the LLM come from?
- STACK §2: synthetic tool's `description` field comes from `partner.delegation_hint` ("Use for billing questions").
- ARCHITECTURE: `agent_partners.invocation_description` ("Call this when the user needs billing help").
- FEATURES: implied via partner registry but no field name.
- **Recommendation:** Single column on `agent_partners` named `invocation_description TEXT NOT NULL` (matches ARCHITECTURE migration 034). LLM-facing only; not the partner's own `agents.description`.

### T5. Streaming partner output to end user
- ARCHITECTURE Pattern 3 (Con): "Doesn't allow streaming partner output to the end user in real time. The end user waits for partner to complete, then sees parent's continuation. **v2.0 acceptable; v2.x can add streaming relay.**"
- PITFALLS #5: silent gaps >2s break trust — hard requirement for `delegating` / `partner_thinking` heartbeat events even if tokens themselves don't stream.
- **Recommendation:** v2.0 ships heartbeat-only (`partner_start`, `partner_done` SSE events + 1.5s `keepalive` heartbeat during partner LLM call). Token relay deferred to v2.x.

### T6. Voice migration eventually?
- SEED-002 envisioned channel-agnostic runtime serving voice too.
- PROJECT.md explicitly limits v2.0 to chat (Vapi remains source of truth for voice).
- All four research files honor this scope.
- **Recommendation:** Keep voice out. The `agents` table and `agent_runtime` module are text-only by design. Re-evaluate post-v2.0 once chat agents have bedded in.

---

## Stack Recommendations

Concrete adoption decisions for v2.0.

| Concern | Decision | Rationale |
|---|---|---|
| Agent runtime | **Build custom** in `src/lib/agent-runtime/` over existing `src/lib/chat/stream/` providers | HIGH conf — already-shipped streaming code is lower risk than swap |
| Optional dep | **Spike `ai@^6.0.174`** in Phase B, adopt only if drop-in <1 day | MEDIUM conf — v6 too new for blind adoption |
| Multi-agent primitive | **Agent-as-tool** (Anthropic sub-agent style) — synthetic `call_partner_<slug>` | HIGH conf — universal pattern across surveyed platforms |
| Delegation guards | Hard `MAX_DELEGATION_DEPTH=2`, `MAX_LLM_CALLS_PER_TURN=6`, visited-set, structured handoff payload | HIGH conf — every guardrail guide |
| Tool scoping | `agent_tools` junction + deny-by-default + **intersection check** at `executeAction` across `delegationChain` | HIGH conf — confused-deputy mitigation |
| Prompt versioning | Append-only `agent_prompt_versions` + `agents.active_prompt_version_id` pointer | HIGH conf — Langfuse/Vellum reference |
| Observability | New `agent_invocations` table + back-reference from `action_logs.agent_invocation_id` (nullable) + shared `trace_id` | HIGH conf — additive, preserves v1.x consumers |
| Observability transport | Defer Langfuse self-host; OpenTelemetry exporter only if `ai@^6` adopted | MEDIUM conf — infra cost is dominant |
| Channel adapters | New `src/lib/agent-runtime/adapters/{whatsapp,meta,manychat,widget,telegram}.ts` for length/markdown/format constraints | HIGH conf — Pitfall #6 |
| Cost guardrails | Per-conv token cap, per-org daily $ cap, per-IP rate limit, global `AGENT_RUNTIME_ENABLED` kill switch | HIGH conf — must ship at launch |
| Failover | Per-agent `model_primary` + `model_fallback`, **no cascade-retry up the chain**, **no mid-stream provider swap** | HIGH conf — Pitfall #10 |

**New dependencies (worst case):** `ai@^6.0.174 @ai-sdk/anthropic @ai-sdk/openai` (only if spike succeeds).
**No new dependencies (best case):** zero.

---

## Feature Categorization

REQ-ID hints for the requirements step.

### Table Stakes (P1 — must ship in v2.0)

**AGENT (agent definition):** AGENT-01..15
- AGENT-01..04 — name, description, system prompt, model, temp, max_tokens
- AGENT-05 — KB scope (per-agent subset of org KB via `metadata.agent_scopes` filter)
- AGENT-06..08 — channel allow-list, channel_overrides JSONB, default-agent-per-channel
- AGENT-09..10 — active toggle, audit timestamps
- AGENT-11..15 — prompt versioning (immutable history, auto-snapshot, rollback, diff, active pointer)

**TOOL (tool scoping):** TOOL-01..06
- TOOL-01 — `agent_tools` junction table
- TOOL-02..05 — multi-select picker UI with folder grouping (reuse v1.5 `tool_folders`)
- TOOL-06 — runtime guard: deny-by-default, refuse + log non-attached tool calls

**RUNTIME (channel-agnostic runtime):** RUNTIME-01..06
- RUNTIME-01..03 — `runAgent(agentId, channel, ctx)` entry, channel override merge, playground isolation flag
- RUNTIME-04..06 — max-tool-calls cap, per-conversation token budget, per-org daily $ circuit-breaker

**DELEG (multi-agent composition):** DELEG-01..06
- DELEG-01 — `agent_partners` junction with `invocation_description`
- DELEG-02 — partner invocation surfaces in transcript as a tool call
- DELEG-03 — three-tier handoff context (structured params + summary + recent N=3 verbatim)
- DELEG-04 — `MAX_DELEGATION_DEPTH=2`
- DELEG-05 — loop detection by `agent_id` in `_callStack`
- DELEG-06 — per-agent invocation log via `agent_invocations`

**PLAY (playground):** PLAY-01..05
- PLAY-01..02 — chat preview with channel selector
- PLAY-03 — inline tool calls visible (reuse v1.4 chat-area)
- PLAY-04 — reset / new session
- PLAY-05 — `mode='playground'` isolation from production inbox

**OBS (observability):** OBS-01..08
- OBS-01..02 — partner call surfaced + per-invocation log
- OBS-03..06 — per-agent counts, cost (model price table), p50/p95 latency, tool success rate
- OBS-07 — conversation replay with delegation tree visualization
- OBS-08 — chat-area extended with agent badges per message

### Differentiators (P2 — defer to v2.x)

- Mock tool responses in playground
- Online eval scoring (LLM-as-judge per call)
- Per-agent rate limits per visitor
- Dataset-based offline eval suite

### Anti-Features (explicit "Out of Scope")

- "More agents = better" auto-spawn / dynamic agent creation
- Free-form natural-language agent definition (no schema)
- Agents creating/editing other agents at runtime
- Unbounded delegation chains
- Streaming "internal monologue" tokens to end-user
- Auto-promote agent version on save (must be explicit Publish)
- Single global cross-tenant agent
- Per-channel forked agent (clone per channel) — use `channel_overrides` instead
- In-playground "deploy to production" button
- Hierarchical "manager agent" black-box router
- Visual flow-chart builder (Voiceflow / n8n style)
- Auto-summarize old conversations into agent prompt
- Multi-agent delegation in voice (Vapi-native)
- Cross-org agent templates / marketplace (deferred to v2.x)

---

## Top Launch Blockers

These five MUST ship in v2.0 day-1, not "polish later." See PITFALLS.md for full detail.

1. **Runaway delegation + cost runaway** — depth cap + LLM-call cap + visited-set + per-conv token cap + per-org daily $ cap + global kill switch
2. **Vercel Hobby 10s timeout** — per-turn AbortController budget; non-widget channels via after()
3. **Tool-scope confused deputy** — intersection model at executeAction across delegationChain
4. **Cross-agent prompt injection** — structured handoff payload, never raw history
5. **Observability black hole** — `agent_invocations` table + `trace_id` propagation from day 1

---

## Phase Ordering Convergence

All four research streams converge on the same dependency order. Mapping to a single plan:

1. **Schema Foundation** (migrations 034-037 + Legacy Default agent seed for every existing org)
2. **Agent Runtime Skeleton** (`runAgent` + ALL guardrails baked in from day 1)
3. **chat/stream.ts refactor + widget integration** (canary channel)
4. **Agent CRUD Dashboard** (parallel with 2/3)
5. **ManyChat + Meta + channel adapters**
6. **Multi-Agent Delegation** (partner-tool injection, structured handoff, intersection authz, adversarial corpus)
7. **Observability UI** (parallel with 2+ since rows are written from Phase 2)
8. **Playground** (multi-channel test harness using `mode='playground'`)
9. **Prompt Versioning UX** (DB trigger + diff/rollback UI)

```
1 (Schema)
  ├─► 2 (Runtime + guardrails)
  │     └─► 3 (refactor + widget) ─┬─► 5 (ManyChat/Meta + adapters)
  │                                  └─► 6 (Delegation) ─► 8 (Playground)
  ├─► 4 (CRUD UI) ─► 9 (Versioning UX)
  └─► 7 (Observability UI)
```

---

## Open Questions for Requirements Step

Before locking REQ-IDs, decide with the user:

1. **Default `MAX_DELEGATION_DEPTH`** — 2 (recommendation, fits Vercel 10s) vs 3
2. **Default per-org daily $ cap** — recommendation: $50/day for new orgs
3. **Adopt `ai@^6` spike outcome** — defer to Phase 2 start; affects ~15 import paths
4. **Visibility of delegation in widget UI** — visible (recommended) or hidden? per-org config?
5. **KB scope granularity** — `document_id[]`, `tag[]`, or `collection_id[]`?
6. **Idempotency wrapper rollout** — v2.0 (recommended) or v2.x?
7. **Vapi voice retrofit timeline** — confirm v2.0 stays text-only; voice catches up v3.0 or never?
8. **`agents.fallback_message`** — recommended copy: "I cannot help with that right now."
9. **Migration of existing widget orgs** — seeded agent named "Main Agent" or carry the org name?
10. **Per-channel default agent vs per-rule agent** — both ship in v2.0 or defer rule-level to v2.1?

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified May 2026; "build custom" supported by direct read of existing `src/lib/chat/stream/` |
| Features | HIGH | 9 production platforms surveyed; convergent vocabulary; failure modes cross-referenced |
| Architecture | HIGH | Based on direct read of existing chat/action-engine code, RLS schema, and inbound handlers |
| Pitfalls | HIGH | Cost/timeout/security/observability grounded in 2026 post-mortems and OWASP Agentic Top 10 |

**Overall confidence:** HIGH

---

*Research completed: 2026-05-15*
*Ready for requirements definition: yes*
*Ready for roadmap: yes (phase ordering converged across all four research streams)*
