# Phase 128: Reliable Calendar Scheduling - Research

**Researched:** 2026-07-15
**Domain:** Cron-driven, delay-tolerant, idempotent time-based workflow dispatch (Next.js API route + Postgres + GitHub Actions)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Delay-tolerant due-window scan (SCH-01)**
The scheduler must select bookings whose reminder time falls in a window derived from durable progress (last processed watermark or per-item dispatch records), not "now ± tick interval". A late cron run still picks up everything that became due since the last successful run.

**D-02: Exactly-once dispatch (SCH-02)**
Deduplication is durable: one dispatch per (booking, workflow, offset). Use a dispatch-log table or unique constraint so retries and overlapping ticks cannot double-fire. Only the workflow/offset that is actually due is dispatched.

**D-03: Secured tick endpoint with durable progress (SCH-03)**
The calendar tick endpoint requires a configured secret (reject when missing/mismatched — follow the existing cron endpoint secret pattern in the repo, e.g. the campaign tick). Progress is persisted so restarts/redeploys don't lose position.

**D-04: Tenant-neutral defaults (SCH-04)**
Platform-default calendar workflows/seeds must not install client-specific (Skleanings) tagging, opportunities, or email content for every org. Defaults become neutral; anything client-specific moves to that tenant's own workflow configuration. NOTE (from REQUIREMENTS Out of Scope): do NOT auto-mutate existing tenant workflows — only change what new orgs/platform seeds install going forward. Existing-tenant migration is CAL-F01 (future).

### Claude's Discretion
- Watermark vs. per-item dispatch-log design (pick the one that composes best with the existing schema and the Phase 127 lifecycle events).
- Whether the tick runs via GitHub Actions cron (existing pattern: `.github/workflows/*tick*`) or another scheduler — keep the existing transport, fix the semantics.

### Deferred Ideas (OUT OF SCOPE)
- Operator tooling to migrate pre-existing client-specific seeded workflows (CAL-F01, future requirement).
- Provider sync (Phase 129), UI coherence (Phase 130).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCH-01 | Calendar reminders tolerate delayed cron invocations without losing due bookings | Found the exact bug: `src/app/api/cron/calendar-tick/route.ts` anchors its scan window to wall-clock `now` (`[now, now+1min)` for `meeting.ended`, `[now+offsetMs, now+offsetMs+1min)` for `meeting.starts_in`), not to a persisted watermark. The GH Actions cron comment itself documents the gap. Recommended fix: replace the fixed window with a scan bounded by a persisted `last_scanned_at` watermark and `now`, capped at a sane max lookback. |
| SCH-02 | A scheduler dispatches only the workflow and offset that are due, once per booking/workflow/offset | `scheduled_workflow_ticks` (migration 087) already gives per-item idempotency via a composite PK, but its `fired_minute` column is written from wall-clock tick time, not the offset-derived target minute — this breaks once SCH-01 widens the scan window (a catch-up tick would record the wrong dedup key). Recommended fix: derive `fired_minute` (or a renamed `target_minute`) from `booking.start_at`/`end_at` and the workflow's offset, not from `now`. |
| SCH-03 | The calendar tick endpoint requires a configured secret and records durable scheduling progress | Current code (`if (CRON_SECRET) { ... }`) treats the secret as optional — if the env var is unset, auth is skipped entirely. `src/app/api/cron/global-knowledge-notion/route.ts` already has the correct pattern (503 if unset, 401 on mismatch) — reuse it. `CRON_SECRET` is already provisioned in Coolify prod env (`.github/workflows/coolify-set-envs.yml`), so tightening this is safe. "Durable scheduling progress" = the same watermark table needed for SCH-01. |
| SCH-04 | Platform defaults are tenant-neutral and never install Skleanings-specific tagging, opportunities, or email content for every organization | Found the precise offender: `supabase/seeds/workflows/booking-confirmation.yaml` (a **top-level, currently-live platform default** loaded for every new org) hardcodes `contact_add_tag` "customer", `pipeline_create_opportunity` stage "Job Confirmed", and a fully Skleanings-branded HTML email. Also found 8 additional Skleanings-only YAMLs nested under `supabase/seeds/workflows/agendamento/**` that the bulk loader script (`scripts/load-workflow-seeds.ts`, recursive) would install to every org if run, even though the per-org onboarding path (`src/lib/workflows/seed-org.ts`, non-recursive) currently skips them by directory-traversal accident, not by design. |
</phase_requirements>

## Summary

The calendar tick scheduler already exists and is more mature than the phase context implied — it is not a greenfield build. `src/app/api/cron/calendar-tick/route.ts`, wired from `.github/workflows/calendar-tick.yml` (GitHub Actions, `*/5 * * * *`), already has: a Bearer-secret check (but optional — the SCH-03 bug), a per-item idempotency table (`scheduled_workflow_ticks`, migration 087) with a composite primary key, and it dispatches through the shared `emitCalendarEvent` (`src/lib/calendar/transition.ts`) which is exactly the Phase 127 canonical dispatch path this phase should keep using. The core defect is that both the `meeting.starts_in` and `meeting.ended` scans use a **fixed one-minute window anchored to wall-clock `now`**, not a durable watermark — a comment in the YAML workflow file even documents this as a known limitation. A cron run delayed or skipped by more than ~1 minute permanently loses any booking whose due-moment fell in the gap. Fixing this requires threading a persisted scan-progress cursor through the route and changing the idempotency key from "the tick's current minute" to "the booking's actual offset-derived due minute" so that a catch-up scan still produces correct, stable dedup keys (this is what ties SCH-01 and SCH-02 together).

