---
id: SEED-027
status: active
planted: 2026-05-20
planted_during: post-SEED-024; planted alongside SEED-025/026/028 to unify automation surfaces
trigger_when: SEED-025 Phase B (unified engine) ships AND SEED-028 (meeting locations) ships, OR explicit request to drive automations from calendar events
scope: Large
priority: high
depends_on: [SEED-025 (unified workflow engine with trigger registry), SEED-028 (meeting locations + dynamic links)]
phases_shipped: [A, B, C, D, E, F]
phases_pending: []
last_commit: a177783
---

# SEED-027: Calendar as First-Class Workflow Surface

Today the scheduling system (SEED-071-073: profiles, event types, availability, bookings) is a closed loop — it lets people book meetings but its events live in isolation from the workflow engine. SEED-027 turns calendar events into **first-class triggers and actions** in the unified workflow system (SEED-025).

After SEED-027, a user can author this workflow with a single English sentence:

> "When a meeting is confirmed, schedule an SMS to the attendee 5 minutes before it starts with the meeting link."

The Copilot (SEED-026) recognizes `meeting.confirmed` as a registered trigger, `meeting.attendee_contact.phone` as a variable, `{{meeting.link}}` as a SEED-028 dynamic variable, and `wait_until` + `send_sms` as available nodes. It composes the workflow, validates, and publishes.

## Why this matters

Calendar events are **the highest-value source of automation signals** for service businesses:

- Meeting confirmations → confirmation messages, prep instructions, location/link
- Pre-meeting reminders → SMS/email/WhatsApp at configurable offsets
- No-shows → recovery flows (apology + reschedule link)
- Cancellations → win-back sequences
- Post-meeting → review request, follow-up email, pipeline stage move

Today every one of these requires custom code. After SEED-027 they're declarative workflows that any user (or Copilot) can build.

## Calendar event model — current state

From `supabase/migrations/071_scheduling.sql` and `073_scheduling_hardening.sql`:

- `scheduling_profiles` — per-org or per-user profile (timezone, branding, slug)
- `event_types` — bookable types (`name`, `duration_minutes`, `location_type`, `location_value`, `slug`)
- `user_availability` — recurring availability windows
- `bookings` — `(id, event_type_id, contact_id, organizer_user_id, starts_at, ends_at, status, meeting_url?, location?, ...)`

`bookings.status` transitions: `pending → confirmed → completed | cancelled | no_show | rescheduled`

These transitions are where workflow triggers fire.

## What this seed adds

### 1. Booking lifecycle hooks

Every `bookings.status` transition emits a workflow event via the unified engine:

| Event                    | Fires when                                                              |
|--------------------------|--------------------------------------------------------------------------|
| `meeting.scheduled`      | `bookings` row inserted (any status incl. pending)                       |
| `meeting.confirmed`      | Transitions to `confirmed` (from `pending` or programmatic confirm)     |
| `meeting.cancelled`      | Transitions to `cancelled`                                              |
| `meeting.rescheduled`    | `starts_at` changes (with old and new times in payload)                 |
| `meeting.no_show`        | Transitions to `no_show` (typically post-meeting marker by organizer)   |
| `meeting.completed`      | Transitions to `completed`                                              |
| `meeting.starts_in`      | Time-based: fires `offset_minutes` before `starts_at` (5m, 1h, 24h, ...)|
| `meeting.ended`          | Time-based: fires when `ends_at` passes                                  |

Time-based events (`starts_in`, `ended`) are evaluated by a scheduled tick (Vercel Cron / pg_cron) that polls upcoming bookings and dispatches matched workflows. Each workflow declares its `offset` at design time; ticks evaluate "any booking where `starts_at - offset` ∈ [last_tick, now]".

### 2. Calendar variables in workflow scope

Whenever a calendar-triggered workflow runs, the engine pre-populates this scope:

