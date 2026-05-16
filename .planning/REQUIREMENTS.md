# Operator v2.0 Requirements — Multi-Bot Platform

**Milestone:** v2.0 Multi-Bot Platform — Channel-Agnostic Agent Abstraction
**Defined:** 2026-05-16
**Source:** [SEED-002](.planning/seeds/SEED-002-multi-bot-platform.md) → research synthesis at [.planning/research/SUMMARY.md](.planning/research/SUMMARY.md)

## Goal

Promote **agent** to a first-class entity in Operator with its own prompt, scoped tools, knowledge base scope, and per-channel overrides — and add multi-agent composition (an agent can delegate to specialist "partner" agents). Chat reaches feature-parity with voice in capability terms.

## Scope

**In scope:** All text channels — web widget, WhatsApp (via Meta), Messenger, Instagram, ManyChat, Telegram.

**Out of scope:** Voice (Vapi). `assistant_mappings`, `/api/vapi/*`, and `resolveTool(orgId, toolName)` keep working byte-for-byte. The "voice and chat as peers" principle is satisfied by chat catching up to voice in capability — not by unifying their runtimes.

## Locked Decisions (from milestone-start questioning)

| Decision | Value | Why |
|---|---|---|
| Naming | `agent` | Avoids collision with Vapi `assistant` and OpenAI Assistants |
| Agent ownership | Per-org always | Cross-org templates deferred to v2.x |
| Channel overrides | JSONB merge, not row fork | Universal pattern across surveyed platforms |
| Delegation primitive | Agent-as-tool (synthetic `call_partner_<slug>`) | Industry standard; preserves call/return semantics |
| `MAX_DELEGATION_DEPTH` | 2 (env-tunable) | Fits Vercel Hobby 10s budget |
| Per-org daily $ cap default | $50/day, **configurable per org** | Safety floor; admin can raise |
| Delegation visibility in widget | Visible by default | Builds user trust + helps debugging |
| Idempotency wrappers | Ship in v2.0 | Pitfall #5 — without it, double-bookings |
| KB scope granularity | `tag[]` filter on pgvector metadata | Most flexible; document-id later if needed |
| Seeded "Legacy Default" agent name | "Main Agent" | Universal; org context shown in dashboard |
| Voice retrofit | NOT in v2.0 (Vapi unchanged) | Re-evaluate post-v2.0 |
| Framework adoption | Custom orchestrator + spike `ai@^6` in Phase 2 | Lower regression risk than blind framework swap |
| Tool reuse principle | Agents invoke **existing `tool_configs` rows** via the **existing action-engine** | Per user direction (2026-05-16) — v2.0 adds an authorization layer (`agent_tools` junction) and a runtime that picks/invokes them, but never replaces or duplicates `tool_configs` or `executeAction`. New tool types in the future continue to be created via the existing `/dashboard/tools` flow, not via an agent-specific creation flow. |

---

## v2.0 Requirements

Total: **52 requirements** across 8 categories. All must ship in v2.0.

### AGENT — Agent Definition (15)