The endpoint's secret check is present but broken by design: it treats `CRON_SECRET` as optional, silently disabling auth if the env var is unset, exactly the anti-pattern SCH-03 targets. A correct reference implementation already exists in the same codebase (`src/app/api/cron/global-knowledge-notion/route.ts`), and the secret is already provisioned in production, so tightening this is a safe, self-contained change.

SCH-04's audit turned up a more serious and more directly actionable finding than "some example seeds mention Skleanings": `supabase/seeds/workflows/booking-confirmation.yaml` is a **currently-live, top-level platform default** (loaded for every new org today via `seed-org.ts`) that tags every confirmed-booking contact "customer", creates a "Job Confirmed" pipeline opportunity, and sends a fully Skleanings-branded confirmation email (logo, phone number, $120 minimum-charge notice, cleaning-specific prep instructions, `hello@skleanings.com` footer). This is the concrete SCH-04 fix target. A second, lower-severity cluster (8 YAML files under `supabase/seeds/workflows/agendamento/**`, all named "Skleanings — …") is currently *not* loaded for new orgs (an accidental byproduct of `seed-org.ts`'s non-recursive directory scan), but *would* be installed to every org if anyone ran the recursive bulk-load script (`npm run seed` / `scripts/load-workflow-seeds.ts`) — this is a latent landmine, not yet triggered in production, that should be closed in the same phase.

**Primary recommendation:** Extend the existing calendar-tick infrastructure rather than rebuilding it — add a watermark-bounded scan + offset-derived idempotency key to `route.ts` (new migration, `1251+`), fix the secret check to the `global-knowledge-notion` pattern, and neutralize/relocate the Skleanings-specific content out of `supabase/seeds/workflows/` (both the live `booking-confirmation.yaml` and the `agendamento/**` tree) without touching the Skleanings org's already-installed `workflows` rows.

## Standard Stack

This phase adds no new libraries. It is entirely internal: one Postgres migration, changes to one Next.js route handler (Node.js runtime, already using `@supabase/supabase-js` service-role client), and YAML seed-file edits.

### Core (already in use, versions confirmed via package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.2.6 | App Router API routes | Existing project stack |
| @supabase/supabase-js | ^2.101.1 | Service-role Postgres/Supabase client used in `route.ts` | Existing project stack |
| typescript | ^5 | Strict typing | Existing project stack (`npm run build` type-checks) |
| vitest | ^4.1.2 | Test runner | Existing project stack |
| pg | (already a devDependency, used by `tests/calendar-overlap-constraint.test.ts`) | Direct Postgres connection for real-DB transactional tests | Existing pattern for testing not-yet-applied migrations |

### Don't add
No new packages are needed. Do not introduce a job-queue library (e.g. BullMQ, node-cron) — the existing GitHub Actions cron + idempotent-tick-endpoint pattern is the established transport for this whole codebase (`calendar-tick`, `global-knowledge-notion`, `obs-alerts`, `twilio-sms-reconcile`, `website-analyzer` all follow it) and CONTEXT.md's Claude's Discretion explicitly says "keep the existing transport, fix the semantics."

**Version verification:** No new packages to verify — this phase is additive SQL + route logic only.

## Architecture Patterns

### Current file map (already exists — this phase edits/extends these, it does not scaffold from scratch)
```
.github/workflows/calendar-tick.yml          # GH Actions cron, */5 * * * *, Bearer CRON_SECRET
src/app/api/cron/calendar-tick/route.ts      # GET handler: meeting.starts_in / meeting.ended / opportunity ticks / wait timeouts
src/lib/calendar/transition.ts               # emitCalendarEvent — canonical dispatch (Phase 127's LIFE-01/03 path)
src/lib/calendar/events.ts                   # CalendarEvent union + CalendarEventPayload
supabase/migrations/087_scheduled_workflow_ticks.sql   # existing per-item idempotency table
supabase/migrations/1245_workflow_engine_hardening.sql # GIN index + opportunity-tick hardening (reference pattern)
supabase/seeds/workflows/booking-confirmation.yaml     # SCH-04 target — live Skleanings-branded platform default
supabase/seeds/workflows/agendamento/**                # SCH-04 target — 8 Skleanings-only workflows, latent bulk-load risk
scripts/load-workflow-seeds.ts               # recursive seed loader (bulk, all orgs) — walks agendamento/**
src/lib/workflows/seed-org.ts                # non-recursive seed loader (new-org onboarding) — currently skips agendamento/** by accident
```

