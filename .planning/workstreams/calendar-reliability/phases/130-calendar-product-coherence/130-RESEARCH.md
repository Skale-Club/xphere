# Phase 130: Calendar Product Coherence - Research

**Researched:** 2026-07-15
**Domain:** Next.js 16 Server Components/Actions + Supabase read models, calendar/scheduling product surface audit
**Confidence:** HIGH (every finding below is a direct code/migration read from this worktree, not inference; grep-verified negative claims — e.g. "zero callers" — are cited with the grep evidence)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Correct scoped read models (SYNC-03)**
- Calendar scope/read models must return correct event-type and organizer data (no wrong joins/fallbacks), use bounded queries (pagination/limits — no unbounded selects that degrade at scale), and display all supported booking states consistently (including showed/completed semantics from Phase 127).

**D-02: Operational-or-removed controls (SYNC-04)**
- For each exposed-but-unfinished control (round-robin assignment, structured location kinds, anything else research identifies): decide per control — if it can be completed end-to-end with modest effort, complete it; otherwise REMOVE it from customer-facing configuration (hide/disable with data preserved). Default bias: remove rather than half-support. Document each decision.

**D-03: No regressions**
- UI changes must not break existing booking flows validated in Phases 126-129. `npm run build` green; existing tests keep passing.

### Claude's Discretion
- Per-control complete-vs-remove decisions, guided by the effort/robustness tradeoff and what Phases 126-129 already hardened.
- Pagination strategy for read models (cursor vs offset) consistent with existing dashboard patterns.

### Deferred Ideas (OUT OF SCOPE)
- New scheduling providers, workflow engine changes (out of scope for the milestone).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-03 | Calendar scope and read models return correct event-type and organizer data, use bounded queries, and display all supported states consistently. | See "Finding 1-6" below: unbounded `getBookings()`, `organizer` hardcoded null in `scope.ts`, wrong `event_types.name` vs `title` join in `contacts/actions.ts`, `'showed'` status invisible in `bookings/page.tsx`. |
| SYNC-04 | Round-robin and structured-location controls are either operational end-to-end or removed from customer-facing configuration. | See "Round-Robin Verdict" and "Structured Location Kinds — Per-Kind Verdict" below: round-robin has zero backing implementation (remove); location kinds are gated by one missing admin control plus per-kind gaps (mixed verdict, itemized). |
</phase_requirements>

## Summary

This phase inherits a calendar product surface that was built in layers (SEED-027 workflow scope, SEED-028 structured locations, migration 1139 round-robin, migration 1224 showed-status) without every layer's consumers being updated in lockstep. The three requirement areas resolve to concrete, narrow findings rather than open-ended exploration:

**SYNC-03** has one clear unbounded-query violator (`getBookings()` in `src/app/(dashboard)/calendar/_actions/bookings.ts`, used by both the flat bookings list and the full calendar view with no `.range()`/`.limit()`), one clear wrong-join bug (`contacts/actions.ts` selects `event_types(title)` but reads `.name` off the result, so the CRM contact panel's booking list never shows the real event type name), one clear "always-null" correctness bug (`scope.ts`'s `buildMeetingScope` hardcodes `organizer: { user_id: null, name: null, email: null }`, ignoring `event_types.user_id`), and one clear state-display gap (`bookings/page.tsx` buckets bookings into upcoming/past/cancelled by exact status match, so `status = 'showed'` — a real, actively-set status per migration 1224 and the `update-booking-status.ts` action-engine executor — falls through every bucket and disappears from the UI entirely).

**SYNC-04** resolves to a firm REMOVE verdict for round-robin (there is no team-member table, no rotation state, and no assignment-at-booking-time logic anywhere in the codebase — `booking_type: 'round_robin'` is a label with zero behavioral difference from `'personal'`), and a mixed, per-kind verdict for structured location kinds: the single root blocker is that `event-type-form.tsx` (the only admin UI for event types) never exposes `allowed_location_kinds` — it only sets the legacy 3-value `location_type` enum — so none of the 9 SEED-028 structured kinds are reachable from the dashboard today regardless of their individual backend readiness. Per-kind, `google_meet`'s link-generation code exists but is wired only into a transition function (`confirmBooking`) that is never called; `store_location` has an orphaned `default_store_location_id` column nothing reads; `zoom`/`whereby` have zero backend integration; the remaining kinds (`client_address`, `custom_address`, `phone_call`, `custom_phone`, `custom_link`) are fully wired downstream and only need the admin control. A fully separate, independently dead control was also found: `calendar_profiles.default_location_type`, persisted by the Settings → Calendar → Preferences page, that no booking-creation code path reads at all.

