# Feature Research: v2.0 Multi-Bot Platform — Chat-Side Agent Abstraction

**Domain:** Multi-agent / agent-management platform (chat channels — web widget, WhatsApp, Meta, ManyChat, Telegram)
**Researched:** 2026-05-15
**Milestone context:** Subsequent milestone on existing multi-tenant SaaS (Next.js + Supabase + RLS). Voice (Vapi) is explicitly out of scope; chat catches up to voice in capability.
**Confidence:** HIGH (production platforms surveyed: Voiceflow, Botpress, Vellum, Dust, Lindy, CrewAI, OpenAI Agents SDK, Microsoft Agent Framework, Langfuse, LangSmith)

## Field Survey — What Production Platforms Ship

| Platform | Composition Pattern | Tool Scoping | Playground | Observability |
|----------|--------------------|--------------:|------------|---------------|
| **Voiceflow** | Workflow blocks + MCP handoff to other agents | API blocks per-flow, scoped sources | Multi-channel preview (web/voice/SMS) | Per-agent transcripts, model routing |
| **Botpress** | Central controller (LLMz) + sub-agents w/ shared scoped memory | Tools attached at agent level, capability isolation | Emulator + simulator | Per-agent eval (MAES), traces |
| **Vellum** | Graph canvas; sub-workflows as nodes; "Agent Builder" beta | Tools as nodes wired into agent | Sandbox with side-by-side prompt diff | Online evals, cost/latency per node |
| **Dust** | Agent-calling tool ("agent as tool"); up to 6 concurrent sub-agents | Skills scoped to Spaces (RBAC); toolsets discovered at runtime | Conversation preview, dataset evals | Per-agent trace, sub-agent timeline |
| **Lindy** | Agent swarms (clones) + multi-agent teams | Tool allow-list per Lindy | Test conversation panel | Run history, cost per task |
| **CrewAI** | Hierarchical manager + `allowed_agents` allow-list | Tools assigned per agent role | Code-based; no UI playground OOTB | Logs only (OSS) |
| **OpenAI Agents SDK** | `handoffs=[...]` + agent-as-tool both supported | Per-agent `tools=[...]`; handoff filters strip history | `Runner` + traces in dashboard | Traces dashboard, guardrail violations |
| **MS Agent Framework** | Handoff orchestration + agent-as-tool | Per-agent tool list | Agents Playground (msteams/directline/webchat channels, mock activities) | Per-agent activity logs |
| **Langfuse / LangSmith** | (observability layer) | n/a | Prompt sandbox | Per-trace cost, p50/p95 latency, per-agent token spend |

## Convergent Vocabulary (what users understand)

After surveying these platforms, the user-facing vocabulary that converges:

- **Agent** (not "bot", not "assistant" — already chosen in SEED-002, validated by OpenAI/Dust/Vellum)
- **Tools** (capabilities the agent can invoke — Voiceflow/Botpress/Dust/OpenAI all use this term)
- **Handoff** (transfer of control — OpenAI, Voiceflow MCP, MS Agent Framework)
- **Agent-as-tool** / **sub-agent** (specialist called by primary, control returns — Dust, OpenAI, CrewAI)
- **Playground** (test surface — Vellum, MS, DigitalOcean, Botpress all use this exact word)
- **Version** (immutable prompt snapshot — Langfuse, Vellum, Braintrust, LangSmith)
- **Deploy** / **production label** (which version is live — Langfuse uses `production`/`staging` labels)

**Operator-facing recommendation:** use "**partner agent**" (from SEED-002) as user-facing term mapped to the agent-as-tool pattern. It is more intuitive for non-technical agency operators than "sub-agent" or "handoff".

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in a v2.0 multi-agent platform. Missing these = product feels half-built.