- [ ] **AGENT-01:** Each org can create one or more agents with required fields: `name`, `slug` (unique per org), `description`, `system_prompt`, `model`, `is_active`
- [ ] **AGENT-02:** Each agent has optional generation config: `temperature` (default 0.7), `max_tokens` (default 1024), `max_history` (default 20 turns)
- [ ] **AGENT-03:** Each agent has a configurable `fallback_message` (default: "I can't help with that right now — let me transfer you to a human.")
- [ ] **AGENT-04:** Each agent has a `model_primary` and optional `model_fallback`; runtime falls back on primary error within the same call (no cascade up the delegation chain)
- [ ] **AGENT-05:** Each agent has an optional `kb_scope TEXT[]` of knowledge-base tags; `null` = full org KB; runtime filters pgvector results by `metadata.tags && agent.kb_scope` when set
- [ ] **AGENT-06:** Each agent declares an `allowed_channels` array (subset of: `web_widget`, `whatsapp`, `messenger`, `instagram`, `manychat`, `telegram`); runtime refuses invocation from a non-allowed channel with HTTP 422
- [ ] **AGENT-07:** Each agent has `channel_overrides JSONB` shaped as `{ [channel]: Partial<AgentSpec> }`; runtime deep-merges per-channel overrides on top of base agent at invocation time (overrides allowed: `system_prompt` suffix-append, `model`, `temperature`, `max_tokens`, `max_history`)
- [ ] **AGENT-08:** Each org can map a default agent per channel via `agent_channel_defaults(org_id, channel, agent_id)`; channel inbound handlers resolve the agent via this table when no rule-level override exists
- [ ] **AGENT-09:** Agents have audit timestamps (`created_at`, `updated_at`, `created_by`, `updated_by`)
- [ ] **AGENT-10:** Inactive agents (`is_active=false`) are excluded from CRUD UI dropdowns and refuse runtime invocation with HTTP 410, but historical `agent_invocations` rows referencing them remain queryable
- [ ] **AGENT-11:** Every change to `agent.system_prompt` automatically creates a row in `agent_prompt_versions(agent_id, version, system_prompt, created_by, created_at)` via DB trigger on UPDATE
- [ ] **AGENT-12:** Each agent has an `active_prompt_version_id` pointer; the runtime always uses the prompt from this version, not from `agents.system_prompt` directly
- [ ] **AGENT-13:** Admin can view the prompt version history list with author, timestamp, and a unified diff against the previous version
- [ ] **AGENT-14:** Admin can rollback to any prior version by clicking "Activate" — this updates `active_prompt_version_id` and creates a new audit log entry; never mutates the version row
- [ ] **AGENT-15:** Saving a prompt edit creates a draft version; promoting to production requires explicit "Publish" action (auto-promote on save is an anti-feature)

### TOOL — Per-Agent Tool Scoping (6)

- [ ] **TOOL-01:** New `agent_tools(agent_id, tool_config_id, allowed_channels agent_channel[] NULL)` junction table; `(agent_id, tool_config_id)` UNIQUE; `null` allowed_channels = all channels
- [ ] **TOOL-02:** Admin can attach/detach tools to an agent via multi-select picker in `/dashboard/agents/[id]`; picker reuses v1.5 `tool_folders` grouping for navigation
- [ ] **TOOL-03:** New agents start with **zero attached tools** (deny-by-default)
- [ ] **TOOL-04:** Picker shows tool name, type (`send_sms`, `custom_webhook`, etc.), folder, and the integration it depends on; tools without a usable integration are visually flagged but selectable
- [ ] **TOOL-05:** Sibling resolver `resolveAgentTool(agentId, toolName)` exists alongside the existing `resolveTool(orgId, toolName)`; existing Vapi path keeps using the org-scoped resolver unchanged
- [ ] **TOOL-06:** Runtime guard: if an LLM emits a tool call for a tool not in the agent's allowed set, the runtime refuses execution with `denied_reason: 'tool_not_attached_to_agent'`, logs the attempt to `agent_invocations`, and returns a synthesized tool-result message to the LLM ("Tool not available to this agent")

### RUNTIME — Channel-Agnostic Agent Runtime (10)