**Primary recommendation:** Fix the four SYNC-03 read-model bugs surgically (bounded query using this codebase's existing offset-pagination convention, one-line join fix, organizer hydration reusing the existing `resolveHostName` pattern, and a `'showed'`-aware bucket in the bookings list UI). For SYNC-04, remove the round-robin option from `new-event-type-dialog.tsx` and remove `default_location_type` from the Preferences UI (both zero-risk, zero-regression removals since neither has any behavioral wiring to disturb), and treat the location-kinds admin gap as the single highest-leverage completion: build one "allowed meeting locations" multi-select in `event-type-form.tsx` scoped to the kinds that are actually reachable (`custom_link`, `phone_call`/`custom_phone`, `client_address`, `custom_address`, plus `google_meet` if its dead-code wiring is also fixed in this phase), explicitly excluding `zoom`/`whereby` (no integration exists) and leaving `store_location` for the planner's effort-budget call (needs both a store picker and `location_data.store_id` wiring — the larger of the "complete" candidates).

## Standard Stack

No new runtime dependencies. This phase is server-action/read-model/UI-control work using what's already installed.

### Core (already installed, verified versions read from this worktree's `package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.6 | App Router Server Components/Actions | Already the framework for every file touched by this phase. |
| `zod` | ^3.25.76 (repo `package.json`; `npm view zod version` reports latest published is 4.4.3 — repo is intentionally pinned to v3, do not upgrade as part of this phase) | Input validation for server actions | Already used by every `_actions/*.ts` file in `src/app/(dashboard)/calendar/`. |
| `vitest` | ^4.1.2 | Test runner | Already the project's only test framework; no component-rendering library (`@testing-library/react`) is installed — see Validation Architecture. |
| `date-fns` / `date-fns-tz` | ^4.1.0 / ^3.2.0 | Date bucketing for bookings list sections | Already used throughout `src/lib/calendar/`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Offset pagination (`.range(from, to)` + zod `page`/`pageSize` + `count`) for `getBookings()` | Cursor-based pagination (`created_at`/`id` keyset) | Rejected: this codebase has an established, repeated offset-pagination convention (`src/app/(dashboard)/contacts/actions.ts`, `prospects/actions.ts`, `calls/actions.ts`, `companies/actions.ts`, `workflows/logs/actions.ts`, `integrations/manychat/event-actions.ts` — 6+ call sites, all `.range(from,to)`). Matching the existing pattern is lower-risk and more consistent than introducing a second pagination idiom for one more list. Cursor pagination would only be worth it if booking lists needed real-time infinite-scroll at very large scale, which is not this phase's bar. |
| Extending `event-type-form.tsx` with a new "allowed locations" multi-select | A separate settings page/dialog for location kinds | Rejected: `allowed_location_kinds` is a per-event-type column (migration 089), not an org-wide setting — it belongs on the event type form next to the existing `location_type` field, mirroring how `store-location-form.tsx` already lives inside Settings → Locations for the org-wide store list. |

**Installation:**
```bash
# No npm install needed.
```

**Version verification:** No new packages. `next@^16.2.6`, `zod@^3.25.76`, `vitest@^4.1.2` confirmed present via direct `package.json` read (not training-data assumption); `npm view zod version` confirms current published npm version is 4.4.3 but this repo is pinned to v3 intentionally — do not bump as part of this phase.

## Architecture Patterns

### Existing Offset-Pagination Pattern (mirror this for `getBookings()`)
**What:** Zod-validated `{ page, pageSize }` input, `.range(from, to)` on the Supabase query builder, `{ rows, total, page, pageSize }` return shape.
**When to use:** Any calendar list read model returning potentially-unbounded rows (the flat bookings list at minimum; the calendar week/month view should instead be date-range-bounded, see Pitfall 1 below).
**Example:**
```typescript
// Source: src/app/(dashboard)/contacts/actions.ts lines 173-197, 304-313 (this repo, existing, established pattern)
export interface ContactListResult {
  rows: ContactListRow[]
  total: number
  page: number
  pageSize: number
}

const parsed = contactListFiltersSchema.safeParse({ page: 1, pageSize: 25, ...filters })
// ...build query with filters...
const from = (f.page - 1) * f.pageSize
const to = from + f.pageSize - 1
query = query.range(from, to)
const { data, count, error } = await query
```

### Existing "resolve host name" pattern (reuse for organizer hydration)
**What:** `resolveHostName(userId)` already exists and correctly resolves a display name from `auth.users` metadata with graceful fallback to email, then to `'your host'`.
**When to use:** `buildMeetingScope`'s `organizer` field should call this same helper (or a variant returning `{ user_id, name, email }`) instead of hardcoding nulls.
**Example:**
```typescript
// Source: src/app/(dashboard)/calendar/_actions/bookings.ts lines 92-108 (this repo, existing, correct pattern)
async function resolveHostName(userId: string): Promise<string> {
  const svc = createServiceRoleClient()
  const { data } = await svc.auth.admin.getUserById(userId)
  const user = data?.user
  if (!user) return 'your host'
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const fullName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null
  if (fullName) return fullName
  return user.email ?? 'your host'
}
```
`scope.ts::buildMeetingScope` already fetches `event_types` (including `user_id` implicitly available via a join) — the fix is to select `event_types.user_id`, call `svc.auth.admin.getUserById(eventType.user_id)` (scope.ts already imports a `SupabaseClient<Database>`, not necessarily service-role — verify the caller passes a service-role client, since `auth.admin.getUserById` requires it), and populate `organizer.user_id/name/email` instead of leaving them null.

### Anti-Patterns to Avoid
- **Loading an entire table into the browser for client-side filtering:** `src/app/(dashboard)/calendar/calendar/page.tsx` calls `getBookings()` with no `from`/`to` even though the function already accepts them, then hands every booking ever created to the client-side `CalendarView` component, which itself does day/week/month navigation without re-fetching. This is the concrete unbounded-query instance SYNC-03 targets. The function's `from`/`to` params exist and are unused by this caller — the fix may be as small as passing a sensible window (e.g., current month ± padding) plus re-fetching on navigation past the loaded window, or a documented "load N months and re-fetch on scroll-out" strategy. This is left to the planner's discretion on exact UX (see Open Questions).
- **Silently swallowing a missing/renamed column instead of failing loudly:** `contacts/actions.ts`'s `event_types(title)` → `.name` mismatch (Finding 3 below) doesn't throw — Supabase/PostgREST returns `undefined` for a field that was never selected, and the calling code's `?? null` fallback hides it completely. This is why the bug shipped unnoticed. When fixing, prefer selecting the field under an explicit alias (`event_types(name:title)`) so the destructuring code and the query stay visibly in sync.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Bounded/paginated list queries | A custom cursor scheme or manual `LIMIT`/`OFFSET` string | The `.range(from, to)` + zod `page`/`pageSize` pattern already used 6+ times in this codebase | Consistency with every other dashboard list; PostgREST's `.range()` already returns `count` for free when `{ count: 'exact' }` (or `'estimated'`) is passed to `.select()`. |
| Organizer display name resolution | A new lookup against `profiles`/a denormalized name column | `resolveHostName()` (already exists, already handles the metadata-vs-email-vs-fallback chain) | Don't duplicate logic that's already correct and tested implicitly by the confirmation-email flow that already calls it. |
| Round-robin assignment | A new team-member/rotation table + fair-distribution algorithm, inside this phase | Nothing — this is out of "modest effort" scope per D-02's default-remove bias; genuinely building round-robin is a separate feature-sized effort (participant management UI, rotation-state persistence, assignment-at-booking-time logic, availability-merging across multiple organizers) | The existing `booking_type` column has zero behavioral wiring; there is nothing to "complete" cheaply — completing it properly is a new feature, not a bug fix. |
| Zoom/Whereby meeting link generation | A hand-rolled OAuth client + API integration for either provider, inside this phase | Nothing — remove from the exposed/selectable kind set | No existing OAuth app registration, token storage, or API client exists for either provider anywhere in the codebase (grep-confirmed) — this is provider-integration-sized work, explicitly the kind of thing D-02's "otherwise REMOVE" branch is for. |

**Key insight:** every "complete it" candidate in this phase should reuse a pattern or code path that already exists elsewhere in the calendar module (offset pagination, `resolveHostName`, the already-correct `createCalendarEvent` fire-and-forget call site, `resolveMeetingLocation`'s already-complete kind handling). Anywhere the fix would require inventing new infrastructure (round-robin, Zoom/Whereby), that's the signal to remove instead.

## SYNC-03 Findings (Read Models: Correctness, Bounded Queries, State Display)

### Finding 1: Unbounded query — `getBookings()`
**File:** `src/app/(dashboard)/calendar/_actions/bookings.ts:151-172`
```typescript
export async function getBookings(params: { status?: string; from?: string; to?: string } = {}) {
  ...
  let query = supabase.from('bookings').select('*').order('start_at', { ascending: true })
  if (params.status) query = query.eq('status', ...)
  if (params.from) query = query.gte('start_at', params.from)
  if (params.to) query = query.lte('start_at', params.to)
  const { data, error } = await query   // <-- no .range()/.limit() ever applied
  ...
}
```
**Callers:**
- `src/app/(dashboard)/calendar/bookings/page.tsx:15` — calls with **no params at all** (`getBookings()`), fetching every booking the org has ever had, every page load.
- `src/app/(dashboard)/calendar/calendar/page.tsx:21` — also calls with **no params**, even though it computes `weekStart`/`weekEnd` locally (lines 16-17) for the Google Calendar external-events fetch on the very next line — the `from`/`to` params on `getBookings()` are simply never passed. The full, unbounded result set is then handed to the client-side `CalendarView` component (`src/components/calendar/calendar-view.tsx`), which navigates day/week/month client-side without re-fetching.
- **Severity:** grows linearly with total historical booking count per org, not with what's visible on screen. This is the literal "unbounded selects that degrade at scale" SYNC-03 D-01 names.
- **Fix shape:** (a) for `/calendar/bookings`, add real offset pagination mirroring `contacts/actions.ts` (page/pageSize/count); (b) for `/calendar/calendar`, actually pass a bounded `from`/`to` window (the params already exist on the function signature) and decide a re-fetch strategy for month navigation — flagged as an Open Question below since it's a UX decision, not a pure bug fix.

### Finding 2: `status` field is typed as bare `string`, masking gaps
**File:** `src/app/(dashboard)/calendar/_actions/bookings.ts:142` — `BookingRow.status: string` (not a union of the 4 valid values). The `.eq('status', params.status as 'confirmed' | 'cancelled' | 'no_show')` cast on line 165 doesn't even include `'showed'` in its cast type, though this doesn't block passing it — it just means TypeScript can't catch a typo here. Recommend narrowing to the canonical status union once Phase 127 finalizes it (see "Cross-Reference to Phase 127" below) so downstream display code (Finding 4) gets compile-time exhaustiveness checking.

### Finding 3: Wrong join — `event_types.title` selected, `.name` read
**File:** `src/app/(dashboard)/contacts/actions.ts:476-481, 526-528`
```typescript
supabase
  .from('bookings')
  .select('id, booker_name, start_at, end_at, status, event_types(title)')   // selects `title`
  .eq('linked_contact_id', id)
  .order('start_at', { ascending: false })
  .limit(5),                                                                 // already bounded — fine
...
const bookingRows = (bookings ?? []).map((b) => {
  const et = b.event_types as { name?: string | null } | { name?: string | null }[] | null
  const eventName = Array.isArray(et) ? et[0]?.name ?? null : et?.name ?? null  // reads `.name` — wrong field
  return { ...
```
`event_types` has no `name` column (verified: `EventTypeRow.title: string` in `src/app/(dashboard)/calendar/_actions/event-types.ts:38`). `eventName` is therefore always `undefined`/`null`. **Consumer:** `src/components/chat/contact-info-panel.tsx:862` — `{b.event_type_name || 'Booking'}` — every booking in every contact's side panel shows the generic label "Booking" instead of the real event type title. This query is already `.limit(5)` — no pagination concern here, purely a wrong-join correctness bug.
**Fix:** either alias the select (`event_types(name:title)`) or change the extraction to `.title`. The alias approach is preferred (keeps the query and the destructuring visibly matched — see Anti-Patterns above).

### Finding 4 (CRITICAL): `'showed'` bookings vanish from the bookings list UI
**File:** `src/app/(dashboard)/calendar/bookings/page.tsx:18-25, 88-98`
```typescript
const upcoming = bookings.filter((b) => b.status === 'confirmed' && new Date(b.start_at) >= now)
const past = bookings.filter((b) => (b.status === 'confirmed' || b.status === 'no_show') && new Date(b.start_at) < now)
const cancelled = bookings.filter((b) => b.status === 'cancelled')
```
`'showed'` (migration `1224_booking_status_showed.sql`) matches **none** of these three predicates. A booking marked `'showed'` — which is a real, live-set status: `src/lib/action-engine/executors/update-booking-status.ts` and `src/lib/calendar/transition.ts` both treat it as a first-class `BookingStatus`, and `src/lib/workflows/spec.ts:752-759` documents a real workflow action example (`{ booking_id: '{{meeting.id}}', status: 'showed' }`) matching the migration's own comment ("set automatically 2 hours after end_at by the post-service mark-showed workflow") — simply disappears from every section. If an org's bookings are *all* `'showed'` (plausible once the mark-showed workflow has run for a while), the page shows **no** "No bookings yet" empty state either (since `bookings.length > 0` short-circuits that branch) and no section headers render (`upcoming.length > 0`/`past.length > 0`/`cancelled.length > 0` are all false) — the page renders a blank content area with zero explanation. The Badge color switch (lines 88-98) also has no `'showed'` case, so even where it might render it would use the default (unstyled) badge variant.
**Fix:** add `'showed'` to the "past" bucket (or a dedicated section), and add a badge color case for it.

### Finding 5: Inconsistent (not broken) 'showed' styling elsewhere
**File:** `src/components/chat/contact-info-panel.tsx:845-850` — handles `'cancelled'`/`'no_show'` explicitly, buckets everything else (including `'showed'` and `'confirmed'`) into the same green pill. Not a visibility bug like Finding 4, but inconsistent — worth aligning once a canonical status→display mapping exists (see Cross-Reference below).

### Finding 6: `organizer` always null in workflow variable scope
**File:** `src/lib/calendar/scope.ts:65-203` (`buildMeetingScope`), lines 168-172:
```typescript
organizer: {
  user_id: null,
  name: null,
  email: null,
},
```
The `MeetingScope` type (lines 35-39) declares `organizer.user_id/name/email` as real fields consumable via `{{meeting.organizer.*}}` in workflow templates, but they are unconditionally hardcoded to `null` — `event_types.user_id` (the actual organizer) is never even selected in this function's query (`scope.ts:70-80` selects booking columns only; the `event_types` join at lines 86-93 only selects `id, name, slug, location_type, location_value`, not `user_id`). Grep confirms no seed workflow or doc currently references `{{meeting.organizer` (so nothing is visibly broken in production today), but this is exactly the "organizer data...no wrong joins/fallbacks" defect SYNC-03 D-01 names, and it will silently produce empty organizer fields for any workflow template authored to use them going forward.
**Fix:** add `user_id` to the `event_types` select in `buildMeetingScope`, then hydrate via the same pattern as `resolveHostName` (Architecture Patterns above) — note `resolveHostName` requires a service-role client for `auth.admin.getUserById`; confirm/adjust `buildMeetingScope`'s caller passes one (it already accepts `SupabaseClient<Database>` generically — check call sites in `transition.ts`/`emails.ts` consumers to confirm service-role usage before reusing this exact helper, or inline an equivalent call).

### Cross-Reference to Phase 127 (do not duplicate — read-model display only, not writer-side vocabulary)
Status-vocabulary drift also exists on **write** paths, which is explicitly Phase 127's LIFE-02 scope ("The booking data model and all callers agree on supported states"), not Phase 130's:
- `src/lib/mcp/tools/bookings.ts:58` — `BookingStatus = z.enum(['confirmed', 'cancelled', 'no_show'])` — missing `'showed'` entirely.
- `src/lib/flows/engine.ts:48` — `type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'pending' | 'completed'` — declares `'pending'`/`'completed'`, neither of which is a legal DB value (the `bookings_status_check` constraint only allows `confirmed/cancelled/no_show/showed`).
- `src/app/api/cron/calendar-tick/route.ts:174` — `.in('status', ['confirmed', 'completed', 'showed'] as never)` — the `as never` cast is a red flag; `'completed'` is not a valid status so this filter branch silently never matches any row for that value (not a crash, but a dead filter term).

**Recommendation for the planner:** Phase 130 should treat Phase 127's eventual canonical status enum as the source of truth once it lands (Phase 130 depends on 127 per the roadmap) and make the *display*-layer fixes above (Findings 2, 4, 5) consume that vocabulary rather than re-deriving it. If Phase 127 has not yet finalized/shipped its canonical type when Phase 130 executes, treat `'confirmed' | 'cancelled' | 'no_show' | 'showed'` (the current DB constraint's actual 4 values, migration `1224`) as the ground truth for display-layer fixes and flag the `flows/engine.ts`/`calendar-tick` writer-side items as pre-existing, cross-phase issues rather than pulling them into this phase's diff.

### Incidental (out of core SYNC-03 scope, worth a one-line note to the planner)
`src/components/chat/contact-info-panel.tsx:854` links to `/calendar/bookings/${b.id}`, but no such route exists — `src/app/(dashboard)/calendar/bookings/` only has `page.tsx` (no `[id]/page.tsx`). This is a pre-existing dead link, not a read-model correctness issue; mention to the planner as an opportunistic fix, not a requirement.

## SYNC-04 Findings (Round-Robin and Structured Location Controls)

### Round-Robin — Verdict: REMOVE (dead control, zero backing implementation)
**Exposed via:** `src/components/calendar/new-event-type-dialog.tsx:15-38` — the "Choose event type" first step of event-type creation presents "Personal booking" vs "Round robin" as equal, fully-described options ("Distributes appointments among team members in a rotating order. E.g.: Sales calls, onboarding sessions.").
**Schema:** `event_types.booking_type TEXT CHECK (IN ('personal','round_robin')) DEFAULT 'personal'` (migration `1139_event_types_booking_type.sql`).
**Evidence of zero backing implementation** (grep for `round_robin`/`team_member`/`rotation` across `src/` and `supabase/migrations/` returns exactly 3 files, all pure plumbing — no team-membership table, no rotation-state table, no assignment logic):
- `src/types/database.ts` — type declarations only.
- `src/app/(dashboard)/calendar/_actions/event-types.ts:28,46` — the field is validated/stored, nothing else.
- `src/components/calendar/new-event-type-dialog.tsx` — the selector UI itself.
- **Every** booking-creation path (`createBooking`, `createBookingInternal`, `resolveAndValidateSlot`) resolves the organizer strictly via `event_types.user_id` — the single creator — with zero branching on `booking_type`. A `'round_robin'` event type behaves identically to a `'personal'` one in every code path today.
- `booking_type` is not even in `event-type-form.tsx`'s zod schema (`src/components/calendar/event-type-form.tsx:19-26`), so it cannot be changed after creation, and `event-type-card.tsx` never displays it — once created, the choice is invisible and frozen.
**Recommendation:** Remove the "Round robin" option from `new-event-type-dialog.tsx` (present "Personal booking" as the only/default choice — either drop the two-step chooser entirely or leave the dialog shape with one option). Leave the `booking_type` column and any existing `'round_robin'`-flagged rows untouched (D-02: "hide/disable with data preserved") — since behavior is already identical to `'personal'`, this is a zero-regression removal.

### Structured Location Kinds — Root Blocker (applies to all 9 SEED-028 kinds)
**File:** `src/components/calendar/event-type-form.tsx` (the only create/edit UI for event types) has a zod schema (lines 19-26) covering only `location_type: z.enum(['video','phone','in_person'])` — the legacy 3-value field from before migration 089. It has **no field at all** for `allowed_location_kinds` (the `text[]` column migration 089 added). Because `createEventType`'s insert (`event-types.ts:84-93`) spreads only the parsed form fields, `allowed_location_kinds` is never explicitly set on INSERT and always takes its DB default: `ARRAY['video']`. **This single gap is why none of the 9 structured kinds are reachable from the dashboard today**, independent of each kind's individual backend readiness (below).

### Structured Location Kinds — Per-Kind Verdict
| Kind | Downstream wiring status | Evidence | Verdict |
|------|--------------------------|----------|---------|
| `google_meet` | Link-generation code exists and is correct (`google-calendar.ts::createMeetingLink`, lines 137-230, uses Google Calendar `conferenceDataVersion=1` API) but is called **only** from `confirmBooking()` in `src/lib/calendar/transition.ts:201-269` — and `confirmBooking` has **zero callers anywhere in the codebase** (grep-confirmed). Both `createBooking` and `createBookingInternal` insert with `status: 'confirmed'` directly, never invoking this transition. | `transition.ts:220-254`; grep `confirmBooking\b` → only the definition, no call sites | **Complete it (modest effort)** — call the same meeting-link logic inline in `createBooking`/`createBookingInternal`, mirroring the already-present fire-and-forget `createCalendarEvent(...)` call a few lines below the insert in both functions. |
| `store_location` | `event_types.default_store_location_id` (migration 089) is set nowhere and read nowhere except its own type declaration (grep-confirmed zero non-type-def usages). No booking-creation path populates `bookings.location_data.store_id`, so `resolveMeetingLocation`'s `store_location` branch (`location-resolver.ts:115-144`) always falls to a bare "Store location" label with no address/coordinates/phone. | grep `store_id\|default_store_location_id` across `src/` → only `location-resolver.ts` (reads it, never populated) and `scope.ts` (reads it, never populated) and type defs | **Larger lift** — needs both an admin-side store picker (reusing the existing `tenant_locations` infrastructure already built for Settings → Locations) and wiring `location_data.store_id` at booking-insert time. Flagged for planner effort-budget judgment; borderline "modest effort." |
| `zoom`, `whereby` | Zero backend integration anywhere — no OAuth client, no API calls, no lib file. | grep for `zoom.us`/`whereby.com`, `find src/lib -iname "*zoom*" -o -iname "*whereby*"` → no results | **Remove from the exposed kind set** — do not include in whatever "allowed locations" admin control the plan builds. Leave the two `_location_kinds` lookup rows in place (dormant, no code impact) for potential future use. |
| `client_address`, `custom_address`, `phone_call`, `custom_phone`, `custom_link` | Fully wired downstream already: `resolveMeetingLocation` (`location-resolver.ts:146-213`) handles all five correctly, `booking-form.tsx`'s radio picker (lines 132-151) already renders labels for all of them, `emails.ts` (lines 170-256) already branches confirmation-email copy correctly across all of them. | Full file reads of `location-resolver.ts`, `booking-form.tsx`, `emails.ts` | **Cheapest full completion** — only needs the root-blocker admin control (above); no other code changes required. |
| `video`, `phone`, `in_person` (legacy aliases) | Already fully functional via the existing `location_type` field (the only kind currently settable by the form) — `resolveMeetingLocation`'s legacy branches (lines 214-251) project them into their modern equivalents. | — | No action needed; already working as designed. |

### Independently Dead Control — `calendar_profiles.default_location_type`
**Exposed via:** `src/components/calendar/meeting-preferences.tsx` (Settings → Calendar → Preferences page, `src/app/(dashboard)/calendar/preferences/page.tsx`), with UI copy per option including "Generate a Google Meet link automatically for each booking" for the `google_meet` choice.
**Schema:** `calendar_profiles.default_location_type` (migration `1141_scheduling_profile_prefs.sql`), values `'google_meet' | 'my_address' | 'client_address' | 'phone'` — note this is a **completely separate vocabulary** from `_location_kinds`/`allowed_location_kinds` (e.g., `'my_address'` has no equivalent in the structured-kinds lookup table at all).
**Evidence of dead wiring:** `updateSchedulingPreferences()` (`calendar-profile.ts:33-50`) persists the value; grep for `default_location_type` across `src/` returns exactly the 5 expected read/write plumbing sites (the action, its type decl, the component, the page, and the migration comment) — **zero booking-creation or availability code ever reads this column**.
**Recommendation:** REMOVE from the Preferences UI. This is not just unused — it is actively misleading (the UI copy promises automatic Google Meet link generation that never happens) and represents a second, conflicting "meeting location" model competing with the event-type-level one. Wiring it in would require reconciling two incompatible vocabularies and two different scopes (per-user preference vs. per-event-type field) — out of proportion to any value it adds; simple removal is the correct D-02 "default bias: remove" call.

## Common Pitfalls

### Pitfall 1: Calendar week/month view has no natural "page size" — bounding it is a UX decision, not just a query fix
**What goes wrong:** Unlike the flat bookings list (where offset pagination is a drop-in fix), the `/calendar/calendar` view's `CalendarView` component does client-side day/week/month navigation over whatever bookings were fetched at page-load time. Simply adding a `.range()`/`.limit()` to `getBookings()` without also bounding by date risks either (a) truncating the visible calendar arbitrarily (e.g., showing only the first 50 bookings chronologically, silently hiding future ones) or (b) requiring a client-side re-fetch-on-navigate flow that doesn't exist today.
**Why it happens:** `getBookings()` already accepts `from`/`to` params (unused by the calendar page today), suggesting date-bounding was the intended fix, but no re-fetch-on-navigate wiring exists in `CalendarView` to support fetching a new window when the user navigates outside the initially-loaded range.
**How to avoid:** Decide explicitly (planner's call, informed by this research): either (a) bound the initial load to a generous-but-finite window (e.g., ±3 months from today) and add a re-fetch trigger in `CalendarView` when navigation crosses that boundary, or (b) keep the initial full load but add a genuine cap (e.g., "last 500 bookings") as a stopgap with a follow-up ticket for real windowing. Do not ship a silent truncation that could hide a real future booking from the calendar view.
**Warning signs:** A booking that exists in the DB and matches the visible week/month doesn't render on the calendar.

### Pitfall 2: `contacts/actions.ts`'s wrong-join fix must not change the `bookings` query's existing `.limit(5)` bound
**What goes wrong:** It's tempting to "fix while you're in there" and touch the surrounding pagination too. This particular query is already correctly bounded (`.limit(5)`) — the only bug is the field-name mismatch (Finding 3). Keep the fix surgical.
**How to avoid:** Change only the select/mapping for the `event_types` join; leave `.limit(5)` untouched.

### Pitfall 3: `auth.admin.getUserById` (used by `resolveHostName`, needed for organizer hydration) requires a service-role client
**What goes wrong:** If the organizer-hydration fix in `scope.ts::buildMeetingScope` is added using whatever `SupabaseClient<Database>` was passed in by the caller (which could be an authenticated user-scoped client depending on call site), `auth.admin.getUserById` will fail — it's a service-role-only Supabase Admin API method.
**How to avoid:** Verify every call site of `buildMeetingScope` (in `transition.ts` and any workflow-dispatch code) passes a service-role client before reusing `resolveHostName`'s exact pattern; if any caller doesn't, either lift the client requirement or create a service-role client inline within the organizer-hydration branch (matching how `resolveHostName` itself does `createServiceRoleClient()` internally rather than trusting its caller's client).
**Warning signs:** A thrown/caught auth error when organizer hydration runs under a non-service-role caller — silently swallowed if not tested, since most of `buildMeetingScope`'s surrounding code already tolerates missing data via optional chaining.

### Pitfall 4: Removing the round-robin dialog option must not orphan existing `'round_robin'`-flagged event types
**What goes wrong:** If the fix deletes the `booking_type` column or force-migrates existing rows to `'personal'`, any org that already created a round-robin-labeled event type loses that (cosmetic, but user-visible-if-ever-shown) label, and any future re-introduction of real round-robin would need to re-derive which event types were originally intended as round-robin.
**How to avoid:** Only remove the *creation-time* UI option (the dialog step). Do not touch the column, its constraint, or existing row values — D-02 explicitly requires "hide/disable with data preserved."

## Environment Availability

No external tool/service dependencies beyond what's already configured for the calendar module (Supabase, and optionally a connected Google Calendar integration for the `google_meet` completion path — already required and already probed by Phase 129's research; this phase does not add a new dependency, it only decides whether to invoke code that already assumes Google Calendar connectivity is optional/best-effort, matching the existing `createCalendarEvent` fire-and-forget pattern). Skipping a formal Environment Availability table — this phase is code/config-only changes to an already-configured module, no new runtime dependency.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (repo root) — `environment: 'node'`, `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`, `setupFiles: ['tests/setup/load-env.ts']` |
| Quick run command | `npx vitest run tests/calendar-bookings.test.ts tests/calendar-slots.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

**Important gap:** no `@testing-library/react` (or equivalent) is installed in this repo (verified: absent from `package.json`). Every existing test in `tests/` is either a mocked-Supabase unit test against server actions/lib functions, or a real-DB `pg.Client` integration test — none render React components. This constrains how SYNC-03/04's UI-layer fixes can be automated: pure-function logic extracted out of components (e.g., a status-bucketing function, a badge-color-lookup function) can be unit tested; actual DOM rendering (dialog option presence/absence, badge visual output) cannot be automated in this repo today and must be verified via `npm run build` (catches type errors) plus manual/browser QA, consistent with how prior calendar-adjacent phases in this project have handled UI-only verification.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-03 | `getBookings()` (or its paginated replacement) applies `.range()`/bounded query, not an unbounded select | unit (mocked Supabase, assert the builder chain includes `.range`/`.limit` with expected bounds) | `npx vitest run tests/calendar-bookings-list.test.ts` | ❌ Wave 0 |
| SYNC-03 | A booking with `status='showed'` is included in the bookings-list bucketing (once bucketing logic is extracted to a pure function) | unit (pure function, no mocks needed) | `npx vitest run tests/calendar-bookings-page.test.ts` | ❌ Wave 0 — requires the planner to extract `page.tsx`'s inline filter logic into a testable pure function as part of the fix, since the component itself can't be rendered (see gap above) |
| SYNC-03 | `contacts/actions.ts`'s `getContactDetail` bookings mapping returns the correct `event_type_name` from the `title` column | unit (mocked Supabase) | `npx vitest run tests/contacts-actions-bookings.test.ts` | ❌ Wave 0 — no existing test file covers `getContactDetail` at all |
| SYNC-03 | `buildMeetingScope` populates `organizer.user_id/name/email` from `event_types.user_id` | unit (mocked Supabase + mocked `auth.admin.getUserById`) | `npx vitest run tests/calendar-scope.test.ts` | ❌ Wave 0 — no existing test file for `scope.ts` |
| SYNC-04 | Round-robin option is absent from `new-event-type-dialog.tsx`'s type-choice step | manual/browser QA (no component-render test infra) | — (manual) | N/A — justified: no `@testing-library/react` in this repo |
| SYNC-04 | `createEventType`/`updateEventType` still accept/preserve `booking_type` on existing rows (no regression, data preserved per D-02) | unit (mocked Supabase) | `npx vitest run tests/event-types-actions.test.ts` | ❌ Wave 0 — no existing test file for `event-types.ts` actions |
| SYNC-04 | `event-type-form.tsx`'s new "allowed locations" control only offers the completed/reachable kind subset (not `zoom`/`whereby`) | manual/browser QA | — (manual) | N/A — justified: no component-render test infra |
| SYNC-04 | Google Meet link is created and persisted on `bookings.meeting_url` when `location_kind='google_meet'` at booking-creation time (if this completion is included in the plan) | unit (mocked Supabase + mocked `createMeetingLink`) | `npx vitest run tests/calendar-bookings.test.ts` (extend existing) | ✅ Exists — extend, don't replace |
| SYNC-04 | `default_location_type` control removed from Preferences UI; `calendar_profiles.default_location_type` column/data untouched | manual/browser QA + `npm run build` (catches any lingering type reference) | — (manual + build) | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/calendar-bookings.test.ts tests/calendar-slots.test.ts` plus whichever new Wave 0 file(s) that task touches (fast, mocked, no live-DB dependency).
- **Per wave merge:** Full calendar test slice — `npx vitest run tests/calendar-bookings.test.ts tests/calendar-bookings-list.test.ts tests/calendar-bookings-page.test.ts tests/contacts-actions-bookings.test.ts tests/calendar-scope.test.ts tests/event-types-actions.test.ts` — plus `npm run build` (mandatory per `CLAUDE.md`: "Always run `npm run build` after changes to catch type errors before finishing").
- **Phase gate:** Full suite (`npm test`) green, `npm run build` green, plus a manual/browser pass through: (1) bookings list showing a `'showed'` booking in a visible section with a distinct badge, (2) new-event-type-dialog no longer offering round-robin, (3) event-type-form's location-kind control, (4) Preferences page no longer showing the dead `default_location_type` control.

### Wave 0 Gaps
- [ ] `tests/calendar-bookings-list.test.ts` — bounded-query assertion for `getBookings()`'s paginated replacement (SYNC-03)
- [ ] `tests/calendar-bookings-page.test.ts` — pure-function status-bucketing test, once extracted from `bookings/page.tsx` (SYNC-03)
- [ ] `tests/contacts-actions-bookings.test.ts` — `getContactDetail` bookings-join correctness (SYNC-03)
- [ ] `tests/calendar-scope.test.ts` — `buildMeetingScope` organizer hydration (SYNC-03) — no test file exists for `scope.ts` today at all, this is a net-new coverage gap independent of this phase
- [ ] `tests/event-types-actions.test.ts` — `createEventType`/`updateEventType` regression coverage, currently entirely untested (SYNC-04)
- [ ] Manual/browser QA checklist (see Phase gate above) — no automated substitute exists for component-rendering assertions in this repo

*(If no gaps: N/A — gaps listed above.)*

## Open Questions

1. **What bounding strategy should the calendar week/month view (`/calendar/calendar`) use?**
   - What we know: `getBookings()` already accepts `from`/`to` but the calendar page never passes them; `CalendarView` does client-side navigation with no re-fetch mechanism.
   - What's unclear: Whether the plan should (a) add a bounded initial load + re-fetch-on-navigate, or (b) ship a simpler fixed-window/cap stopgap now and defer real windowing.
   - Recommendation: Planner's call, informed by Pitfall 1 above — either is defensible, but a silent truncation that could hide a real booking from view must be avoided regardless of which is chosen.

2. **Should `store_location` be completed or removed in this phase?**
   - What we know: It needs both an admin-side store picker (event-type-form.tsx) and `location_data.store_id` wiring at booking-insert time — real but bounded work, reusing existing `tenant_locations` infrastructure.
   - What's unclear: Whether this clears the "modest effort" bar D-02 sets, relative to the other completions already recommended (google_meet, the base kind-set admin control).
   - Recommendation: Treat as the swing case — if the plan's effort budget allows, complete it (it's the most product-visible of the remaining kinds, letting orgs with physical locations use the feature migration 089 was built for); otherwise remove `store_location` from the exposed kind set alongside `zoom`/`whereby` and leave `default_store_location_id` as dormant schema, consistent with D-02's default-remove bias.

3. **Should `google_meet` completion (wiring `createMeetingLink` into the live insert path) be bundled into this phase, or deferred?**
   - What we know: It's genuinely modest effort (mirrors an existing fire-and-forget call site already present in both booking-creation functions) and directly un-blocks one of the two "real" video-conferencing kinds this schema was built to support.
   - What's unclear: Whether Phase 127's canonical lifecycle service (still being planned in parallel) changes the booking-creation flow's shape enough that this wiring should wait until after 127 lands, to avoid rework.
   - Recommendation: Since Phase 130 depends on 127 per the roadmap, by execution time the lifecycle service should already exist — wire this completion using whatever the finalized `createBooking`/lifecycle entry point looks like at that time, not the pre-127 shape described in this research.

## Sources

### Primary (HIGH confidence — read directly from this worktree)
- `src/lib/calendar/scope.ts` — full file read (organizer-null bug, Finding 6)
- `src/app/(dashboard)/calendar/_actions/bookings.ts` — full file read (unbounded query Finding 1, status typing Finding 2)
- `src/app/(dashboard)/calendar/bookings/page.tsx` — full file read (state-display gap Finding 4)
- `src/app/(dashboard)/calendar/calendar/page.tsx`, `src/app/(dashboard)/calendar/page.tsx` — full file reads
- `src/app/(dashboard)/contacts/actions.ts` (lines 460-582) — read (wrong-join Finding 3)
- `src/components/chat/contact-info-panel.tsx` (lines 790-880) — read (Finding 5, dead link)
- `src/components/calendar/new-event-type-dialog.tsx`, `event-type-form.tsx`, `event-type-card.tsx`, `new-booking-dialog.tsx`, `booking-form.tsx`, `booking-page-client.tsx`, `store-location-form.tsx`, `meeting-preferences.tsx` — full file reads (round-robin and location-kind findings)
- `src/app/(dashboard)/calendar/_actions/event-types.ts`, `calendar-profile.ts`, `availability.ts`, `google-events.ts` — full file reads
- `src/lib/calendar/location-resolver.ts`, `booking-validation.ts`, `google-calendar.ts` (lines 120-360), `transition.ts` (lines 190-350) — full/partial reads (per-kind verdicts, `confirmBooking` dead-code finding)
- `src/app/book/[slug]/[eventType]/page.tsx` — read
- `supabase/migrations/089_event_types_location_kinds.sql`, `090_bookings_location_kind.sql`, `1139_event_types_booking_type.sql`, `1141_scheduling_profile_prefs.sql`, `1224_booking_status_showed.sql` — full reads
- `src/types/database.ts` — grep-verified field names (`booking_type`, `default_store_location_id`)
- `.planning/workstreams/calendar-reliability/phases/126-booking-trust-boundary/126-RESEARCH.md`, `126-01-SUMMARY.md` — read for existing test-infrastructure pattern and confirmed Phase 126 findings (resolveAndValidateSlot, offset-pagination precedent context)
- `.planning/workstreams/calendar-reliability/phases/127-canonical-booking-lifecycle/127-CONTEXT.md`, `128-reliable-calendar-scheduling/128-CONTEXT.md`, `129-provider-synchronization-integrity/129-CONTEXT.md` — read for parallel-phase scope boundaries (Cross-Reference to Phase 127 section)
- `tests/calendar-bookings.test.ts` (partial), directory listing of `tests/` — read for Validation Architecture
- `package.json`, `vitest.config.ts` (referenced, not re-read — confirmed via Phase 126's RESEARCH.md which read it directly) — version/config confirmation
- Grep evidence (all negative claims below are grep-confirmed, not assumed): `round_robin`/`team_member`/`rotation` across `src/` + `supabase/migrations/`; `allowed_location_kinds` across `src/`; `store_id`/`default_store_location_id` across `src/`; `zoom.us`/`whereby.com`/`find -iname "*zoom*"`/`"*whereby*"` across `src/lib`; `confirmBooking\b` across `src/`; `default_location_type`/`sync_mode` across `src/`; `no_show`/`'showed'`/`meeting.organizer` across `src/`

### Secondary (MEDIUM confidence)
- `npm view zod version` — confirms current published npm version (4.4.3) vs. this repo's pinned `^3.25.76`; used only to note the pin is intentional, not to recommend a change.

### Tertiary (LOW confidence)
- None — every substantive finding in this document is a direct code/migration/grep read from this worktree, not inferred from training data or external search.

## Metadata

**Confidence breakdown:**
- SYNC-03 findings (unbounded query, wrong join, organizer-null, state-display gap): HIGH — each is a direct read of the exact offending code, with concrete file:line citations and, where relevant, grep-confirmed absence of any mitigating logic elsewhere.
- SYNC-04 round-robin verdict: HIGH — grep across the entire `src/` tree and `supabase/migrations/` confirms zero assignment/rotation logic exists; this is a negative claim backed by exhaustive search, not absence-of-evidence assumption.
- SYNC-04 location-kinds per-kind verdicts: HIGH for the root blocker (event-type-form.tsx gap) and for `zoom`/`whereby`/`google_meet`/`store_location` (all grep-confirmed); MEDIUM for the exact "modest effort" line for `store_location` specifically, since effort estimation is inherently judgment-based — flagged as Open Question 2 for the planner.
- Validation Architecture: HIGH for framework/config facts (read directly); MEDIUM for the "no React component test infra" implication on SYNC-04's manual-QA items, since this is a structural gap in the repo, not a phase-specific research finding, but it directly constrains what this phase can and cannot automate.

**Research date:** 2026-07-15
**Valid until:** ~2026-08-14 (30 days — stable domain; re-verify against Phase 127's actual shipped canonical status vocabulary before finalizing the SYNC-03 display-layer fix, since this phase depends on 127's output landing first per the roadmap)
