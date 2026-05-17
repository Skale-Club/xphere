# Requirements: Phase 38 — Multi-Agent Delegation

**Milestone:** v2.0 Multi-Bot Platform
**Phase:** 38 — Multi-Agent Delegation + Intersection Authz + Idempotency
**Source:** `.planning/workstreams/multi-bot-platform/REQUIREMENTS.md` (authoritative — see that file for full traceability)

## Phase 38 Requirements

### DELEG — Multi-Agent Delegation

- [ ] **DELEG-02:** For each agent with declared partners, the runtime injects synthetic LLM tools named `call_partner_<partner_slug>` into the tool list; the tool's description is `agent_partners.invocation_description`
- [ ] **DELEG-03:** When the LLM calls `call_partner_<slug>`, the runtime intercepts the tool call, recursively invokes `runAgent()` for the partner, and returns the partner's reply as the tool result; the parent agent then completes the user-facing reply
- [ ] **DELEG-04:** Handoff payload to partner uses three-tier structure: `{ from_agent: slug, intent: short_string, extracted_params: {...}, summary: string, recent_messages: last_3_verbatim }`; raw conversation history is NEVER forwarded
- [ ] **DELEG-05:** Handoff payload schema rejects nested keys matching `^role$|^system$|^instructions?$` to prevent prompt injection across agent boundary
- [ ] **DELEG-06:** Loop detection: `_callStack` (visited agent IDs) prevents an agent from being invoked twice in the same delegation chain; second attempt returns synthetic tool result "Cycle detected — answer from current agent"
- [ ] **DELEG-07:** Tool-execution authorization uses the **intersection model** across the full `delegationChain`: `executeAction` re-checks `(org_id, agent_id, tool_id)` for **every agent in the chain** and refuses with `denied_reason: 'intersection_excludes_tool'` if any chain member lacks the permission
- [ ] **DELEG-08:** SSE stream emits cosmetic `partner_start` (with partner name + invocation description) and `partner_done` events around partner invocations; widget UI surfaces these as visible badges — visibility is on by default, controllable via `organizations.delegation_visibility`

### IDEMP — Idempotency for Side-Effecting Tools

- [ ] **IDEMP-01:** `tool_idempotency_keys` table already exists (migration 038); Phase 38 adds TTL cleanup + runtime integration
- [ ] **IDEMP-02:** Side-effecting executors (`create_appointment`, `send_sms`, `create_contact`, `custom_webhook` when method is non-GET) accept an `idempotency_key` from the runtime; if a row exists, return the cached `response_payload` instead of re-executing; if not, execute and persist
- [ ] **IDEMP-03:** Runtime derives the idempotency key as `sha256(agent_invocation_id + tool_call_index)` so each LLM-issued tool call has a stable key for the lifetime of the invocation

### Cross-cutting Acceptance Gates

- [ ] **GATE-02:** Adversarial prompt-injection corpus (≥10 known patterns: DAN, role-reversal, fake system prompts, JSON instruction smuggling) sent to a 2-agent delegation setup; assert no injected tool calls reach `executeAction`
- [ ] **GATE-04:** Confused-deputy 3-level chain test — A (read-only) → B (write-capable) → C (write-capable) — write attempt by C must be refused with `denied_reason: 'intersection_excludes_tool'`
- [ ] **GATE-05:** Realistic latency integration test (mock LLM with sleep 2.5s/call) — chain of generalist + 1 specialist + 1 tool-call ≤ 8s total
- [ ] **GATE-06:** Idempotency test — same tool call with same idempotency_key fired twice → executor invoked once, both responses identical

---

*Requirements extracted from multi-bot-platform REQUIREMENTS.md on 2026-05-17*