```jsonc
{
  "meeting": {
    "id": "booking-uuid",
    "title": "Strategy session with Acme",
    "starts_at": "2026-05-21T14:00:00Z",
    "ends_at":   "2026-05-21T14:30:00Z",
    "duration_minutes": 30,
    "status": "confirmed",
    "organizer": {
      "user_id": "...",
      "name": "Maria Silva",
      "email": "maria@xphere.app"
    },
    "attendee_contact": {
      "id": "...",
      "name": "John Acme",
      "email": "john@acme.com",
      "phone": "+15551234567"
    },
    "event_type": {
      "id": "...",
      "name": "30-min strategy",
      "slug": "30min-strategy"
    },
    "location": {                            // SEED-028 resolved location
      "type": "google_meet",
      "label": "Google Meet",
      "address": null,
      "coordinates": null,
      "phone": null
    },
    "link": "https://meet.google.com/abc-defg-hij",   // SEED-028 dynamic link
    "notes": "Pre-meeting notes from booking form",
    "rescheduled_from": null,                // populated only on meeting.rescheduled
    "rescheduled_to":   null
  },
  "trigger": {
    "event": "meeting.confirmed",
    "fired_at": "2026-05-20T13:55:00Z",
    "offset_minutes": null                   // populated for meeting.starts_in
  }
}
```

### 3. Calendar actions (nodes workflows can use)

New node `kind` values in the unified spec:

| Node kind                  | Purpose                                                                   |
|----------------------------|---------------------------------------------------------------------------|
| `calendar.create_event`    | Create a new booking (org/event_type/contact/starts_at/duration)          |
| `calendar.cancel`          | Cancel an existing booking (by id; cascades notifications)                |
| `calendar.reschedule`      | Move an existing booking to a new `starts_at`                             |
| `calendar.mark_no_show`    | Set status to `no_show` (post-meeting flag)                               |
| `calendar.mark_completed`  | Set status to `completed`                                                 |
| `calendar.send_invite`     | (Re)send the calendar invite email/iCal to attendee                       |
| `calendar.create_reminder` | Schedule a one-off reminder action without writing a full workflow        |

`calendar.create_reminder` is a convenience: it inserts a `scheduled_reminders` row that the same tick scheduler processes. Equivalent to authoring a `meeting.starts_in` workflow but inline within a flow.

### 4. Scheduler — time-based tick

A scheduled job runs every minute (Vercel Cron or pg_cron):

1. Query bookings where any `meeting.starts_in` workflow's offset puts the booking in the next minute window
2. For each match, enqueue a workflow run with the right scope
3. Mark dispatched to avoid double-fire on overlapping ticks (idempotency table: `(workflow_id, booking_id, event, fired_at)`)

For `meeting.ended`: same mechanism applied to `ends_at`.

For `scheduled_reminders` (inline reminders from `calendar.create_reminder`): same scheduler processes them; treated as one-shot mini-workflows.

### 5. Status-transition hooks

Bookings status changes flow through a server-side helper that:

1. Updates the `bookings` row in a transaction
2. Inserts an `event_dispatches` row capturing the transition
3. Enqueues matching workflows (queries `workflows WHERE trigger_type = 'event' AND trigger_config.event = 'meeting.confirmed' AND NOT health_blocked`)

This is wrapped in `lib/scheduling/transition.ts` so every callsite (API routes, server actions, webhook handlers) goes through one path.

## Phases

### Phase A — Trigger registry extension (depends on SEED-025 B)
- Extend `lib/workflows/spec.ts` trigger types with the 8 calendar events listed above
- Each trigger declares its variable scope and `config_schema` (e.g. `meeting.starts_in` requires `offset` string like `-5m`, `-1h`, `-24h`)
- New helpers `lib/scheduling/events.ts` — typed event emitter; called from `lib/scheduling/transition.ts`
- Migration 086: `event_dispatches` table for audit trail of transitions
- Migration 087: `scheduled_workflow_ticks` table for tick scheduler idempotency