#### Agent Definition

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Agent has name + description | Every platform surveyed has both; description is needed for partner-agent delegation reasoning | S | AGENT-01 |
| System prompt (free text) | The core of an agent; universal across all platforms | S | AGENT-02 |
| Model selector (Anthropic / OpenRouter providers already wired) | Voiceflow, Vellum, Botpress, Lindy all expose model choice; operator's two providers already exist | S | AGENT-03 |
| Temperature + max_tokens | Universally exposed; safe defaults (temperature 0.7, max_tokens 1024) | S | AGENT-04 |
| Tool allow-list per agent | Dust, OpenAI Agents SDK, CrewAI, MS — every platform scopes tools at the agent level. Operator currently scopes only at org level — this is the single biggest gap | M | TOOL-01 (junction table `agent_tools`) |
| Knowledge-base scope (which org KB collections this agent reads) | Dust "Skills scoped to Spaces", Voiceflow "scope sources". Operator's KB is per-org; v2.0 needs per-agent subset (use a tag or collection filter — KB stays in pgvector with `metadata.org_id`, add `metadata.agent_scopes`) | M | AGENT-05 / KB-01 |
| Channel allow-list (which channels this agent serves) | Implicit in Voiceflow/Lindy multi-channel routing; explicit toggle prevents accidental deploys | S | AGENT-06 |
| Channel-specific overrides (prompt suffix per channel) | Voice-vs-chat formatting differences are universal; channel_overrides JSONB on agent (SEED-002 design) avoids forking agents | M | AGENT-07 |
| Default agent per channel (routing fallback) | Multi-channel inbox needs to know which agent handles inbound message when no rule matches | S | AGENT-08 / RUNTIME-01 |
| Active / inactive toggle | Operator needs to pause an agent without deleting it | S | AGENT-09 |
| Created/updated timestamps + last-edited-by | Audit trail; expected in any SaaS admin tool | S | AGENT-10 |

#### Multi-Agent Composition

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Partner agent registry (agent A can call agent B as a tool) | Dust, OpenAI Agents SDK, CrewAI all support this. The agent-as-tool pattern (not handoff) — control returns to primary | M | DELEG-01 (junction `agent_partners`) |
| Partner invocation surfaces in transcript as a tool call | Users need to see which partner was called and why | S | DELEG-02 / OBS-01 |
| Shared conversation context (summary, not full transcript) passed to partner | Full transcript = blown context window; summary = standard pattern | M | DELEG-03 |
| Max delegation depth (default 2) | Universal safety primitive; prevents A→B→A→B infinite chains | S | DELEG-04 |
| Loop detection (same agent twice in same call chain) | OpenAI guardrails, Anthropic agentic patterns both ship this | S | DELEG-05 |
| Per-agent invocation log | Every partner call lands in `action_logs` (existing table) tagged with `agent_id` + `parent_agent_id` | S | OBS-02 |

#### Tool Scoping UX

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Multi-select tool picker on agent edit page | Dust, OpenAI Agents SDK, Botpress all use this UX (checkboxes / multi-select) | S | TOOL-02 |
| Deny-by-default (agent only sees explicitly attached tools) | OpenAI Agents SDK semantics; safer than allow-all | S | TOOL-03 |
| Tool description visible while picking (so operator can compare) | Operator's `tool_configs` already has descriptions; surface them | S | TOOL-04 |
| Folder-based grouping in picker (operator already has `tool_folders` from v1.5) | Reuse existing folder hierarchy = familiar UX, no relearning | S | TOOL-05 |
| Runtime guard: if agent calls non-attached tool, refuse + log | Defense-in-depth even if LLM hallucinates a tool name | S | TOOL-06 / RUNTIME-02 |

#### Test Playground

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Chat-style preview (send message, see streamed response) | Vellum sandbox, MS Agents Playground, DigitalOcean Gradient — all platforms ship this. Non-negotiable | M | PLAY-01 |
| Channel selector in playground (simulate web vs WhatsApp vs Meta formatting) | MS Agents Playground supports msteams/directline/webchat/emulator; user expects to test the channel-override prompt | M | PLAY-02 |
| Tool calls visible inline in playground (request + response) | Vellum, Botpress, OpenAI all show this — operator can already see this pattern in v1.2 chat-area | S | PLAY-03 (reuse existing component) |
| Reset / new session button | Every playground has this; trivial | S | PLAY-04 |
| Playground sessions do NOT pollute production inbox | Tag sessions as `mode='playground'` so they're filtered out of `conversations` list | S | PLAY-05 / RUNTIME-03 |