- [ ] **RUNTIME-01:** New `src/lib/agent-runtime/` module exports `runAgent(ctx: AgentRunContext, opts: AgentRunOptions): Promise<AgentRunResult>`; this is the single entry point for chat-side agent invocation
- [ ] **RUNTIME-02:** `AgentRunContext` carries `orgId`, `agentId`, `channel`, `conversationId`, `message`, `history`, `supabase` client, optional `metadata`; internal-use fields `_depth`, `_callStack`, `_rootInvocationId`, `_traceId` track delegation state
- [ ] **RUNTIME-03:** Runtime resolves the agent + applies `channel_overrides` for the invocation channel before calling the LLM
- [ ] **RUNTIME-04:** Runtime enforces `MAX_DELEGATION_DEPTH=2` (env-tunable via `AGENT_MAX_DELEGATION_DEPTH`); attempts beyond cap return synthetic tool result "Delegation depth exceeded — answer from current agent"
- [ ] **RUNTIME-05:** Runtime enforces `MAX_LLM_CALLS_PER_TURN=6` (env-tunable); exceeding the cap halts the loop and returns the agent's `fallback_message`
- [ ] **RUNTIME-06:** Runtime enforces a per-conversation token cap (default 200K, env-tunable via `AGENT_MAX_TOKENS_PER_CONVERSATION`); on exceed, persists a final "conversation length exceeded — please start a new chat" assistant message and halts
- [ ] **RUNTIME-07:** Runtime enforces a per-org daily $ cap (default `$50/day`, **per-org override** via `organizations.daily_cost_cap_usd_override` column); on exceed, returns the agent's `fallback_message` and emits a Sentry-style log event for ops
- [ ] **RUNTIME-08:** Per-turn time budget enforced via `AbortController` with `setTimeout(8000)` (2s safety margin under Vercel Hobby 10s); on abort, persists partial assistant reply marked `status='aborted'`
- [ ] **RUNTIME-09:** Global kill switch via env var `AGENT_RUNTIME_ENABLED=true|false`; when `false`, all chat handlers fall back to a static "service temporarily unavailable" message and emit a 503-equivalent log event
- [ ] **RUNTIME-10:** Runtime writes exactly one `agent_invocations` row per `runAgent()` call with `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `model`, `status`, `error_detail`; partner calls produce child rows with `parent_invocation_id` pointing to the parent

### DELEG — Multi-Agent Delegation (8)

- [ ] **DELEG-01:** New `agent_partners(agent_id, partner_agent_id, invocation_description TEXT NOT NULL)` junction table; `CHECK (agent_id <> partner_agent_id)`; `(agent_id, partner_agent_id)` UNIQUE
- [ ] **DELEG-02:** For each agent with declared partners, the runtime injects synthetic LLM tools named `call_partner_<partner_slug>` into the tool list; the tool's description is `agent_partners.invocation_description`
- [ ] **DELEG-03:** When the LLM calls `call_partner_<slug>`, the runtime intercepts the tool call, recursively invokes `runAgent()` for the partner, and returns the partner's reply as the tool result; the parent agent then completes the user-facing reply
- [ ] **DELEG-04:** Handoff payload to partner uses three-tier structure: `{ from_agent: slug, intent: short_string, extracted_params: {...}, summary: string, recent_messages: last_3_verbatim }`; raw conversation history is NEVER forwarded
- [ ] **DELEG-05:** Handoff payload schema rejects nested keys matching `^role$|^system$|^instructions?$` to prevent prompt injection across agent boundary
- [ ] **DELEG-06:** Loop detection: `_callStack` (visited agent IDs) prevents an agent from being invoked twice in the same delegation chain; second attempt returns synthetic tool result "Cycle detected — answer from current agent"
- [ ] **DELEG-07:** Tool-execution authorization uses the **intersection model** across the full `delegationChain`: `executeAction` re-checks `(org_id, agent_id, tool_id)` for **every agent in the chain** and refuses with `denied_reason: 'intersection_excludes_tool'` if any chain member lacks the permission
- [ ] **DELEG-08:** SSE stream emits cosmetic `partner_start` (with partner name + invocation description) and `partner_done` events around partner invocations; widget UI surfaces these as visible badges (e.g. "Asking the billing specialist...") — visibility is on by default, controllable via `organizations.delegation_visibility` (`visible | hidden`)

### CHAN — Channel Adapters & Wiring (6)

- [ ] **CHAN-01:** New `src/lib/agent-runtime/adapters/{web_widget,whatsapp,meta,manychat,telegram}.ts` modules expose `formatOutbound(text, opts) => ChannelMessage[]` for length, markdown, button, and attachment normalization per channel
- [ ] **CHAN-02:** WhatsApp/Meta/Instagram/Telegram adapters split outbound messages on the channel's hard length limit (1600 chars for WhatsApp; 2000 for Messenger; 4096 for Telegram); markdown is stripped or downgraded as appropriate
- [ ] **CHAN-03:** `src/app/api/chat/[token]/route.ts` (web widget) refactored to call `runAgent({stream: true})`; declares `export const maxDuration = 10`; existing `createChatStream` shim preserved through Phase 6 rollout for safe rollback
- [ ] **CHAN-04:** `src/lib/manychat/dispatch-event.ts` extended: when matched rule has `agent_id` set (XOR with `tool_config_id`), dispatch invokes `runAgent({stream: false})` and returns the reply via the existing ManyChat outbound action; rules without `agent_id` keep current behavior
- [ ] **CHAN-05:** `src/lib/meta/process-event.ts` extended: when the resolved `meta_channels` row has `agent_id` set, the always-200 + `after()` async path invokes `runAgent({stream: false})` and posts the reply via Meta Graph API; channels without `agent_id` keep current behavior
- [ ] **CHAN-06:** Migration 039 adds nullable `agent_id` FK to `agents` on both `manychat_rules` and `meta_channels` (single migration per Phase 33 D-33-01 split — separate from migration 038 which carries `tool_idempotency_keys` + `agent_model_pricing`); additive only (no backfill, no XOR CHECK constraint — see Phase 37 for dispatcher branch)

### IDEMP — Idempotency for Side-Effecting Tools (3)

- [ ] **IDEMP-01:** New `tool_idempotency_keys(org_id, agent_id, tool_id, idempotency_key TEXT, response_payload JSONB, created_at)` table with UNIQUE `(org_id, tool_id, idempotency_key)` and 24-hour TTL via partitioning or scheduled cleanup
- [ ] **IDEMP-02:** Side-effecting executors (`create_appointment`, `send_sms`, `create_contact`, `custom_webhook` when method is non-GET) accept an `idempotency_key` from the runtime; if a row exists, return the cached `response_payload` instead of re-executing; if not, execute and persist
- [ ] **IDEMP-03:** Runtime derives the idempotency key as `sha256(agent_invocation_id + tool_call_index)` so each LLM-issued tool call has a stable key for the lifetime of the invocation, preventing double-execution from agent retries or LLM tool-call deduplication failures

### PLAY — Playground (5)

- [ ] **PLAY-01:** Each agent has a test playground at `/dashboard/agents/[id]/playground`; admin chats against the agent and sees the reply inline
- [ ] **PLAY-02:** Playground exposes a channel selector (web_widget, whatsapp, messenger, instagram, manychat, telegram); switching channel re-applies the corresponding `channel_overrides`
- [ ] **PLAY-03:** Playground surfaces all tool calls inline in the message thread (reuses v1.4 chat-area `MessageList` component) with arguments + result + timing
- [ ] **PLAY-04:** Playground shows a "New session" button that resets the conversation context but preserves the agent + channel selection
- [ ] **PLAY-05:** Playground invocations carry `mode='playground'` flag in the runtime context; resulting `agent_invocations` rows are tagged so they're excluded from production observability counts and don't write to `conversations` / `conversation_messages`

### OBS — Observability (8)

- [ ] **OBS-01:** New `agent_invocations` table with: `id`, `organization_id` (FK + RLS), `agent_id`, `parent_invocation_id NULL` (self-FK for delegation tree), `trace_id UUID NOT NULL`, `channel`, `conversation_id NULL`, `depth`, `status`, `user_message`, `assistant_reply`, `tool_calls JSONB`, `partner_calls JSONB`, `tokens_in`, `tokens_out`, `cost_usd NUMERIC(10,6)`, `model`, `duration_ms`, `error_detail`, `mode` (`production | playground`), `created_at`
- [ ] **OBS-02:** `action_logs` extended with nullable `agent_invocation_id UUID FK` + `trace_id UUID NULL` (additive — v1.x consumers unaffected)
- [ ] **OBS-03:** New `agent_model_pricing(model TEXT PRIMARY KEY, input_per_1m_usd NUMERIC, output_per_1m_usd NUMERIC, source TEXT, updated_at)` seeded with current Anthropic + OpenRouter rates; runtime computes `cost_usd` per invocation by joining
- [ ] **OBS-04:** Per-agent metrics widget at `/dashboard/agents/[id]` shows: invocation count, p50/p95 latency, total cost, tool-call success rate (last 24h / 7d / 30d)
- [ ] **OBS-05:** Per-org cost ticker on `/dashboard` showing 1h / 24h / 7d totals + `% of daily cap consumed`; alert badge at 80% of cap
- [ ] **OBS-06:** Per-conversation drill-in at `/dashboard/conversations/[id]` extended with delegation tree visualization (nested invocations rendered as collapsible tree with cost + latency per node)
- [ ] **OBS-07:** `/dashboard/agents/[id]/invocations` lists recent invocations with status filter, cost filter, error filter; click-through opens delegation tree
- [ ] **OBS-08:** Existing chat-area component extended to show an agent badge on each assistant message (which agent produced it); useful when delegation is involved

### Cross-cutting Acceptance Tests (must pass to ship)

These are not requirements per-se but acceptance gates the verifier will check at end of milestone:

- [ ] **GATE-01:** Existing chat continues to work byte-identically post-Phase 1 migration (snapshot diff of widget conversation against pre-migration baseline = 0 differences)
- [ ] **GATE-02:** Adversarial prompt-injection corpus (≥10 known patterns: DAN, role-reversal, fake system prompts, JSON instruction smuggling) sent to a 2-agent delegation setup; assert no injected tool calls reach `executeAction`
- [ ] **GATE-03:** Load test (1000 req / 10 min from one IP) → rate-limited after 20/min, total cost < $5, kill switch flip → 503-graceful within 1s
- [ ] **GATE-04:** Confused-deputy 3-level chain test — A (read-only) → B (write-capable) → C (write-capable) — write attempt by C must be refused with `denied_reason: 'intersection_excludes_tool'`
- [ ] **GATE-05:** Realistic latency integration test (mock LLM with sleep 2.5s/call) — chain of generalist + 1 specialist + 1 tool-call ≤ 8s total
- [ ] **GATE-06:** Idempotency test — same tool call with same idempotency_key fired twice → executor invoked once, both responses identical
- [ ] **GATE-07:** Migration discipline — `SELECT count(*) FROM conversations WHERE agent_id IS NULL` returns 0 after backfill

---

## Future Requirements (deferred to v2.x)

These were called table-stakes by FEATURES.md research but are differentiators for Operator's scale; defer until first real signal.

- Mock tool responses in playground (when operator complains about real GHL writes during testing)
- Online eval scoring (LLM-as-judge per call) — when volume justifies the overhead
- Per-agent rate limits per visitor — when abuse observed
- Dataset-based offline eval suite (regression testing of prompts against fixed corpus) — when prompt iteration becomes the bottleneck
- Token streaming relay from partner to end-user (v2.0 ships heartbeat-only)
- Voice (Vapi) integration of agents — re-evaluate after v2.0 chat agents bed in
- Cross-org agent templates / marketplace
- A/B testing UI for prompt versions (schema is in scope; testing UX is not)
- Per-rule agent override on Meta channels (channel-level via `agent_channel_defaults` ships in v2.0; rule-level can wait if needed)

---

## Out of Scope (explicit exclusions)

These are anti-features identified by research; explicitly excluded to protect against scope creep.

| Excluded | Reason |
|---|---|
| Voice agent management (Vapi assistants) | Vapi remains source of truth for voice; Operator does NOT sync agent definitions to Vapi |
| "More agents = better" auto-spawn | Bag-of-agents anti-pattern; HBR/Galileo failure rate analysis |
| Free-form natural-language agent definition | Schema is the contract; no "describe your agent in English" creator |
| Agents creating/editing other agents at runtime | Recursive admin = security disaster |
| Unbounded delegation chains | `MAX_DELEGATION_DEPTH=2` is hard cap |
| Streaming "internal monologue" tokens to end-user | Confuses users; widget shows reply only + delegation badges |
| Auto-promote prompt version on save | Must be explicit Publish action |
| Single global cross-tenant agent | Per-org always |
| Per-channel forked agent (one agent per channel) | Use `channel_overrides` instead |
| In-playground "deploy to production" button | Promotion is an explicit admin action elsewhere |
| Hierarchical "manager agent" black-box router | Black-box routing breaks debuggability |
| Visual flow-chart builder (Voiceflow / n8n style) | Explicit "no n8n fallback" in PROJECT.md |
| Auto-summarize old conversations into agent prompt | Long-term memory bleed; explicit handoff payload only |
| Replacing Vapi as voice provider | Out of milestone; Operator is not a voice runtime |

---

## Traceability

Every v2.0 REQ-ID and acceptance gate maps to exactly one phase. Coverage: **52/52 requirements + 7/7 gates = 100%**.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AGENT-01 | Phase 36 | Pending |
| AGENT-02 | Phase 36 | Pending |
| AGENT-03 | Phase 36 | Pending |
| AGENT-04 | Phase 34 | Complete |
| AGENT-05 | Phase 34 | Complete |
| AGENT-06 | Phase 34 | Complete |
| AGENT-07 | Phase 34 | Complete |
| AGENT-08 | Phase 36 | Pending |
| AGENT-09 | Phase 33 | Complete |
| AGENT-10 | Phase 34 | Complete |
| AGENT-11 | Phase 41 | Pending |
| AGENT-12 | Phase 41 | Pending |
| AGENT-13 | Phase 41 | Pending |
| AGENT-14 | Phase 41 | Pending |
| AGENT-15 | Phase 41 | Pending |
| TOOL-01 | Phase 33 | Complete |
| TOOL-02 | Phase 36 | Pending |
| TOOL-03 | Phase 36 | Pending |
| TOOL-04 | Phase 36 | Pending |
| TOOL-05 | Phase 34 | Complete |
| TOOL-06 | Phase 34 | Complete |
| RUNTIME-01 | Phase 34 | Complete |
| RUNTIME-02 | Phase 34 | Complete |
| RUNTIME-03 | Phase 34 | Complete |
| RUNTIME-04 | Phase 34 | Complete |
| RUNTIME-05 | Phase 34 | Complete |
| RUNTIME-06 | Phase 34 | Complete |
| RUNTIME-07 | Phase 34 | Complete |
| RUNTIME-08 | Phase 34 | Complete |
| RUNTIME-09 | Phase 34 | Complete |
| RUNTIME-10 | Phase 34 | Complete |
| DELEG-01 | Phase 33 | Complete |
| DELEG-02 | Phase 38 | Pending |
| DELEG-03 | Phase 38 | Pending |
| DELEG-04 | Phase 38 | Pending |
| DELEG-05 | Phase 38 | Pending |
| DELEG-06 | Phase 38 | Pending |
| DELEG-07 | Phase 38 | Pending |
| DELEG-08 | Phase 38 | Pending |
| CHAN-01 | Phase 37 | Pending |
| CHAN-02 | Phase 37 | Pending |
| CHAN-03 | Phase 35 | Complete |
| CHAN-04 | Phase 37 | Pending |
| CHAN-05 | Phase 37 | Pending |
| CHAN-06 | Phase 33 | Complete |
| IDEMP-01 | Phase 38 | Pending |
| IDEMP-02 | Phase 38 | Pending |
| IDEMP-03 | Phase 38 | Pending |
| PLAY-01 | Phase 39 | Pending |
| PLAY-02 | Phase 39 | Pending |
| PLAY-03 | Phase 39 | Pending |
| PLAY-04 | Phase 39 | Pending |
| PLAY-05 | Phase 39 | Pending |
| OBS-01 | Phase 33 | Complete |
| OBS-02 | Phase 33 | Complete |
| OBS-03 | Phase 33 | Complete |
| OBS-04 | Phase 40 | Pending |
| OBS-05 | Phase 40 | Pending |
| OBS-06 | Phase 40 | Pending |
| OBS-07 | Phase 40 | Pending |
| OBS-08 | Phase 40 | Pending |
| GATE-01 | Phase 35 | Complete |
| GATE-02 | Phase 38 | Pending |
| GATE-03 | Phase 34 | Complete |
| GATE-04 | Phase 38 | Pending |
| GATE-05 | Phase 38 | Pending |
| GATE-06 | Phase 38 | Pending |
| GATE-07 | Phase 33 | Complete |

### Coverage Summary by Phase

| Phase | REQ Count | Gate Count | REQs |
|-------|----------:|-----------:|------|
| Phase 33 | 7 | 1 | AGENT-09, TOOL-01, DELEG-01, OBS-01, OBS-02, OBS-03, CHAN-06 + GATE-07 |
| Phase 34 | 17 | 1 | AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-10, TOOL-05, TOOL-06, RUNTIME-01..10 + GATE-03 |
| Phase 35 | 1 | 1 | CHAN-03 + GATE-01 |
| Phase 36 | 7 | 0 | AGENT-01, AGENT-02, AGENT-03, AGENT-08, TOOL-02, TOOL-03, TOOL-04 |
| Phase 37 | 4 | 0 | CHAN-01, CHAN-02, CHAN-04, CHAN-05 |
| Phase 38 | 11 | 4 | DELEG-02..08, IDEMP-01, IDEMP-02, IDEMP-03 + GATE-02, GATE-04, GATE-05, GATE-06 |
| Phase 39 | 5 | 0 | PLAY-01..05 |
| Phase 40 | 5 | 0 | OBS-04..08 |
| Phase 41 | 5 | 0 | AGENT-11..15 |
| **Total** | **52** | **7** | All requirements + gates mapped |

---

*Requirements defined: 2026-05-16*
*Last updated: 2026-05-16 — initial v2.0 definition (52 requirements + 7 acceptance gates) + traceability populated by gsd-roadmapper (9 phases, 33-41)*
