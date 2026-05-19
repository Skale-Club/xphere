---
id: SEED-019
status: dormant
planted: 2026-05-19
planted_during: post-v2.8 Scheduling Hardening
trigger_when: explicit user request OR milestone planning with theme "automations 2.0", "no-code", "workflow builder", "flow editor", "AI agents that build automations"; OR first paying client asks for branching/conditional logic; OR competitor analysis shows ManyChat/n8n parity expected
scope: Large
priority: high
depends_on: [SEED-002 (multi-bot platform — agent runtime exists)]
---

# SEED-019: Visual Automation Builder — AI-Native, Drag-and-Drop, Multi-Channel

Build a **node-based visual workflow editor** for the existing action engine, where flows can be triggered by any runtime (Vapi voice, chat, agents, inbound webhooks, schedules, manual) and execute multi-step sequences with variable passing, conditional branching, and delays.

The defining principle: **AI is the primary builder.** Drag-and-drop is the fallback for power users who want to fine-tune. Most users will say "create a flow that adds new contacts to a Google Sheet and sends them a welcome WhatsApp" and the AI builds the canvas. AI can also **read existing flows, explain them, edit them, and execute them on demand.**

Visually inspired by ManyChat / n8n / Zapier. Conceptually different: the LLM is a first-class collaborator, not a chat sidebar bolted onto a canvas.

---

## Why This Matters

### 1. The current `/automations` page is single-shot, stateless
Today's tool_configs map one LLM-callable name → one backend action. That's enough for "the AI assistant on a call needs to create a contact in GHL", but it can't express:
- "When SMS arrives from a phone matching a Lost lead, create a task AND send a WhatsApp follow-up AND wait 24h AND if no reply, escalate to a human"
- "Every Monday at 9am, query GHL for opportunities won last week, render a CSV, email to the operator"
- "When a booking is created via /scheduling, check if the contact has a custom field 'plan=premium', if yes book a 60min slot, if no book 30min"

The competition (ManyChat, n8n, Make, Zapier) sells flows specifically because business logic is **multi-step, conditional, and time-aware**. Xphere is at parity on integrations but a step behind on orchestration.

### 2. AI-native is the differentiator
n8n/Zapier require business users to drag nodes and wire them manually — which is why those tools are mostly used by developers. ManyChat is easier but locked to one channel.

Xphere already has the agent runtime, the integration library, and the multi-channel inbox. Adding **"tell the AI what you want and it builds the flow"** is the wedge: a non-technical operator can describe an automation in Portuguese, see it materialize on the canvas, tweak visually if needed, and ship. No competitor does this well today.

### 3. The action engine is the substrate — flows are a layer on top
We don't throw away tool_configs. A flow is a graph of nodes; each "action node" calls the existing `executeAction()` dispatcher. The engine, integrations, credential storage, logs — all reused. We add: flow schema, execution state machine, visual editor, trigger expansion, AI generator.

This means the surface area of new code is bounded — most of it is the canvas + state machine + AI prompting layer. The provider executors don't change.

### 4. The 80/20 of flows is linear
Looking at real ManyChat/n8n templates, 80% of flows are: trigger → 3-5 actions in sequence → end. Branching, loops, and delays are the 20% that matter for advanced cases. **Ship linear flows first, AI can build those cleanly, then add the harder primitives over 2-3 follow-up milestones.**

### 5. Long-term, this becomes the agent's playbook
Once flows exist, an AI agent on a chat can call `executeFlow('lead_qualification', { contact_id })` instead of being told to manually invoke 5 different tools. The flow IS the playbook. The agent becomes a thin natural-language wrapper around well-tested flow definitions.

---

## When to Surface

**Primary triggers:**
- Explicit user request for a workflow builder, visual editor, "automation 2.0", or n8n-style flows
- Milestone planning with theme "no-code", "ai agents that build automations", "workflow editor"
- First paying client asks for branching/conditional logic that tool_configs can't express
- Multi-step automation request that today requires custom code

**Secondary triggers:**
- Competitor analysis (sales team loses a deal because ManyChat has visual flows)
- Operator pain point: "I have to ask Claude to chain 3 actions every time, I want this to be reusable"
- Need for scheduled automations beyond GHL reengagement (currently single-purpose cron)