#### Observability

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Per-agent invocation count (last 24h / 7d / 30d) | Langfuse, LangSmith dashboards make this the default metric | S | OBS-03 (aggregate query on `conversation_messages` filtered by `agent_id`) |
| Per-agent token spend (estimated cost via model price table) | LangSmith ships this; agency operators care because LLM cost is line-item | M | OBS-04 |
| Per-agent p50 / p95 latency | LangSmith, Langfuse default chart | S | OBS-05 |
| Per-agent tool-call success rate | Existing `action_logs` table already has `status`; group by `agent_id` | S | OBS-06 |
| Conversation replay with delegation tree visualization | Dust sub-agent timeline, OpenAI traces — shows "primary → partner → tool" hierarchy | M | OBS-07 |
| Existing per-conversation transcript view (v1.2) extended with agent badges | Reuse `chat-area.tsx` from v1.4 refactor; just add agent label per message | S | OBS-08 |

#### Prompt Versioning (Minimum Lovable)

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Linear immutable version history per agent | Langfuse, LangSmith, Vellum — all use linear incrementing version numbers; immutability is the contract | M | AGENT-11 (table `agent_prompt_versions`) |
| Auto-snapshot on save (no separate "save version" step) | Lower-friction UX; Langfuse + Vellum both auto-snapshot on edit | S | AGENT-12 |
| One-click rollback to previous version | Universal; rollback creates a new version that copies content of selected old one | S | AGENT-13 |
| Show diff between any two versions (read-only) | Vellum's "View Diff" is the killer feature; a basic side-by-side text diff is enough for v2.0 | M | AGENT-14 |
| "Active version" pointer on the agent | Production label / pointer to immutable version; allows staged rollout later | S | AGENT-15 |

#### Rate Limits & Guardrails

| Feature | Why Expected | Complexity | Notes / Maps to REQ |
|---------|--------------|------------|---------------------|
| Max delegation depth (already in DELEG-04) | See above | S | DELEG-04 |
| Max tool calls per conversation (default 20) | Industry-standard runaway-cost stop; MindStudio, Anthropic, Oracle all recommend | S | RUNTIME-04 |
| Per-conversation token budget cap | Runaway-loop protection — every guardrail guide flags this as critical | M | RUNTIME-05 |
| Per-org daily token budget with circuit-breaker (degrade to safe-mode) | Oracle, Redis blogs — must-have for multi-tenant where one org could blow up costs | M | RUNTIME-06 |
| Webhook handler ALWAYS returns 200 (existing pattern) | Already enforced by CLAUDE.md | S | (existing) |

### Differentiators (Defer to v2.x)

Features that distinguish premium platforms but don't block first-party value. Defer-worthy because Operator can ship v2.0 without them and validate the core agent abstraction first.

| Feature | Value Proposition | Complexity | Why Defer |
|---------|-------------------|------------|-----------|
| Cross-org agent templates / marketplace | Reusable specialist agents (dental clinic, e-commerce) — sales asset | L | Already explicitly deferred in SEED-002. Validate single-org agents first |
| Prompt A/B testing UI | Statistical comparison of two versions on live traffic | L | Out of scope per PROJECT.md ("schema in scope; testing UI is not") |
| Eval suite (dataset-based offline scoring) | Vellum/Langfuse have this. Critical at scale, premature for one customer | L | Need real production volume before evals are meaningful |
| Online eval scoring (LLM-as-judge on every prod call) | Langfuse, LangSmith ship this | M | Cost overhead doubles per-call price; defer until paid tier |
| Mock tool responses in playground | MS Agents Playground supports it; lets operators test without firing real GHL writes | M | Nice-to-have; v2.0 can ship with real tool calls in playground (operator picks a test org) |
| Drag-and-drop visual agent canvas (Voiceflow style) | Marketing asset; non-developer friendly | XL | Out of scope — Operator is an admin tool, not a no-code builder |
| Hierarchical manager agent (CrewAI-style supervisor that auto-routes) | Saves operator from defining partner rules explicitly | L | Adds opaque routing logic; partner agent registry is more debuggable |
| Agent swarm / clone-yourself parallel execution (Lindy 3.0) | Mass-send / mass-call use cases | L | Doesn't match Operator's inbox model; campaign engine already handles bulk |
| MCP server compatibility (agent exposes itself over Model Context Protocol) | Integration story with Claude Desktop, IDEs | M | Not a v2.0 user need; revisit when MCP adoption matures |
| Per-agent rate limits per visitor (e.g. 5 msg/min per session) | Anti-abuse for public widget | S | Add when abuse is observed; not a launch blocker |
| Channel handoff to human agent | Inbox supports manual reply already (v1.2); first-class "human agent" entity is overkill for v2.0 | M | Already in PROJECT.md backlog |
| Multi-step "deep research" agent loop (Dust @deep-dive style) | Long-running task agent | L | Doesn't match Operator's sync chat-reply latency budget |
| Cost attribution per end-customer / per visitor | Useful for billable customers | M | Defer until Operator has billing |

