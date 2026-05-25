---
id: SEED-026
status: complete
planted: 2026-05-20
planted_during: post-SEED-024; planted alongside SEED-025 unified workflows
shipped: 2026-05-25
shipped_as: v3.0 Workflow Runtime Hardening
trigger_when: SEED-025 Phase B (unified engine) ships; OR explicit request to make Copilot able to build workflows; OR users start asking the AI to create automations and it can't
scope: Large
priority: high
depends_on: [SEED-025 (unified data model + spec), SEED-020 (Copilot tool framework)]
phases_shipped: [A, B, C, D, E]
phases_pending: []
last_commit: cbf0996
---

# SEED-026: AI Workflow Authoring — Copilot + Claude Code Build Workflows Perfectly

The primary product surface for workflows is **AI authoring**, not manual canvas editing. Most users will never open the canvas. They will say "send an SMS five minutes before every meeting" and an AI will build, validate, and publish the workflow.

This seed makes two AI surfaces robust at workflow authoring:

1. **In-app Copilot** (SEED-020's chat panel + 27 tools) — extended with workflow CRUD tools, primed with the org's filtered spec, with structured error feedback so it can self-correct
2. **Claude Code / external coding agents** — when a developer or external agent works in this repo, the documentation is so precise that the LLM can generate a workflow definition file from a one-line natural-language brief, validate it locally, and submit a PR

Both surfaces share the same underlying spec, the same validator, and the same authoring guide. There is no second source of truth.

## Why this is a separate seed from SEED-025

SEED-025 delivers a clean foundation: one data model, one engine, one spec, one log table. It is necessary but not sufficient. Without SEED-026 the foundation is underutilized — manual canvas editing remains the only realistic authoring path, even though every "real" workflow has been triggered by a natural-language request all along.

Separating the seeds also lets SEED-025 ship in production behind the unified-engine flag without waiting for the AI surface to be feature-complete.

## Two audiences, one substrate

```
┌────────────────────────────────────────────────────────────────┐
│  Org-filtered capability spec (from SEED-025 lib/workflows/spec)│
│  ─ trigger types ─ node types ─ integrations ─ variables       │
│  ─ examples ─ validation rules ─ JSONSchemas                   │
└──────────────────────┬─────────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐           ┌────────▼─────────┐
│  In-app        │           │  Claude Code     │
│  Copilot       │           │  & external      │
│  (SEED-020)    │           │  coding agents   │
│                │           │                  │
│  Tools:        │           │  Reads:          │
│  create_wf     │           │  CLAUDE.md       │
│  edit_wf       │           │  WORKFLOWS.md    │
│  validate_wf   │           │  spec.json       │
│  explain_wf    │           │  examples/*.yaml │
│  run_wf        │           │                  │
└────────────────┘           └──────────────────┘
```

## Substrate — what's shared

### 1. Org-filtered capability spec

SEED-025 produces `lib/workflows/spec.ts` and `GET /api/workflows/spec`. The spec is **the source of truth** for everything authorable:

```jsonc
{
  "version": "2026.05",
  "org_id": "...",
  "triggers": [
    {
      "type": "tool_call",
      "description": "Invoked by name from an AI agent, voice call, or chat. Use for actions agents must be able to call (e.g. send_sms, lookup_contact).",
      "config_schema": { "type": "object", "properties": { "tool_name": { "type": "string" } }, "required": ["tool_name"] }
    },
    {
      "type": "event:meeting.confirmed",
      "description": "Fires when a calendar booking transitions to 'confirmed' status (SEED-027).",
      "variables": ["meeting.title", "meeting.starts_at", "meeting.link", "meeting.attendee_contact_id", ...]
    },
    ...
  ],
  "nodes": [
    {
      "type": "send_sms",
      "description": "Send an SMS via a connected SMS integration (Twilio or GoHighLevel).",
      "integration_required": ["twilio", "gohighlevel"],
      "params_schema": { ... JSONSchema ... },
      "examples": [
        { "to": "{{contact.phone}}", "body": "Your appointment is in 5 minutes: {{meeting.link}}" }
      ]
    },
    ...
  ],
  "available_integrations": ["twilio", "google_calendar"],     // only connected ones
  "variables": {
    "contact.*": { ... },
    "meeting.*": { ... },
    "trigger.*": { ... }
  }
}
```

Spec is **org-filtered server-side**: only `connected` integrations appear. AI cannot reference what doesn't exist.

### 2. Canonical workflow file format

A workflow definition is a **declarative YAML document** (not code). Same format whether written by Copilot, Claude Code, or human. Stored as `workflow_versions.definition` JSON internally; round-trips losslessly to YAML.

```yaml
# .planning/workflows/examples/sms-meeting-reminder.yaml
name: SMS reminder 5min before meeting
description: When a meeting is confirmed, schedule an SMS to the attendee 5 minutes before start.
trigger:
  type: event
  event: meeting.confirmed
nodes:
  - id: wait
    kind: wait_until
    offset: "-5m"
    from: "{{meeting.starts_at}}"
  - id: notify
    kind: send_sms
    integration: twilio
    to: "{{meeting.attendee_contact.phone}}"
    body: "Your appointment is in 5 minutes: {{meeting.link}}"
edges:
  - from: trigger
    to: wait
  - from: wait
    to: notify
```

### 3. Validator

`npm run workflows:validate <file.yaml>` and `validateWorkflow(definition)` library function:

- Schema validation against spec (JSONSchema)
- Variable resolution check: every `{{...}}` must exist in trigger scope or upstream node outputs
- Integration availability: every `integration: X` must be `connected` for the org
- Cycle detection in edges
- Reachability: every node connected to trigger
- Returns **structured errors** with `path`, `code`, `message`, `suggestion` — designed to feed back into LLM for self-correction

## In-app Copilot extension (SEED-020 integration)

### New Copilot tools (added to the SEED-020 tool library)

| Tool                   | What it does                                                                          |
|------------------------|---------------------------------------------------------------------------------------|
| `list_workflows`       | Returns existing workflows with name/description/kind/last_run/health                  |
| `get_workflow`         | Returns full YAML definition of one workflow                                          |
| `create_workflow`      | Creates a new workflow from YAML; runs validator first; returns workflow_id + errors  |
| `update_workflow`      | Updates an existing workflow (new version); validator-gated                           |
| `validate_workflow`    | Dry-run validation; returns structured errors for self-correction                     |
| `run_workflow`         | Manual one-shot execution with optional input; returns run_id + result                |
| `explain_workflow`     | Returns natural-language explanation of an existing workflow's behavior                |
| `delete_workflow`      | Soft-deletes (deactivates) a workflow                                                 |
| `list_capabilities`    | Returns the org-filtered spec (triggers, nodes, integrations, variables)              |

### Copilot system prompt additions

The Copilot's system prompt is extended at runtime with:

- A **condensed capability summary** (top-level trigger/node types + which integrations are connected)
- A **decision tree**: "Is this a one-shot action (`kind: tool`) or a multi-step process (`kind: flow`)?" → branch
- **Five canonical few-shot examples** chosen from `.planning/workflows/examples/` covering the most common patterns:
  1. `tool_call` trigger → single action (reusable by agents)
  2. `event` trigger → multi-step with wait
  3. `schedule` trigger → cron-driven nightly sync
  4. Branching with condition node
  5. Multi-integration flow (cross-system)

The full spec is **never** loaded into the system prompt — too large and changes per org. Instead, the Copilot calls `list_capabilities` as needed (it's the first tool call in any workflow-creation conversation).

### Self-correction loop

When Copilot calls `create_workflow` with invalid YAML:

```jsonc
{
  "ok": false,
  "errors": [
    {
      "path": "nodes[1].to",
      "code": "unresolved_variable",
      "message": "{{contact.phone}} is not in scope for this trigger",
      "suggestion": "The 'event:meeting.confirmed' trigger exposes 'meeting.attendee_contact.phone'. Use {{meeting.attendee_contact.phone}}."
    }
  ]
}
```

The structured `suggestion` field is engineered for LLM consumption — the Copilot reads it, edits the YAML, re-submits. Typically 1-2 iterations to a valid workflow.

## Claude Code / external coding agent surface

### Documentation files

```
CLAUDE.md                                  EDIT — add "Workflows" section pointing to WORKFLOWS.md
WORKFLOWS.md                               NEW  — top-level authoring guide (root of repo)
.planning/agents/workflow-authoring.md     NEW  — deep agent guide with decision tree + checklist
.planning/workflows/examples/              NEW  — directory of 20+ canonical examples (.yaml)
.planning/workflows/templates/             NEW  — partial templates for common patterns
docs/workflows/spec.schema.json            NEW  — JSONSchema for workflow definition (LLM can validate locally)
```

### WORKFLOWS.md (root)

The single document a coding agent reads before authoring. Sections:

1. **One-page mental model** — Workflow = trigger + DAG; kinds are `tool` (1-node, invokable) or `flow` (multi-node)
2. **Authoring rules** — never reference disconnected integrations; never use undefined variables; always validate before submitting
3. **File location** — `supabase/seeds/workflows/*.yaml` for repo-tracked workflows; otherwise authored via API
4. **Validation command** — `npm run workflows:validate path/to/file.yaml`
5. **Submission paths** — `POST /api/workflows` (publishes immediately, validator-gated); for repo-tracked, commit the YAML and the seed loader picks it up
6. **Common pitfalls** with examples (variable scope, integration health, cycles)
7. **Reference**: link to `docs/workflows/spec.schema.json` + `examples/`

### `.planning/agents/workflow-authoring.md`

Deep guide for agents. Includes:

- **Decision tree** (markdown flowchart): trigger? single vs multi-step? which integration?
- **Variable scope reference** by trigger type
- **Pattern catalog** with name, when-to-use, example, anti-patterns
- **Checklist** the agent runs through before submitting:
  - [ ] All `{{...}}` variables exist in scope at that node
  - [ ] All `integration:` values are in available_integrations
  - [ ] All node `kind` values exist in spec
  - [ ] No cycles, all nodes reachable from trigger
  - [ ] `npm run workflows:validate` passes

### Examples directory

`.planning/workflows/examples/` — 20+ hand-curated workflows covering every pattern. Each is a complete, valid, runnable YAML with a comment header explaining what it does and why each node is structured as it is. Used as:

- Few-shot examples for Copilot (top 5 selected dynamically by trigger type)
- Reference for Claude Code via "look at examples/X.yaml for a similar pattern"
- Smoke test corpus: every example must `validate` clean on every PR

### Workflow seed loader

`supabase/seeds/workflows/*.yaml` — YAML files committed to the repo become workflows on every org (or selected orgs via frontmatter). The seed loader (`scripts/load-workflow-seeds.ts`) validates all files and inserts/updates them as `kind='tool'` or `kind='flow'` workflows owned by a system org or per-tenant.

This is how **default workflows** ship to every tenant — same authoring format used by humans, Copilot, and Claude Code.

## Phases

### Phase A — Spec + validator
- `lib/workflows/spec.ts` finalized with full schema (depends on SEED-025 Phase B)
- `lib/workflows/validate.ts` — pure validator producing structured errors
- `npm run workflows:validate` CLI wrapper
- `GET /api/workflows/spec` endpoint (auth-gated, org-scoped)
- `docs/workflows/spec.schema.json` exported and committed

### Phase B — Authoring guides
- `WORKFLOWS.md` at repo root
- `.planning/agents/workflow-authoring.md`
- `CLAUDE.md` update with Workflows section
- `.planning/workflows/examples/` — first 10 canonical examples committed
- All examples pass validator in CI (new `npm run workflows:validate-all`)

### Phase C — Copilot tools
- Extend SEED-020 tool registry with 9 new workflow tools
- Each tool wraps `lib/workflows/*` library functions (no new business logic — pure UI surface)
- Copilot system prompt patch: add workflow capability summary + decision tree + 5 examples
- Self-correction loop tested end-to-end: invalid YAML → structured error → LLM auto-corrects

### Phase D — Workflow seed loader
- `scripts/load-workflow-seeds.ts` validates and ingests `supabase/seeds/workflows/*.yaml`
- `supabase/seeds/workflows/` — first 5 platform-default workflows committed (welcome SMS, lead capture, missed-call follow-up, etc.)
- CI integration: PRs touching `supabase/seeds/workflows/` run validator
- Production loader runs on deploy (Vercel build step) so default workflows update per release

### Phase E — Copilot quality + observability
- Conversation transcripts (when user opts in) annotated with workflow-authoring outcomes
- `workflow_authoring_runs` table: tracks Copilot attempts → result (created/edited/abandoned), error counts, iteration counts
- Weekly admin report: "Copilot workflow success rate" with breakdown by error type
- Iterate on prompts/examples based on real failure modes
- Add 10 more examples to cover gaps discovered in production

## Authoring contract (what "perfect" means)

A workflow author (Copilot, Claude Code, human) is "perfect" if:

1. **Zero validation errors** before submission (validator runs locally for code agents, server-side for Copilot)
2. **Zero references to disconnected integrations** (enforced by spec filtering)
3. **Zero undefined variables** (enforced by scope analysis in validator)
4. **Self-correcting**: when validator returns errors, next iteration must reduce error count to zero
5. **Idempotent**: same brief → same (or semantically equivalent) workflow
6. **Documented**: every workflow has `name` and `description`; complex flows have node comments

These are not aspirational — they are validator-enforced. A workflow that violates them cannot be created.

## Success criteria

1. ✅ Copilot can take a one-sentence brief ("send SMS 5 min before any meeting") and produce a valid published workflow without human canvas editing
2. ✅ Claude Code, given only `WORKFLOWS.md` + `examples/` + the spec, can author a new workflow from a developer's natural-language brief and submit a PR with a YAML file
3. ✅ Self-correction loop converges in ≤ 3 iterations for 90% of cases (measured via `workflow_authoring_runs`)
4. ✅ Every example in `.planning/workflows/examples/` validates clean in CI
5. ✅ Default platform workflows in `supabase/seeds/workflows/` ship to every new org automatically
6. ✅ Spec.json never references a disconnected integration for an org (no AI can hallucinate unavailable capabilities)
7. ✅ Conversation transcripts show measurable shift: > 50% of workflows created in production are AI-authored within 60 days of GA

## Risks + mitigations

| Risk                                                       | Mitigation                                                                  |
|------------------------------------------------------------|------------------------------------------------------------------------------|
| LLM generates workflow referencing nonexistent capabilities| Spec is org-filtered; validator hard-rejects unknown types                  |
| Spec drift between docs and code                           | `spec.json` generated from `spec.ts`; CI fails if `docs/workflows/spec.schema.json` is stale |
| Example workflows go stale as spec evolves                 | All examples validated in CI on every PR                                    |
| Copilot creates harmful workflow (e.g. infinite trigger loop) | Validator detects cycles; rate limit + circuit breaker in runtime engine    |
| Users prefer canvas over chat                              | Both surfaces ship; canvas remains first-class; we measure shift over time   |
| Copilot context blows past token limit                      | Spec summary loaded by default; full spec only via tool call when needed     |

## Files

```
docs/
  workflows/
    spec.schema.json                                    NEW   Phase A  generated, committed for code agents
    AUTHORING.md                                        NEW   Phase B  long-form authoring guide

WORKFLOWS.md                                            NEW   Phase B  root-of-repo authoring guide
CLAUDE.md                                               EDIT  Phase B  add Workflows section

.planning/
  agents/workflow-authoring.md                          NEW   Phase B  deep agent guide w/ decision tree
  workflows/
    examples/                                           NEW   Phase B  20+ canonical .yaml workflows
    templates/                                          NEW   Phase B  partial templates for common patterns

src/
  lib/
    workflows/
      spec.ts                                           DEP   SEED-025 source of truth, org-filtered
      validate.ts                                       NEW   Phase A  pure validator → structured errors
      yaml.ts                                           NEW   Phase A  YAML ↔ JSON definition roundtrip
      explain.ts                                        NEW   Phase C  natural-language workflow summary
    copilot/
      tools/
        list-workflows.ts                               NEW   Phase C
        get-workflow.ts                                 NEW   Phase C
        create-workflow.ts                              NEW   Phase C
        update-workflow.ts                              NEW   Phase C
        validate-workflow.ts                            NEW   Phase C
        run-workflow.ts                                 NEW   Phase C
        explain-workflow.ts                             NEW   Phase C
        delete-workflow.ts                              NEW   Phase C
        list-capabilities.ts                            NEW   Phase C
      system-prompt.ts                                  EDIT  Phase C  inject capability summary + examples
  app/
    api/
      workflows/spec/route.ts                           DEP   SEED-025
      workflows/route.ts                                NEW   Phase A  POST /api/workflows (validator-gated)
      workflows/[id]/route.ts                           NEW   Phase A  GET/PUT/DELETE
      workflows/[id]/validate/route.ts                  NEW   Phase A  dry-run validate

scripts/
  validate-workflows.ts                                 NEW   Phase A  CLI for npm run workflows:validate
  load-workflow-seeds.ts                                NEW   Phase D  ingest supabase/seeds/workflows/

supabase/
  seeds/workflows/                                      NEW   Phase D  platform-default workflows (.yaml)
  migrations/085_workflow_authoring_runs.sql            NEW   Phase E  Copilot authoring telemetry
```

## Open questions

- Should we expose YAML directly to end users in the canvas (a "Source" tab), or keep it purely an AI/code-agent format?
- Per-tenant override of platform-default workflows: copy-on-write, or pure inheritance with patch?
- Multi-language: should `description` and node comments be localized, and how does Copilot pick locale?
- Voice authoring (user speaks to Copilot in a call): in scope for this seed, or a follow-up?