### Phase B — Status-transition wiring
- Rewrite all booking mutation paths (booking creation, confirm endpoint, cancel, reschedule, mark-no-show) to call `lib/scheduling/transition.ts` exclusively
- `transition` does: status check → DB update → event dispatch → workflow enqueue
- Backwards-compat: existing notification-sending code (confirmation email, etc.) is converted into platform-default workflows (`supabase/seeds/workflows/booking-confirmation.yaml`) — see SEED-026 Phase D
- Tests cover: each transition fires the right event; double-confirm is idempotent; race conditions don't double-fire

### Phase C — Tick scheduler
- Vercel Cron `/api/cron/scheduling-tick` every 1 min (or pg_cron equivalent)
- Query upcoming bookings + active `meeting.starts_in` workflows; compute matches; enqueue
- Process `scheduled_reminders` (inline reminders)
- Idempotency: `(workflow_id, booking_id, event, fired_minute)` unique constraint
- Observability: tick duration metric; matches-per-tick gauge; failures alerted

### Phase D — Calendar action nodes
- New executors in `lib/flows/executors/calendar.ts` for the 7 action node kinds
- Each action node validates: org owns booking, event_type exists, status transition is legal (e.g. can't cancel a `completed` booking)
- Surface action nodes in `spec.ts`
- 5 canonical examples added to `.planning/workflows/examples/` (depends on SEED-026 B)

### Phase E — Variable resolution
- `lib/scheduling/scope.ts` — builds the `meeting.*` scope object from a booking_id; joins contact, organizer, event_type, location (SEED-028)
- Used by the workflow runtime when a calendar-triggered workflow starts
- Validator (SEED-026 Phase A) is updated with the calendar variable namespace so authoring tools can reference it

### Phase F — Platform-default workflows
Ship as platform defaults (via SEED-026 seed loader):

| Workflow                         | Trigger              | Effect                                                                |
|----------------------------------|----------------------|------------------------------------------------------------------------|
| `booking-confirmation`           | `meeting.confirmed`  | Send confirmation email + SMS with `{{meeting.link}}` and prep info    |
| `pre-meeting-24h-reminder`       | `meeting.starts_in -24h` | Send "tomorrow at X" reminder via the org's preferred channel       |
| `pre-meeting-5min-reminder`      | `meeting.starts_in -5m`  | Send last-minute SMS with `{{meeting.link}}`                          |
| `no-show-recovery`               | `meeting.no_show`     | Wait 1h then send "sorry we missed you" + reschedule link              |
| `post-meeting-review-request`    | `meeting.completed`   | Wait 1h then send review request                                       |
| `cancellation-acknowledgement`   | `meeting.cancelled`   | Confirmation + win-back offer                                          |

All authored as YAML in `supabase/seeds/workflows/`. Orgs inherit them with copy-on-write override capability.

## Backwards compatibility

- The existing notification email/SMS code paths continue to run during Phase B; cutover is per-event behind a feature flag (`calendar_notifications_via_workflows`)
- Once a tenant flips to workflows, the platform-default workflows replicate the old behavior verbatim — no user-visible regression
- Custom on-prem booking notification customizations (rare today) are migrated org-by-org by copy-paste into per-org workflow YAML

## Risks + mitigations

| Risk                                                          | Mitigation                                                                                |
|---------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Tick scheduler misses bookings around minute boundaries        | Query window includes 1-min overlap; idempotency table dedupes; alert on dispatch gaps     |
| Double-fire of confirmation on re-confirm                      | Status check in `transition.ts`: no event if status didn't actually change                  |
| Cascade: a workflow creates a booking → fires `meeting.scheduled` → infinite loop | Engine rate limit per (workflow, trigger_chain_depth); circuit breaker at depth 3           |
| User customizes platform-default workflow then we ship a new version | Copy-on-write: customized workflows are forked; platform updates only apply to non-forked  |
| Time-zone bugs in offset calculation                            | All comparisons in UTC at the engine; user-facing offsets remain in user TZ                |

## Success criteria

1. ✅ All 8 calendar events emit through `lib/scheduling/transition.ts` and reach matching workflows
2. ✅ `meeting.starts_in` with arbitrary offsets fires within 60s of target time, 99.9th percentile
3. ✅ All 7 calendar action nodes available in the spec and validator
4. ✅ Copilot can build a calendar-triggered workflow from a one-sentence brief (relies on SEED-026)
5. ✅ All 6 platform-default workflows ship via seed loader and run for every new org
6. ✅ Zero customer-reported regressions in booking notifications during cutover (validated by 7-day parity dual-write)
7. ✅ `npm run build` + integration tests pass

## Open questions

- Should `meeting.starts_in` support multiple offsets in a single workflow (a list `[-24h, -1h, -5m]`) or one offset per workflow? (One per workflow is simpler; users compose multiple workflows.)
- Should `meeting.rescheduled` re-fire downstream reminders automatically, or require explicit workflow logic?
- Booking-form-driven workflows: when an `event_type` has a custom intake form, should form fields become variables (`{{meeting.form.<field>}}`)?
- Recurring bookings: out of scope for v1 (single-event only)?

## Files

```
supabase/
  migrations/086_event_dispatches.sql                          NEW   Phase A
  migrations/087_scheduled_workflow_ticks.sql                  NEW   Phase A
  seeds/workflows/booking-confirmation.yaml                    NEW   Phase F
  seeds/workflows/pre-meeting-24h-reminder.yaml                NEW   Phase F
  seeds/workflows/pre-meeting-5min-reminder.yaml               NEW   Phase F
  seeds/workflows/no-show-recovery.yaml                        NEW   Phase F
  seeds/workflows/post-meeting-review-request.yaml             NEW   Phase F
  seeds/workflows/cancellation-acknowledgement.yaml            NEW   Phase F

src/
  lib/
    scheduling/
      transition.ts                                            NEW   Phase B  one-path for booking mutations
      events.ts                                                NEW   Phase A  typed event emitter
      scope.ts                                                 NEW   Phase E  builds meeting.* variable scope
    workflows/
      spec.ts                                                  EDIT  Phase A  register 8 calendar trigger types + 7 action node kinds
    flows/
      executors/calendar.ts                                    NEW   Phase D  7 calendar action node executors
  app/
    api/
      cron/scheduling-tick/route.ts                            NEW   Phase C  Vercel Cron 1-min tick
      scheduling/bookings/[id]/confirm/route.ts                EDIT  Phase B  go through transition.ts
      scheduling/bookings/[id]/cancel/route.ts                 EDIT  Phase B
      scheduling/bookings/[id]/reschedule/route.ts             EDIT  Phase B
      scheduling/bookings/[id]/no-show/route.ts                NEW   Phase B
      scheduling/bookings/[id]/complete/route.ts               NEW   Phase B
  components/
    workflows/calendar-trigger-config.tsx                      NEW   Phase D  config UI for meeting.starts_in (offset picker)

.planning/
  workflows/examples/
    pre-meeting-5min-sms.yaml                                  NEW   Phase D  canonical example
    post-meeting-review-request.yaml                           NEW   Phase D
    no-show-rebook.yaml                                        NEW   Phase D
    multi-channel-confirmation.yaml                            NEW   Phase D
    cancellation-winback.yaml                                  NEW   Phase D
```

## Coordination

- **SEED-025** must ship Phase B (unified engine + spec) before SEED-027 Phase A can start
- **SEED-028** must ship before SEED-027 Phase E — calendar scope includes `meeting.location` and `meeting.link` which come from SEED-028
- **SEED-026** Phase D loader picks up the platform-default workflows in SEED-027 Phase F