### Anti-Features (What Failed Teams Shipped Then Pulled Back)

Drawn from "Why Agentic AI Projects Fail" (HBR, Composio, RAND, Gartner — 40% of agentic projects predicted cancelled by 2027) and the "bag of agents 17x error trap" pattern.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **"More agents = better" — auto-spawn specialist agents dynamically** | Looks impressive in demos; matches early hype | Research shows accuracy degrades beyond ~4 agents ("Coordination Tax"); debug nightmare; operator can't reason about who did what | Force operator to explicitly register partner agents. Hard cap on delegation depth |
| **Free-form natural-language agent definition (no schema)** | "Just describe your agent in English" — Lindy/Adept marketing | Untyped, untestable, no version control, no tool scoping — exactly what serious teams (Vellum, Dust) walked away from | Structured schema: prompt + tools + KB scope + model — explicit fields |
| **Letting agents create / edit other agents at runtime** | "Self-improving agents" demos | Security catastrophe; uncapped cost; impossible to audit; no production team ships this | Agent CRUD is admin-only via dashboard. Never via tool call |
| **Unbounded delegation chains** | Flexibility | Infinite loops, runaway costs, customer-facing dead air. Every guardrail guide flags this as #1 risk | Hard depth limit (2-3); loop detection by agent_id in chain |
| **Streaming "internal monologue" / thinking tokens to end-user** | Looks intelligent; OpenAI o1-style UX trend | Confuses non-technical users; leaks system prompt content; exposes partner names | Surface only final response. Operator sees full trace in observability |
| **Auto-promote agent version to production on save** | Less friction for operator | One typo silently breaks production for all visitors. Every prompt-management guide warns against this | Explicit "Publish" / "Activate version N" action. Draft vs production label |
| **Single global agent shared across all orgs** | Easier to manage | Violates Operator's RLS-everywhere invariant; cross-tenant prompt contamination | Always org-scope agents. Templates are copies, not refs (defer entirely) |
| **Per-channel forked agent (clone the agent for each channel)** | "Easy" channel customization | Drift across copies; bug-fix-once-deploy-many never happens; pollutes agent list | `channel_overrides` JSONB on single agent (SEED-002 design) |
| **In-playground "deploy to production" button** | Faster iteration | Skips version review; bypasses publish flow; encourages cowboy edits | Playground tests draft version only. Publish lives on agent settings page |
| **Hierarchical "manager agent" that orchestrates all calls** | Less config; CrewAI hierarchical mode markets this | Manager becomes a black box; debugging is impossible; adds 1 extra LLM call to every conversation | Direct partner-agent registry: agent A explicitly lists which agents it can call |
| **Visual flow-chart builder (Voiceflow / n8n style nodes)** | Demo-friendly; sales asset | Constraint forces complexity into a 2D canvas; agency operators don't think in flow charts | Form-based agent editor + tool checkboxes. PROJECT.md explicitly says "no n8n fallback" |
| **Auto-summarize old conversations into agent's prompt** | "Long-term memory" | Prompt grows unboundedly; cost spikes; private info bleeds across users | Per-conversation context window only. KB stores curated facts |

## Feature Dependencies

```
AGENT-01..15 (agent definition + versioning)
    └──requires──> migration: agents, agent_prompt_versions tables

TOOL-01..06 (tool scoping)
    └──requires──> AGENT-01..03 (agents must exist)
    └──extends──> existing action-engine (resolve-tool.ts)

DELEG-01..06 (partner-agent composition)
    └──requires──> AGENT-01..03, TOOL-01
    └──requires──> RUNTIME-01..02 (channel-agnostic runtime must dispatch first)

RUNTIME-01..06 (runAgent() runtime)
    └──requires──> AGENT-01..09 (agent fields), TOOL-01..06 (scoping enforcement)
    └──replaces──> src/lib/chat/ monolithic prompt

PLAY-01..05 (playground)
    └──requires──> RUNTIME-01..03 (playground IS the runtime, just in mode='playground')
    └──reuses──> v1.4 chat-area split (MessageList, MessageComposer)

OBS-01..08 (observability)
    └──requires──> RUNTIME-01 + DELEG-02 (data must be emitted first)
    └──reuses──> existing action_logs table + Realtime channel from v1.4

AGENT-11..15 (prompt versioning)
    └──independent of runtime — pure schema + UI
    └──RUNTIME consumes active_version_id pointer
```