**Negative triggers (don't surface):**
- Milestone focused on a single new channel or integration — flows reuse what's there, no urgency
- When the customer base hasn't yet validated tool_configs as a need — premature investment

---

## Locked Decisions (capture before /gsd:discuss-phase)

| Decision | Value | Reasoning |
|----------|-------|-----------|
| Visual library | **React Flow (`@xyflow/react` v12)** | Mature, used by n8n itself, great TS support, custom nodes, free MIT |
| Storage | **JSONB column on `flows` table** + edges in same blob | Versioning, optimistic locking, fast snapshot reads — no graph DB |
| Execution | **Linear-first** — branching/loops in v2 | Ship the 80% case first; AI generates linear flows reliably |
| Trigger model | **Coexist with existing webhook receivers** | Don't break Vapi/Meta/ManyChat routes; add a new `flow_triggers` registry that maps events → flow IDs |
| AI builder | **Tool-calling LLM with strict schema** | Use Anthropic structured output: LLM proposes a flow JSON validated by Zod before render. No free-form code generation |
| AI executor | **New action_type `execute_flow`** | Flows become callable from any runtime exactly like other actions — clean reuse |
| Backwards compat | **Existing tool_configs survive as "1-node flows" or stay as-is** | Don't force a migration; operator chooses when to upgrade a tool_config to a flow |
| Execution runtime | **Node.js (Vercel) for short flows, Supabase Edge Functions for delays/schedules** | Vercel timeout is the blocker for long flows; Edge Functions can sleep |
| Variable interpolation | **Mustache-style `{{node_id.output.field}}`** | Familiar syntax, easy to render, can be highlighted in the UI |
| Error handling | **Per-node: halt-flow / skip-node / fallback-edge** | Three explicit options on each node; default halt |
| Observability | **Reuse `action_logs` + new `flow_runs` table** | Per-run state + per-node timing; query joins reconstruct full execution |

---

## Scope Estimate

**Large** — 7-9 phases for the v1 MVP. Likely 3 milestones total to reach feature-parity with simplified ManyChat:
- **Milestone A (v3.0):** linear flows, AI builder, AI executor, manual + webhook triggers
- **Milestone B (v3.1):** branching, scheduled triggers, retries, debugging UI
- **Milestone C (v3.2):** loops, sub-flows, parallel branches, marketplace templates

This seed scopes **Milestone A**.

### Milestone A — Phase decomposition (proposed)

1. **FLOWS-DB-FOUNDATION** — schema for `flows`, `flow_versions`, `flow_runs`, `flow_triggers`, `flow_run_nodes`; RLS; TypeScript types
2. **FLOWS-ENGINE-LINEAR** — execution engine: load flow → walk nodes sequentially → call `executeAction()` per node → interpolate variables → persist run state → return result; per-node error policy
3. **FLOWS-TRIGGER-REGISTRY** — declarative trigger system: webhook triggers (event router checks `flow_triggers` table for matching flows), manual triggers, future-scheduled triggers; first wire Meta+ManyChat+Vapi inbound through the registry
4. **FLOWS-VISUAL-CANVAS** — React Flow setup, base canvas with pan/zoom, custom node types (trigger, action, end), edge rendering, save/load round-trip
5. **FLOWS-NODE-PALETTE** — left sidebar listing all available action_types grouped by integration, drag-to-canvas creates new node with default config, node config panel (form per action_type with required params, variable picker)
6. **FLOWS-AI-BUILDER** — `/automations/build` chat-style page where user describes the flow in natural language, LLM streams structured flow JSON, canvas renders live; bi-directional: user can edit canvas and ask AI to refine; "explain this flow" command for existing flows
7. **FLOWS-AI-EXECUTOR** — new `execute_flow` action_type wired into the action engine; AI agents on chat can call flows by name; `runFlowNow(flowId, inputVars)` server action for manual triggering; observability viewer at `/automations/runs/[id]` with per-node status
8. **FLOWS-MIGRATION-COEXIST** — keep `/automations` (tool_configs) page intact, add `/automations/flows` as the new entry; "upgrade to flow" button on tool_configs that creates a 1-node flow as starting point; clear messaging about which is which

### Components to build (high level)

**Database (Phase 1):**
- `flows(id, org_id, name, slug, description, version, is_active, created_by, created_at, updated_at)` — header
- `flow_versions(id, flow_id, version_number, definition jsonb, created_at, created_by)` — immutable snapshots (definition = `{ nodes, edges, variables, metadata }`)
- `flow_triggers(id, org_id, flow_id, trigger_type, config jsonb, is_active)` — `trigger_type` enum: `webhook | manual | scheduled | event` with config being `{ event_name, filter }` etc.
- `flow_runs(id, org_id, flow_id, flow_version_id, trigger_type, trigger_payload jsonb, status, started_at, ended_at, error)` — one row per execution
- `flow_run_nodes(id, run_id, node_id, status, input jsonb, output jsonb, error, started_at, ended_at)` — per-node trace

**Engine (Phase 2):**
- `src/lib/flows/engine.ts` — `runFlow(flow_version, trigger_payload, context)`: walks nodes, calls executors, persists state
- `src/lib/flows/interpolate.ts` — `{{node_5.output.email}}` → resolved value from runtime state
- `src/lib/flows/zod-schema.ts` — Zod schema for flow definition (catches AI hallucinations + UI validation)
- Vercel timeout guard: flows with delays > 10s halt and persist, picked up by Edge Function workers

**Trigger registry (Phase 3):**
- `src/lib/flows/trigger-router.ts` — given an event (e.g., `meta.message.received`, `vapi.tool.called`, `contact.created`), find flows whose triggers match and enqueue runs
- Hook into existing webhook handlers (Meta, ManyChat, Vapi, etc.) — they call `triggerRouter.fire(event, payload)` alongside current logic

**Visual editor (Phases 4-5):**
- `src/app/(dashboard)/automations/flows/page.tsx` — list flows
- `src/app/(dashboard)/automations/flows/[id]/page.tsx` — canvas editor
- `src/components/flows/canvas.tsx` — React Flow root
- `src/components/flows/nodes/{trigger,action,condition,delay,end}-node.tsx` — node types
- `src/components/flows/palette.tsx` — left sidebar with grouped integration nodes
- `src/components/flows/node-config-panel.tsx` — right sidebar form per node
- `src/components/flows/variable-picker.tsx` — dropdown showing available `{{node_id.output.*}}` references at this point in the flow

**AI builder (Phase 6):**
- `src/app/(dashboard)/automations/flows/build/page.tsx` — split: chat on left, canvas on right
- `src/lib/flows/ai-builder.ts` — prompt template + tool-call definitions: `add_node`, `connect_nodes`, `update_node_config`, `delete_node`, `propose_full_flow`
- The AI never returns raw flow JSON to the user — it calls structured tools that mutate the canvas state, which the UI then renders
- For "explain this flow": AI receives flow definition + recent runs, returns markdown summary
- For "edit this flow": same tool API + current canvas state

**AI executor (Phase 7):**
- New executor in `src/lib/action-engine/executors/execute-flow.ts` — calls `runFlow()` with mapped params
- New `action_type` enum value `execute_flow`
- New page `/automations/runs/[id]` — visual replay of execution with per-node status, input/output, timing
- Agents that have `execute_flow` in their tools can now run flows mid-conversation

### Out of scope (deferred to Milestones B and C)

- **Branching / conditional nodes** — if/else logic, switch on variable values (Milestone B)
- **Loop nodes** — for-each over arrays, with iteration limit guards (Milestone C)
- **Delay nodes beyond 10s** — pause flow, persist state, resume via Edge Function worker (Milestone B)
- **Scheduled triggers** — cron-style execution (every Monday 9am) requires the delay infrastructure (Milestone B)
- **Sub-flows** — call one flow from another, nested execution (Milestone C)
- **Parallel branches** — fork execution into multiple paths, await all (Milestone C)
- **Flow marketplace / templates** — shareable templates ("Lead qualifier", "Welcome sequence") (Milestone C)
- **Real-time collaboration** — multiple operators editing the same canvas (out of scope indefinitely)
- **Version diff visualization** — show what changed between versions (Milestone B)
- **Time-travel debugging** — replay execution from any node (Milestone B)
- **Custom code nodes** — arbitrary JS execution inside a flow (out of scope — security nightmare)
- **External webhook trigger by URL** — `https://xphere.skale.club/flows/[id]/trigger` (Milestone B)

---

## AI as Primary Builder — Design Notes

This is the part nobody has solved well. The pattern that works:

1. **Strict tool schema, not free-form JSON.** LLM has tools like `add_node(type, position, config)`, `connect_nodes(from_id, to_id)`, `set_node_config(node_id, config)`. Each tool call mutates server state and triggers re-render. The LLM never writes raw flow JSON.

2. **Bounded action types.** LLM only sees the existing `action_type` enum + node primitives (trigger, action, end). Cannot invent new node types — typecheck on every tool call.

3. **Variable awareness.** LLM has a `get_available_variables(at_node_id)` tool that returns valid `{{node_id.output.*}}` references at that point. Prevents hallucinated variable paths.

4. **Round-trip editing.** User drags a node, asks AI "do the rest", AI sees current state and continues from there. No "AI builds in one shot or never" — it's continuous collaboration.

5. **Explain mode.** AI can render any flow in natural language: "When an SMS arrives from a phone number matching a contact tagged 'lead', create a task for the owner and send a Slack notification."

6. **Run mode.** From the chat: "Run my lead qualification flow for contact ID 123." AI invokes `execute_flow` with the right params. Confirms back the result and links to the run page.

7. **Debug mode.** AI can read recent `flow_runs` for a flow, identify which node failed, suggest a fix, and offer to apply it (calls `set_node_config` with the fix).

The AI builder is opinionated: it has a system prompt that **discourages overengineering** ("most flows are linear, don't add branching unless asked"), **suggests starting simple** ("ship a 3-node flow first, iterate"), and **explains tradeoffs** in plain language.

---

## Open Questions (resolve in /gsd:discuss-phase)

1. **Should flows replace tool_configs eventually, or coexist forever?** Migration story has UX implications.
2. **How do we handle execution timeouts on Vercel Hobby (10s per route)?** Edge Functions worker queue? Persist + resume?
3. **Trigger granularity:** is `event_type = 'message.received'` enough, or do we need `event_type = 'message.received' AND channel = 'whatsapp' AND keyword LIKE 'hello'`?
4. **AI model:** Claude (anthropic.com), GPT-4 (openai.com), or local? Tool-calling quality matters more than reasoning here.
5. **How does the canvas handle 50+ node flows?** Performance / pan-zoom / mini-map / search?
6. **Versioning UX:** semantic versions auto? Operator-named drafts? Force a new version on every save?
7. **Per-node retry policy:** default retry 3x with exponential backoff, or no retry? Configurable per node?
8. **Concurrent runs of the same flow:** how many max? Per-tenant rate limit?
9. **Run history retention:** keep 30 days of `flow_runs` and `flow_run_nodes`? More? Configurable per org?
10. **Variable types:** string-only at first? Or typed (string/number/boolean/array/object) with validation?
11. **Trigger backfill:** when operator activates a new trigger, do we backfill existing events that match? (e.g., "send WhatsApp to all contacts created in the last 24h" — should this work?)
12. **Permission model:** can any org member edit flows, or only admins? Read-only viewer role?
13. **Public webhook endpoints for flows:** `https://xphere.skale.club/api/flows/[id]` callable from external? With signing secret?

---

## Codebase Hints (for the researcher when this seed is promoted)

- **Action engine:** `src/lib/action-engine/execute-action.ts` is the dispatcher — flows call it. Don't bypass.
- **Existing executors:** `src/lib/action-engine/executors/*` (whatsapp), plus all the provider libs (`src/lib/ghl/*`, `src/lib/twilio/*`, `src/lib/manychat/*`, `src/lib/google-contacts/*`, `src/lib/custom-webhook/*`, `src/lib/knowledge/*`). Every action_type already has an executor.
- **Action types:** `Database['public']['Enums']['action_type']` — current ~31 values. Add `execute_flow` and `flow_trigger` (for AI agents that can run flows).
- **Multi-tenancy:** all new tables follow the RLS pattern with `(SELECT public.get_current_org_id())`. Service role bypasses.
- **Agent runtime:** `src/lib/agent-runtime/run-agent.ts` — chat agents already have tool-calling. Adding `execute_flow` as a callable tool is a 10-line change.
- **Migration cadence:** numbered SQL files in `supabase/migrations/`, applied via `npx supabase db push`. Last applied: 073.
- **Webhook receivers:** `src/app/api/{vapi,meta,manychat,evolution,ghl,twilio,chat}/**` — these are the integration points for the new trigger registry.
- **Storage of definitions:** JSONB is fine. The whole flow definition (nodes + edges + variables + metadata) goes in one `definition jsonb` column on `flow_versions`. Snapshots are immutable; edits create new versions.
- **React Flow:** install `@xyflow/react@^12`. Built-in pan/zoom/mini-map. Custom node types via `nodeTypes={{ trigger: TriggerNode, action: ActionNode, end: EndNode }}`.
- **dnd-kit already installed:** used in pipeline kanban (`src/components/pipeline/kanban-board.tsx`) and custom fields settings (`src/app/(dashboard)/settings/custom-fields/`). Useful for the palette → canvas drag.
- **Anthropic SDK:** used in `src/lib/chat/stream/anthropic.ts` — strong tool-calling support. Use the same client for the AI builder.
- **Existing scheduling cron:** `src/lib/automations/ghl-reengagement/runner.ts` shows how to run a scheduled job. Flows scheduled triggers would generalize this pattern.
- **Custom Fields validation pattern:** `src/lib/custom-fields/validate.ts` — pure function model is a good reference for the flow definition validator.

---

## References

- React Flow (xyflow): https://reactflow.dev/
- n8n architecture writeup: https://docs.n8n.io/hosting/architecture/
- ManyChat flow builder UX (visual reference): https://manychat.com/
- LangGraph for executor pattern reference: https://langchain-ai.github.io/langgraph/
- Anthropic tool use: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Vercel timeout limits: https://vercel.com/docs/functions/runtimes#max-duration
- Supabase Edge Functions for long-running work: https://supabase.com/docs/guides/functions

---

**Status:** Dormant until trigger surfaces.

When promoted, this seed becomes the basis for the **v3.0 Visual Automation Builder (Milestone A)** roadmap. The discussion phase resolves the open questions above; the planning phase decomposes Phase 1 (FLOWS-DB-FOUNDATION) into individual plans. Expect this milestone to take 4-6 weeks of focused work — biggest single feature in Xphere's roadmap.
