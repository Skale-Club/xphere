# Agent Guide — Workflow Authoring

This document is for **AI agents** (the in-app Copilot and external coding agents like Claude Code) authoring workflows in this codebase. The contract is the workflow validator. Read `WORKFLOWS.md` first if you haven't.

## Decision tree

```
Is the workflow callable by name (agent tool, voice handler, webhook)?
├── Yes → kind: tool
│         trigger: { type: tool_call, config: { tool_name: "<unique>" } }
│         exactly one action node connected from trigger
│
└── No  → kind: flow (multi-step)
          What starts it?
          ├── Calendar event (booking lifecycle) → trigger: { type: event, event: meeting.<x> }
          ├── Time-based                        → trigger: { type: event, event: meeting.starts_in, config: { offset: "-5m" } }
          ├── Schedule (cron)                   → trigger: { type: schedule, config: { cron: "0 9 * * *" } }
          ├── Inbound HTTP                      → trigger: { type: webhook_url }
          └── Manual / API                      → trigger: { type: manual }
```

## Pre-flight checklist (run this BEFORE submitting)

- [ ] **Trigger type exists** — found in `spec.triggers`
- [ ] **Every node kind exists** — found in `spec.nodes` (which is already org-filtered)
- [ ] **Every integration is connected** — found in `spec.available_integrations`
- [ ] **Every `{{variable}}` is in scope** at the node where it's referenced
- [ ] **No duplicate node ids**
- [ ] **No cycles** in `edges`
- [ ] **Every node reachable from `trigger`**

If you have access to the local repo: `npm run workflows:validate <file>` runs all these checks. Treat that command as the source of truth.

## Variable scope reference

Scope is the **set of namespace prefixes** that resolve at a given node. A reference like `{{contact.phone}}` is valid if `contact.` is in scope.

| Trigger type                | Initial scope                                                                |
|-----------------------------|------------------------------------------------------------------------------|
| `tool_call`                 | `trigger`, `input`, `contact` (when caller provides linked contact)         |
| `manual`                    | `trigger`, `input`, `contact`                                                |
| `webhook_url`               | `trigger`, `input`, `trigger.headers`                                        |
| `schedule`                  | `trigger`                                                                    |
| `event:meeting.*`           | `trigger`, `meeting`, `contact` (`meeting.attendee_contact` for explicit)   |
| `event:meeting.starts_in`   | above + `trigger.offset_minutes`                                             |

**Each node also adds its own id as a scope prefix** for downstream nodes. So if a node `id: lookup` returns data, downstream nodes can reference `{{lookup.field}}`.

## Reading errors

Every validation error has this shape:

```jsonc
{
  "path": "nodes[1].to",
  "code": "unresolved_variable",
  "message": "{{contact.phone}} is not in scope for this trigger",
  "suggestion": "Variables available at this trigger: meeting.attendee_contact.phone, meeting.starts_at, …. Use {{meeting.attendee_contact.phone}}."
}
```

The `suggestion` is designed to be **directly actionable**. When iterating:

1. Read every error's `suggestion`
2. Apply the smallest set of edits that addresses all errors
3. Re-validate
4. Repeat until `ok: true`

Target: ≤ 3 iterations to convergence. If you can't converge after 3, the brief itself probably has a gap (missing integration, requested capability isn't in the spec) — escalate to a human rather than guess.

## Pattern catalog

### Pattern 1: Single-action tool

When to use: agent must be able to invoke an action by name.

```yaml
name: lookup_appointment_by_phone
trigger:
  type: tool_call
  config: { tool_name: lookup_appointment_by_phone }
nodes:
  - id: action
    kind: custom_webhook
    integration: custom_webhook
    config:
      url: "{{integration.endpoint}}/lookup"
      method: POST
      body: { phone: "{{input.phone}}" }
edges:
  - { from: trigger, to: action }
```

### Pattern 2: Event → wait → action

When to use: react to a lifecycle event with a delay (reminder, follow-up).

```yaml
name: post-meeting-thanks
trigger:
  type: event
  event: meeting.completed
nodes:
  - id: wait
    kind: wait
    duration: "1h"
  - id: thanks
    kind: send_sms
    integration: twilio
    to: "{{meeting.attendee_contact.phone}}"
    body: "Thanks for meeting with us today! Anything follow-up I can help with?"
edges:
  - { from: trigger, to: wait }
  - { from: wait,    to: thanks }
```

### Pattern 3: Branch on condition

When to use: different downstream actions based on data.

```yaml
trigger:
  type: event
  event: meeting.no_show
nodes:
  - id: was_paid
    kind: condition
    expression: "{{meeting.was_paid}} == true"
  - id: refund
    kind: send_sms
    integration: twilio
    to: "{{meeting.attendee_contact.phone}}"
    body: "We missed you. A refund is on its way."
  - id: rebook
    kind: send_sms
    integration: twilio
    to: "{{meeting.attendee_contact.phone}}"
    body: "We missed you. Rebook: {{meeting.event_type.slug}}"
edges:
  - { from: trigger,  to: was_paid }
  - { from: was_paid, to: refund, when: "true" }
  - { from: was_paid, to: rebook, when: "false" }
```

### Pattern 4: Time-based pre-meeting reminder

```yaml
trigger:
  type: event
  event: meeting.starts_in
  config: { offset: "-5m" }
nodes:
  - id: notify
    kind: send_sms
    integration: twilio
    to: "{{meeting.attendee_contact.phone}}"
    body: "Your meeting starts in 5 minutes: {{meeting.link}}"
edges:
  - { from: trigger, to: notify }
```

## Anti-patterns

- **Hardcoded phone numbers / URLs** instead of variables. Workflows are templates — always reference `{{contact.phone}}`, `{{meeting.link}}`, etc.
- **Conditioning on string equality of formatted dates** instead of structured fields. Use `{{meeting.status}}` not `{{meeting.starts_at}} contains "2026"`
- **Multiple workflows that duplicate logic.** Compose: one workflow can call another via the `tool_call` trigger
- **Triggering a workflow from an action of the same workflow** — produces cycles; validator rejects. If you need recursion, use `wait` and a separate `tool_call` trigger
- **Catch-all `custom_webhook`** when a named integration node exists. The named node is more legible and gets dedicated observability

## When in doubt

- Check `.planning/workflows/examples/` for a similar workflow you can copy
- Check `docs/workflows/spec.schema.json` for the static spec
- For per-org capabilities (which integrations are connected), call `/api/workflows/spec` from the agent context
- If a brief asks for something the spec can't express, **say so** rather than improvising. The spec is the ceiling — if the user needs something outside it, that's a product/SEED conversation, not an authoring conversation.