### Dependency Notes

- **TOOL scoping is a hard prerequisite for DELEG** — partner agents must be tool-scoped or they inherit the primary agent's tools, which defeats the point of specialization
- **PLAY needs RUNTIME first** — playground is just `runAgent(agentId, channel, ctx)` with `mode='playground'` flag. Building a separate playground runtime is a known anti-pattern (Vellum had two for a while, deprecated one in 2025)
- **OBS-04 (cost tracking) requires a model price table** — small extra table mapping `model_slug → cost_per_million_in / out`; refresh manually each quarter
- **AGENT-11..15 (versioning) can ship in parallel with RUNTIME** — schema is independent; only the pointer (`active_version_id`) needs to be live when runtime queries the prompt
- **Channel-specific overrides (AGENT-07) require channel-aware runtime (RUNTIME-01)** — runtime reads `channel_overrides[channel]` and concatenates onto base prompt

## MVP Definition

### Launch With (v2.0)

The minimum to satisfy "chat reaches feature-parity with voice" and ship a credible multi-agent platform.

**Phase 1 — Agent Foundation (must land first)**
- [ ] AGENT-01..10 — agent CRUD (name, description, system prompt, model, temp, max_tokens, channels, default-per-channel, active toggle, timestamps)
- [ ] Migration: `agents`, `agent_channels` (or `channel_overrides` JSONB)
- [ ] Dashboard `/dashboard/agents` list + edit pages

**Phase 2 — Tool Scoping**
- [ ] TOOL-01..06 — `agent_tools` junction; multi-select picker with folder grouping; runtime deny-by-default guard
- [ ] Refactor `src/lib/action-engine/resolve-tool.ts` to accept `agentId`

**Phase 3 — Channel-Agnostic Runtime**
- [ ] RUNTIME-01..03 — `runAgent(agentId, channel, context)` in `src/lib/agent-runtime/`
- [ ] Replace `src/lib/chat/` monolithic prompt with runtime call
- [ ] Wire web widget, ManyChat, Meta inbound handlers to runtime
- [ ] AGENT-07 channel_overrides merge logic

**Phase 4 — Multi-Agent Composition**
- [ ] DELEG-01..06 — partner registry, agent-as-tool invocation, shared context summary, depth limit, loop detection
- [ ] RUNTIME-04..06 — max-tool-calls cap, per-conv token budget, per-org daily budget circuit breaker

**Phase 5 — Playground**
- [ ] PLAY-01..05 — chat preview with channel selector, inline tool calls, reset, mode='playground' isolation
- [ ] KB scope plumbing (AGENT-05) — pgvector filter by `metadata.agent_scopes`

**Phase 6 — Observability**
- [ ] OBS-01..08 — per-agent counts, cost, latency, tool success rate, delegation tree on conversation replay
- [ ] Model price table seeded with current Anthropic + OpenRouter rates

**Phase 7 — Prompt Versioning**
- [ ] AGENT-11..15 — `agent_prompt_versions` table, auto-snapshot, one-click rollback, diff viewer, active-version pointer

### Add After Validation (v2.x)

Triggered by usage signals from one paying customer running 3+ agents.

- [ ] Mock tool responses in playground — when operator complains about firing real GHL writes during testing
- [ ] Online eval scoring — when conversation volume justifies LLM-as-judge cost (~1k convs/day)
- [ ] Per-agent rate limits per visitor — when abuse is observed
- [ ] Dataset-based offline eval suite — when prompt iteration cycle becomes the bottleneck

### Future Consideration (v3+)

- [ ] Cross-org agent templates / marketplace — explicit deferral per SEED-002
- [ ] Prompt A/B testing UI — schema is in scope for v2.0 (versions table), UI is not
- [ ] MCP server compatibility — when MCP adoption matures in operator's customer base
- [ ] Hierarchical manager agent — only if explicit partner registry proves too verbose for power users
- [ ] Cost attribution per end-customer — when Operator adds billing
- [ ] Multi-agent delegation in voice — out of scope per PROJECT.md (Vapi-native)

