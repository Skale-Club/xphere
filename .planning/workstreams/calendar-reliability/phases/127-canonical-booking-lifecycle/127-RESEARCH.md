# Phase 127: Canonical Booking Lifecycle - Research

**Researched:** 2026-07-15
**Domain:** Next.js/Supabase workflow-event dispatch, Postgres state-machine transitions, dual workflow-execution engines
**Confidence:** HIGH (every finding below is verified by reading this worktree's actual code and migrations; no claim about "what exists" rests on training-data assumptions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: One canonical transition service**
- A single module (e.g. `src/lib/calendar/lifecycle.ts`) owns booking status transitions. It validates the current→next transition against an explicit state machine, performs the write, and emits the corresponding calendar event only after the write succeeds.
- All writers (native `createBooking`/`cancelBookingByToken`, MCP booking tools, workflow actions, Xkedule inbound) are refactored to call it. No writer updates `bookings.status` directly anymore.

**D-02: Agreed state model**
- The booking data model and all callers must agree on supported states, including completion/"showed" semantics (migration 1224 added `showed`). The state machine must document every state and legal transition; illegal transitions return typed errors, never silent no-ops that still emit events.

**D-03: Event emission contract**
- Exactly one calendar event per successful transition (created/cancelled/rescheduled/completed/showed etc.). Emission happens after persistence, never before; failed writes emit nothing.
- Event payloads follow one documented shape (LIFE-04): meeting fields, event fields, and trigger-offset variables exposed consistently for workflow consumption.

**D-04: Compatibility**
- Do not change public API shapes or webhook contracts of existing endpoints; this is an internal unification. Xkedule mirror semantics (external_source rows) are preserved.

### Claude's Discretion
- Exact module layout, naming, and whether to use a transition table vs. switch-based guard.
- How to structure transactional persistence given Supabase client constraints (RPC vs. sequential writes with compensations) — pick the smallest reliable approach consistent with existing patterns.

### Deferred Ideas (OUT OF SCOPE)
- Provider synchronization details (Google/GHL) belong to Phase 129.
- Reminder scheduling belongs to Phase 128.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIFE-01 | Every booking status transition uses one canonical service with valid state guards, transactional persistence, and one matching calendar event. | `src/lib/calendar/transition.ts` already contains a state-guarded `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking` API (SEED-027 Phase B) — but it is **dead code**: nothing calls it except itself. Every real writer bypasses it and calls `.update()` directly, then separately (and inconsistently) calls the low-level `emitCalendarEvent`. See "Architecture Patterns" → Pattern 1 and "Current Writer Map". Transactional persistence should follow the existing `debit_copilot_credits`-style `plpgsql SECURITY DEFINER` RPC precedent (migration `1208_copilot_credits.sql`) — see "Architecture Patterns" → Pattern 2. |
| LIFE-02 | The booking data model and all callers agree on supported states, including completion/showed semantics. | Confirmed disagreement: DB CHECK (`1224_booking_status_showed.sql`) allows only `confirmed\|cancelled\|no_show\|showed`; `src/lib/flows/engine.ts` writes `status: 'completed' as 'confirmed'` (an **invalid** value that the DB constraint rejects at runtime) and separately defines `type BookingStatus = 'confirmed' \| 'cancelled' \| 'no_show' \| 'pending' \| 'completed'` (includes two values — `pending`, `completed` — that do not exist in the DB). A live seed workflow (`supabase/seeds/workflows/agendamento/pipeline/skleanings-post-service-review.yaml`) triggers on `event: meeting.completed`, which is **never emitted anywhere in the codebase** — this workflow is currently dead. See "Common Pitfalls" #1 and #2, "State of the Art". |
| LIFE-03 | Native booking, MCP, workflow actions, and Xkedule inbound updates trigger the same lifecycle contract without emitting events after failed writes. | Verified per-writer: MCP `bookings_cancel` updates status and emits **no event at all**. Xkedule webhook's update branch (`existing` row path) does not check the `.update()` error before firing `emitCalendarEvent` — violates "no events after failed writes" literally. `flows/engine.ts`'s `booking_confirm/cancel/reschedule/mark_no_show/mark_complete` action-node handlers **never call `emitCalendarEvent`** — the entire "workflow actions" writer category is currently silent (zero test coverage confirms this: no test file references these handlers). See "Architecture Patterns" → "Current Writer Map" and "Common Pitfalls" #3-#7. |
| LIFE-04 | Calendar workflow payloads expose documented meeting, event, and trigger-offset variables consistently. | `src/lib/calendar/scope.ts::buildMeetingScope` — the function that builds `{{meeting.*}}` — selects `event_types.name` (line 90), but `event_types` has no `name` column (only `title`, verified against `src/types/database.ts` lines 4914-4964 and every other `event_types` select in the codebase). This PostgREST query silently returns `{data: null}` on every call, so `meeting.title`, `meeting.event_type.name`, and `meeting.event_type.slug` are **wrong on every single calendar workflow trigger today** (always fall back to `'Meeting'`/`null`/`null`). `meeting.organizer.*` is hardcoded to `{user_id: null, name: null, email: null}` — never populated. See "Common Pitfalls" #8 and #9. |
</phase_requirements>

## Summary

This phase looks like it needs new infrastructure, but the infrastructure already exists and is unused. `src/lib/calendar/transition.ts` (SEED-027 Phase B, already in this worktree) is precisely the "canonical transition service" LIFE-01 asks for: `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking` each fetch current status, guard against illegal/duplicate transitions, write, and call `emitCalendarEvent` only after a successful write. The problem is that **every real writer in the codebase ignores these functions and only imports the low-level `emitCalendarEvent`**, re-implementing (inconsistently, and in several cases incorrectly) its own inline `.update()` + manual event-fire sequence. A grep across the whole `src/` tree confirms `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking` from `transition.ts` have **zero external callers** — they are dead code sitting next to the exact bug pattern they were built to prevent.

The four writer categories named in LIFE-03 are in four different states of correctness today:
1. **Native** (`src/app/(dashboard)/calendar/_actions/bookings.ts`): `createBooking`, `createBookingInternal`, `cancelBookingByToken`, dashboard `cancelBooking` all do inline `.update()`/`.insert()` + a manual `void emitCalendarEvent(...).catch(() => {})` call. `cancelBookingByToken` happens to be safe (its `UPDATE ... WHERE status='confirmed'` clause is atomic and only fires the event when a row was actually returned), but dashboard `cancelBooking` has no such guard — it always fires `meeting.cancelled` even if the booking was already cancelled or the id didn't match.
2. **MCP** (`src/lib/mcp/tools/bookings.ts`): `bookings_create` fires `meeting.confirmed` (not `meeting.scheduled`, unlike every other "created" writer — a semantic inconsistency). `bookings_cancel` updates status and fires **no event whatsoever**.
3. **Workflow actions**: there are **two separate, non-overlapping** action-node registries in this codebase — `src/lib/flows/engine.ts`'s inline switch (used only when a flow contains a `wait` node, via `runFlow`) and `src/lib/action-engine/execute-action.ts` (used by the wait-free synchronous engine, `src/lib/workflows/run-flow-sync.ts::runFlowSync`, and by MCP/agent tool calls). The `booking_confirm`/`booking_cancel`/`booking_reschedule`/`booking_mark_no_show`/`booking_mark_complete`/`booking_create`/`booking_get` action types exist **only** in `flows/engine.ts`'s switch — `execute-action.ts` has no case for any of them, so a wait-free workflow (the common case) referencing `booking_cancel` would throw an unhandled-action error at runtime. None of the seven `flows/engine.ts` booking handlers call `emitCalendarEvent`. The one booking-mutating action type that *is* registered in `execute-action.ts` (`update_booking_status`, delegating to `src/lib/action-engine/executors/update-booking-status.ts`) also never emits an event and performs no current-state guard at all — any status can transition to any other listed status.
4. **Xkedule inbound** (`src/app/api/xkedule/webhook/route.ts`): does call `emitCalendarEvent` on every request, but (a) does not check the `.update()` result on its "existing row" branch before firing the event, (b) its `mapStatus()` collapses Xkedule's own `completed` status into native `confirmed` (never `showed`), and (c) its `calendarEventFor()` falls back to `meeting.rescheduled` for any event/status combination it doesn't explicitly recognize, which is not always accurate.

On top of the emission-consistency gap, the **state vocabulary itself disagrees between files**: the DB CHECK constraint (migration `1224`) allows `confirmed | cancelled | no_show | showed`. `src/lib/flows/engine.ts` writes a `'completed'` status (not in the CHECK — this write throws a Postgres constraint violation at runtime today, an existing bug, not a hypothetical one) and separately declares a `BookingStatus` type including `pending` and `completed`, neither of which the DB recognizes. `workflows/spec.ts` documents `event:meeting.completed` as a triggerable event and a live seed workflow (`skleanings-post-service-review.yaml`) is wired to it — but no code path anywhere emits `meeting.completed`. Reconciling "showed" (the DB's actual vocabulary) against "completed" (the event/flows vocabulary) is the central LIFE-02 decision this phase must make explicit.

**Primary recommendation:** Do not build a new module from scratch. Rename/extend `src/lib/calendar/transition.ts` into the canonical `lifecycle.ts` this phase's decisions describe (or keep its name and location — CONTEXT.md leaves this to discretion), add the two missing transitions (`showed`, and reconcile it with the `meeting.completed` event name), wrap the guard+write step in a new `plpgsql SECURITY DEFINER` RPC modeled directly on the existing `debit_copilot_credits`/`credit_copilot_credits` pattern (migration `1208_copilot_credits.sql`) for atomicity, and then **delete every duplicated inline `.update()` call across all four writer categories**, replacing each with a call to the canonical service. Add the missing `booking_*` action-type registrations to `execute-action.ts` (or consolidate the two switches) so workflow actions work identically regardless of which engine runs them. Fix the `scope.ts` `event_types.name` → `title` bug as part of the same pass since LIFE-04 requires the payload to be correct, not just consistently shaped.

## Standard Stack

No new runtime dependencies. This phase is a refactor + one new Postgres RPC function using infrastructure already in `package.json`.

### Core (already installed, verified from this worktree)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | (existing) | All booking reads/writes | Already the only DB client in use; no ORM. |
| `next` | (existing, App Router) | Server actions / route handlers | Existing writer entry points (`bookings.ts`, `xkedule/webhook/route.ts`, `cron/calendar-tick/route.ts`) all stay in this shape. |
| `zod` | (existing) | Input validation | Already used for `createBookingSchema`, MCP tool input schemas. |
| `vitest` | ^4.1.2 | Test framework | Confirmed in `package.json`; `vitest.config.ts` reads `tests/**/*.test.ts(x)`, node env, `tests/setup/load-env.ts`. |
| `pg` | ^8.21.0 (dev) | Real-DB integration tests | Already used by `tests/contact-identity-trigger.test.ts` / phase 126's new `tests/calendar-overlap-constraint.test.ts` for `BEGIN/COMMIT`-sensitive constraint tests — reuse for any RPC-level state-guard test. |

### Supporting (Postgres function, not an npm package)
| Pattern | Precedent in this repo | Purpose |
|---------|------------------------|---------|
| `plpgsql SECURITY DEFINER` RPC callable via `supabase.rpc(...)` | `public.debit_copilot_credits` / `credit_copilot_credits` / `reset_copilot_credits` (migration `1208_copilot_credits.sql`, called from `src/lib/billing/credits.ts` via `supabase.rpc('debit_copilot_credits', {...})`) | The established in-repo pattern for "read current state + validate + write, atomically, in one round trip" — exactly the transactional-persistence requirement in D-01/LIFE-01's "Claude's Discretion" note. Supabase-js has no client-side multi-statement transaction API; this RPC pattern is how this codebase already solves that class of problem. |

### Alternatives Considered
| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| One `plpgsql` RPC doing guard+write+audit-insert atomically | Sequential JS calls: `SELECT status` → validate in TS → `UPDATE ... WHERE status = $expected` (optimistic-concurrency guard in the `WHERE` clause, like `cancelBookingByToken` already does) | Valid smaller alternative — no new migration needed, and `cancelBookingByToken`'s existing `.eq('status', 'confirmed')` pattern already proves this works for a single-transition case. Weaker than an RPC for a *general* state machine with 4+ current states and multiple legal target states each, because the "is this transition legal" logic would need per-transition WHERE clauses hand-maintained in TS rather than one table-driven guard. Reasonable fallback if the planner wants zero new migrations this phase. |
| RPC embeds workflow dispatch too (matching + `runFlow`/`runFlowSync` calls inside the SQL function) | Keep dispatch (workflow matching, `event_dispatches` insert, `runFlow`/`runFlowSync` calls) in TypeScript, call it only after the RPC confirms success | Workflow dispatch makes outbound calls into other JS engines (agent runtime, HTTP webhooks) — this cannot live inside a Postgres function. The existing `emitCalendarEvent` in `transition.ts` already does this correctly as a separate, later step; keep that shape, just gate the call on the RPC's success. |
| Extending `bookings_status_check` to add `'completed'` | Keep `'showed'` as the only DB terminal-attendance value and rename/repoint the `meeting.completed` event to fire on the `showed` transition | Both are viable; this is the LIFE-02 decision this phase must make. See "Open Questions" #1 for the evidence trail (a currently-dead seed workflow, a runtime-crashing status write) either choice must resolve. |

**Installation:** No `npm install` needed.

**Version verification:** `vitest` (^4.1.2) and `pg` (^8.21.0) read directly from this worktree's `package.json`; unchanged from Phase 126's research (same repo/branch lineage).

## Architecture Patterns

### Current Writer Map (as-is, verified by reading every call site)

```
┌─ NATIVE (src/app/(dashboard)/calendar/_actions/bookings.ts) ──────────────┐
│ createBooking            → INSERT status='confirmed' → emitCalendarEvent  │
│                             ('meeting.scheduled')                         │
│ createBookingInternal    → INSERT status='confirmed' → emitCalendarEvent  │
│                             ('meeting.scheduled')                         │
│ cancelBookingByToken     → UPDATE ...WHERE status='confirmed' (atomic     │
│                             guard) → emitCalendarEvent('meeting.cancelled')│
│                             only if a row was returned. SAFE.             │
│ cancelBooking (dashboard)→ UPDATE status='cancelled', no current-status   │
│                             guard, no rows-affected check → ALWAYS fires  │
│                             emitCalendarEvent('meeting.cancelled') even   │
│                             if booking was already cancelled or id        │
│                             didn't match. NOT idempotent, can double-fire.│
└─────────────────────────────────────────────────────────────────────────┘

┌─ MCP (src/lib/mcp/tools/bookings.ts) ──────────────────────────────────────┐
│ bookings_create → INSERT status='confirmed' → emitCalendarEvent           │
│                    ('meeting.confirmed' — NOT 'meeting.scheduled',        │
│                    inconsistent with every other "created" writer)        │
│ bookings_cancel → UPDATE status='cancelled' → NO EVENT EMITTED AT ALL     │
│ bookings_list / bookings_get → read-only, N/A                             │
└─────────────────────────────────────────────────────────────────────────┘

┌─ WORKFLOW ACTIONS — TWO SEPARATE, NON-OVERLAPPING DISPATCHERS ────────────┐
│                                                                             │
│ (a) src/lib/flows/engine.ts::executeFlowNode (durable engine, runFlow,    │
│     used ONLY when the flow definition contains a `wait` node):           │
│       booking_confirm       → UPDATE status='confirmed', NO EVENT         │
│       booking_cancel        → UPDATE status='cancelled', NO EVENT         │
│       booking_reschedule    → UPDATE start_at/end_at,     NO EVENT        │
│       booking_mark_no_show  → UPDATE status='no_show',    NO EVENT        │
│       booking_mark_complete → UPDATE status='completed'  ← INVALID VALUE, │
│           violates bookings_status_check, WILL THROW AT RUNTIME. NO EVENT.│
│       booking_create        → INSERT status='confirmed',  NO EVENT        │
│       booking_get           → read-only, N/A                              │
│     None of these 6 mutating handlers import or call emitCalendarEvent.   │
│                                                                             │
│ (b) src/lib/workflows/run-flow-sync.ts::runFlowSync (wait-free engine,    │
│     used for the common case — flows with no wait node — AND for MCP/     │
│     agent-tool-triggered flows) delegates every action node to            │
│     src/lib/action-engine/execute-action.ts::executeAction, which has NO  │
│     case for any booking_* type above. The only booking-mutating action   │
│     type registered there is:                                             │
│       update_booking_status → src/lib/action-engine/executors/            │
│         update-booking-status.ts: any listed status → any listed status,  │
│         ZERO current-state guard, ZERO event emission. Valid statuses     │
│         match the DB (confirmed/cancelled/no_show/showed) — this executor │
│         has the correct vocabulary, just no guard and no event.           │
│                                                                             │
│ Net effect: a workflow using booking_cancel only works if its definition  │
│ happens to also contain a wait node (forcing it onto the durable engine)  │
│ — otherwise executeAction has no matching case and the node throws.       │
└─────────────────────────────────────────────────────────────────────────┘

┌─ XKEDULE INBOUND (src/app/api/xkedule/webhook/route.ts) ──────────────────┐
│ New booking  → INSERT (error checked) → emitCalendarEvent (SAFE — only    │
│                 fires after a confirmed successful insert)                │
│ Existing row → UPDATE (error NOT checked/awaited-and-inspected) →         │
│                 emitCalendarEvent fires unconditionally. VIOLATES "no     │
│                 events after failed writes" literally on the update path.│
│ mapStatus(): Xkedule 'completed' → native 'confirmed' (never 'showed') —  │
│   loses attendance/completion signal for every Xkedule-sourced booking.   │
│ calendarEventFor(): falls back to 'meeting.rescheduled' for any           │
│   event/status combination not explicitly matched — not always accurate. │
└─────────────────────────────────────────────────────────────────────────┘

┌─ TIME-BASED (src/app/api/cron/calendar-tick/route.ts) — NOT a status     │
│ writer, but an emitCalendarEvent caller worth noting: queries             │
│ `.in('status', ['confirmed', 'completed', 'showed'])` for the             │
│ meeting.ended scan — 'completed' here can never match any row (invalid   │
│ DB value), so this filter is silently dead/no-op for that branch.        │
└─────────────────────────────────────────────────────────────────────────┘

┌─ DEAD CODE (src/lib/calendar/transition.ts) — THE ACTUAL CANONICAL       │
│ SERVICE, ALREADY BUILT, ALREADY TESTED (emitCalendarEvent only) BUT      │
│ NEVER CALLED for its guarded transition functions:                       │
│   confirmBooking   → idempotent guard (`status==='confirmed'` → no-op),  │
│                       optional Google Meet link creation, THEN emits     │
│                       'meeting.confirmed'. Zero external callers.        │
│   cancelBooking    → idempotent guard, THEN emits 'meeting.cancelled'.   │
│                       Zero external callers (name-collides with the      │
│                       unrelated, actually-used `cancelBooking` in        │
│                       bookings.ts — different function, different file). │
│   markNoShow       → idempotent guard, THEN emits 'meeting.no_show'.     │
│                       Zero external callers.                             │
│   rescheduleBooking→ writes new start_at/end_at, THEN emits              │
│                       'meeting.rescheduled' with rescheduled_from/to.    │
│                       Zero external callers.                             │
│ Confirmed via grep: only `emitCalendarEvent` is imported anywhere        │
│ outside this file. This is the single largest finding of this research — │
│ the canonical service LIFE-01 asks for already exists and only needs to  │
│ be (a) extended for the missing `showed` transition + RPC-backed atomic  │
│ writes, and (b) actually wired up as the only call path.                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Pattern 1: Extend the existing dead `transition.ts`, don't write a new module from scratch
**What:** `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking` in `src/lib/calendar/transition.ts` already implement the guard→write→emit shape LIFE-01 requires. Add a `markShowed` (or resolve the showed/completed naming question — see Open Questions #1) function following the identical shape, then make this module (renamed or not, per discretion) the *only* place any writer touches `bookings.status`.
**When to use:** Any status-transition writer — this is the target of the refactor for all four writer categories.
**Example (existing, correct shape to replicate for the missing transitions):**
```typescript
// Source: src/lib/calendar/transition.ts lines 271-296 (this repo, existing, currently unused)
export async function cancelBooking(
  ctx: TransitionContext,
  bookingId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: booking, error } = await ctx.supabase
    .from('bookings')
    .select('id, org_id, status')
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, error: error?.message ?? 'Booking not found' }
  if (booking.status === 'cancelled') return { ok: true }   // idempotent guard

  await ctx.supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus })
    .eq('id', bookingId)

  await emitCalendarEvent(ctx, {
    event: 'meeting.cancelled',
    booking_id: bookingId,
    org_id: booking.org_id as string,
  })

  return { ok: true }
}
```
This is not yet transactional (the SELECT and UPDATE are two round trips — a race is possible under concurrent transitions on the same booking), which is exactly what Pattern 2's RPC closes.

### Pattern 2: Atomic guard+write via `plpgsql SECURITY DEFINER` RPC (transactional persistence, LIFE-01)
**What:** A single Postgres function that does the "read current status → validate legal transition → write → insert audit row" sequence inside one implicit transaction, callable via `supabase.rpc(...)`. This closes the race Pattern 1's two-round-trip version has, and matches D-01/LIFE-01's "transactional persistence" requirement without introducing a new dependency.
**When to use:** The write step inside the canonical lifecycle service. Workflow-dispatch (matching + `runFlow`/`runFlowSync`) stays in TypeScript, called only after the RPC returns success — dispatch makes outbound calls to other engines and cannot live inside SQL.
**Example (precedent, already in this repo and proven at scale):**
```sql
-- Source: supabase/migrations/1208_copilot_credits.sql lines 76-91 (this repo, existing)
CREATE OR REPLACE FUNCTION public.debit_copilot_credits(
  p_org_id uuid,
  p_amount_usd numeric,
  p_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inc numeric;
  ...
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd < 0 THEN
    RAISE EXCEPTION 'debit amount must be >= 0';
  END IF;
  -- ... single-transaction read+validate+write ...
END;
$$;
```
```typescript
// Source: src/lib/billing/credits.ts line 201 (this repo, existing) — the calling
// convention the new booking-transition RPC should mirror:
const { data, error } = await supabase.rpc('debit_copilot_credits', {
  p_org_id: orgId,
  p_amount_usd: amount,
  p_run_id: runId,
})
```
A booking-transition analog (shape, not final code — planner's job): `public.transition_booking(p_booking_id uuid, p_expected_current text[], p_new_status text, p_org_id uuid) RETURNS jsonb` — validates `current_status = ANY(p_expected_current)`, raises a typed exception (or returns `{ok: false, error: 'illegal_transition'}`) otherwise, updates the row, and returns the org_id + old/new status for the caller to build the `emitCalendarEvent` payload from. Keep the exception/error-return convention consistent with `debit_copilot_credits`'s `RAISE EXCEPTION` style so the TS layer's try/catch handling stays uniform with the existing billing precedent.

### Pattern 3: Reconcile the two workflow-action dispatchers
**What:** `flows/engine.ts`'s switch (durable/wait engine) and `execute-action.ts`'s switch (wait-free engine, via `run-flow-sync.ts`) must both route booking mutations through the same canonical service, and ideally both recognize the same action-type names so a workflow's behavior does not depend on whether it happens to contain a `wait` node.
**When to use:** LIFE-03's "workflow actions" writer category is not satisfiable by editing only one of these two files — grep confirms `execute-action.ts` has no case for `booking_confirm/cancel/reschedule/mark_no_show/mark_complete/create`, and `flows/engine.ts`'s handlers are unreachable from the wait-free path entirely.
**Recommendation:** Register the missing `booking_*` action types in `execute-action.ts` too (delegating to the same canonical lifecycle service used everywhere else), so `runFlowSync` (wait-free, the common path, and the path MCP/agent tool calls use) gains parity with the durable engine. Alternatively, consolidate to one dispatcher — but that is a larger change than this phase's stated boundary ("internal unification," no public contract changes) suggests is warranted; the smaller fix (mirror the registrations) satisfies LIFE-03 without touching the dual-engine architecture itself.

### Anti-Patterns to Avoid
- **Emitting an event before confirming the write succeeded / affected a row:** the Xkedule webhook's update branch and dashboard `cancelBooking` both do this today. D-03 explicitly forbids it. The correct shape (already in this codebase) is `cancelBookingByToken`'s `UPDATE ... WHERE status = 'confirmed' RETURNING ...` — only fire the event if a row came back.
- **Re-implementing the state guard inline at each call site:** every current writer does its own ad hoc (or absent) status check instead of calling `transition.ts`'s existing guarded functions. This is precisely the anti-pattern LIFE-01 targets.
- **Writing a status value that is not in the DB's CHECK constraint:** `flows/engine.ts`'s `executeBookingMarkComplete` does exactly this (`status: 'completed' as 'confirmed'`, a type-assertion used specifically to silence the compiler around an invalid runtime value). Any new code must derive its allowed-status list from the single source of truth this phase establishes, not redeclare a local `BookingStatus` type per file (there are currently **three different, mutually inconsistent** local `BookingStatus` type declarations in this codebase: `transition.ts`, `flows/engine.ts`, `update-booking-status.ts`).
- **Selecting a column that doesn't exist and swallowing the resulting query error:** `scope.ts`'s `event_types.name` select is exactly this — the bug is invisible because the code destructures only `.data` and never checks `.error`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Atomic "check current state, then write" under concurrency | A new locking/retry scheme in TypeScript | `plpgsql SECURITY DEFINER` RPC (Pattern 2), following `debit_copilot_credits` | This codebase already solved this exact class of problem for billing; reuse the proven shape rather than inventing a new one for bookings. |
| Workflow matching + dispatch (finding active workflows whose `trigger_config` matches an event, loading their definition, running them via `runFlow`/`runFlowSync`, recording `event_dispatches`) | A new dispatch layer inside the canonical lifecycle service | `emitCalendarEvent` in `transition.ts`, unchanged | This is already correct and has dedicated test coverage (`tests/calendar/transition-dispatch.test.ts`, 8 passing tests covering matching, cascade-depth limiting, dispatch-audit recording, and fire-and-forget error handling). The lifecycle service should call it, not reimplement it. |
| A new "meeting variable" builder for workflow payloads | A second scope-building function | `buildMeetingScope` in `src/lib/calendar/scope.ts`, with the `event_types.name`→`title` bug fixed | The shape and every field this function returns (`starts_at_minus_24h`, `google_calendar_url`, `attendee_contact.*`, `location.*`, etc.) is exactly LIFE-04's "documented meeting variables" — it just has one real bug (wrong column name) and one unfinished stub (`organizer.*` always null) to fix, not a rewrite. |

**Key insight:** This phase's actual work is closer to "wire up and fix two already-correct-shaped modules" (`transition.ts`'s guarded functions, `scope.ts`'s variable builder) than "design a new system." The risk is in the volume of call sites to migrate (6+ distinct writer functions across 5 files) and in resolving the `showed`/`completed` vocabulary split, not in inventing new architecture.

## Common Pitfalls

### Pitfall 1: `flows/engine.ts` writes an invalid `bookings.status` value today
**What goes wrong:** `executeBookingMarkComplete` (`src/lib/flows/engine.ts` lines 619-646) does `.update({ status: 'completed' as 'confirmed', ... })`. The DB CHECK constraint (`bookings_status_check`, migration `1224`) only allows `confirmed | cancelled | no_show | showed`. This UPDATE will fail with a Postgres constraint-violation error every time this action node actually executes against a real database.
**Why it happens:** The `as 'confirmed'` cast exists specifically to silence TypeScript's structural check against the Supabase-generated `Update` type, which masked the mismatch at compile time.
**How to avoid:** The canonical lifecycle service's status-transition write must use a single shared status type/list (derived from the DB CHECK, not redeclared per file) so this class of bug cannot compile.
**Warning signs:** A workflow run marked `failed` with a Postgres error mentioning `bookings_status_check` in its `workflow_runs.error` column, for any org that has a `booking_mark_complete` action node in a wait-containing flow.

### Pitfall 2: The DB's `showed` and the workflow layer's `completed` are two different, disconnected vocabularies
**What goes wrong:** `1224_booking_status_showed.sql`'s own comment says `'showed'` is meant to be "set automatically 2 hours after end_at by the post-service mark-showed workflow" — but no such workflow exists in `supabase/seeds/workflows/`. Meanwhile, `workflows/spec.ts` documents `event:meeting.completed` ("A booking transitioned to completed") and a real seed workflow, `supabase/seeds/workflows/agendamento/pipeline/skleanings-post-service-review.yaml`, triggers on exactly that event to send a post-service review SMS 3 hours later. No code path in this repository ever calls `emitCalendarEvent` with `event: 'meeting.completed'` — this seed workflow cannot currently fire.
**Why it happens:** Two different SEED efforts (booking status vocabulary vs. calendar event vocabulary) were built without reconciling "showed" (attendance-oriented DB value) against "completed" (workflow-facing event name for the same real-world moment).
**How to avoid:** LIFE-02 requires this phase to resolve it explicitly. Two defensible resolutions: (a) treat `status: 'showed'` as the DB fact and have the canonical service emit `meeting.completed` when a booking transitions to `showed` (rename nothing, just document that `showed`↔`meeting.completed` is one transition with two names — the smaller change), or (b) rename the event to `meeting.showed` and update the seed workflow + spec.ts to match. Either way, document the decision in the new service's state-machine comments so future readers don't reintroduce the mismatch.
**Warning signs:** Any org relying on `skleanings-post-service-review.yaml` (or any future org-authored workflow triggering on `meeting.completed`) silently never receives it.

### Pitfall 3: MCP `bookings_cancel` cancels a booking and fires nothing
**What goes wrong:** `src/lib/mcp/tools/bookings.ts` lines 176-209 — the handler updates `status: 'cancelled'` (optionally appends a reason to `notes`) and returns `{ cancelled: true }`. It never imports or calls `emitCalendarEvent`. Any org relying on a "booking cancelled" workflow (SMS notice, opportunity update, etc.) gets nothing when the cancellation happens through an MCP client (Claude, ChatGPT, or any MCP-connected agent) rather than the public cancel page or dashboard.
**Why it happens:** `bookings_create` in the same file does correctly call `emitCalendarEvent` — this looks like an oversight specific to the cancel handler, not a deliberate design choice (there's no comment explaining an intentional omission, unlike other fire-and-forget patterns in the codebase which are always commented).
**How to avoid:** Route through the canonical service; this becomes automatic once `bookings_cancel`'s handler calls `cancelBooking()` from the lifecycle module instead of a bare `.update()`.
**Warning signs:** A booking's `status` is `'cancelled'` in the DB but `event_dispatches` has no matching `meeting.cancelled` row for that `booking_id`.

### Pitfall 4: Xkedule webhook can emit an event after a failed write
**What goes wrong:** `src/app/api/xkedule/webhook/route.ts` line 229: `await supabase.from('bookings').update(mutable).eq('id', existing.id)` — the returned `{data, error}` is discarded entirely (not even assigned to a variable). Execution falls through unconditionally to `emitCalendarEvent` at line 245. If the update fails (e.g., a future CHECK constraint addition, a transient network blip, an RLS policy change), the event still fires, describing a state change that never happened.
**Why it happens:** The insert branch two lines above (`if (error || !inserted) { ...; return ok(...) }`) does check its error — the update branch was written without the same guard, likely an oversight from treating "insert new row" and "update existing row" asymmetrically.
**How to avoid:** This is fixed for free once the update path routes through the canonical lifecycle service, which by construction (D-03) never emits after a failed write.
**Warning signs:** `event_dispatches` rows whose `payload.booking_id` doesn't match the actual current `bookings.status` for that id (a downstream workflow acted on stale/incorrect information).

### Pitfall 5: Xkedule's own `completed` status is lost, not mapped to `showed`
**What goes wrong:** `mapStatus()` in the Xkedule webhook (line 54-58) only distinguishes `cancelled` and `no_show` explicitly; every other incoming Xkedule status (including their own `completed`) maps to native `confirmed`. A booking Xkedule reports as fully completed/serviced stays `confirmed` in Xphere forever (or until manually changed), so `showed`-triggered workflows for Xkedule-sourced bookings can never fire.
**Why it happens:** The native `confirmed | cancelled | no_show` vocabulary predates the `showed` migration (`1224`); `mapStatus()` was never revisited after `showed` was added.
**How to avoid:** LIFE-03 explicitly names "Xkedule inbound" as a writer that must use the same contract — extending `mapStatus()` to recognize Xkedule's `completed` → native `showed` is in scope for this phase (not deferred to Phase 129, which per CONTEXT.md's Deferred Ideas covers only Google/GHL provider sync details).
**Warning signs:** Xkedule-sourced bookings never transition to `showed` in the dashboard/reporting views even when the appointment clearly happened and Xkedule's own system shows it complete.

### Pitfall 6: Dashboard `cancelBooking` can double-fire `meeting.cancelled`
**What goes wrong:** `src/app/(dashboard)/calendar/_actions/bookings.ts` lines 176-211 — `.update({status:'cancelled',...}).eq('id', id)` has no `.eq('status', 'confirmed')` guard and no check of rows-affected. If called twice on an already-cancelled booking (e.g., a double-click, or a race between the dashboard action and a separate cancellation path), the second call still succeeds (no-op UPDATE, no Postgres error) and still fires a second `meeting.cancelled` event.
**Why it happens:** Contrast with `cancelBookingByToken` in the same file, which correctly chains `.eq('status', 'confirmed')` and only proceeds past a `.single()` (which errors on zero rows) — the dashboard action was written without the same defensive pattern.
**How to avoid:** Route through the canonical service's idempotent guard (`transition.ts`'s existing `if (booking.status === 'cancelled') return { ok: true }` — with no event re-fire).
**Warning signs:** Duplicate `event_dispatches` rows with `event_type='meeting.cancelled'` for the same `booking_id`.

### Pitfall 7: `scope.ts` selects a non-existent `event_types.name` column — every meeting-scope payload is silently wrong
**What goes wrong:** `src/lib/calendar/scope.ts` line 90: `.from('event_types').select('id, name, slug, location_type, location_value').eq(...).single()`. `event_types` has no `name` column — verified against `src/types/database.ts` (Row type only has `title`) and every other `event_types` select in this codebase (`bookings.ts`, `booking-validation.ts`, `mcp/tools/event-types.ts` all select `title`). PostgREST returns an error for the unknown column; `.single()` on error returns `{ data: null }`; the calling code destructures only `.data`, never inspects `.error`. Net effect: `eventType` is `undefined` on **every single call** to `buildMeetingScope`, forever, in production today.
**Why it happens:** Likely a naming drift — `title` was the column name from the original `071_scheduling.sql` migration; `scope.ts` (SEED-027 Phase E) was written assuming `name`.
**How to avoid:** Change the select to `title` and read `eventType?.title` (matching every other call site in the codebase) instead of `eventType?.name`.
**Warning signs:** Every calendar workflow's SMS/email body that references `{{meeting.title}}` renders the literal fallback string `"Meeting"` instead of the actual event type name, and `{{meeting.event_type.slug}}`/`{{meeting.event_type.name}}` always render empty. This is directly checkable by inspecting any `workflow_runs.state` row for a `meeting.*`-triggered run — `meeting.title` will read `"Meeting"` regardless of the actual event type booked.

### Pitfall 8: `meeting.organizer.*` is a permanent stub
**What goes wrong:** `scope.ts` lines 168-172 hardcode `organizer: { user_id: null, name: null, email: null }` — this is never populated from the booking's actual organizer (`event_types.user_id`, resolvable the same way `booking-validation.ts` and the CAL-02 `organizer_user_id` column already do).
**Why it happens:** Appears to be an intentional placeholder from SEED-027 Phase E that was never completed.
**How to avoid:** LIFE-04 requires the payload to expose meeting variables "consistently" — an always-null `organizer` object is a documented-but-broken variable. Populate it from `event_types.user_id` (or the new `organizer_user_id` denormalized column migration 1249 added) + an `auth.users`/profile lookup for name/email, mirroring the existing `resolveHostName()` helper already in `bookings.ts`.
**Warning signs:** Any workflow referencing `{{meeting.organizer.name}}` or `{{meeting.organizer.email}}` (there is currently no such reference in any seed workflow, since it has never worked) renders empty.

## Runtime State Inventory

Not applicable — this phase refactors internal code call sites and adds one Postgres RPC function; it does not rename or rebrand any identifier that lives in external/stored state (no org/tenant renaming, no key renaming in third-party UIs). The one adjacent external-state concern found during research — Xkedule's own status vocabulary (`completed`) being silently collapsed by `mapStatus()` — is documented above as Pitfall 5 (a mapping-logic gap, not a stored-identifier rename) and is in scope for this phase per LIFE-03's explicit inclusion of "Xkedule inbound."

## Code Examples

### The existing, correct atomic-guard pattern to generalize (Pattern 2 candidate baseline)
```typescript
// Source: src/app/(dashboard)/calendar/_actions/bookings.ts lines 820-835 (this repo, existing, correct)
// cancelBookingByToken already does an atomic "guard in the WHERE clause" —
// this is the shape the new RPC should generalize to N states/transitions.
const { data, error } = await supabase
  .from('bookings')
  .update({ status: 'cancelled', updated_at: new Date().toISOString() })
  .eq('id', bookingId)
  .eq('cancel_token', cancelToken)
  .eq('status', 'confirmed')       // <-- the atomic guard: only matches if still confirmed
  .select('id, org_id')
  .single()

if (error || !data) return { ok: false, error: 'not_found_or_already_cancelled' }
// Event only fires below this line, only when a row was actually returned.
```

### The RPC precedent to model the new transition function on
```typescript
// Source: src/lib/billing/credits.ts line 201 (this repo, existing)
const { data, error } = await supabase.rpc('debit_copilot_credits', {
  p_org_id: orgId,
  p_amount_usd: amount,
  p_run_id: runId,
})
if (error) throw new Error(error.message)
```

### The three currently-inconsistent local `BookingStatus` type declarations (to be unified)
```typescript
// src/lib/calendar/transition.ts:22 — matches the DB (correct)
type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'showed'

// src/lib/action-engine/executors/update-booking-status.ts:4 — matches the DB (correct)
type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'showed'

// src/lib/flows/engine.ts:48 — does NOT match the DB (missing 'showed', has invalid
// 'pending' and 'completed')
type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'pending' | 'completed'
```

## State of the Art

| Old Approach (current code, verified) | Target Approach (this phase) | Why |
|--------------------------------------|-------------------------------|-----|
| Each writer inlines its own `.update()` + optional manual `emitCalendarEvent` call | Every writer calls one canonical `transition.ts`-based service function | LIFE-01/LIFE-03 |
| Three mutually-inconsistent local `BookingStatus` type declarations | One shared status type/list, derived once, imported everywhere | LIFE-02 |
| `flows/engine.ts` booking actions reachable only from the durable (wait-containing) engine; `execute-action.ts` has no booking_* cases besides `update_booking_status` | Both dispatchers route booking actions through the same canonical service; action types registered in both (or consolidated) | LIFE-03 |
| `meeting.completed` documented + seed-workflow-consumed but never emitted; `showed` exists in the DB with no matching event | Explicit, documented reconciliation between the DB's `showed` value and the `meeting.completed` (or renamed) event | LIFE-02 |
| `scope.ts` selects a non-existent `event_types.name` column, breaking `meeting.title`/`meeting.event_type.*` on every call | Selects `title` (matching the schema); `meeting.organizer.*` actually populated | LIFE-04 |
| Two-round-trip (SELECT then UPDATE) status guard in `transition.ts`, racy under concurrency | Single-round-trip `plpgsql SECURITY DEFINER` RPC, atomic | LIFE-01 ("transactional persistence") |

**Deprecated/outdated:**
- Ad hoc inline `.update({status: ...})` calls across `bookings.ts`, `mcp/tools/bookings.ts`, `flows/engine.ts`, `update-booking-status.ts`, and `xkedule/webhook/route.ts` — all superseded by the canonical service.

## Open Questions

1. **Should `'completed'` become a new DB status value, or should the `meeting.completed` event be repointed to the existing `showed` transition?**
   - What we know: The DB CHECK only allows `showed` (added by migration 1224, intended for exactly this "client was present" moment). The event/workflow layer (`spec.ts`, a live seed workflow) is wired to `meeting.completed`, which nothing emits. `flows/engine.ts` currently tries to write literal status `'completed'` and would fail against the DB today.
   - What's unclear: Whether any production org besides the Skleanings seed relies on the `meeting.completed` event name specifically (vs. it being safe to rename before any real org workflow references it in production — this worktree cannot query the live DB for `workflows` rows using this trigger).
   - Recommendation: The smaller, lower-risk resolution is (a) — keep `showed` as the only DB value, and have the canonical service emit `meeting.completed` as the *event name* when a booking transitions into `showed` (i.e., one DB status, one event, just named differently for historical reasons — document this explicitly in the lifecycle module's comments so it isn't "rediscovered" as a bug later). This avoids a status-value migration and keeps the already-authored seed workflow working unchanged. Flag this choice for the planner/operator to confirm before implementation, since it is not explicitly resolved in CONTEXT.md's locked decisions.

2. **Should the two workflow-action dispatchers (`flows/engine.ts` vs `execute-action.ts`) be consolidated, or just have their booking-action registrations mirrored?**
   - What we know: They already diverge beyond booking actions (they're fundamentally two different engines: durable/suspendable vs. synchronous/inline) — full consolidation is a larger architectural change than this phase's "internal unification, no public contract changes" framing suggests.
   - What's unclear: Whether a future phase already plans to unify these two engines (no roadmap phase in this milestone mentions it explicitly).
   - Recommendation: Mirror the registrations (add `booking_confirm`/`booking_cancel`/etc. to `execute-action.ts`, delegating to the same canonical lifecycle service `flows/engine.ts` calls) rather than merging the engines — smallest change that satisfies LIFE-03 for both dispatch paths.

3. **Does the canonical service need a full generic transition-table (state × event → allowed-next-states matrix), or is a per-transition guard function (mirroring `transition.ts`'s current shape) sufficient?**
   - What we know: CONTEXT.md's "Claude's Discretion" explicitly defers "transition table vs. switch-based guard" to the planner/implementer.
   - What's unclear: Whether `rescheduleBooking` (which changes `start_at`/`end_at`, not `status`) belongs in the same state machine as the status transitions, or is a parallel concern.
   - Recommendation: Given only 4-5 states and roughly a dozen legal transitions total, a small explicit per-transition function set (extending `transition.ts`'s existing style) is proportionate — a generic table adds indirection without a clear payoff at this scale. `rescheduleBooking` can stay a sibling function using the same RPC-guard pattern but validated against "is this booking still cancellable/reschedulable" rather than a status change.

## Environment Availability

Skipped — this phase has no new external service/tool dependencies. All work uses the existing Supabase Postgres instance and the existing Next.js/Vitest toolchain already verified in Phase 126's research.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (repo root) — `environment: 'node'`, `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`, `setupFiles: ['tests/setup/load-env.ts']`, `retry: 1` |
| Quick run command | `npx vitest run tests/calendar/transition-dispatch.test.ts tests/calendar-bookings.test.ts tests/mcp-bookings.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIFE-01 | `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking` (or their renamed equivalents) guard illegal transitions, are idempotent on duplicate calls, and emit exactly one event on success | unit (mocked Supabase, model on `tests/calendar/transition-dispatch.test.ts`'s chain-mock pattern) | `npx vitest run tests/calendar/lifecycle.test.ts` | ❌ Wave 0 — `transition.ts`'s guarded functions currently have zero test coverage (only `emitCalendarEvent` is tested) |
| LIFE-01 | The RPC-backed atomic write rejects a transition attempted from an unexpected current status (simulated concurrent write) | integration (real DB, `pg.Client`, model on `tests/calendar-overlap-constraint.test.ts`'s `BEGIN/COMMIT` pattern) | `npx vitest run tests/calendar-lifecycle-rpc.test.ts` | ❌ Wave 0 — depends on the new RPC's existence |
| LIFE-02 | Every status literal written anywhere in `src/` is a member of the single shared status list (no `'pending'`/`'completed'` string literals reach a `bookings.update`) | unit / static assertion (grep-based or type-level test) | `npx vitest run tests/calendar-status-vocabulary.test.ts` | ❌ Wave 0 — no such consistency check exists today; this is what would have caught Pitfall 1 pre-merge |
| LIFE-03 | `cancelBooking` (dashboard), `cancelBookingByToken`, `createBooking`, `createBookingInternal` route through the canonical service and emit the documented event exactly once (regression + new assertions) | unit (mocked Supabase) | `npx vitest run tests/calendar-bookings.test.ts` | ✅ Exists — extend, don't replace (currently exercises the pre-refactor inline-update shape) |
| LIFE-03 | MCP `bookings_create`/`bookings_cancel` both emit exactly one correctly-named event on success, none on failure | unit (mocked Supabase, model on existing `tests/mcp-bookings.test.ts`) | `npx vitest run tests/mcp-bookings.test.ts` | ✅ Exists for `bookings_create` only — `bookings_cancel` has no test today; extend this file |
| LIFE-03 | `flows/engine.ts`'s `booking_confirm/cancel/reschedule/mark_no_show/mark_complete` action nodes call the canonical service and emit events | unit (model on `tests/workflows/engine.test.ts`'s existing action-node test pattern) | `npx vitest run tests/workflows/engine.test.ts` | ❌ Wave 0 for booking-specific cases — file exists but has zero `booking_*` coverage today (confirmed via grep) |
| LIFE-03 | `execute-action.ts`'s newly-registered `booking_*` cases (Pattern 3) behave identically to the durable-engine versions | unit | `npx vitest run tests/action-engine-booking.test.ts` | ❌ Wave 0 |
| LIFE-03 | Xkedule webhook does not emit an event when the mirror-row update fails; `mapStatus` correctly maps Xkedule's `completed` → native `showed` | integration (mocked Supabase route-handler test, no precedent file exists for this route today) | `npx vitest run tests/xkedule-webhook.test.ts` | ❌ Wave 0 — no test file for `src/app/api/xkedule/webhook/route.ts` exists in this codebase at all |
| LIFE-04 | `buildMeetingScope` correctly populates `title`/`event_type.name`/`event_type.slug` from the real `event_types.title` column (regression guard for Pitfall 7) | unit (mocked Supabase) | `npx vitest run tests/calendar-scope.test.ts` | ❌ Wave 0 — no test file for `src/lib/calendar/scope.ts` exists today |
| LIFE-04 | `meeting.organizer.*` is populated (not permanently null) once fixed | unit | same file as above | ❌ Wave 0 (same file) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/calendar/transition-dispatch.test.ts tests/calendar-bookings.test.ts tests/mcp-bookings.test.ts tests/workflows/engine.test.ts` (fast, fully mocked — no live DB dependency, safe every commit)
- **Per wave merge:** add `tests/calendar-lifecycle-rpc.test.ts` and any other real-DB suites (requires `SUPABASE_DB_URL`/`DATABASE_URL` + service-role env vars, soft-skips without them per the existing pattern in `tests/contact-identity-trigger.test.ts`)
- **Phase gate:** Full suite (`npm test`) green before `/gsd:verify-work`, including real-DB suites not soft-skipped

### Wave 0 Gaps
- [ ] `tests/calendar/lifecycle.test.ts` — unit tests for the canonical service's guard/idempotency/event-emission behavior across all transitions (LIFE-01)
- [ ] `tests/calendar-lifecycle-rpc.test.ts` — real-DB test proving the RPC rejects an illegal/racing transition atomically (LIFE-01)
- [ ] `tests/calendar-status-vocabulary.test.ts` — consistency check that no status literal outside the shared list reaches a `bookings` write (LIFE-02; would have caught the existing `'completed'` bug)
- [ ] `tests/mcp-bookings.test.ts` — extend with `bookings_cancel` event-emission coverage (currently only `bookings_create` is tested) (LIFE-03)
- [ ] `tests/workflows/engine.test.ts` — extend with `booking_confirm/cancel/reschedule/mark_no_show/mark_complete` action-node coverage, currently absent (LIFE-03)
- [ ] `tests/action-engine-booking.test.ts` — coverage for the newly-registered `booking_*` cases in `execute-action.ts` (LIFE-03, Pattern 3)
- [ ] `tests/xkedule-webhook.test.ts` — first-ever test file for this route; must cover the no-event-on-failed-update case and the `completed`→`showed` mapping fix (LIFE-03)
- [ ] `tests/calendar-scope.test.ts` — first-ever test file for `buildMeetingScope`; must cover the `title` column fix and organizer population (LIFE-04)

## Sources

### Primary (HIGH confidence — read directly from this worktree)
- `src/lib/calendar/transition.ts` — full file read
- `src/lib/calendar/booking-validation.ts` — full file read
- `src/lib/calendar/events.ts` — full file read
- `src/lib/calendar/scope.ts` — full file read
- `src/app/(dashboard)/calendar/_actions/bookings.ts` — full file read
- `src/lib/mcp/tools/bookings.ts` — full file read
- `src/app/api/xkedule/webhook/route.ts` — full file read
- `src/app/api/cron/calendar-tick/route.ts` — full file read
- `src/lib/flows/engine.ts` (lines 1-70, 490-731) — read
- `src/lib/workflows/run-flow-sync.ts` — full file read
- `src/lib/action-engine/execute-action.ts` (lines 160-190) — read
- `src/lib/action-engine/executors/update-booking-status.ts` — full file read
- `src/lib/workflows/spec.ts` (lines 70-200, 640-760) — read
- `src/types/database.ts` (`event_types` Row/Insert/Update, `action_type` enum, `bookings` status literals) — read
- `supabase/migrations/1224_booking_status_showed.sql`, `1249_bookings_organizer_overlap_guard.sql`, `1208_copilot_credits.sql`, `071_scheduling.sql` (status CHECK) — read
- `supabase/seeds/workflows/agendamento/pipeline/skleanings-post-service-review.yaml` — read (confirmed dead `meeting.completed` trigger)
- `src/lib/billing/credits.ts` (RPC call site) — read
- `tests/calendar/transition-dispatch.test.ts`, `tests/mcp-bookings.test.ts`, `tests/calendar-bookings.test.ts` — read
- `tests/` directory listing (`tests/workflows/`, `tests/calendar/`) — confirmed absence of scope/xkedule/booking-action test files
- `vitest.config.ts`, `package.json` (vitest/pg versions) — read
- `.planning/config.json` (`workflow.nyquist_validation: true`) — read
- `.planning/workstreams/calendar-reliability/{REQUIREMENTS,ROADMAP,STATE}.md`, `phases/126-booking-trust-boundary/126-RESEARCH.md`, `phases/127-canonical-booking-lifecycle/127-CONTEXT.md` — read

### Secondary / Tertiary
None used — every finding in this document is verified directly against this worktree's code, migrations, and tests. No WebSearch or Context7 lookups were needed; this phase's domain is entirely internal-codebase reconciliation, not third-party library usage.

## Metadata

**Confidence breakdown:**
- Writer-map / dead-code findings (transition.ts unused, dual dispatchers, MCP cancel silent, Xkedule unchecked update): HIGH — every claim verified by grep + full file reads, not inferred.
- State-vocabulary mismatch (LIFE-02): HIGH — the invalid `'completed'` write and the dead `meeting.completed` seed workflow are directly observable in the code, not hypothetical.
- `scope.ts` column-name bug (LIFE-04): HIGH — cross-checked against `src/types/database.ts`'s generated schema and every other `event_types` select in the codebase; all agree the column is `title`, only `scope.ts` uses `name`.
- RPC/transactional-persistence recommendation: HIGH as precedent-identification (the `debit_copilot_credits` pattern exists and is proven), MEDIUM as a specific recommendation for this phase's exact RPC signature (left to planner/implementer discretion per CONTEXT.md).
- Open Question #1 (showed vs. completed resolution): flagged explicitly as unresolved — this document presents evidence and a recommendation, not a locked decision, since CONTEXT.md does not resolve it.

**Research date:** 2026-07-15
**Valid until:** ~2026-08-14 (30 days — this is an internal-code-only domain with no external dependency drift risk; the finding set is stable unless Phase 126's migrations 1249/1250 or unrelated concurrent work on `flows/engine.ts`/`bookings.ts` lands first — re-verify writer call sites if significant time has passed before planning starts)
