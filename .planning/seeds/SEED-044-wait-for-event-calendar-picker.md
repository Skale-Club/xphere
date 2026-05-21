---
id: SEED-044
status: dormant
planted: 2026-05-21
planted_during: v2.8 (post-ship) — canvas visual refinement milestone (SEED-043)
trigger_when: next milestone touching the flow canvas node config UX, OR any milestone that wires calendar/event triggers end-to-end
scope: Medium
depends_on: [SEED-027 (Calendar as First-Class Workflow Surface — all phases shipped)]
---

# SEED-044: Wait for Event Node Must Expose a Calendar/Event Picker

## Why This Matters

The `wait` node in the flow canvas has a `wait_for_event` mode
(`src/components/flows/node-config-panel.tsx:333`), but it only shows a
**Timeout** field. There is no picker for WHICH event should resolve the wait.

This is semantically broken: the workflow runtime has no way to know what
condition it is waiting for. The node is ambiguous in the canvas UI ("wait for
event — wait for *what*?") and incomplete in the runtime definition (no
`event_type` field in the persisted node data).

SEED-027 already shipped the full calendar event registry
(`meeting.confirmed`, `meeting.starts_in`, `meeting.cancelled`, etc.) and the
variable scope infrastructure. All the backend plumbing exists. The canvas
picker is the missing final link.

Without it, any user who selects "Wait for event" ends up with a node that
either silently times out or never resolves, depending on the runtime
implementation.

## When to Surface

**Trigger:** Any milestone that includes flow canvas node UX work OR a milestone
that ships end-to-end calendar-triggered workflow execution.

This seed should be presented during `/gsd:new-milestone` when:
- The milestone scope includes "flow canvas", "node config", or "wait node"
- The milestone scope includes "calendar events", "event triggers", or "workflow triggers"
- A user or audit flags that `wait_for_event` has no event selection UI

## What Needs to Be Built

### 1. Event picker UI (`node-config-panel.tsx`)

When `flow.mode === 'wait_for_event'`, show an event picker instead of (or in
addition to) the Timeout field:

```tsx
// Inside the wait_for_event branch
<Select
  value={flow.event_type ?? ''}
  onValueChange={(v) => updateNodeData(node.id, { event_type: v })}
>
  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select event..." /></SelectTrigger>
  <SelectContent>
    <SelectItem value="meeting.confirmed">Meeting confirmed</SelectItem>
    <SelectItem value="meeting.cancelled">Meeting cancelled</SelectItem>
    <SelectItem value="meeting.starts_in">Meeting starts in...</SelectItem>
    <SelectItem value="meeting.completed">Meeting completed</SelectItem>
    <SelectItem value="meeting.no_show">Meeting no-show</SelectItem>
    <SelectItem value="meeting.rescheduled">Meeting rescheduled</SelectItem>
  </SelectContent>
</Select>
```

Ideally this list comes from the org capability spec (`GET /api/workflows/spec`)
rather than being hardcoded, so non-calendar events (webhooks, custom triggers)
surface automatically.

### 2. `meeting.starts_in` offset sub-field

When `event_type === 'meeting.starts_in'`, show an offset picker:
`-5m / -1h / -24h` or a free input for custom offsets.

### 3. Node subtitle update (`nodes/index.tsx:167`)

Currently: `Wait for event - ${formatWaitDuration(flow.timeout) ?? '7 days'}`

Should be: `Wait for event — ${flow.event_type ?? 'no event selected'}`

This makes the canvas node readable at a glance.

### 4. Runtime enforcement

The workflow validator should flag a `wait_for_event` node with no `event_type`
as a configuration error (not just a warning) so broken definitions can't be
saved.

## Scope Estimate

**Medium** — UI picker + spec-driven population + subtitle update + validator
rule. One phase of 2-3 tasks. No new backend required since SEED-027 already
shipped the event registry.

## Breadcrumbs

- `src/components/flows/node-config-panel.tsx:314-353` — `wait` node config
  block; `wait_for_event` branch currently has only a Timeout field
- `src/components/flows/nodes/index.tsx:161-179` — `WaitNodeImpl`; subtitle
  hardcodes duration instead of event type when in `wait_for_event` mode
- `src/components/flows/flow-palette.tsx:25` — wait node registered with
  description "Sleep or wait for event"
- `src/lib/scheduling/google-calendar.ts` — existing calendar integration
- `src/components/scheduling/calendar-view.tsx` — existing calendar UI component
- `.planning/seeds/SEED-027-calendar-as-workflow-surface.md` — all phases
  shipped; defines the 8 calendar events and their variable scopes
- `src/app/api/workflows/spec` — org capability spec endpoint (source of truth
  for available events)

## Notes

The immediate fix (hardcoded picker) could be done in hours. The right fix
(spec-driven picker that auto-populates from connected integrations) is worth
doing properly when the canvas UX milestone arrives, so the picker scales to
webhook events, CRM events, and any future triggers without code changes.