## Feature Prioritization Matrix

| Feature Group | User Value | Implementation Cost | Priority |
|---------------|------------|---------------------|----------|
| AGENT-01..10 (definition) | HIGH | LOW | P1 |
| TOOL-01..06 (scoping) | HIGH | MEDIUM | P1 |
| RUNTIME-01..03 (channel-agnostic) | HIGH | MEDIUM | P1 |
| RUNTIME-04..06 (safety guardrails) | HIGH | MEDIUM | P1 |
| DELEG-01..06 (multi-agent) | HIGH | MEDIUM | P1 |
| PLAY-01..05 (playground) | HIGH | MEDIUM | P1 |
| AGENT-11..15 (versioning) | MEDIUM | MEDIUM | P1 |
| OBS-01..08 (observability) | MEDIUM | MEDIUM | P1 |
| AGENT-05 (KB scope) | MEDIUM | MEDIUM | P1 |
| Mock tools in playground | LOW | MEDIUM | P2 |
| Online evals | LOW | HIGH | P3 |
| Cross-org templates | MEDIUM | HIGH | P3 |
| Visual canvas builder | LOW | HIGH | P3 (likely never) |

**Priority key:**
- P1: Required for v2.0 launch
- P2: Add in v2.1/v2.2 once validated
- P3: Future or never (anti-feature risk)

## Competitor Feature Analysis (focused mapping)

| Feature | Dust | OpenAI Agents SDK | Vellum | Voiceflow | Operator v2.0 (recommended) |
|---------|------|-------------------|--------|-----------|-----------------------------|
| Agent entity | First-class | First-class | First-class | First-class (workflows) | First-class (`agents` table) |
| Tool scoping | Per-Space (RBAC) | Per-agent `tools=[]` | Per-node | Per-flow | Per-agent `agent_tools` junction |
| Composition pattern | Agent-as-tool | Both (`handoffs` + `as_tool`) | Sub-workflow nodes | MCP handoff | Agent-as-tool ("partner agents") |
| Max sub-agents | 6 concurrent | Configurable | Configurable | Configurable | 1 at a time, depth 2 |
| Playground | Conversation preview | Trace dashboard | Sandbox with diff | Multi-channel preview | Chat preview + channel selector |
| Channel overrides | Workspace-level | n/a (SDK) | n/a (workflow) | Per-channel publish | `channel_overrides` JSONB |
| Prompt versioning | Yes (Spaces) | n/a (SDK) | Versions + diffs | Versions | Linear immutable + diff + rollback |
| Per-agent cost tracking | Yes | Via traces | Yes (per node) | Yes | Yes (model price table) |
| Loop / depth limits | Yes | Yes (max_turns) | Yes | Yes | Yes (depth 2 default, loop by agent_id) |
| Cross-org templates | Yes (Spaces) | n/a | Yes | Yes | Deferred to v2.x |

## What This Tells the Roadmap

**Phase ordering is largely forced by dependencies:**
1. Agent foundation (schema + CRUD) — nothing works without it
2. Tool scoping — runtime can't enforce without `agent_tools` junction
3. Runtime — replaces existing chat path; touch-everything refactor
4. Multi-agent delegation — depends on runtime + tool scoping
5. Playground — depends on runtime
6. Observability + versioning — can ship in parallel with playground

**Most-likely-to-fail phases (research flags for roadmap):**
- **Phase 3 (Runtime)** — replacing `src/lib/chat/` is a deep refactor; needs careful migration plan
- **Phase 4 (Delegation)** — context-passing strategy (summary vs full transcript) needs design doc before coding
- **Phase 6 (Observability)** — cost attribution requires model price table + Anthropic/OpenRouter usage telemetry parsing

**Won't-need-research phases:**
- Phase 1 (Agent CRUD) — standard form + table, reuses existing patterns
- Phase 5 (Playground) — just runtime + chat-area component from v1.4
- Phase 7 (Versioning) — well-established pattern (Langfuse, Vellum reference)

## Sources

