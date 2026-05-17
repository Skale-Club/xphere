# Roadmap: Phase 38 — Multi-Agent Delegation + Intersection Authz + Idempotency

## Overview

This workstream delivers the core multi-agent delegation capability for Operator v2.0.
Partners of an agent become synthetic LLM tools (`call_partner_<slug>`); the runtime
intercepts those calls and recursively invokes `runAgent()` with a structured handoff payload.
Authorization uses an intersection model (every agent in the chain must have the tool),
side-effecting executors gain idempotency wrappers, and the SSE stream surfaces delegation events
to the widget UI.

## Phases

- [ ] **Phase 38: Multi-Agent Delegation + Intersection Authz + Idempotency** - Partner-as-tool
  injection, structured handoff, intersection model at `executeAction`, idempotency wrappers on
  side-effecting tools, SSE delegation events + widget badges, adversarial prompt-injection tests.

## Phase Details

### Phase 38: Multi-Agent Delegation + Intersection Authz + Idempotency
**Goal**: Agents can delegate to partner agents via synthetic `call_partner_<slug>` tools; runtime
intercepts the tool call and recursively invokes `runAgent()` with structured handoff (no raw
history); `executeAction` enforces the intersection model across the full delegation chain;
side-effecting executors are wrapped with idempotency keys derived from the invocation.
**Depends on**: Phase 34, Phase 36
**Requirements**: DELEG-02, DELEG-03, DELEG-04, DELEG-05, DELEG-06, DELEG-07, DELEG-08, IDEMP-01, IDEMP-02, IDEMP-03, GATE-02, GATE-04, GATE-05, GATE-06
**Success Criteria** (what must be TRUE):
  1. When agent A has partners configured, the runtime injects synthetic `call_partner_<partner_slug>` tools; when the LLM emits one, the runtime recursively invokes `runAgent()` for the partner and returns the partner's reply as the tool result; `MAX_DELEGATION_DEPTH=2` is enforced and visited-set loop detection rejects re-entry with a synthetic tool-result message
  2. Handoff payload uses the three-tier structure (`from_agent` / `intent` / `extracted_params` / `summary` / `recent_messages: last_3_verbatim`); raw conversation history is never forwarded; payload schema rejects nested keys matching `^role$|^system$|^instructions?$` (DELEG-04, DELEG-05)
  3. `executeAction` re-checks `(org_id, agent_id, tool_id)` for every agent in `ctx.delegationChain` and refuses with `denied_reason: 'intersection_excludes_tool'` if any chain member lacks the permission
  4. Adversarial prompt-injection corpus (≥10 known patterns) sent to a 2-agent delegation setup produces zero injected tool calls reaching `executeAction` (GATE-02); realistic-latency integration test completes ≤8s total (GATE-05)
  5. Side-effecting executors (`create_appointment`, `send_sms`, `create_contact`, non-GET `custom_webhook`) accept an `idempotency_key = sha256(agent_invocation_id + tool_call_index)`; same key fired twice → executor invoked once, both responses byte-identical (GATE-06)
  6. SSE stream emits `partner_start` and `partner_done` events around partner invocations; widget UI surfaces these as visible badges; visibility is per-org-toggleable via `organizations.delegation_visibility`
**Plans**: TBD

---

*Workstream created: 2026-05-17*
