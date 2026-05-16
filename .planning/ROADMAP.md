# Roadmap: Operator

## Overview

Operator is a multi-tenant agency operations platform built around a reliable Action Engine. The v1.9 milestone shipped the first scheduled automation (GHL Lost-Lead Reengagement SMS). The v2.0 milestone now promotes **agent** to a first-class entity for chat channels (web widget, WhatsApp, Messenger, Instagram, ManyChat, Telegram), adds multi-agent delegation (chat-only), and reaches feature-parity with voice in capability terms. Voice (Vapi) is explicitly untouched — `assistant_mappings`, `/api/vapi/*`, and `resolveTool(orgId, toolName)` keep working byte-for-byte.

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** - Phase 7 (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** - Phases 8-13 (shipped 2026-04-05)
- ✅ **v1.3 Google Reviews Widget + Meta Messaging** - Phases 14-20 (shipped 2026-05-05)
- ✅ **v1.4 Chat System Refactor** - Phases 21-25 (shipped 2026-05-05)
- ✅ **v1.5 Tools Folder System** - Phase 26 (shipped 2026-05-06)
- ✅ **v1.6 ManyChat Integration** - Phases 27-28 (shipped 2026-05-07)
- ✅ **v1.7 Google Contacts Integration** - Phase 29 (shipped 2026-05-07)
- ✅ **v1.8 Executor Completeness** - Phases 30-31 (shipped 2026-05-08)
- ✅ **v1.9 GHL Lost-Lead Reengagement (SMS)** - Phase 32 (shipped 2026-05-16)
- 🚧 **v2.0 Multi-Bot Platform** - Phases 33-41 (defining)

Archived roadmaps: `.planning/milestones/v1.{0..8}-ROADMAP.md`.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (33.1, 33.2): Urgent insertions (marked with INSERTED)

Continuous numbering across milestones. v1.9 ended at phase 32; v2.0 starts at phase 33.

### Shipped (v1.x)

- [x] **Phase 32: GHL Lost-Lead Reengagement SMS Automation** - End-to-end scheduled MVP (completed 2026-05-16)

### v2.0 Multi-Bot Platform

- [x] **Phase 33: Schema Foundation + Legacy Default Agent Backfill** - All v2.0 migrations land additively; every existing org gets a seeded "Main Agent" so day-1 behavior is byte-identical (completed 2026-05-16)
- [ ] **Phase 34: Agent Runtime Skeleton + Day-1 Guardrails** - `runAgent()` entry, all cost/loop/timeout/kill-switch guards, agent-tool resolver, observability writes from day 1
- [ ] **Phase 35: Web Widget Canary Cutover** - Refactor `chat/stream.ts` to consume `runAgent()`; web widget switches to agent runtime with byte-identical behavior verified
- [ ] **Phase 36: Agent CRUD Dashboard** - `/dashboard/agents` list/create/edit; tool picker reuses v1.5 folders; channel overrides + channel defaults editor
- [ ] **Phase 37: ManyChat + Meta + Channel Adapters** - Per-channel formatting adapters (length, markdown, splits); ManyChat & Meta inbound branch on `agent_id`
- [ ] **Phase 38: Multi-Agent Delegation + Intersection Authz + Idempotency** - Partner-as-tool injection, structured handoff, intersection model at `executeAction`, idempotency wrappers on side-effecting tools
- [ ] **Phase 39: Multi-Channel Playground** - `/dashboard/agents/[id]/playground` with channel selector and `mode='playground'` runtime isolation
- [ ] **Phase 40: Per-Agent Observability UI** - Metrics widgets, cost ticker, conversation drill-in with delegation tree, invocations list, agent badges in chat-area
- [ ] **Phase 41: Prompt Versioning UX** - DB trigger snapshots, draft/publish flow, diff viewer, one-click rollback

## Phase Details

### Phase 32: GHL Lost-Lead Reengagement SMS Automation
**Goal**: A daily scheduled job identifies GoHighLevel "Lost" opportunities older than the configured threshold for the Skleanings sub-account, sends a Twilio SMS reengagement message to each contact (with `{{first_name}}` substitution and STOP opt-out compliance), persists an anti-loop record so the same contact is never re-messaged, and logs every dispatch in `action_logs` for observability — all configured exclusively via env vars and triggered by a GitHub Action workflow (with manual `workflow_dispatch` available).
**Depends on**: Phase 31 (v1.8 `send_sms` Twilio executor)
**Requirements**: REENG-01, REENG-02, REENG-03, REENG-04, REENG-05, REENG-06, REENG-07, REENG-08, REENG-09, REENG-10, REENG-11, REENG-12, REENG-13, REENG-14, REENG-15, REENG-16, REENG-17
**Success Criteria** (what must be TRUE):
  1. A GitHub Action runs daily at the scheduled time (cron `0 14 * * *`) and successfully calls the runner endpoint with the bearer secret; the same workflow can be triggered manually from the GitHub UI via `workflow_dispatch`
  2. Calling `POST /api/automations/ghl-reengagement/run` with the correct bearer secret returns a JSON summary `{ processed, sent, skipped, failed, errors[] }` reflecting the actual pass; calling it without the secret returns HTTP 401
  3. Every Lost opportunity in the configured GHL location whose `updatedAt` is older than the threshold (default 180 days) receives exactly one SMS per contact ever — repeated invocations skip contacts already present in `ghl_reengagement_sent`
  4. Each SMS message has `{{first_name}}` substituted (or the fallback "amigo(a)" when missing) and every dispatch attempt (success or failure) appears in `action_logs` with `tool_name='ghl_reengagement_sms'` and either response payload or error detail
  5. An operator can configure the automation end-to-end by setting env vars on Vercel + GitHub Action secrets — the required vars are documented in `docs/automations/ghl-reengagement.md` along with the cron schedule and how to manually trigger a run
**Plans**: 4 plans
- [x] 32-01-PLAN.md — Wave 0 test scaffolds (4 Vitest stubs + shared fixture for REENG-01, 03, 08)
- [x] 32-02-PLAN.md — GHL list lib + render-template helper + migration 032_ghl_reengagement_sent + schema push + types regen (REENG-01..04, 08, 09)
- [x] 32-03-PLAN.md — runReengagement orchestration (claim-first anti-loop, allSettled dispatch, logAction redaction) (REENG-02, 04, 10, 11, 12)
- [x] 32-04-PLAN.md — Protected route handler + GitHub Action workflow + operator docs + phase gate (REENG-05..07, 13..17)

---

### Phase 33: Schema Foundation + Legacy Default Agent Backfill
**Goal**: All v2.0 schema lands additively in a single coherent migration wave; every existing org gets a seeded "Main Agent" whose prompt, tools, and KB scope reproduce v1.4 chat behavior verbatim, so when later phases cut the chat path over to the agent runtime, behavior is byte-identical.
**Depends on**: Phase 32 (v1.9 baseline; no functional dependency, just numeric continuation)
**Requirements**: AGENT-09, TOOL-01, DELEG-01, OBS-01, OBS-02, OBS-03, CHAN-06, GATE-07
**Success Criteria** (what must be TRUE):
  1. Migrations 034-039 are applied to the remote DB and `npm run build` passes with regenerated `src/types/database.ts`; no existing `tool_configs`, `action_logs`, `conversations`, `manychat_rules`, or `meta_channels` column is removed or renamed (additive-only verified by schema diff)
  2. Every existing organization has exactly one row in `agents` named "Main Agent" whose `system_prompt` is byte-equal to the v1.4 hardcoded `chat/stream.ts` template, with all that org's currently-active `tool_configs` granted via `agent_tools`, and a matching `agent_channel_defaults(org_id, 'web_widget', main_agent_id)` row
  3. `SELECT count(*) FROM conversations WHERE agent_id IS NULL` returns 0 after backfill (GATE-07 verification)
  4. `agent_invocations`, `agent_prompt_versions`, `agent_channel_defaults`, `agent_tools`, `agent_partners`, `tool_idempotency_keys`, and `agent_model_pricing` tables exist with RLS enabled using the `(SELECT public.get_current_org_id())` pattern; `agent_model_pricing` is seeded with current Anthropic + OpenRouter rates
  5. Vapi paths (`/api/vapi/*`, `assistant_mappings`, `resolveTool(orgId, toolName)`) are untouched — pre-existing v1.x integration tests still pass
**Plans**: TBD

---

### Phase 34: Agent Runtime Skeleton + Day-1 Guardrails
**Goal**: A single `runAgent(ctx, opts)` entry point in `src/lib/agent-runtime/` is the only way chat-side code invokes an LLM; every cost, loop, timeout, and kill-switch guard ships in this phase (not later); every invocation writes exactly one `agent_invocations` row with full cost/latency/trace data; the `ai@^6` adoption decision is locked here via spike.
**Depends on**: Phase 33
**Requirements**: AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-10, TOOL-05, TOOL-06, RUNTIME-01, RUNTIME-02, RUNTIME-03, RUNTIME-04, RUNTIME-05, RUNTIME-06, RUNTIME-07, RUNTIME-08, RUNTIME-09, RUNTIME-10, GATE-03
**Success Criteria** (what must be TRUE):
  1. `runAgent(ctx, opts)` resolves the agent, applies `channel_overrides` for the invocation channel, enforces `allowed_channels` (HTTP 422 on mismatch), and refuses inactive agents (HTTP 410)
  2. All four cost/safety caps are enforced from day 1: `MAX_DELEGATION_DEPTH=2` (placeholder hook for Phase 38), `MAX_LLM_CALLS_PER_TURN=6`, per-conversation token cap (default 200K), per-org daily $ cap (default $50, override via `organizations.daily_cost_cap_usd_override`); each emits a structured log event when tripped
  3. Per-turn `AbortController` with 8s budget is propagated to every LLM SDK call; on abort the partial assistant reply is persisted with `status='aborted'`; `AGENT_RUNTIME_ENABLED=false` env flip causes every `runAgent` call to return a 503-graceful response within 1s (GATE-03)
  4. Every `runAgent` call writes exactly one `agent_invocations` row with non-null `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `model`, `status`, `trace_id`; cost is computed via join to `agent_model_pricing`
  5. `resolveAgentTool(agentId, toolName)` exists alongside the unchanged `resolveTool(orgId, toolName)`; runtime tool-call guard refuses tools not attached to the agent with `denied_reason: 'tool_not_attached_to_agent'` and synthesizes a tool-result message back to the LLM (no exception thrown)
  6. The `ai@^6` spike is run; the adoption decision (adopt vs stay custom) is documented in the phase verifier output and respected by the codebase
**Plans**: 6 plans
- [ ] 34-01-PLAN.md — ai@^6 spike: install, probe, lock adopt/reject decision in RESEARCH.md (RUNTIME-01)
- [ ] 34-02-PLAN.md — Migration 042: ADD 'running' to agent_invocation_status enum + organizations.daily_cost_cap_usd_override column + types regen (RUNTIME-07)
- [ ] 34-03-PLAN.md — types.ts + resolve-agent.ts + resolve-agent-tool.ts: shared contracts + agent resolver + tool junction resolver (AGENT-04..07, AGENT-10, TOOL-05, RUNTIME-01..03)
- [ ] 34-04-PLAN.md — guardrails.ts: kill-switch, delegation depth stub, LLM call count, token cap, daily cost cap (RUNTIME-04..09, GATE-03)
- [ ] 34-05-PLAN.md — invocations.ts + run-agent.ts + index.ts: DB write helpers + orchestration loop + public export (RUNTIME-01, 08..10, TOOL-06, AGENT-06, AGENT-10)
- [ ] 34-06-PLAN.md — Vitest test suite: guardrail units, GATE-03 kill-switch timing, invocation writes, full integration test with Main Agent (all REQs)

---

### Phase 35: Web Widget Canary Cutover
**Goal**: `src/lib/chat/stream.ts` is refactored to accept an `AgentContext`; `src/app/api/chat/[token]/route.ts` switches to invoke `runAgent({stream: true})` resolving the per-channel default agent; legacy orgs continue to chat with byte-identical behavior because Phase 33 seeded the Main Agent. The `createChatStream` shim is preserved through Phase 38 for safe rollback.
**Depends on**: Phase 33, Phase 34
**Requirements**: CHAN-03, GATE-01
**Success Criteria** (what must be TRUE):
  1. The web widget endpoint (`POST /api/chat/[token]`) declares `export const maxDuration = 10` and invokes `runAgent({stream: true})`; the `createChatStream` shim wraps the new path so any non-migrated caller still compiles
  2. A snapshot diff of a fully-played widget conversation against a captured pre-migration v1.4 baseline shows zero observable differences (GATE-01) — same token stream, same SSE events, same persisted messages, same tool call ordering
  3. SSE protocol is preserved: `session`, `token`, `tool_call`, `done` events emit in the same shape; widget JS bundle requires no changes
  4. Existing v1.4 chat-area realtime subscriptions continue to deliver new messages via `postgres_changes` on `conversation_messages`
  5. A one-line revert of `src/app/api/chat/[token]/route.ts` rolls back to the legacy `createChatStream` path (rollback drill verified)
**Plans**: TBD
**UI hint**: yes

---

### Phase 36: Agent CRUD Dashboard
**Goal**: An admin can create, edit, and configure agents end-to-end through `/dashboard/agents` — name, slug, prompt, model, generation config, fallback message, attached tools (reusing v1.5 folder grouping), partner agents, channel allow-list, channel overrides JSONB, and per-channel default mapping. Runs in parallel with Phases 34-35.
**Depends on**: Phase 33
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-08, TOOL-02, TOOL-03, TOOL-04
**Success Criteria** (what must be TRUE):
  1. Admin can navigate to `/dashboard/agents`, see the org's agents listed, create a new agent (name, slug unique per org, description, system prompt, model, is_active toggle, optional temperature/max_tokens/max_history/fallback_message), and edit any field; saves persist with `created_by` / `updated_by` audit fields
  2. Tool attachment uses a multi-select picker that reuses the v1.5 `tool_folders` hierarchy; new agents start with zero tools attached (deny-by-default verified by the picker showing all unchecked); each tool row displays name, type, folder, and the integration it depends on (with a visual flag if the integration is missing but still selectable)
  3. Admin can set the default agent per channel via `agent_channel_defaults(org_id, channel, agent_id)` UI; channels without a default fall back to the seeded Main Agent
  4. Channel overrides JSONB is editable via a structured form (per-channel rows for system_prompt suffix, model, temperature, max_tokens, max_history) backed by a Zod parser that rejects malformed shape on save
  5. Inactive agents are excluded from CRUD UI dropdowns (channel default mapper, partner picker) but their historical `agent_invocations` rows remain queryable
**Plans**: TBD
**UI hint**: yes

---

### Phase 37: ManyChat + Meta + Channel Adapters
**Goal**: Channel adapter modules normalize outbound replies for each channel's wire format (length, markdown, splits, attachments); ManyChat dispatch and Meta inbound processing branch on `agent_id` (additive, XOR with existing `tool_config_id` / per-channel automation paths) so agents can serve WhatsApp, Messenger, Instagram, and ManyChat traffic via the always-200 + `after()` async pattern.
**Depends on**: Phase 35
**Requirements**: CHAN-01, CHAN-02, CHAN-04, CHAN-05
**Success Criteria** (what must be TRUE):
  1. `src/lib/agent-runtime/adapters/{web_widget,whatsapp,meta,manychat,telegram}.ts` exist; each exposes `formatOutbound(text, opts) => ChannelMessage[]`; per-channel snapshot tests cover length truncation (1600 WhatsApp / 2000 Messenger / 4096 Telegram) and markdown stripping
  2. `src/lib/manychat/dispatch-event.ts` invokes `runAgent({stream: false})` when the matched rule has `agent_id` set (XOR with `tool_config_id`); reply is sent via the existing `sendManychatMessage` outbound path; rules without `agent_id` keep current v1.6 behavior
  3. `src/lib/meta/process-event.ts` invokes `runAgent({stream: false})` when the resolved `meta_channels` row has `agent_id` set; reply posts via Meta Graph API on the existing always-200 + `after()` async path; channels without `agent_id` keep current v1.3 behavior
  4. ManyChat and Meta webhook handlers always return HTTP 200 within their existing latency envelopes regardless of agent latency; agent runs happen in `after()` and never block the webhook ack
  5. A 3000-char agent response sent through the WhatsApp adapter splits into ≤1600-char chunks at sentence boundaries (snapshot test)
**Plans**: TBD

---

### Phase 38: Multi-Agent Delegation + Intersection Authz + Idempotency
**Goal**: Agents can delegate to partner agents via synthetic `call_partner_<slug>` tools; runtime intercepts the tool call and recursively invokes `runAgent()` with structured handoff (no raw history); `executeAction` enforces the intersection model across the full delegation chain; side-effecting executors are wrapped with idempotency keys derived from the invocation. This phase verifies most cross-cutting acceptance gates.
**Depends on**: Phase 34, Phase 36
**Requirements**: DELEG-02, DELEG-03, DELEG-04, DELEG-05, DELEG-06, DELEG-07, DELEG-08, IDEMP-01, IDEMP-02, IDEMP-03, GATE-02, GATE-04, GATE-05, GATE-06
**Success Criteria** (what must be TRUE):
  1. When agent A has partners configured, the runtime injects synthetic `call_partner_<partner_slug>` tools (description = `agent_partners.invocation_description`); when the LLM emits one, the runtime recursively invokes `runAgent()` for the partner and returns the partner's reply as the tool result; `MAX_DELEGATION_DEPTH=2` is enforced (Phase 34 placeholder activated) and visited-set loop detection rejects re-entry with a synthetic tool-result message
  2. Handoff payload uses the three-tier structure (`from_agent` / `intent` / `extracted_params` / `summary` / `recent_messages: last_3_verbatim`); raw conversation history is never forwarded; payload schema rejects nested keys matching `^role$|^system$|^instructions?$` (DELEG-04, DELEG-05)
  3. `executeAction` re-checks `(org_id, agent_id, tool_id)` for **every agent in `ctx.delegationChain`** and refuses with `denied_reason: 'intersection_excludes_tool'` if any chain member lacks the permission; a 3-level chain A (read-only) → B (write) → C (write) write attempt is refused (GATE-04)
  4. Adversarial prompt-injection corpus (≥10 known patterns: DAN, role-reversal, fake system prompts, JSON instruction smuggling) sent to a 2-agent delegation setup produces zero injected tool calls reaching `executeAction` (GATE-02); a realistic-latency integration test (mock LLM 2.5s/call) of generalist + 1 specialist + 1 tool-call completes ≤8s total (GATE-05)
  5. Side-effecting executors (`create_appointment`, `send_sms`, `create_contact`, non-GET `custom_webhook`) accept an `idempotency_key = sha256(agent_invocation_id + tool_call_index)`; same key fired twice → executor invoked once, both responses byte-identical (GATE-06)
  6. SSE stream emits cosmetic `partner_start` (with partner name + invocation description) and `partner_done` events around partner invocations; widget UI surfaces these as visible badges by default; visibility is per-org-toggleable via `organizations.delegation_visibility`
**Plans**: TBD
**UI hint**: yes

---

### Phase 39: Multi-Channel Playground
**Goal**: Each agent has a test playground at `/dashboard/agents/[id]/playground` where an admin chats against the agent across channel modes; tool calls and partner invocations render inline; playground sessions carry `mode='playground'` so they're excluded from production observability counts and don't write to `conversations`/`conversation_messages`.
**Depends on**: Phase 36, Phase 38
**Requirements**: PLAY-01, PLAY-02, PLAY-03, PLAY-04, PLAY-05
**Success Criteria** (what must be TRUE):
  1. Admin opens `/dashboard/agents/[id]/playground`, sends a message, and sees the streamed reply inline reusing the v1.4 chat-area `MessageList` component; tool calls display arguments + result + timing inline
  2. Channel selector (web_widget, whatsapp, messenger, instagram, manychat, telegram) re-applies the corresponding `channel_overrides` on every send; switching channel mid-session is allowed
  3. "New session" button resets conversation context but preserves the current agent + channel selection
  4. Playground invocations carry `mode='playground'` in the runtime context; resulting `agent_invocations` rows are tagged `mode='playground'` and are excluded from production cost/latency widgets and the per-org cost ticker
  5. No row is written to `conversations` or `conversation_messages` from a playground run (verified by snapshot diff before/after)
**Plans**: TBD
**UI hint**: yes

---

### Phase 40: Per-Agent Observability UI
**Goal**: Admins can answer "how is each agent performing, what does it cost, and what happened in this conversation" via dashboard widgets backed by the `agent_invocations` rows that have been written since Phase 34. Includes per-agent metrics, per-org cost ticker, conversation drill-in with delegation tree, invocations list with filters, and per-message agent badges in the existing chat-area.
**Depends on**: Phase 34, Phase 36, Phase 38
**Requirements**: OBS-04, OBS-05, OBS-06, OBS-07, OBS-08
**Success Criteria** (what must be TRUE):
  1. `/dashboard/agents/[id]` shows a metrics widget with invocation count, p50/p95 latency, total cost, and tool-call success rate over 24h / 7d / 30d windows
  2. `/dashboard` shows a per-org cost ticker with 1h / 24h / 7d totals and `% of daily cap consumed`; an alert badge appears when consumption ≥80% of cap
  3. `/dashboard/conversations/[id]` renders a delegation tree (collapsible nested invocations) with cost + latency annotated per node
  4. `/dashboard/agents/[id]/invocations` lists recent invocations filterable by status, cost, and error; clicking an invocation opens its delegation tree view
  5. Existing chat-area component shows an agent badge on each assistant message identifying which agent produced it (useful when delegation is involved)
**Plans**: TBD
**UI hint**: yes

---

### Phase 41: Prompt Versioning UX
**Goal**: Every change to an agent's system prompt automatically creates an immutable version row via DB trigger; the runtime reads the prompt from `active_prompt_version_id`, never directly from `agents.system_prompt`; admins edit drafts and explicitly Publish to promote; rollback is one click and never mutates a version row.
**Depends on**: Phase 36
**Requirements**: AGENT-11, AGENT-12, AGENT-13, AGENT-14, AGENT-15
**Success Criteria** (what must be TRUE):
  1. Updating `agents.system_prompt` automatically inserts a row in `agent_prompt_versions(agent_id, version, system_prompt, created_by, created_at)` via DB trigger; the version number monotonically increases per agent
  2. `runAgent()` always loads the prompt from the row pointed to by `agents.active_prompt_version_id`, never from `agents.system_prompt` directly (verified by integration test that mutates `system_prompt` and asserts runtime still uses the old active version)
  3. Saving a prompt edit creates a draft version (new row, but `active_prompt_version_id` unchanged); promoting to production requires an explicit "Publish" action on the prompt history page (no auto-promote on save)
  4. Admin can view the prompt version history list at `/dashboard/agents/[id]` with author, timestamp, and unified diff against the previous version
  5. Clicking "Activate" on any prior version updates `active_prompt_version_id` and creates a new audit log entry; the version row itself is never mutated; rollback completes in a single click
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41. Phases 34/36 may begin in parallel with 35; Phase 40 may begin in parallel with later phases since rows are written from Phase 34 onward.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 32. GHL Lost-Lead Reengagement SMS Automation | v1.9 | 4/4 | Complete    | 2026-05-16 |
| 33. Schema Foundation + Legacy Default Agent Backfill | v2.0 | 7/7 | Complete    | 2026-05-16 |
| 34. Agent Runtime Skeleton + Day-1 Guardrails | v2.0 | 0/6 | Planned     | - |
| 35. Web Widget Canary Cutover | v2.0 | 0/0 | Not started | - |
| 36. Agent CRUD Dashboard | v2.0 | 0/0 | Not started | - |
| 37. ManyChat + Meta + Channel Adapters | v2.0 | 0/0 | Not started | - |
| 38. Multi-Agent Delegation + Intersection Authz + Idempotency | v2.0 | 0/0 | Not started | - |
| 39. Multi-Channel Playground | v2.0 | 0/0 | Not started | - |
| 40. Per-Agent Observability UI | v2.0 | 0/0 | Not started | - |
| 41. Prompt Versioning UX | v2.0 | 0/0 | Not started | - |

---

## Backlog

### Phase 999.1: GHL Push-Pull Messaging (BACKLOG)

**Goal:** Full push-pull architecture where Operator is the AI brain and GHL is the delivery layer for SMS and WhatsApp. Includes inbound webhook, bot toggle, human takeover, assigned operator, and outbound message routing with operator name prefix.
**Requirements:** TBD
**Plans:** 7/7 plans complete

**What was shipped:**
- `supabase/migrations/041_ghl_inbound.sql` — `ghl_channels`, `ghl_events`, GHL channel variants on `conversations.channel`, `conversations.assigned_user_id`
- `src/lib/ghl/send-message.ts` — generalized GHL message sender (SMS + WhatsApp)
- `src/lib/ghl/process-event.ts` — inbound event processor with dedup, `bot_status` gate, automation dispatch, outbound reply via GHL API
- `src/app/api/ghl/webhook/route.ts` — inbound receiver with `X-Operator-Secret` auth, routes by `locationId`
- `PATCH /api/chat/conversations/[id]/bot-status` — toggle bot `active` / `paused` (human takeover)
- `POST /api/chat/conversations/[id]/assign` — assign a specific org member to a conversation
- `src/app/api/chat/conversations/[id]/messages/route.ts` — GHL outbound routing + `operator_prefix: true` adds `"Name:\nMessage"` format

**GHL Workflow config:**
  - Trigger: Customer Replied
  - Action: Webhook → `POST https://operator.skale.club/api/ghl/webhook`
  - Header: `X-Operator-Secret: <webhook_secret from ghl_channels row>`

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