### Multi-agent platforms surveyed (HIGH confidence — direct docs)
- [Dust — Agent Configuration and Management](https://deepwiki.com/dust-tt/dust/3.1-agent-configuration-and-management)
- [Dust — Tools / Skills scoping](https://docs.dust.tt/docs/tools)
- [Dust — Deep-dive coordinator + sub-agents](https://dust.tt/blog/building-deep-dive-infrastructure-for-ai-agents-that-actually-go-deep)
- [OpenAI Agents SDK — Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK — Orchestration and handoffs guide](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [Vellum — Product updates 2025](https://www.vellum.ai/blog/vellum-product-update-december-2025)
- [Voiceflow — Platform overview](https://www.voiceflow.com/features/platform-overview)
- [Botpress — Agent Studio](https://botpress.com/features/ai-agent-studio)
- [Botpress — Multi-agent orchestration](https://botpress.com/blog/ai-agent-orchestration)
- [CrewAI — Collaboration & delegation docs](https://docs.crewai.com/en/concepts/collaboration)
- [CrewAI — `allowed_agents` hierarchical delegation PR](https://github.com/crewAIInc/crewAI/pull/2068)
- [Lindy — AI Agent Platforms guide](https://www.lindy.ai/blog/ai-agent-platform)
- [Microsoft Agent Framework — Handoff orchestration](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff)

### Playground patterns (HIGH confidence)
- [Microsoft 365 Agents Playground — debug & channel emulation](https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/debug-your-agents-playground)
- [DigitalOcean Gradient — Agent Playground](https://docs.digitalocean.com/products/gradient-ai-platform/how-to/test-agents/)

### Observability patterns (HIGH confidence)
- [Langfuse — Per-trace cost, prompt versions](https://langfuse.com/)
- [LangSmith — Observability dashboards (P50/P99, cost)](https://www.langchain.com/langsmith/observability)
- [Top observability platforms 2025/2026 comparison](https://www.firecrawl.dev/blog/best-llm-observability-tools)

### Composition patterns (HIGH confidence)
- [Agent-as-Tools vs Handoff — Xiaojian Yu](https://medium.com/@yuxiaojian/agent-as-tools-vs-handoff-in-multi-agent-ai-systems-11f66a0342c4)
- [LangChain — Choosing the right multi-agent architecture](https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture)
- [AWS — Multi-agent collaboration patterns](https://aws.amazon.com/blogs/machine-learning/multi-agent-collaboration-patterns-with-strands-agents-and-amazon-nova/)

### Prompt versioning (HIGH confidence)
- [Langfuse — Prompt Version Control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)
- [Braintrust — What is prompt management](https://www.braintrust.dev/articles/what-is-prompt-management)
- [Vellum — Side-by-side prompt diffs](https://docs.vellum.ai/changelog/2025/2025-07)

### Guardrails & safety (HIGH confidence)
- [Oracle — Runtime budget guardrails for agentic AI](https://blogs.oracle.com/ai-and-datascience/runtime-budget-guardrails-agentic-ai)
- [Redis — Agentic AI guardrails](https://redis.io/blog/agentic-ai-guardrails/)
- [MindStudio — Deploy agents to production: budget & monitoring](https://www.mindstudio.ai/blog/deploy-ai-agents-production-budget-guardrails-monitoring)
- [Open-source runaway-agent guardrails (DEV)](https://dev.to/tazsat0512/how-i-built-open-source-guardrails-that-auto-stop-runaway-ai-agents-249m)

### Failure modes & anti-features (MEDIUM-HIGH confidence)
- [Why your multi-agent system is failing — 17x error trap](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)
- [HBR — Why agentic AI projects fail](https://hbr.org/2025/10/why-agentic-ai-projects-fail-and-how-to-set-yours-up-for-success)
- [Composio — 2025 AI Agent Report: why pilots fail](https://composio.dev/blog/why-ai-agent-pilots-fail-2026-integration-roadmap)
- [Google Cloud — Lessons from 2025 on agents and trust](https://cloud.google.com/transform/ai-grew-up-and-got-a-job-lessons-from-2025-on-agents-and-trust)
- [InfoQ — Evaluating AI agents in practice](https://www.infoq.com/articles/evaluating-ai-agents-lessons-learned/)

---
*Feature research for: multi-agent / agent-management platform (chat channels)*
*Researched: 2026-05-15*
*Downstream: REQUIREMENTS.md will map table-stakes features to REQ-IDs (AGENT-, RUNTIME-, TOOL-, DELEG-, OBS-, PLAY-) and place differentiators in "Future Requirements", anti-features in "Out of Scope".*
