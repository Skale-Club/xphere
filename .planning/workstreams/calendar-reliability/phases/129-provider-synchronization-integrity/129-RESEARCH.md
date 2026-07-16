# Phase 129: Provider Synchronization Integrity - Research

**Researched:** 2026-07-15
**Domain:** Google Calendar API integration, Supabase multi-tenant RLS, provider-status mapping, canonical lifecycle conformance
**Confidence:** HIGH (every finding below is read directly from this worktree's code/migrations, not inferred from training data)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Google org ownership (SYNC-01)**
- Google calendar configuration rows must be explicitly owned by an organization (org_id column / scoping), not implicitly resolved. Access respects tenant isolation (RLS scoped to org member).
- Conflict-calendar selection made in settings must actually be honored by availability/busy computation (migration 1142 added conflict calendars — verify the selection is used end-to-end, fix if ignored).
- Bookings synced to Google must store the external Google event id on the booking (or a link table) so cancel/reschedule can propagate later (lifecycle synchronization foundation; full bidirectional reconciliation is CAL-F02, out of scope).

**D-02: Xkedule/GHL lifecycle conformance (SYNC-02)**
- Xkedule inbound updates and GHL booking paths must use the Phase 127 canonical lifecycle service — same transitions, same events, no direct status writes.
- Provider status semantics preserved: external/mirrored rows keep their provider-owned status vocabulary mapped explicitly to the canonical states; no silent coercion.

**D-03: Non-goals**
- No new providers. No full bidirectional Google edit/delete reconciliation (CAL-F02). No mutation of existing tenant workflows.

### Claude's Discretion
- Schema shape for external event identifiers (column vs. link table) — pick smallest compatible with existing google sync code.
- How to model org ownership migration for existing Google connection rows (backfill strategy).

### Deferred Ideas (OUT OF SCOPE)
- Full bidirectional Google event edit/delete reconciliation and missed-webhook reconciliation jobs (CAL-F02).
- UI coherence work (Phase 130).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Google calendar configuration has an explicit organization ownership model, honors selected conflict calendars, and stores external event identifiers for lifecycle synchronization. | Org ownership is **already correct** (see "Corrected Premise" below) — no migration needed there. The two real gaps are: (1) `conflict_calendar_ids` is stored but never read by `fetchBusyTimes` (see "Gap 1"); (2) `createCalendarEvent`'s returned Google event id is discarded at both call sites (see "Gap 2"). |
| SYNC-02 | Xkedule and GHL booking paths preserve provider status semantics and use the canonical lifecycle/event path. | Xkedule webhook (`/api/xkedule/webhook`) writes `bookings.status` directly and silently coerces `completed`→`confirmed` (see "Gap 3"). GHL has **no native-bookings-writing path today** — `create_appointment`/`get_availability` call GHL's own API directly and never touch `bookings` (see "GHL Reality Check"). The only GHL-adjacent writer of `bookings.status` is the generic `update_booking_status` workflow action, which also bypasses any lifecycle service. |
</phase_requirements>

## Summary

This phase sits downstream of Phase 127 (canonical lifecycle service), which has **not yet been executed in this worktree** — only `127-CONTEXT.md` exists; `git log` shows only Phase 126 commits applied so far (migrations up to `1250`). Critically, a lifecycle-shaped module (`src/lib/calendar/transition.ts`, "SEED-027 Phase B") **already exists and already does most of what Phase 127's D-01 describes** — it owns `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking`, writes the DB, and emits exactly one event after each write. Phase 127 will likely extend or rename this module rather than create a brand-new `lifecycle.ts` from scratch. **Phase 129's plan must not hard-code an assumed Phase 127 API shape** — it should reference "whichever module Phase 127 lands on" and verify at execution time, since Phase 127 hasn't been planned or built yet.

For SYNC-01, code inspection **corrects a premise in CONTEXT.md's D-01**: Google Calendar's org-ownership model is not "implicitly resolved" — the `integrations` table has had a `NOT NULL organization_id` column, org-scoped RLS (`get_current_org_id()`), and a `UNIQUE (organization_id, provider)` constraint since the foundational schema (migrations `002`, `009`). The dashboard already frames it correctly ("Fetch **the org's** Google Calendar integration", one connection per org, not per organizer). **No backfill migration is needed for org ownership** — this part of D-01 is already satisfied and the planner should not spend a task rebuilding it. The two things that genuinely are broken: (1) `conflict_calendar_ids` (migration `1142`, stored per-organizer on `calendar_profiles`) is set from the UI but **never read** anywhere `fetchBusyTimes` is called — busy-time computation is hardcoded to the `'primary'` calendar only; (2) both `createBooking` and `createBookingInternal` call `createCalendarEvent(...)` fire-and-forget and **discard the returned Google event id** — nothing persists it, so no future cancel/reschedule propagation is possible even though the requirement calls it "lifecycle synchronization foundation."

For SYNC-02, the Xkedule webhook route already exists and is close to correct in spirit (idempotent, last-write-wins, emits `meeting.*` events) but writes `bookings.status`/`.insert()`/`.update()` directly instead of calling a lifecycle service, and its `mapStatus()` function silently coerces Xkedule's `pending`/`awaiting_approval`/`completed` statuses all into `confirmed` — losing the distinction the native `showed` status (migration `1224`) exists specifically to capture. Its companion `calendarEventFor()` has a related bug: an Xkedule `completed` booking falls through every explicit branch and fires `meeting.rescheduled` — the wrong event — because status was already coerced away before this function runs. **GHL has no equivalent inbound path at all.** `src/lib/ghl/create-appointment.ts` and `get-availability.ts` are Vapi/workflow action-engine tools that call GHL's REST API directly and never read or write the native `bookings` table; there is no GHL webhook receiver that mirrors GHL appointment status back into `bookings` (unlike Xkedule's `/api/xkedule/webhook`). The planner needs an explicit scoping decision here (see "GHL Reality Check" and "Open Questions").

**Primary recommendation:** Scope SYNC-01 to two surgical fixes (multi-calendar busy-time fetch honoring `conflict_calendar_ids`; a new dedicated `bookings.google_event_id` column populated at both native booking-creation call sites) plus documentation of the already-correct org-ownership model. Scope SYNC-02 to (a) refactoring the Xkedule webhook to call into Phase 127's lifecycle service with an explicit, exhaustive Xkedule-status→canonical-transition map (no catch-all coercion), and (b) getting an explicit answer from the user/orchestrator on what "GHL booking paths" means given no such path currently writes to `bookings` — the safest default is routing the existing generic `update_booking_status` workflow action (the only write path any GHL-triggered automation could reach) through the lifecycle service, without inventing a new GHL calendar-sync feature.

## Standard Stack

No new runtime dependencies. This phase is Google Calendar API request shaping, one schema migration, and refactoring existing write paths — all using what's already installed and verified directly from this worktree's `package.json`.

### Core (already installed, verified versions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.6 | Server actions, route handlers | Already the app framework for every touched file. |
| `zod` | ^3.25.76 | Input validation | Already used in `bookings.ts`, MCP tools, xkedule webhook payload schema. |
| `date-fns` / `date-fns-tz` | ^4.1.0 / ^3.2.0 | Interval math, tenant-local↔UTC conversion | Already used by `google-calendar.ts` and the xkedule webhook (`fromZonedTime`). |
| `pg` | ^8.21.0 (devDependency) | Real-DB integration tests | Same `BEGIN/ROLLBACK`-in-transaction pattern already used by `tests/calendar-overlap-constraint.test.ts` / `tests/calendar-rls.test.ts` from Phase 126. |

### Supporting (already installed, existing crypto convention)
| Module | Purpose | Note |
|--------|---------|------|
| `src/lib/crypto.ts` (AES-256-GCM) | Encrypts Google OAuth tokens at rest in `integrations.encrypted_api_key` | Sensitive path per `CLAUDE.md` — **do not change the encryption format**. No changes needed for this phase; only read/decrypt paths (`getCalendarTokens`) are touched, and only to add multi-calendar support, not to alter token storage. |

**Installation:** No `npm install` needed.

**Version verification:** No new packages introduced; all versions above read directly from this worktree's `package.json`, not assumed from training data.

## Architecture Patterns

### Current Google Calendar Integration Architecture (as-is, verified by reading code)

```
Connect flow (one-time, per org, authenticated dashboard user)
  src/app/api/google/calendar-callback/route.ts
    → orgId = current active org (get_current_org_id() RPC)
    → integrations.upsert({ organization_id: orgId, provider: 'google_calendar', ... },
                            { onConflict: 'organization_id,provider' })
    → ONE row per org (UNIQUE (organization_id, provider) since migration 009).
    → Tokens AES-256-GCM encrypted via src/lib/crypto.ts before storage.

Token read / refresh (src/lib/calendar/google-calendar.ts::getCalendarTokens)
  → SELECT * FROM integrations WHERE organization_id = orgId AND provider = 'google_calendar'
  → Auto-refreshes if <60s TTL remaining, using GOOGLE_CALENDAR_CLIENT_ID/SECRET env vars.
  → NOTE: takes a `userId` parameter that is NEVER used in the query. This is
    consistent with the connection being org-wide (one shared Google account
    per org, not per-organizer) — confirmed by the dashboard's own comment
    ("Fetch the org's Google Calendar integration", src/app/(dashboard)/
    calendar/connections/page.tsx:13). Not a tenant-isolation bug, but a
    misleading/dead parameter worth a cleanup note (see Open Questions).

Busy-time fetch (src/lib/calendar/google-calendar.ts::fetchBusyTimes)
  → Calls Google's freeBusy API with items: [{ id: calendarId }], calendarId
    defaults to 'primary'. Callers NEVER pass anything else.
  → Called from 3 places, all hardcoded to the default:
      - src/lib/calendar/booking-validation.ts:174 (resolveAndValidateSlot — CAL-01/126)
      - src/app/(dashboard)/calendar/_actions/bookings.ts:334 (getAvailableSlots)
      - src/app/(dashboard)/calendar/_actions/bookings.ts:409 (getDebugSlots)
  → conflict_calendar_ids (calendar_profiles, per-organizer, set via
    src/components/calendar/conflict-calendars-dialog.tsx) is READ in the UI
    but never passed into any of the 3 call sites above. <-- SYNC-01 GAP 1

Event creation on booking (src/lib/calendar/google-calendar.ts::createCalendarEvent)
  → Called fire-and-forget from both native booking-creation paths:
      - src/app/(dashboard)/calendar/_actions/bookings.ts:556 (public createBooking)
      - src/app/(dashboard)/calendar/_actions/bookings.ts:765 (operator createBookingInternal)
  → Returns the created event's Google `id`. BOTH call sites do
    `await createCalendarEvent(...)` with the return value never assigned to
    anything — the id is discarded. <-- SYNC-01 GAP 2
  → Separately, transition.ts::confirmBooking DOES persist a google_event_id,
    but only for the unrelated google_meet flow (createMeetingLink, not
    createCalendarEvent), and it stores it by clobbering the ENTIRE
    location_data JSON column: `updatePayload.location_data =
    { google_event_id: result.google_event_id }` — this silently wipes any
    other location_data fields (e.g. a store_id) that existed before this
    write. This is additional evidence that location_data is the wrong
    place to add the new external-event-id storage (see Pattern 2).
```

### Corrected Premise: Google Org Ownership Is Already Explicit (SYNC-01, part 1)

D-01 in CONTEXT.md assumes Google config might be "implicitly resolved." Verified against every migration touching `integrations` (`002_action_engine.sql`, `009_unique_provider_per_org.sql`, `081_integration_health.sql`, `029_manychat_outbound.sql`) plus every write site (`src/app/api/google/calendar-callback/route.ts`, `src/app/(dashboard)/calendar/connections/page.tsx`):

- `integrations.organization_id` is `NOT NULL REFERENCES organizations(id)` since the table's creation (migration `002`).
- `UNIQUE (organization_id, provider)` has existed since migration `009` — a second Google connection for the same org overwrites (upsert), never duplicates or leaks cross-org.
- RLS policies (`integrations_select/insert/update/delete`) scope every authenticated-client operation to `organization_id = (SELECT get_current_org_id())`. Server-role reads (`getCalendarTokens`, `fetchBusyTimes`, `createCalendarEvent`) always pass an explicit, server-derived `orgId` (from `event_types.org_id` or the authenticated session's active org) — never an unvalidated client value.

**No backfill migration is required for org ownership.** The planner should treat this as verified-correct and spend the schema/migration budget on Gap 1 and Gap 2 instead. If the planner wants a defensive regression test, one asserting "an authenticated user of org A cannot read org B's `integrations` row for `google_calendar` via the authenticated client" is sufficient (see Validation Architecture) — no code or schema change is expected to make it pass, since it should already pass today.

### Pattern 1: Multi-calendar busy-time fetch honoring `conflict_calendar_ids` (SYNC-01 Gap 1)

**What:** Extend `fetchBusyTimes` to accept a list of calendar IDs (not just one), and have each of the 3 call sites look up the *organizer's* `calendar_profiles.conflict_calendar_ids` and pass it through, falling back to `['primary']` when empty.

**Why this shape:** Google's `freeBusy` endpoint already accepts multiple `items` in a single request (`{ items: [{id: 'primary'}, {id: 'cal2@group...'}] }`) and returns one `calendars[id].busy` array per requested calendar — no need for N sequential requests. This is a small, additive change to `fetchBusyTimes`'s signature.

**Example (shape, not final code — planner's job):**
```typescript
// Source: derived from src/lib/calendar/google-calendar.ts::fetchBusyTimes (existing)
export async function fetchBusyTimes(
  userId: string,
  orgId: string,
  timeMin: string,
  timeMax: string,
  calendarIds: string[] = ['primary'],   // <-- was: calendarId = 'primary' (single)
): Promise<BusyInterval[]> {
  const tokens = await getCalendarTokens(userId, orgId)
  if (!tokens) return []

  const body = { timeMin, timeMax, items: calendarIds.map((id) => ({ id })) }
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', { /* ... */ })
  const data = (await res.json()) as { calendars?: Record<string, { busy?: BusyInterval[] }> }

  // Merge busy intervals across all requested calendars.
  return calendarIds.flatMap((id) => data.calendars?.[id]?.busy ?? [])
}
```
Each call site then needs one extra lookup before calling `fetchBusyTimes`:
```typescript
// At each of the 3 call sites (booking-validation.ts, bookings.ts x2) — the
// organizer is always et.user_id (the event type's owner), already fetched.
const { data: hostProfile } = await supabase
  .from('calendar_profiles')
  .select('conflict_calendar_ids')
  .eq('user_id', et.user_id)
  .maybeSingle()
const calendarIds = hostProfile?.conflict_calendar_ids?.length
  ? hostProfile.conflict_calendar_ids
  : ['primary']
const busyTimes = await fetchBusyTimes(et.user_id, et.org_id, startAt.toISOString(), endAt.toISOString(), calendarIds)
```
**When to use:** All 3 existing `fetchBusyTimes` call sites (`booking-validation.ts`, `getAvailableSlots`, `getDebugSlots`) must be updated together — updating only one would make availability display (`getAvailableSlots`) and booking validation (`resolveAndValidateSlot`) disagree on what's "busy," reintroducing a race where a slot displayed as open then gets rejected (or worse, a slot the UI marks busy is actually bookable), which is exactly the kind of drift Phase 126's `resolveAndValidateSlot` was built to eliminate.

### Pattern 2: Dedicated `google_event_id` column (SYNC-01 Gap 2)

**What:** Add a new nullable column to `bookings`, e.g. `google_event_id TEXT`, populated from `createCalendarEvent`'s return value at both native call sites.

**Why not reuse `location_data` or `external_id`/`external_source`:**
- `location_data` is already overwritten wholesale by the unrelated `google_meet` flow in `transition.ts::confirmBooking` (see above) — proven unsafe as a shared bag for two independent concerns (meeting-location data vs. calendar-sync metadata). Storing a second, unrelated id inside the same JSON blob would either collide with that existing write or require both writers to merge-not-replace, which is more code than a column.
- `external_source`/`external_id`/`external_updated_at` (migration `1212`) have an established, different meaning: "this row is a **read-only mirror** of a booking that originated in an external system" (currently only Xkedule). A native booking that has ALSO been pushed to Google Calendar is the opposite direction — Xphere is the source of truth, Google is the mirror. Reusing the same columns would make `external_source IS NULL` (currently the signal Phase 126's CAL-02 exclusion constraint and the Xkedule double-booking exemption both rely on) ambiguous. **Do not repurpose these columns.**
- A dedicated column is the smallest compatible change per D-01's discretion note, requires no application-wide semantic redefinition, and is trivial to add to the two `.insert()`/fire-and-forget blocks that already exist.

**Example:**
```sql
-- New migration (number TBD — see Migration Numbering below)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;
```
```typescript
// Source: derived from src/app/(dashboard)/calendar/_actions/bookings.ts:553-568 (createBooking, existing)
try {
  const { createCalendarEvent } = await import('@/lib/calendar/google-calendar')
  const googleEventId = await createCalendarEvent(et.user_id, et.org_id, { /* ...unchanged... */ })
  if (googleEventId) {
    await supabase.from('bookings').update({ google_event_id: googleEventId }).eq('id', booking.id)
  }
} catch {
  // Non-fatal — booking already succeeded; Google sync failure must not roll it back.
}
```
Apply the identical pattern to `createBookingInternal` (line 765). **Do not** attempt to also backfill `google_event_id` for historical bookings — the id was never stored, so it cannot be recovered from Xphere's own data (Google's Events API could theoretically be searched by time range per organizer to reconstruct it, but that is speculative reconciliation work explicitly out of scope per D-03/CAL-F02). Document this as a known gap for pre-existing rows, not a migration task.

### Pattern 3: Xkedule status mapping through the canonical lifecycle service (SYNC-02)

**What:** Replace the Xkedule webhook's direct `.insert()`/`.update()` + hand-rolled `calendarEventFor()` with calls into whatever module Phase 127 delivers (currently `src/lib/calendar/transition.ts`'s `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking` — Phase 127 may add a `markShowed`/`markCompleted` equivalent, since none exists yet for the `showed` status added by migration `1224`).

**Current gap, concretely (read from `src/app/api/xkedule/webhook/route.ts:52-58`):**
```typescript
// Xkedule status (pending|awaiting_approval|confirmed|completed|cancelled|no_show)
// → native enum (confirmed|cancelled|no_show). Active states mirror as confirmed.
function mapStatus(s: string): 'confirmed' | 'cancelled' | 'no_show' {
  if (s === 'cancelled') return 'cancelled'
  if (s === 'no_show') return 'no_show'
  return 'confirmed'   // <-- 'pending', 'awaiting_approval', AND 'completed' ALL collapse here
}
```
`completed` (Xkedule's "client was serviced" state) silently becomes native `confirmed` — exactly the "silent coercion" D-02 forbids, and exactly the distinction the native `showed` status (migration `1224`) exists to capture. This also cascades into a second bug: `calendarEventFor()` (same file, lines 60-66) decides the emitted event from `(payload.event, status)`; since `status` was already coerced to `'confirmed'` and the Xkedule `event` string for a completion webhook won't match any of `booking.cancelled`/`booking.created`/`booking.confirmed`, the function falls through to its catch-all `return 'meeting.rescheduled'` — **a completed booking fires the wrong workflow event entirely.**

**Recommended shape (exhaustive map, typed, no catch-all fallback to a wrong state):**
```typescript
// Explicit, exhaustive — every Xkedule status must be named. Unknown statuses
// are an error to surface (log + skip), never silently coerced to a default.
type XkeduleStatus = 'pending' | 'awaiting_approval' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
const XKEDULE_STATUS_MAP: Record<XkeduleStatus, { transition: 'confirm' | 'cancel' | 'no_show' | 'complete' }> = {
  pending:            { transition: 'confirm' },   // native has no separate "pending" state; mirrors as confirmed (documented, not silent)
  awaiting_approval:  { transition: 'confirm' },
  confirmed:          { transition: 'confirm' },
  completed:          { transition: 'complete' },  // maps to native 'showed', NOT 'confirmed'
  cancelled:          { transition: 'cancel' },
  no_show:            { transition: 'no_show' },
}
```
The key fix for D-02 is not that every Xkedule status needs its own native value (native only has 4: `confirmed`/`cancelled`/`no_show`/`showed`) — it's that the mapping must be **exhaustive and documented**, and specifically that `completed` must not collapse into the same bucket as `pending`/`confirmed`. Then the webhook calls the lifecycle service's corresponding transition function (whichever one Phase 127 names for "mark showed/completed") instead of writing `status` directly and computing its own event name.

**When to use:** Any inbound provider webhook that maps a foreign status vocabulary onto the native one. This same pattern (explicit map, typed, no default-to-confirmed) should be the template if a future GHL/other provider webhook is ever built.

### GHL Reality Check (SYNC-02 — read this before scoping GHL work)

Verified by grep across `src/lib/ghl/` and `src/app/api/ghl/` (no GHL webhook route exists at all — only `/api/ghl/webhook` handles inbound **messages**, not appointments):

```
GHL outbound (Vapi/workflow-triggered, action-engine action_type):
  src/lib/ghl/create-appointment.ts::createAppointment
    → POST https://services.leadconnectorhq.com/calendars/events/appointments (GHL's own API)
    → Returns a string like "Appointment confirmed. ID: <ghl-id>" — this ID is
      never written anywhere in Xphere's database. No `bookings` row is
      created or updated.
  src/lib/ghl/get-availability.ts::getAvailability
    → GET .../calendars/{calendarId}/free-slots — read-only, GHL-side only.

GHL inbound webhook (src/lib/ghl/process-event.ts::processGhlEvent):
  → Handles ONLY `type === 'InboundMessage'` (SMS/WhatsApp text messages).
  → No appointment/booking event types are parsed or handled at all.
  → Never touches the `bookings` table.

Conclusion: there is no code path today where a GHL appointment status
change reaches the native `bookings` table, in either direction. This is
structurally different from Xkedule, which has a real inbound mirror
(/api/xkedule/webhook). "GHL booking paths preserve provider status
semantics" (SYNC-02) has no existing concrete implementation to refactor.
```

The one place a GHL-triggered automation *could* legitimately reach `bookings` is indirectly: a GHL-driven workflow action invoking the generic `update_booking_status` action type (`src/lib/action-engine/executors/update-booking-status.ts`), which writes `bookings.status` directly with no lifecycle-service call and no event emission at all — this executor is provider-agnostic (any workflow can invoke it, not GHL-specific), but it is the only real candidate write path a GHL automation could exercise. See "Open Questions" for how the planner should resolve this ambiguity — this research recommends confirming scope with the user/orchestrator rather than guessing.

### Anti-Patterns to Avoid
- **Writing `bookings.status` directly instead of calling the lifecycle service:** confirmed direct-write sites today are `cancelBookingByToken` (native), the Xkedule webhook's `.update(mutable)`, the MCP `bookings_cancel` tool, and `executeUpdateBookingStatus`. All of these are Phase 127's responsibility to convert (LIFE-03), but Phase 129 must not add a **new** direct-write site while wiring Xkedule through the lifecycle service — if Phase 127 hasn't landed yet when 129 executes, this phase should block on / coordinate with Phase 127 rather than duplicate lifecycle logic inline in the webhook.
- **Reusing `location_data` for the Google event id:** proven unsafe — see Pattern 2.
- **Silently defaulting an unrecognized provider status to `confirmed`:** exactly what `mapStatus()` does today and exactly what D-02 forbids. An unmapped/unknown Xkedule status should be logged and skipped (webhook still returns 200 per this repo's convention), not silently coerced.
- **Assuming Phase 127 will be named `lifecycle.ts`:** CONTEXT.md's own wording is `(e.g. src/lib/calendar/lifecycle.ts)` — a suggestion, not a commitment. `transition.ts` already exists and already implements 4 of the needed transitions. Verify the actual module Phase 127 produced before writing import paths into Phase 129's plan.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Multi-calendar busy-time merging | A custom loop issuing N sequential `freeBusy` requests | Google's `freeBusy` endpoint's native multi-`items` support (one request, `items: [{id}, {id}, ...]`) | Already how the endpoint is designed to be used; avoids N round-trips and N-times the rate-limit exposure per booking-validation call. |
| Status-vocabulary mapping | Ad-hoc if/else chains scattered per call site (the current `mapStatus`/`calendarEventFor` pattern) | One explicit `Record<ProviderStatus, CanonicalTransition>` map per provider, colocated with the webhook | Exhaustive TypeScript `Record` types force a compile error if a new provider status is added without a mapping decision — silent coercion becomes structurally impossible, not just avoided by convention. |
| Provider status transitions | Direct `bookings.update({status: ...})` calls duplicated per writer | Phase 127's canonical lifecycle service (whichever module it lands on) | This is the entire point of Phase 127 — Phase 129 is explicitly a *consumer* of that service, not a place to reimplement transition logic. |

**Key insight:** every piece of SYNC-01 is "the org-scoping is already right; two specific call-sites are missing a value they should be threading through" — not new architecture. SYNC-02's Xkedule half is "convert an existing correct-shaped webhook to call a service instead of writing directly," also not new architecture. SYNC-02's GHL half is the one place this phase may need a real scope decision, not just code changes — see Open Questions.

## Common Pitfalls

### Pitfall 1: Updating only `resolveAndValidateSlot`'s `fetchBusyTimes` call, missing `getAvailableSlots`/`getDebugSlots`
**What goes wrong:** If Pattern 1 (multi-calendar busy fetch) is applied only to the booking-creation validation path and not to the slot-display path (`getAvailableSlots`), the UI will keep offering slots that are actually busy on a conflict calendar, and the booking attempt will then fail validation — a confusing "slot disappeared" UX regression, and a functional regression versus today's (admittedly wrong, but at least *consistent*) behavior of ignoring conflict calendars everywhere.
**How to avoid:** Update all 3 call sites in the same task/commit; add a test that asserts `getAvailableSlots` and `resolveAndValidateSlot` agree on a slot's availability when a conflict calendar has a busy interval.

### Pitfall 2: Treating GHL as a drop-in parallel to Xkedule
**What goes wrong:** Planning a "GHL webhook, mirrored into `bookings`, same shape as `/api/xkedule/webhook`" without confirming this is actually wanted invents a new inbound integration surface (a new webhook route, new idempotency/ordering logic, new contact-matching logic) that D-03 arguably forbids ("No new providers" — GHL isn't new, but a brand-new bidirectional sync *capability* for it plausibly is, and is a materially bigger task than "wire an existing writer to the lifecycle service").
**Why it happens:** CONTEXT.md's D-02 groups "Xkedule and GHL" together with parallel language, which reads as if both already have an inbound mirror. Only Xkedule does.
**How to avoid:** Confirm with the user/orchestrator (see Open Questions) before committing to a specific GHL implementation shape. Default to the narrower reading: route the existing `update_booking_status` workflow action through the lifecycle service, since it's the only real write path any GHL-triggered automation reaches today.

### Pitfall 3: Assuming Phase 127's lifecycle service already exists with a stable API when writing this phase's plan
**What goes wrong:** This worktree currently has `git log` showing only Phase 126 commits; Phase 127 has a CONTEXT.md but no RESEARCH.md, PLAN.md, or code yet. A Phase 129 plan that imports `from '@/lib/calendar/lifecycle'` will break if Phase 127 instead extends `transition.ts` in place (which the existing module strongly suggests it will, given 4 of the needed transitions are already there).
**How to avoid:** The Phase 129 plan should treat "which module/function names Phase 127 actually produced" as a fact to verify at the start of Phase 129's own execution (read the merged Phase 127 code), not something to assume from this research. Flag this explicitly as a Wave 0 / task-0 verification step in the plan.

### Pitfall 4: Migration numbering collision
**What goes wrong:** This worktree's `supabase/migrations/` currently tops out at `1250` (Phase 126's `1249`/`1250`). Phase 127 and 128 will each likely add their own migrations before Phase 129 executes, consuming `1251`, `1252`, etc. A Phase 129 plan that hardcodes `1251_add_google_event_id.sql` will collide.
**How to avoid:** Per this repo's established convention (confirmed in Phase 126's own research and `CLAUDE.md`), the plan should name the migration descriptively but resolve the actual next-free number at execution time via Supabase MCP (`list_migrations`) or the live worktree's `supabase/migrations/` listing, not at research/planning time.

### Pitfall 5: `.env.local` in this worktree points at the **production** Supabase project
**What goes wrong:** `tests/calendar-rls.test.ts` (Phase 126) explicitly documents that this worktree's `.env.local` points at prod, and that migration `1250` is deliberately **not yet applied to production** (pending a manual operator checkpoint, Plan `126-06`). Any new real-DB test for this phase (e.g., asserting `integrations` RLS, or testing the new `google_event_id` column) must follow the same "wrap the whole suite in one Postgres transaction, apply migration DDL in-transaction, `ROLLBACK` in `afterAll`" pattern already used by `tests/calendar-overlap-constraint.test.ts` / `tests/calendar-rls.test.ts` — never assume a plain `supabase-js` client against `.env.local` is safe to mutate with in a test.
**Warning signs:** A test that "passes" in dev but the maintainer later discovers wrote real rows into the production `bookings` or `integrations` table.

## Code Examples

### The SYNC-01 Gap 1 evidence (conflict calendars stored, never read)
```typescript
// Source: src/app/(dashboard)/calendar/_actions/calendar-profile.ts (existing, stores per-organizer selection)
export async function updateSchedulingPreferences(input: {
  conflict_calendar_ids?: string[]
  // ...
}): Promise<ActionResult<void>> {
  // ... writes calendar_profiles.conflict_calendar_ids ...
}
```
```typescript
// Source: src/lib/calendar/booking-validation.ts:174-179 (existing — the only place
// fetchBusyTimes is called during actual booking validation)
const busyTimes = await fetchBusyTimes(
  et.user_id,
  et.org_id,
  startAt.toISOString(),
  endAt.toISOString(),
  // <-- no 5th argument; calendarId inside fetchBusyTimes defaults to 'primary'.
  //     conflict_calendar_ids is never fetched or passed here.
).catch(() => [])
```

### The SYNC-01 Gap 2 evidence (Google event id discarded)
```typescript
// Source: src/app/(dashboard)/calendar/_actions/bookings.ts:553-568 (createBooking, existing)
try {
  const { createCalendarEvent } = await import('@/lib/calendar/google-calendar')
  await createCalendarEvent(et.user_id, et.org_id, {   // <-- return value (event id) discarded
    summary: `${et.title} with ${parsed.data.booker_name}`,
    // ...
  })
} catch {
  // Non-fatal
}
```

### The SYNC-02 Xkedule direct-write evidence
```typescript
// Source: src/app/api/xkedule/webhook/route.ts:227-242 (existing)
let bookingId: string
if (existing) {
  await supabase.from('bookings').update(mutable).eq('id', existing.id)  // <-- direct write, no lifecycle service
  bookingId = existing.id
} else {
  const { data: inserted, error } = await supabase
    .from('bookings')
    .insert({ ...mutable, org_id: orgId, event_type_id: eventTypeId })
    // ...
}
// 8. Emit the calendar event manually, computed by calendarEventFor() —
//    a second, separate hand-rolled piece of "what event should fire" logic
//    that duplicates what a lifecycle service's transition functions already do.
void emitCalendarEvent({ supabase }, { event: calendarEventFor(payload.event, status), booking_id: bookingId, org_id: orgId })
```

## State of the Art

| Old Approach | Current Approach (this phase should produce) | When Changed | Impact |
|--------------|------------------------------------------------|---------------|--------|
| `fetchBusyTimes(..., calendarId = 'primary')` — single hardcoded calendar | `fetchBusyTimes(..., calendarIds = ['primary'])` — merges busy intervals across the organizer's configured `conflict_calendar_ids` | This phase (129) | Closes the SYNC-01 conflict-calendar gap; requires updating 3 call sites in lockstep (Pitfall 1). |
| `createCalendarEvent(...)` return value discarded | Return value persisted to a new `bookings.google_event_id` column | This phase (129) | Enables future cancel/reschedule propagation (CAL-F02, not built here — just the storage foundation). |
| Xkedule webhook writes `bookings.status` directly + hand-rolled `calendarEventFor()` | Xkedule webhook calls Phase 127's lifecycle service with an explicit, exhaustive status map | This phase (129), depends on Phase 127 | Fixes the `completed`→wrong-event bug; makes Xkedule conform to LIFE-01/LIFE-03's "one canonical service" invariant. |

**Deprecated/outdated:**
- `mapStatus()`'s catch-all `return 'confirmed'` in the Xkedule webhook — silently coerces `pending`/`awaiting_approval`/`completed` together; replace with the exhaustive map in Pattern 3.

## Open Questions

1. **What does "GHL booking paths" concretely mean, given no such path writes to `bookings` today?**
   - What we know: `src/lib/ghl/create-appointment.ts` and `get-availability.ts` talk directly to GHL's REST API and never touch the native `bookings` table. `src/lib/ghl/process-event.ts` only handles inbound text messages, not appointment/booking webhooks. There is no `/api/ghl/appointments`-style webhook route.
   - What's unclear: Whether SYNC-02's GHL clause (a) was written assuming a booking-mirror path exists that doesn't, (b) intends for this phase to build a new GHL→bookings inbound webhook (which would be a materially larger, arguably new-capability task bordering on D-03's "no new providers" non-goal), or (c) is adequately satisfied by routing the one generic write path a GHL automation could reach (`update_booking_status`) through the lifecycle service.
   - Recommendation: Surface this to the user/orchestrator before planning starts. This research's default recommendation is (c) — the narrowest reading consistent with "no new providers" and "no mutation of existing tenant workflows."

2. **What is Phase 127's actual delivered module/function shape?**
   - What we know: `src/lib/calendar/transition.ts` already exists with `confirmBooking`/`cancelBooking`/`markNoShow`/`rescheduleBooking`, each doing write-then-emit. Phase 127 has a CONTEXT.md but has not been researched, planned, or executed in this worktree yet.
   - What's unclear: Whether Phase 127 extends `transition.ts` in place, renames it, or adds a new `lifecycle.ts` that wraps/replaces it — and whether it adds a `markShowed`/`markCompleted` function (needed for the Xkedule `completed` status mapping in Pattern 3).
   - Recommendation: Phase 129's plan should include an explicit first step that reads the actual Phase 127 code as merged, rather than assuming any specific import path from this research.

3. **Should the `getCalendarTokens(userId, ...)` dead parameter be cleaned up?**
   - What we know: The parameter is accepted but never used in the query (the connection is org-wide, confirmed intentional by the dashboard's own UI copy).
   - What's unclear: Whether removing it is worth the diff noise for this phase, or should be left as a documented "reserved for future per-organizer connections" parameter.
   - Recommendation: Claude's discretion — a one-line doc comment (`// userId reserved; connection is currently org-wide`) is lower-risk than a signature change touching 4 call sites for zero functional benefit.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` | Token refresh, freeBusy/events API calls | ✓ (present in this worktree's `.env.local`) | — | Tests mock `fetchBusyTimes`/`createCalendarEvent` (see existing `tests/calendar-bookings.test.ts` `vi.mock` pattern) — no live Google API access needed for automated tests. |
| `DATABASE_URL` (or `SUPABASE_DB_URL`) | Real-DB integration tests (`pg.Client`, transaction-wrapped) | ✓ (present in this worktree's `.env.local` — **points at production**, see Pitfall 5) | — | None needed; existing soft-skip pattern (`describe.skip` when absent) already covers CI environments without it. |
| Google Calendar API (network) | `freeBusy`, `events` endpoints | Not verifiable from this session (no live network call attempted) | — | All existing tests mock this layer entirely; no phase-129 test should require live Google API reachability. |

**Missing dependencies with no fallback:** None identified.
**Missing dependencies with fallback:** None — all required env vars are present in this worktree.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (repo root) — `environment: 'node'`, `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`, `setupFiles: ['tests/setup/load-env.ts']` |
| Quick run command | `npx vitest run tests/calendar-bookings.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | `fetchBusyTimes` merges busy intervals across multiple `conflict_calendar_ids`, not just `'primary'` | unit (mocked `fetch`) | `npx vitest run tests/google-calendar-busy.test.ts` | ❌ Wave 0 — no test file for `google-calendar.ts` exists today |
| SYNC-01 | `resolveAndValidateSlot` and `getAvailableSlots` agree on availability when a conflict calendar has a busy interval (regression against Pitfall 1) | unit (mocked Supabase + mocked `fetchBusyTimes`) | `npx vitest run tests/calendar-bookings.test.ts tests/google-calendar-busy.test.ts` | Partial — extend existing `tests/calendar-bookings.test.ts` mocks |
| SYNC-01 | `createBooking`/`createBookingInternal` persist the Google event id returned by `createCalendarEvent` onto `bookings.google_event_id` | unit (mocked Supabase, assert the second `.update()` call) | `npx vitest run tests/calendar-bookings.test.ts` | ✅ File exists — extend, don't replace (mirrors the existing `vi.mock('@/lib/calendar/google-calendar', ...)` pattern) |
| SYNC-01 | An authenticated user of org A cannot read org B's `google_calendar` row in `integrations` (regression proving the "already correct" org-ownership finding) | integration (real DB, transaction-wrapped per Pitfall 5) | `npx vitest run tests/integrations-rls.test.ts` | ❌ Wave 0 — no RLS test exists for `integrations` specifically; model on `tests/calendar-rls.test.ts`'s in-transaction pattern |
| SYNC-02 | Xkedule webhook maps every documented Xkedule status (`pending`/`awaiting_approval`/`confirmed`/`completed`/`cancelled`/`no_show`) to an explicit canonical transition, with `completed` distinct from `confirmed` | unit (mocked Supabase, exercise the route handler directly) | `npx vitest run tests/xkedule-webhook.test.ts` | ❌ Wave 0 — no test file exists for `/api/xkedule/webhook` today |
| SYNC-02 | Xkedule webhook calls the lifecycle service (not a direct `.update()`) for status transitions | unit (mocked lifecycle module, assert it — not raw Supabase `.update` — is called) | same file | ❌ Wave 0 (same file as above) |
| SYNC-02 | GHL scope decision resolved and its corresponding write path (whichever the orchestrator confirms) tested | unit | TBD — depends on Open Question 1's resolution | ❌ Cannot pre-specify until scope is confirmed |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/calendar-bookings.test.ts tests/google-calendar-busy.test.ts tests/xkedule-webhook.test.ts` (fast, fully mocked — no live DB/network dependency)
- **Per wave merge:** add `npx vitest run tests/integrations-rls.test.ts` (requires `DATABASE_URL`/`SUPABASE_DB_URL`, soft-skips otherwise per the established pattern)
- **Phase gate:** Full suite (`npm test`) green before `/gsd:verify-work`, including the real-DB suite with env vars present locally (per Pitfall 5, never against a bare prod client outside a rolled-back transaction).

### Wave 0 Gaps
- [ ] `tests/google-calendar-busy.test.ts` — mocked-`fetch` unit test for `fetchBusyTimes`'s new multi-calendar-id support (SYNC-01)
- [ ] `tests/integrations-rls.test.ts` — real-DB, transaction-wrapped RLS regression test proving `integrations` org-scoping already works (SYNC-01, defensive regression, not a fix)
- [ ] `tests/xkedule-webhook.test.ts` — mocked-Supabase unit test for the webhook's status-mapping + lifecycle-service-call behavior (SYNC-02); no precedent test exists for this route today
- [ ] GHL test file — cannot be specified until Open Question 1 is resolved

## Sources

### Primary (HIGH confidence — read directly from this worktree)
- `src/lib/calendar/google-calendar.ts` — full file read
- `src/lib/calendar/transition.ts` — full file read
- `src/lib/calendar/booking-validation.ts` — full file read
- `src/lib/calendar/scope.ts`, `src/lib/calendar/events.ts` — full files read
- `src/app/(dashboard)/calendar/_actions/bookings.ts` — full file read (lines 300-816)
- `src/app/(dashboard)/calendar/_actions/calendar-profile.ts` — full file read
- `src/app/(dashboard)/calendar/_actions/google-events.ts` — full file read
- `src/app/(dashboard)/calendar/connections/page.tsx` — full file read
- `src/app/api/google/calendar-callback/route.ts` — full file read
- `src/app/api/xkedule/webhook/route.ts` — full file read
- `src/lib/ghl/create-appointment.ts`, `get-availability.ts`, `process-event.ts` — full files read
- `src/lib/action-engine/execute-action.ts` (relevant sections), `src/lib/action-engine/executors/update-booking-status.ts` — read
- `src/lib/mcp/tools/bookings.ts` — full file read (current worktree state, mid-Phase-126-02)
- `supabase/migrations/002_action_engine.sql`, `009_unique_provider_per_org.sql`, `1142_scheduling_conflict_calendars.sql`, `1200_xkedule_integration.sql`, `1202_rename_scheduling_to_calendar.sql`, `1212_xkedule_booking_mirror.sql`, `1224_booking_status_showed.sql`, `1249_bookings_organizer_overlap_guard.sql`, `1250_calendar_rls_least_privilege.sql` — read
- `src/types/database.ts` (bookings Row/Insert/Update types) — read
- `tests/calendar-bookings.test.ts`, `tests/calendar-rls.test.ts` — read (mocking + real-DB transaction patterns)
- `vitest.config.ts`, `package.json`, `.env.local.example` — read
- `.planning/workstreams/calendar-reliability/{REQUIREMENTS,ROADMAP}.md`, `phases/126-booking-trust-boundary/126-RESEARCH.md`, `phases/127-canonical-booking-lifecycle/127-CONTEXT.md`, `phases/129-provider-synchronization-integrity/129-CONTEXT.md` — read
- `git log --oneline` (this worktree) and `git status --short` — confirms Phase 126 complete, Phase 127 not yet started, migrations top out at `1250`

### Secondary (MEDIUM confidence)
- None — every finding in this document was verified against this repo's own code/migrations, not external sources. Google's `freeBusy` multi-`items` request shape (Pattern 1) reflects the Google Calendar API v3 contract as already exercised by the existing single-item call in this codebase; no external doc fetch was needed since the existing code already demonstrates the request/response shape.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; versions read directly from this worktree's `package.json`.
- SYNC-01 org-ownership finding (already correct): HIGH — verified against every migration that ever touched `integrations`, plus every read/write call site via grep.
- SYNC-01 conflict-calendar and event-id gaps: HIGH — both confirmed by reading the full call chain (UI → server action → `fetchBusyTimes`/`createCalendarEvent`) and finding zero references connecting them.
- SYNC-02 Xkedule findings: HIGH — the coercion bug and its downstream event-name bug are both directly traceable in the ~10-line functions that produce them.
- SYNC-02 GHL scope ambiguity: HIGH confidence that no current code path exists; MEDIUM confidence on what the *right* remediation is (genuinely a scope question for the user, not a code-reading question — flagged as Open Question 1, not asserted as fact).
- Phase 127 dependency risk: HIGH — directly observed via `git log` (no Phase 127 commits) and reading `transition.ts` (pre-existing lifecycle-shaped module that Phase 127 will likely build on).

**Research date:** 2026-07-15
**Valid until:** ~2026-07-22 (7 days, not 30 — this phase's research is unusually time-sensitive because it depends on Phase 127's not-yet-built output; re-verify the Phase 127 module shape and migration numbering immediately before planning/executing Phase 129, regardless of this date).