### Pattern 1: Watermark-bounded scan replacing fixed "now" window (SCH-01)
**What:** Persist the instant through which the scheduler has successfully processed all due bookings. On each tick, scan `(watermark, now]` instead of `[now, now+1min)`. Advance the watermark to `now` only after the scan completes without a fatal error, so a crashed/partial tick retries the same range next time.
**When to use:** Any time-based dispatch loop whose correctness depends on not missing a tick (this route already has this need in three places: `meeting.starts_in`, `meeting.ended`, and, out of this phase's scope but sharing the same route, the opportunity-tick scanner).
**Design choice (Claude's Discretion, D-01/D-02):** The cleanest composition with the existing schema is a **hybrid**: keep `scheduled_workflow_ticks` as the per-item dedup guard (its composite PK already does the "exactly once" job well), but (a) add a small watermark table/row so the *query bounds* are durable, and (b) change what gets written as the tick's dedup key from "the wall-clock minute the tick happened to run in" to "the booking's actual offset-derived due minute" (`start_at - offset`, truncated to minute for `meeting.starts_in`; `end_at` truncated to minute for `meeting.ended`). This second change is required *because of* the first — once the scan window can span many minutes in one tick (catch-up), each booking in that batch must still get its own correct, stable key, not all collapse onto the same `fired_minute = now`.
**Cap the lookback:** Uncapped catch-up is dangerous for content that says "starts in 5 minutes" — if the tick was down for 3 hours, firing a stale "-5m" reminder for a meeting that already happened is actively wrong, not just late. Recommend: cap the scan lookback (e.g. via a constant, not necessarily a new env var) and skip (log, don't dispatch) any `meeting.starts_in` candidate whose `start_at` has already passed by the time the tick runs. `meeting.ended` reminders don't have this "stale content" problem the same way (the meeting did end; "send a review request" is still valid late) — so the cap should be a scan-lookback bound, not a blanket "skip anything old" rule applied identically to both event types. Flagged as an Open Question below for the planner's explicit design decision.

```sql
-- Illustrative shape only, not a literal migration — planner should reconcile
-- exact columns with the Phase 127 lifecycle event contract before finalizing.
CREATE TABLE IF NOT EXISTS public.calendar_tick_watermark (
  event_type   text PRIMARY KEY,   -- 'meeting.starts_in' | 'meeting.ended'
  scanned_to   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

### Pattern 2: Secret-required cron auth (SCH-03) — reuse existing correct implementation
**What:** Treat a missing `CRON_SECRET` as a *server misconfiguration* (503), and a present-but-mismatched header as *unauthorized* (401). Never silently skip the check.
**Source:** `src/app/api/cron/global-knowledge-notion/route.ts` (already correct in this repo):
```typescript
// Source: src/app/api/cron/global-knowledge-notion/route.ts (this repo, verbatim)
const cronSecret = process.env.CRON_SECRET
if (!cronSecret) {
  return Response.json({ ok: false, error: 'CRON_SECRET is not configured' }, { status: 503 })
}
if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
  return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}
```
Contrast with `calendar-tick/route.ts`'s current (buggy) check:
```typescript
// Current — SCH-03 bug: if CRON_SECRET is unset, this block never executes.
if (CRON_SECRET) {
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
}
```
**Stronger variant available in-repo (optional upgrade):** `src/app/api/automations/ghl-reengagement/run/route.ts` uses `timingSafeEqual` for constant-time comparison instead of `!==`. Not strictly required by SCH-03's wording, but worth considering since this is a security-sensitive endpoint and the pattern already exists in-house.
**Note:** `CRON_SECRET` is already set in production Coolify env (confirmed in `.github/workflows/coolify-set-envs.yml`, line `upsert CRON_SECRET "${CRON_SECRET}"`), so switching to "reject when missing" will not break prod.
**Note on scope:** Every other cron route in this repo *except* `global-knowledge-notion` has the same optional-secret bug (`obs-alerts`, `twilio-sms-reconcile`, `website-analyzer`). SCH-03 only names the calendar tick endpoint — fixing the others is out of scope for this phase unless the planner deliberately chooses to (flagged as an aside, not a requirement).

### Pattern 3: Extract pure, testable scheduling logic out of the route handler
**What:** The current `route.ts` has ~250 lines of scan/offset/dedup logic inlined directly in the `GET` handler. The repo's established pattern for cron routes (see `src/lib/obs/alerts.ts` backing `obs-alerts/route.ts`, tested via `tests/obs-alerts.test.ts` as pure unit tests) is to keep business logic in `src/lib/**` and the route as thin auth + orchestration.
**Recommendation:** Extract `parseOffset`, the due-window computation, and the dedup-key computation into a new `src/lib/calendar/tick.ts` (or similar) with pure functions taking `(now, watermark, offsetMinutes, booking)` → `{ due: boolean, targetMinute: string }`. This makes SCH-01/SCH-02's core logic unit-testable without mocking Supabase, and is the single biggest lever for good test coverage on this phase (see Validation Architecture below — there is currently *zero* test coverage on this route).

### Anti-Patterns to Avoid
- **Anchoring scan windows to `now`:** the root cause of SCH-01. Any window computed only from the current tick's wall-clock time cannot tolerate delay by definition.
- **Recording dedup keys from wall-clock dispatch time instead of the semantic due-moment:** breaks once catch-up scanning is introduced (two different real dispatch times could represent the same logical due-moment, or vice versa).
- **App-level mutexes/locks for idempotency:** this codebase consistently uses a DB unique constraint / insert-conflict-as-claim pattern (`scheduled_workflow_ticks`, `scheduled_opportunity_ticks`) instead of advisory locks or in-process locks — keep doing that; it's what survives multi-instance/serverless execution.
- **Widening the seed loader's org filter as a fix for SCH-04:** the fix belongs in *content* (remove/relocate Skleanings-specific YAML), not in loader logic, per the explicit Out-of-Scope note ("do NOT auto-mutate existing tenant workflows").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exactly-once dispatch under retries/overlap | A custom app-level lock/semaphore | Postgres unique constraint + insert-as-claim (already the pattern in `scheduled_workflow_ticks` / `scheduled_opportunity_ticks`) | DB-level atomicity survives process crashes, multi-instance deploys, and overlapping GH Actions runs; an app-level lock does not. |
| Cron transport | A new scheduler process, node-cron, BullMQ | GitHub Actions `schedule:` + `concurrency: { group, cancel-in-progress: false }` (already used by 6 other tick endpoints in this repo) | Established, zero-infra pattern; `cancel-in-progress: false` already prevents true overlapping runs at the GH Actions layer, and the DB constraint is the defense-in-depth backstop. |
| Constant-time secret comparison | Manual `===`/`!==` string compare (current bug surface) | `node:crypto`'s `timingSafeEqual`, already used in `src/app/api/automations/ghl-reengagement/run/route.ts` | Avoids timing side-channel; pattern already proven in this codebase. |

**Key insight:** every piece of infrastructure this phase needs (idempotency table pattern, secret-check pattern, watermark-style progress row pattern via `automation_schedules`) already exists somewhere in this codebase in a *correct* form. This phase is about propagating the correct pattern to the one place (`calendar-tick/route.ts`) that has the incorrect/incomplete version, not inventing new infrastructure.

## Runtime State Inventory

> Included because SCH-04 involves relocating/neutralizing seed content that has already been installed as live `workflows` rows for at least one real tenant (Skleanings), and CONTEXT.md explicitly warns against mutating existing tenant workflows.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (already-installed workflow rows) | The Skleanings org almost certainly already has `workflows` rows for `booking-confirmation` (slug) and possibly the `agendamento/**` set, installed via a prior `seed-org.ts` run or manual creation — these live in the `workflows`/`workflow_versions` tables, not in git. **Not verified in this research pass** (would require a live DB query scoped to the Skleanings org, which this research phase did not run against production). | Planner/executor must query `workflows` for the Skleanings org before editing seed YAML, to confirm whether editing `booking-confirmation.yaml`'s content will (a) only affect *future* new-org seeding (git-tracked seed file) or (b) also get pushed into Skleanings' existing installed workflow via a re-run of `scripts/load-workflow-seeds.ts` (which *updates* existing seed-managed rows, detected via `description` containing `'Platform-default'` — see `loadForOrg` in `scripts/load-workflow-seeds.ts`). Since CONTEXT.md forbids auto-mutating existing tenant workflows, the safe path is: edit the seed file's content, and explicitly do NOT run `npm run seed` / `workflows:load-seeds` against the Skleanings org as part of this phase's execution (that re-sync is out of scope; flag it for CAL-F01). |
| Live service config | None found — no external service (Twilio, Google Calendar, etc.) config embeds "Skleanings" by name for these workflows; the branding lives entirely in the YAML `body`/`subject` strings and in the hardcoded phone number `+18572280830` / `(508) 500-6625` inside the YAML content itself. | Code/content edit only (edit the YAML), no external service reconfiguration needed. |
| OS-registered state | None — this is not an OS-level rename; `.github/workflows/calendar-tick.yml` itself is generic and requires no change for SCH-04. | None. |
| Secrets/env vars | None — `CRON_SECRET` (touched for SCH-03) is unrelated to the SCH-04 content changes and does not reference "Skleanings" or any tenant name. | None. |
| Build artifacts | None — no compiled/installed artifact caches the seed YAML content; `scripts/load-workflow-seeds.ts` reads the files fresh from disk at run time. | None. |

**Explicit non-goal confirmed from CONTEXT.md:** existing tenant workflow rows (Skleanings' already-installed automations, however they got there) are out of scope to migrate or delete in this phase. This phase only needs to ensure that (1) the git-tracked seed content is tenant-neutral going forward, and (2) nothing in this phase's own execution (e.g., accidentally running the seed loader) pushes the *old* content out or the *new neutral* content into Skleanings' existing rows as a side effect.

## Common Pitfalls

### Pitfall 1: Fixing SCH-01 without also fixing the dedup key (SCH-02 regression)
**What goes wrong:** Widening the scan window to `(watermark, now]` without changing how `fired_minute` is computed means every booking caught in a multi-minute catch-up batch gets the *same* `fired_minute = now` value inserted into `scheduled_workflow_ticks`. That still satisfies uniqueness (different `booking_id` per row), so it won't cause double-fires in itself — but it silently breaks the *semantic* meaning of the dedup key (it no longer represents "this booking's due moment," just "whichever tick happened to catch it"), which will bite the next time someone needs to reason about or query dispatch history, and makes it easy to introduce a real double-fire later (e.g., if a booking's offset changes and the same real-world due moment gets scanned twice under two different `now`-anchored keys).
**Why it happens:** SCH-01 and SCH-02 look like separable requirements but share one data structure.
**How to avoid:** Change the dedup key to be derived from the booking + offset (the due moment), not from tick wall-clock time, as the first step of the SCH-01 fix, not an afterthought.
**Warning signs:** A test that runs the tick twice in a row with an artificially advanced `now` and asserts exactly one dispatch per booking regardless of how many wall-clock minutes the catch-up spans.

### Pitfall 2: Uncapped catch-up firing stale "starts in N minutes" content
**What goes wrong:** If the tick is down for hours (redeploy, outage) and then catches up, a naive `(watermark, now]` scan would dispatch a "your appointment starts in 5 minutes" SMS for a meeting that started 3 hours ago.
**Why it happens:** "Don't lose due bookings" (SCH-01) and "don't send nonsensical stale content" are in tension for time-sensitive reminder types specifically.
**How to avoid:** Cap the lookback window and/or add a guard that skips (with a logged/counted skip, not a silent drop) any `meeting.starts_in` candidate whose `start_at` is already in the past by dispatch time. `meeting.ended`-triggered content (e.g. review requests) doesn't need this guard the same way.
**Warning signs:** No test currently exercises "tick was down for N hours" — this must be a Wave 0 test to add.

### Pitfall 3: Reintroducing the SCH-04 bug via the bulk seed loader
**What goes wrong:** Even after `booking-confirmation.yaml` is neutralized, the 8 `agendamento/**` Skleanings-only YAMLs still exist in `supabase/seeds/workflows/`. Anyone who runs `npm run seed` (`scripts/load-workflow-seeds.ts`, which recurses into subdirectories, unlike `seed-org.ts`) against all orgs will push Skleanings-branded pipeline/nutrition/remarketing workflows to every tenant.
**Why it happens:** The two seed loaders have inconsistent directory-traversal behavior (`seed-org.ts` is flat/non-recursive; `load-workflow-seeds.ts` is recursive) — the current tenant-safety of `agendamento/**` is accidental, not designed.
**How to avoid:** Relocate the 8 Skleanings-only YAMLs entirely out of `supabase/seeds/workflows/` (e.g., to `.planning/workflows/examples/` alongside the existing example workflows referenced in `CLAUDE.md`/`WORKFLOWS.md` — that directory is already documented as "canonical patterns to copy," not a seeded/loaded path), so neither loader can reach them regardless of traversal behavior.
**Warning signs:** `npm run workflows:validate-all` and `npm run seed --dry-run` are the fastest way to confirm what a full loader run would touch before/after the fix — run both and diff.

### Pitfall 4: `WORKFLOWS.md` documents seed-loading as automatic on deploy — it is not
**What goes wrong:** `WORKFLOWS.md` line 87 states "On deploy, the seed loader inserts/upserts the workflows for every org," implying `npm run seed` is CI/CD-wired. It is not: `.github/workflows/build-deploy.yml` (the only push-to-main pipeline) never invokes it; the Dockerfile's `CMD` is just `node server.js`. This is stale/aspirational documentation, not actual current behavior.
**Why it matters for this phase:** Don't assume production tenants are constantly re-synced from `supabase/seeds/workflows/` — the seed files' current *installed* effect on any given org depends entirely on when someone last ran the script manually (or when that org was created via `seed-org.ts`, which has its own narrower, non-recursive path).
**How to avoid:** Treat "installed in the Skleanings org's `workflows` table" and "present in `supabase/seeds/workflows/`" as two independent facts that must each be checked, not inferred from each other.

## Code Examples

### Correct cron-secret pattern (copy this)
```typescript
// Source: src/app/api/cron/global-knowledge-notion/route.ts (this repo)
const cronSecret = process.env.CRON_SECRET
if (!cronSecret) {
  return Response.json({ ok: false, error: 'CRON_SECRET is not configured' }, { status: 503 })
}
if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
  return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}
```

### Constant-time variant (optional hardening, also already in-repo)
```typescript
// Source: src/app/api/automations/ghl-reengagement/run/route.ts (this repo)
import { timingSafeEqual } from 'node:crypto'

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(.+)$/)
  if (!m) return false
  const expected = process.env.GHL_REENGAGEMENT_TRIGGER_SECRET ?? ''
  if (!expected) return false
  const providedBuf = Buffer.from(m[1])
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}
```

### DB-backed progress/watermark pattern (existing precedent to mirror)
```sql
-- Source: supabase/migrations/033_automation_schedules.sql (this repo)
CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key     TEXT         NOT NULL UNIQUE,
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  next_run_at        TIMESTAMPTZ  NOT NULL,
  interval_minutes   INTEGER      NOT NULL CHECK (interval_minutes > 0),
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT         CHECK (last_run_status IN ('success','error','skipped')),
  last_run_result    JSONB,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```
Its consumer (`src/app/api/automations/ghl-reengagement/run/route.ts`) reads `next_run_at`/`last_run_at` before running and writes them back after — the same read-before/write-after shape the calendar-tick watermark needs, just keyed by event type instead of automation name and without the "not due yet" skip (calendar-tick already runs every 5 minutes unconditionally; only the *window* needs to become watermark-bounded, not the tick's own cadence).

### Existing per-item idempotency table (extend, don't replace)
```sql
-- Source: supabase/migrations/087_scheduled_workflow_ticks.sql (this repo)
CREATE TABLE IF NOT EXISTS public.scheduled_workflow_ticks (
  workflow_id  uuid        NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  booking_id   uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  event_type   text        NOT NULL,
  fired_minute timestamptz NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, booking_id, event_type, fired_minute)
);
```

### The SCH-04 offender, precisely (fix target)
```yaml
# Source: supabase/seeds/workflows/booking-confirmation.yaml (this repo, live platform default)
# Marked "# Platform-default workflow — ships to every org." yet hardcodes:
nodes:
  - id: tag_customer
    kind: contact_add_tag
    tag_name: customer            # SCH-04: business-assumption tagging
  - id: create_opportunity
    kind: pipeline_create_opportunity
    title: "Cleaning — {{meeting.attendee_contact.name}}"   # SCH-04: "Cleaning" hardcoded
    stage_name: Job Confirmed     # SCH-04: assumes a pipeline stage every tenant doesn't have
  - id: send_confirmation_email
    kind: send_tenant_email
    subject: "Your Skleanings appointment is confirmed!"     # SCH-04: literal tenant brand
    body: |
      <!-- Skleanings logo, (508) 500-6625, $120 minimum charge,
           "Secure pets in a separate room", hello@skleanings.com footer -->
```

### Genuinely tenant-neutral platform default (model to follow)
```yaml
# Source: supabase/seeds/workflows/pre-meeting-5min-reminder.yaml (this repo)
name: Pre-meeting reminder — 5 minutes
description: |
  Platform-default. Sends a 5-minute heads-up SMS to the meeting attendee
  with the dynamic meeting link.
trigger:
  type: event
  event: meeting.starts_in
  config:
    offset: "-5m"
nodes:
  - id: notify
    kind: send_sms
    integration: twilio
    to: "{{meeting.attendee_contact.phone}}"
    body: "Hi {{meeting.attendee_contact.name}}, your appointment starts in 5 minutes: {{meeting.link}}"
```

## State of the Art

| Old Approach | Current/Recommended Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Scan window = `[now, now + 1min)` (or `[now+offset, now+offset+1min)`), no persisted progress | Scan window = `(watermark, now]`, watermark persisted and advanced only after a successful pass | This phase (128) | Cron delay/skip no longer permanently loses due bookings — the exact SCH-01 fix. |
| Dedup key `fired_minute` = wall-clock tick time | Dedup key derived from the booking's offset-computed due moment | This phase (128) | Makes the idempotency key stable and correct under catch-up scanning — the exact SCH-02 fix. |
| `if (CRON_SECRET) { check }` (optional auth) | `if (!CRON_SECRET) return 503; if (mismatch) return 401` (mandatory auth) | This phase (128); pattern already exists elsewhere in repo (`global-knowledge-notion`) | Closes an unauthenticated-invocation gap — the exact SCH-03 fix. |
| `booking-confirmation.yaml` ships Skleanings branding/business-logic to every org | Neutral tag/opportunity/email content (or those nodes removed from the platform default entirely, left to per-tenant customization) | This phase (128) | New/other-tenant orgs stop receiving a competitor's brand and cleaning-specific business assumptions — the exact SCH-04 fix. |

**Deprecated/outdated:**
- Treating `supabase/seeds/workflows/`'s flat top-level files as "the only platform defaults" is no longer safe to assume — `scripts/load-workflow-seeds.ts` recurses into subdirectories, so anything anywhere under that tree is a latent platform-wide install, not just the top-level files.

## Open Questions

1. **How far back should catch-up scanning look, and should `meeting.starts_in` stale candidates be skipped vs. fired?**
   - What we know: SCH-01 requires not losing due bookings; the existing content for `-5m`/`-1h`/`-24h` reminders is time-sensitive ("starts in 5 minutes").
   - What's unclear: CONTEXT.md doesn't specify a lookback cap or a "skip if already started" rule.
   - Recommendation: Cap the lookback (a constant is fine, no new config surface needed) and skip-with-log any `meeting.starts_in` candidate whose `start_at` has already passed; let `meeting.ended`-based content fire regardless of lateness. Planner should make this an explicit, tested design decision rather than leaving it implicit.

2. **Where should the 8 `agendamento/**` Skleanings-only YAMLs go?**
   - What we know: they must leave `supabase/seeds/workflows/` (or become genuinely reachable-only-by-Skleanings, which the current directory structure does not enforce for the bulk loader).
   - What's unclear: delete outright vs. relocate to `.planning/workflows/examples/` (already documented in `CLAUDE.md`/`WORKFLOWS.md` as example/reference material) vs. some other non-loaded location.
   - Recommendation: relocate rather than delete — they're realistic, well-formed examples of wait-node/pipeline-condition workflows that have authoring value, and `.planning/workflows/examples/` is the existing, documented home for exactly that.

3. **Migration numbering coordination with Phase 127.**
   - What we know: migrations `1249`/`1250` are claimed by Phase 126; `1251` is the next free number as of this research pass.
   - What's unclear: Phase 127 (which this phase depends on and which may execute its own migrations first) could also claim `1251+` before Phase 128 executes.
   - Recommendation: the plan should not hardcode a migration number in prose; resolve the actual next-free number at execution time (re-check `supabase/migrations/` immediately before creating the file).

4. **`trigger.offset_minutes` is documented in the workflow spec but never populated at runtime — is fixing that in scope here?**
   - What we know: `src/lib/workflows/spec.ts` documents `trigger.offset_minutes` as an available variable for `meeting.starts_in`-triggered workflows. `emitCalendarEvent` (`src/lib/calendar/transition.ts`) builds `triggerInput = { meeting: scope, event: payload.event }` — it drops `payload.offset_minutes` entirely, so `{{trigger.offset_minutes}}` would always resolve empty in a workflow template. Confirmed the gap exists identically in both the sync engine (`run-flow-sync.ts`) and the durable engine (`flows/engine.ts`) — neither ever sets `trigger.offset_minutes`, only `trigger.fired_at`/`trigger.type`/`trigger.payload`.
   - What's unclear: this looks like it's squarely Phase 127's LIFE-04 ("Calendar workflow payloads expose documented meeting, event, and trigger-offset variables consistently") rather than this phase's job.
   - Recommendation: Phase 128's plan should not need this variable to implement SCH-01/02 (the offset can be read from `wf.trigger_config.offset` directly inside the tick route, as it already is). Flag for the planner to confirm Phase 127 closes this gap; if Phase 127 lands first (per the roadmap dependency), verify `trigger.offset_minutes` is populated before Phase 128 executes, but do not block on it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres (via `DATABASE_URL`) | Real-DB transactional tests (idempotency constraint, watermark table) | ✓ | Supabase-managed Postgres, project `mwklvkmggmsintqcqfvu` | — |
| GitHub Actions | Cron transport (`.github/workflows/calendar-tick.yml`) | ✓ (existing workflow file, `CRON_SECRET`/`SITE_URL` secrets already configured) | — | — |
| Coolify env (`CRON_SECRET`) | SCH-03 auth tightening | ✓ (confirmed provisioned via `coolify-set-envs.yml`) | — | — |

No missing dependencies. `.env.local` in this worktree points at the real production Supabase project (per `tests/calendar-overlap-constraint.test.ts`'s own comment) — any new real-DB test must follow that file's transaction+SAVEPOINT+rollback discipline and never commit.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `npx vitest run tests/<new-file>.test.ts` |
| Full suite command | `npm run test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCH-01 | A tick that runs late (or after a skipped tick) still dispatches bookings whose due-moment fell in the gap | unit (pure function: watermark-bounded window computation) | `npx vitest run tests/calendar-tick-window.test.ts` | ❌ Wave 0 |
| SCH-01 | Stale `meeting.starts_in` candidates (start_at already passed) are skipped, not dispatched, during catch-up | unit | `npx vitest run tests/calendar-tick-window.test.ts` | ❌ Wave 0 (same file as above) |
| SCH-02 | Two overlapping/duplicate ticks covering the same due-moment for the same (booking, workflow) dispatch exactly once | integration (real-DB, transaction-rollback pattern per `tests/calendar-overlap-constraint.test.ts`) | `npx vitest run tests/calendar-tick-idempotency.test.ts` | ❌ Wave 0 |
| SCH-02 | Idempotency key correctly derived from offset-based due-moment, not wall-clock tick time | unit | `npx vitest run tests/calendar-tick-window.test.ts` | ❌ Wave 0 (same file as above) |
| SCH-03 | Missing `CRON_SECRET` env → 503; wrong/absent Authorization header → 401; correct header → 200 | route-level unit (mocked Supabase, direct `GET` import, mirrors `tests/ghl-reengagement-route.test.ts`) | `npx vitest run tests/calendar-tick-route.test.ts` | ❌ Wave 0 |
| SCH-03 | Watermark persists across process restarts (i.e., is read from DB at tick start, not in-memory) | integration (real-DB) | `npx vitest run tests/calendar-tick-idempotency.test.ts` | ❌ Wave 0 (same file as above) |
| SCH-04 | `booking-confirmation.yaml` (and any other top-level seed) contains no literal "Skleanings"/tenant-specific brand strings | unit (parse YAML, assert content) | `npx vitest run tests/workflow-seeds-tenant-neutral.test.ts` | ❌ Wave 0 |
| SCH-04 | No file under `supabase/seeds/workflows/` (recursively, matching what `scripts/load-workflow-seeds.ts` actually walks) references Skleanings-specific content | unit | `npx vitest run tests/workflow-seeds-tenant-neutral.test.ts` | ❌ Wave 0 (same file as above) |
| SCH-04 | `npm run workflows:validate-all` still passes after removing/relocating the `agendamking/**` files (no dangling references) | smoke | `npm run workflows:validate-all` | ✓ (existing script) |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run <file>` for the file(s) touched.
- **Per wave merge:** `npm run test` (full suite) — this repo's suite includes real-DB tests gated on `DATABASE_URL`/`SUPABASE_DB_URL`, which are present in this worktree.
- **Phase gate:** `npm run build` (per `CLAUDE.md`: "Always run `npm run build` after changes to catch type errors before finishing") + `npm run test` + `npm run workflows:validate-all` all green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/calendar-tick-window.test.ts` — pure-function tests for the watermark-bounded window + offset-derived dedup key (requires extracting this logic out of `route.ts` into `src/lib/calendar/tick.ts` or similar first — see Architecture Pattern 3).
- [ ] `tests/calendar-tick-idempotency.test.ts` — real-DB test (transaction+SAVEPOINT+rollback pattern, mirror `tests/calendar-overlap-constraint.test.ts`) proving the new/extended unique constraint rejects duplicate dispatch for the same (booking, workflow, offset-derived due-moment), and proving watermark persistence.
- [ ] `tests/calendar-tick-route.test.ts` — route-level auth tests (mirror `tests/ghl-reengagement-route.test.ts`'s mock-Supabase + direct-handler-import pattern) for the SCH-03 secret behavior.
- [ ] `tests/workflow-seeds-tenant-neutral.test.ts` — new: parses every YAML under `supabase/seeds/workflows/**` (recursively) and asserts no Skleanings-specific strings/business assumptions remain, so this doesn't regress silently later.
- [ ] `src/lib/calendar/tick.ts` (or equivalent) — currently does not exist; the window/offset/dedup logic all lives inline in `route.ts` today. Extracting it is a prerequisite for meaningful unit testing (Wave 0 infrastructure, not just a test gap).

## Sources

### Primary (HIGH confidence — direct repo inspection in this worktree)
- `src/app/api/cron/calendar-tick/route.ts` — the scheduler under repair; read in full.
- `.github/workflows/calendar-tick.yml` — cron transport + documented known limitation.
- `supabase/migrations/087_scheduled_workflow_ticks.sql` — existing idempotency table.
- `supabase/migrations/1245_workflow_engine_hardening.sql` — existing hardening pattern for a sibling tick mechanism (opportunity ticks).
- `supabase/migrations/033_automation_schedules.sql` + `src/app/api/automations/ghl-reengagement/run/route.ts` — existing DB-backed progress/watermark + secret-auth reference implementation.
- `src/app/api/cron/global-knowledge-notion/route.ts` — correct secret-required pattern.
- `src/lib/calendar/transition.ts`, `src/lib/calendar/events.ts` — canonical dispatch path (Phase 127 territory, consumed here).
- `src/lib/workflows/seed-org.ts`, `scripts/load-workflow-seeds.ts` — the two seed loaders, confirmed to have different (accidental) directory-traversal behavior.
- `supabase/seeds/workflows/booking-confirmation.yaml` and all 8 files under `supabase/seeds/workflows/agendamento/**` — read in full or grepped precisely for SCH-04 offending content.
- `supabase/seeds/workflows/pre-meeting-5min-reminder.yaml` and other top-level seeds — confirmed genuinely tenant-neutral, used as the "good" model.
- `WORKFLOWS.md`, `.github/workflows/build-deploy.yml`, `Dockerfile` — cross-checked to confirm the seed loader is NOT actually wired into CI/CD (documentation is stale on this point).
- `tests/calendar-overlap-constraint.test.ts` — real-DB transaction-rollback test pattern to reuse for the new migration's constraint test.
- `tests/ghl-reengagement-route.test.ts` — route-handler-level auth test pattern to reuse.
- `tests/obs-alerts.test.ts` — pure-function extraction/test pattern to reuse.
- `src/lib/workflows/run-flow-sync.ts`, `src/lib/flows/engine.ts` — confirmed `trigger.offset_minutes` is documented but never populated (Open Question 4).
- `src/lib/workflows/spec.ts` — `meeting.starts_in` trigger spec (offset config schema, documented variables).
- `package.json` — confirmed no new dependencies needed; existing stack versions.
- `.env.local` (worktree) — confirmed real `DATABASE_URL` present for real-DB tests.
- `.planning/workstreams/calendar-reliability/{REQUIREMENTS,ROADMAP,STATE}.md`, `128-CONTEXT.md` — phase scope and locked decisions.

### Secondary / Tertiary
None used — all findings in this research were verified by direct inspection of the repository's own code, migrations, tests, and CI configuration rather than external documentation, since this phase is entirely internal business logic with no new third-party library surface.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all versions read directly from `package.json`.
- Architecture: HIGH — the exact bug, the exact correct-pattern precedents, and the exact SCH-04 offending files were all located and read directly in this codebase, not inferred.
- Pitfalls: HIGH — each pitfall traces to a specific, cited line of code or a specific cross-file inconsistency found during this research pass.
- Validation architecture: MEDIUM-HIGH — test file paths are recommendations (none exist yet), but the patterns they should follow (`tests/calendar-overlap-constraint.test.ts`, `tests/ghl-reengagement-route.test.ts`, `tests/obs-alerts.test.ts`) are all real, currently-passing examples in this repo.

**Research date:** 2026-07-15
**Valid until:** This is an internal-only, fast-moving phase (touches migrations 1251+ which may be claimed by a concurrently-planned Phase 127) — treat migration numbering as re-verify-at-execution-time regardless of date; the rest of the research (bug locations, patterns, SCH-04 offenders) is stable until this phase's code lands.
