# Phase 126: Booking Trust Boundary - Research

**Researched:** 2026-07-15
**Domain:** PostgreSQL/Supabase RLS + exclusion constraints, Next.js 16 Server Actions, public booking security
**Confidence:** HIGH (all findings verified against this repo's actual code/migrations; DB constraint syntax cross-verified with official/community Postgres sources)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Server-authoritative availability**
- Public and programmatic booking creation must derive `end_at` from the active event type and validate the requested UTC start against the same availability/conflict logic used to display slots.

**D-02: Durable overlap protection**
- The database must reject malformed intervals and overlapping active bookings for the same organizer, even where event types differ. Cancelled bookings must not block a replacement slot.

**D-03: Safe cancellation**
- Opening a cancellation URL must render a confirmation page only. The state mutation must be a POST server action protected by the existing cancellation token.

**D-04: RLS boundary**
- Remove broad public calendar RLS access. Public booking flows use narrowly scoped service-role code; normal authenticated reads/writes remain tenant-scoped.

### Claude's Discretion
- Choose the smallest compatible PostgreSQL exclusion/check-constraint approach and maintain compatibility with existing booking data.

### Deferred Ideas (OUT OF SCOPE)
- Existing tenant workflow migration is explicitly out of scope for this phase.
- Provider synchronization and booking lifecycle event unification belong to later phases.
</user_constraints>

## Summary

The native booking system (migrations `071`/`073`, hardened over `1139-1224`) already does the *hard* parts well: public pages are server components that exclusively use `createServiceRoleClient()` (no browser/anon Supabase client is ever instantiated for calendar tables), slot generation is a pure function (`src/lib/calendar/slots.ts`), and `cancel_token` is already an unguessable `gen_random_uuid()`. The gaps are narrower and more surgical than "rebuild the system":

1. **CAL-01** has a real hole: the public `createBooking` server action does derive `end_at` server-side and does run a pre-check + rely on a unique index, but the **MCP `bookings_create` tool** (`src/lib/mcp/tools/bookings.ts`) — which is squarely "programmatic booking" — accepts a client-supplied `end_at`, never checks `event_types.active`, and performs **zero** availability/conflict validation before insert. It is the actual gap CAL-01 targets.
2. **CAL-02** requires a genuinely new DB constraint. The current guard (`idx_bookings_event_slot_unique`, migration `073`/`1212`) is a partial *unique index* on `(event_type_id, start_at)` — it does not prevent overlap (only exact start-time collision) and does not span different `event_type_id`s for the same organizer. There is also **no `CHECK (start_at < end_at)`** anywhere. `bookings` has no `user_id`/organizer column today — one must be added (denormalized from `event_types.user_id`) before an exclusion constraint can be scoped per organizer.
3. **CAL-03** is a straightforward fix: `src/app/book/cancel/[id]/page.tsx` calls `cancelBookingByToken()` directly inside a Server Component's render path on a bare GET — any link-preview crawler (Slack/WhatsApp/Outlook Safe Links unfurl) that fetches the URL cancels the booking. The codebase already has the correct idiomatic fix pattern in use elsewhere (`src/app/oauth/authorize/page.tsx`: `<form action={serverAction}>`).
4. **CAL-04** requires tightening 3 RLS policies that were written for a client architecture that no longer exists: `bookings_public_insert` (`WITH CHECK (true)` — anon can INSERT any row with the anon key directly, bypassing all server-side validation), `user_availability_public_select` (`USING (true)` — any anon reader can read every org's weekly availability), and `event_types_public_select` (`active = true OR org...` — any anon reader can read every org's active event types). Since no legitimate client code path uses the anon key against these tables (confirmed by grep — all reads/writes go through `createServiceRoleClient()` in server actions/route handlers), these policies can be dropped/narrowed without breaking the product.

**Primary recommendation:** Ship four narrowly-scoped changes: (1) extract a shared "resolve + validate slot" helper that both `createBooking` and the MCP `bookings_create` tool call; (2) one migration that adds `bookings.organizer_user_id` (backfilled + trigger-populated) + `CHECK (start_at < end_at)` + a `btree_gist` exclusion constraint scoped to `(organizer_user_id, tstzrange(start_at, end_at, '[)'))` filtered to `status = 'confirmed' AND external_source IS NULL`; (3) convert the cancellation page to GET-renders-confirmation / POST-mutates via a `<form action={cancelBookingByToken}>`, reusing the existing `cancel_token`; (4) drop/narrow the three anon RLS policies. All four are independently testable against the existing `pg.Client`-based real-DB test pattern already used in `tests/contact-identity-trigger.test.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAL-01 | A public or programmatic booking is accepted only when its event type is active, its time is valid and available, and its interval is conflict-free in the tenant calendar. | `createBooking` already does most of this (see "Current Booking Creation Flow"). The gap is the MCP `bookings_create` tool, which must gain the same active-check + server-derived `end_at` + availability/conflict validation. See "Don't Hand-Roll" and "Code Examples". |
| CAL-02 | The database prevents invalid booking intervals and overlapping active bookings for the same organizer, including bookings from different event types. | No `CHECK (start_at < end_at)` exists today; current unique index is scoped to `event_type_id`, not organizer. See "Architecture Patterns" → Exclusion Constraint pattern. |
| CAL-03 | Public cancellation requires an explicit POST confirmation and cannot be triggered by a link preview or crawler. | `src/app/book/cancel/[id]/page.tsx` currently cancels on GET render. Fix pattern already exists in-repo (`src/app/oauth/authorize/page.tsx`). See "Code Examples". |
| CAL-04 | Calendar tables enforce least-privilege RLS policies; privileged service-role paths remain explicit. | Three anon-broad policies identified (`bookings_public_insert`, `user_availability_public_select`, `event_types_public_select`). Confirmed unused by any legitimate anon-key code path. See "Current RLS State" section. |
</phase_requirements>

## Standard Stack

No new runtime dependencies are needed. This phase is schema + server-action + RLS work using what's already installed.

### Core (already installed, verified versions)
| Library | Version (package.json) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.6 | App Router, Server Actions, Server Components | Already the app framework; `<form action={serverAction}>` is the idiomatic POST-mutation pattern and is already used elsewhere in this repo (`src/app/oauth/authorize/page.tsx`). |
| `zod` | ^3.25.76 | Input validation on server actions/MCP tool input | Already the validation library for all server actions in this repo. |
| `date-fns` / `date-fns-tz` | ^4.1.0 / ^3.2.0 | Interval math for slot generation | Already used in `src/lib/calendar/slots.ts`; no change needed to the pure-function slot engine itself. |
| `pg` | ^8.21.0 (devDependency) | Real-DB integration tests for Postgres-level constraints/triggers | Already used by `tests/contact-identity-trigger.test.ts` for `BEGIN/COMMIT`-sensitive constraint testing — reuse this exact pattern for the new exclusion constraint. |

### Supporting (Postgres extension, not an npm package)
| Extension | Where enabled | Purpose | When to Use |
|---------|---------|---------|-------------|
| `btree_gist` | New migration, `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;` (matches this repo's convention seen in `004_knowledge_base.sql` for `vector`) | Adds GiST operator classes for scalar equality (uuid) so an `EXCLUDE USING gist` constraint can combine `organizer_user_id WITH =` and a `tstzrange WITH &&` in one constraint. | Required any time an exclusion constraint mixes a plain equality column with a range/overlap column — confirmed available on Supabase Postgres (standard contrib extension). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB-level `EXCLUDE USING gist` constraint | Application-level "SELECT ... FOR UPDATE" + check-then-insert transaction | Rejected: CAL-02 explicitly requires a *database constraint*, and the existing 23505-based race-guard already proves app-level pre-checks alone are insufficient under concurrency (that's exactly why migration `073` exists as a DB-level backstop). |
| `EXCLUDE USING gist` | Postgres 18 `WITHOUT OVERLAPS` temporal-constraint syntax (cleaner syntax, no `btree_gist` needed) | Rejected for this phase: requires confirming the target Postgres major version Supabase runs. `btree_gist` + `EXCLUDE USING gist` works on any Postgres ≥ 9.2 and is what the existing schema's Postgres version supports without version risk. Worth a follow-up note if Supabase's Postgres is confirmed ≥ 18. |
| Denormalized `organizer_user_id` column | A `CHECK`/trigger that joins to `event_types` at write time without adding a column | Rejected: exclusion constraints in Postgres cannot reference other tables — the equality/range operands must be columns (or immutable expressions) on the row itself. Denormalization is the only compatible approach. |

**Installation:**
```bash
# No npm install needed — schema-only change applied via Supabase MCP apply_migration
# per this repo's CLAUDE.md convention (operator applies migrations, do not run `supabase db push`).
```

**Version verification:** No new npm packages introduced; `pg` (^8.21.0) and `next` (^16.2.6) are already pinned in `package.json` and were read directly from this worktree, not assumed from training data.

## Architecture Patterns

### Current Booking Creation Flow (as-is, verified by reading code)

```
Public booker (browser)
  └─ src/app/book/[slug]/[eventType]/page.tsx (Server Component, service-role read)
       └─ src/components/calendar/booking-page-client.tsx (Client Component)
            └─ calls server actions directly (no anon Supabase client anywhere):
                 - getAvailableSlots()   → src/lib/calendar/slots.ts::generateSlots (pure fn)
                 - createBooking()       → derives end_at from event_types.duration_minutes,
                                            runs a SELECT-based conflict pre-check, INSERTs,
                                            maps 23505 → 'slot_taken'

Programmatic (MCP tool, Claude/ChatGPT-facing)
  └─ src/lib/mcp/tools/bookings.ts::bookings_create
       └─ NO active-type check, NO end_at derivation (client supplies both start_at AND
          end_at directly), NO availability/conflict pre-check. Relies entirely on the
          (currently insufficient) DB unique index. <-- THE CAL-01 GAP

Operator (authenticated dashboard, out of CAL-01 scope by design)
  └─ createBookingInternal() — intentionally allows duration override (drag-to-create) and
     bypasses booker-facing availability windows; still must respect the new CAL-02 DB
     constraint like every other write path.

Xkedule mirror (external system of record, deliberately exempted)
  └─ src/app/api/xkedule/webhook/route.ts — writes bookings with external_source='xkedule'.
     Migration 1212 already exempts external_source IS NOT NULL rows from the double-booking
     guard because Xkedule allows multiple staff to be booked at the same start_at. The new
     CAL-02 constraint's WHERE clause must preserve this exemption.
```

### Pattern 1: Shared slot-validation core for CAL-01
**What:** Extract the "resolve event type (active) → derive end_at from duration_minutes → validate requested start against `generateSlots`/conflict logic" sequence that already exists inline in `createBooking` (`src/app/(dashboard)/calendar/_actions/bookings.ts` lines ~455-489) into a function importable by both the public server action and the MCP tool.
**When to use:** Any "programmatic or public" booking-creation entry point (CAL-01's own wording). `createBookingInternal` is explicitly allowed to diverge (operator override), so it does not need to call this shared helper, but it must not regress the DB-level guarantee.
**Example (shape, not final code — planner's job):**
```typescript
// Source: derived from src/app/(dashboard)/calendar/_actions/bookings.ts (createBooking, lines 455-489)
async function resolveAndValidateSlot(supabase, params: { eventTypeId: string; startAtIso: string }) {
  const { data: et } = await supabase
    .from('event_types')
    .select('duration_minutes, org_id, user_id, ...')
    .eq('id', params.eventTypeId)
    .eq('active', true)   // <-- MCP tool currently skips this
    .single()
  if (!et) return { ok: false, error: 'event_type_not_found' }

  const startAt = new Date(params.startAtIso)
  const endAt = addMinutes(startAt, et.duration_minutes)  // <-- MCP tool currently accepts client end_at instead

  // Re-use the same availability window + existing-bookings + busy-times check
  // that getAvailableSlots() already runs (src/lib/calendar/slots.ts::generateSlots),
  // not just the conflict-only pre-check createBooking currently does — CAL-01 explicitly
  // requires "its time is valid and available", not just "conflict-free".
  ...
}
```

### Pattern 2: Postgres exclusion constraint for organizer-scoped overlap (CAL-02)
**What:** A GiST exclusion constraint on `bookings` that rejects any INSERT/UPDATE producing two `status='confirmed'`, `external_source IS NULL` rows for the same organizer with overlapping `[start_at, end_at)` ranges — regardless of `event_type_id`.
**When to use:** This is the DB-level backstop CAL-02 requires; it complements (does not replace) the application-level check in CAL-01, exactly the same way the existing `idx_bookings_event_slot_unique` complements `createBooking`'s SELECT pre-check today.
**Example:**
```sql
-- Source: cross-verified against multiple current (2026) Postgres/Supabase sources —
-- https://www.postgresql.org/docs/current/rangetypes.html
-- https://supabase.com/docs/guides/database/extensions
-- https://neon.com/docs/extensions/btree_gist
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- 1. Denormalized organizer column (bookings has no user_id today — only via event_types FK)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id);

-- 2. Backfill existing rows from event_types.user_id
UPDATE public.bookings b
  SET organizer_user_id = et.user_id
  FROM public.event_types et
  WHERE b.event_type_id = et.id AND b.organizer_user_id IS NULL;

-- 3. Trigger to auto-populate on future inserts (defense in depth — do not rely on
--    every write path remembering to set it)
CREATE OR REPLACE FUNCTION public.set_booking_organizer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organizer_user_id IS NULL THEN
    SELECT user_id INTO NEW.organizer_user_id
    FROM public.event_types WHERE id = NEW.event_type_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bookings_set_organizer ON public.bookings;
CREATE TRIGGER trg_bookings_set_organizer
  BEFORE INSERT OR UPDATE OF event_type_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_organizer();

-- 4. Malformed-interval guard (does not exist anywhere in the schema today)
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_valid_interval CHECK (start_at < end_at);

-- 5. The exclusion constraint itself.
--    CRITICAL: use '[)' (half-open), NOT '[]'. This codebase's own overlap logic
--    (src/lib/calendar/slots.ts::overlaps — isBefore(aStart,bEnd) && isAfter(aEnd,bStart))
--    already treats touching endpoints (09:30 end / 09:30 start) as NON-overlapping so
--    back-to-back bookings are allowed. Using '[]' (closed) here would silently reject
--    every legitimate back-to-back booking — a very easy mistake to copy from blog examples.
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_organizer_overlap
  EXCLUDE USING gist (
    organizer_user_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed' AND external_source IS NULL);
```
**Migration ordering note:** Steps 1-4 can ship in one migration. Step 5 should run an audit query first (`SELECT ... GROUP BY organizer_user_id HAVING count(*) > 1` over overlapping ranges) against the live data to check for pre-existing violations — if any exist, the constraint creation will fail outright (Postgres does not support `NOT VALID` for exclusion constraints the way it does for `CHECK`/FK, so any existing violation blocks the `ALTER TABLE`). This audit should be a documented manual step for the operator before applying the constraint migration, since this agent cannot query the live DB from this worktree.

### Pattern 3: GET renders / POST mutates for cancellation (CAL-03)
**What:** Split `src/app/book/cancel/[id]/page.tsx` into (a) a GET-only render that fetches booking details read-only and shows a confirmation form, and (b) the actual `cancelBookingByToken` mutation wired as a Server Action bound to a `<form action={...}>`.
**When to use:** Any public, unauthenticated page today that mutates state as a side effect of rendering — this repo has exactly one such case (this file).
**Example — the in-repo precedent for this exact pattern already exists:**
```typescript
// Source: src/app/oauth/authorize/page.tsx (lines 196-211, this repo, existing code)
// Confirms this pattern is already idiomatic here for "public page, explicit POST action":
//   <form action={deny}>...</form>
//   <form action={approve}>...</form>
// where `deny`/`approve` are 'use server' functions bound in the same file.
// Applying the same shape to cancellation:
export default async function CancelBookingPage({ params, searchParams }: Props) {
  const { id } = await params
  const { token } = await searchParams
  if (!token) notFound()

  const supabase = createServiceRoleClient()
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, booker_name, start_at, status, event_type_id, cancel_token')
    .eq('id', id).maybeSingle()
  if (!booking || booking.cancel_token !== token) notFound()
  // NOTE: no cancelBookingByToken() call here anymore — GET is now read-only.

  if (booking.status === 'cancelled') {
    return <AlreadyCancelledView booking={booking} />
  }

  async function confirmCancel() {
    'use server'
    await cancelBookingByToken(id, token)
    revalidatePath(`/book/cancel/${id}`)
  }

  return (
    <ConfirmationView booking={booking}>
      <form action={confirmCancel}>
        <button type="submit">Cancel booking</button>
      </form>
    </ConfirmationView>
  )
}
```
Next.js Server Actions already carry a built-in same-origin (`Origin`/`Host` header) check on the POST request they generate — this is a free defense-in-depth bonus versus the current GET-triggers-mutation code path, which has no such protection today because it isn't a client-submitted action at all.

### Anti-Patterns to Avoid
- **Mutating state during Server Component render on a GET route:** exactly what `src/app/book/cancel/[id]/page.tsx` does today. Next.js Server Components render on GET; anything with a side effect belongs in a Server Action triggered by a form submission (POST) or Route Handler, never inline in page render logic.
- **Trusting client-supplied `end_at`:** the MCP tool's `bookings_create` schema accepts `end_at: z.string().datetime()` directly from the caller instead of deriving it from `event_types.duration_minutes` — this is precisely what CAL-01 forbids ("its event type is active, its time is valid and available").
- **Widening RLS `USING (true)` "for convenience":** `user_availability_public_select` and `bookings_public_insert` both use `USING/WITH CHECK (true)`. Now that no legitimate anon-key caller exists (verified — see below), these should be replaced with policies that only the (RLS-bypassing) service role can act through, or removed entirely and re-added narrowly scoped if a future feature needs anon reads again.

## Current RLS State (verified by reading every migration touching these 4 tables)

| Table | Policy (current, cumulative across migrations 071 → 1224) | Problem for CAL-04 |
|---|---|---|
| `bookings` | `bookings_org_isolation` (FOR ALL, org-scoped, fine) **+** `bookings_public_insert` (FOR INSERT, `WITH CHECK (true)`) | Anon key can INSERT an arbitrary row directly (any `org_id`, any `status`, skip all app-level validation, skip rate limiting) if it ever obtains the anon key — which is public by definition (`NEXT_PUBLIC_SUPABASE_...`). No legitimate code path uses this: `createBooking`/`createBookingInternal` both use `createServiceRoleClient()`. |
| `user_availability` | `user_availability_public_select` (FOR SELECT, `USING (true)`) **+** `user_availability_org_write` (org-scoped) | Any anon reader can `SELECT * FROM user_availability` for **every org**, not just the one being booked. Public booking pages already fetch this via the service-role client (`src/app/book/[slug]/[eventType]/page.tsx` line 43-48), so this broad policy is unused dead surface area. |
| `event_types` | `event_types_org_isolation` (org-scoped, fine) **+** `event_types_public_select` (FOR SELECT, `USING (active = true OR org_id = current_org_id())`) | Any anon reader can enumerate every active event type across **every tenant** (title, description, duration, pricing-adjacent fields). Public pages already use service-role reads. |
| `calendar_profiles` (renamed from `scheduling_profiles` by migration `1202`) | `calendar_profiles_org_isolation` (org-scoped only — **no public policy exists**) | Already least-privilege; no change needed. Confirms the "narrow service-role for public reads" pattern is already how this table is handled — extend the same treatment to the other three. |

**Confirmed via grep** (`\.from\(['"](bookings|event_types|user_availability|calendar_profiles)['"]\)` across `src/`): every read/write to these 4 tables from the public booking surface, the dashboard, the MCP tools, and the Xkedule webhook uses either `createServiceRoleClient()` (bypasses RLS entirely, by design) or the authenticated `createClient()` (org-scoped RLS, unaffected by removing the anon-broad policies). **No browser/anon Supabase client is instantiated anywhere in `src/components/calendar/` or `src/app/book/`.** This means the anon-broad policies can be tightened without any client-side code change — D-04's "Public booking flows use narrowly scoped service-role code" is already true in practice; the RLS just hasn't caught up to reflect it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Overlap prevention under concurrency | A custom advisory-lock or "SELECT...FOR UPDATE then INSERT" transaction wrapper | Postgres `EXCLUDE USING gist` constraint (see Pattern 2) | This is precisely the textbook use case for exclusion constraints — the existing partial-unique-index approach in this codebase already demonstrates the team's own precedent of pushing this guarantee into the DB rather than the app layer. |
| Cancellation-token generation/verification | A new HMAC/JWT token scheme | The existing `bookings.cancel_token uuid DEFAULT gen_random_uuid()` | D-03 explicitly says "protected by the existing cancellation token" — a `gen_random_uuid()` v4 is already cryptographically unguessable (122 bits of randomness); there is no security gain from replacing it, only migration risk (every already-sent confirmation email has the old token baked into its cancel URL). |
| CSRF/same-origin protection on the new POST cancel action | Custom CSRF token embedded in the form | Next.js Server Actions' built-in Origin/Host same-origin check | Framework-provided, already relied on implicitly by `src/app/oauth/authorize/page.tsx`'s `approve`/`deny` forms in this same repo. |

**Key insight:** every piece of this phase has an existing in-repo precedent to copy (partial unique index → exclusion constraint; `oauth/authorize` form-action pattern → cancel form-action pattern; service-role-only public reads on `calendar_profiles` → same treatment for the other 3 tables). This is a "bring the outliers in line with the pattern already established elsewhere in the codebase" phase, not new architecture.

## Common Pitfalls

### Pitfall 1: `'[]'` vs `'[)'` range bounds in the exclusion constraint
**What goes wrong:** Copying the closed-range `'[]'` syntax from generic Postgres tutorials makes back-to-back bookings (one ending exactly when the next starts) falsely collide.
**Why it happens:** Most public examples model hotel-room-night bookings (inclusive both ends is correct there); calendar slot bookings are conventionally half-open.
**How to avoid:** Use `tstzrange(start_at, end_at, '[)')` to match this codebase's existing `overlaps()` semantics in `src/lib/calendar/slots.ts` (`isBefore(aStart, bEnd) && isAfter(aEnd, bStart)` — strict inequality, touching endpoints do not overlap).
**Warning signs:** A `bookings_no_organizer_overlap` violation error on an INSERT for a slot that visibly does not overlap any existing confirmed booking, only touches its edge.

### Pitfall 2: Exclusion constraint creation fails outright if pre-existing data violates it
**What goes wrong:** Unlike `CHECK`/FK constraints, exclusion constraints have no `NOT VALID` + `VALIDATE CONSTRAINT` deferred-validation path — `ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE ...` scans and enforces immediately; if any two existing rows already violate it, the migration fails.
**Why it happens:** The existing overlap guard (`idx_bookings_event_slot_unique`) is scoped to `event_type_id`, so an organizer with two different event types double-booked at overlapping times today would not have been caught by it — such rows may already exist in production.
**How to avoid:** Run an audit `SELECT` (grouping by `organizer_user_id`, checking for overlapping `[start_at,end_at)` pairs within `status='confirmed' AND external_source IS NULL`) against the live DB before applying the constraint migration. This agent could not run this query from the worktree (no live DB access in this session) — flag as a required operator/planner pre-flight step, not something to skip.
**Warning signs:** `apply_migration` (Supabase MCP) returns a constraint-violation error citing two specific `ctid`s/rows.

### Pitfall 3: Xkedule mirror rows accidentally caught by the new constraint
**What goes wrong:** If the exclusion constraint's `WHERE` clause omits `external_source IS NULL`, legitimate multi-staff Xkedule bookings at the same time (by design, per migration `1212`'s comment) start failing to sync, silently dropping bookings from the calendar/CRM.
**Why it happens:** Easy to copy the `WHERE (status = 'confirmed')` clause from the *old* migration `073` and forget the `external_source IS NULL` addendum that migration `1212` layered on top later.
**How to avoid:** Explicitly carry forward `external_source IS NULL` in the new constraint's `WHERE`, matching the current `idx_bookings_event_slot_unique` definition exactly (see migration `1212_xkedule_booking_mirror.sql`).
**Warning signs:** Xkedule webhook logs `[xkedule/webhook] booking insert error` after this migration ships, or the xkedule sync silently stops for orgs with round-robin/multi-staff bookings.

### Pitfall 4: MCP tool's `bookings_create` still bypasses server-derived availability even after adding an active-type check
**What goes wrong:** Adding `.eq('active', true)` to the MCP tool's event-type lookup is necessary but not sufficient for CAL-01 — the tool must also stop trusting the client-supplied `end_at` and must run the same "is this time actually within availability + conflict-free" check `getAvailableSlots`/`createBooking` run, not just rely on the new DB exclusion constraint as the only gate.
**Why it happens:** The DB constraint (CAL-02) prevents *overlap*, but does not validate that a requested time falls within the organizer's configured `user_availability` windows at all — an MCP caller could otherwise book a confirmed, non-overlapping slot at 3am on a day with no availability configured.
**How to avoid:** Route the MCP tool through the same shared "resolve + validate slot" helper described in Pattern 1, not just the same conflict pre-check.
**Warning signs:** Bookings appearing on the calendar outside any configured `user_availability` window, with no corresponding public-page booking flow that could have produced them.

### Pitfall 5: `user_availability` can now have multiple rows per `day_of_week` (migration `1140`), but slot-fetching code still uses `.maybeSingle()`
**What goes wrong:** `getAvailableSlots()` and `getDebugSlots()` in `src/app/(dashboard)/calendar/_actions/bookings.ts` both do `.from('user_availability').select(...).eq('day_of_week', dow).maybeSingle()`. Migration `1140_user_availability_multi_slot.sql` explicitly dropped the `(user_id, day_of_week)` uniqueness constraint specifically so operators could configure two windows per day (e.g. `08:00-12:00` and `14:00-18:00`). If any org actually uses that feature, `.maybeSingle()` throws a Postgres/PostgREST "more than one row" error and the booking page breaks for that day.
**Status:** This is an existing, adjacent correctness bug — not one of CAL-01..04's four success criteria directly, but it does affect whether "its time is valid and available" (CAL-01's language) can be computed correctly. Flagging for the planner's discretion on whether to fold a fix into this phase's slot-validation work (Pattern 1 touches this exact code path anyway) or explicitly defer it.
**Warning signs:** A PostgREST/Supabase-js error (`PGRST116`) surfacing from the public booking page for any org with a split-availability day configured.

## Migration Numbering

**Highest migration file in this worktree:** `1247_prospect_rows_view.sql` (branch `codex/calendar-reliability`). The next sequential number in this worktree is **1248**.

**Caveat — verify before finalizing the plan's migration number:** per this project's memory/history, migration numbering has previously desynced between worktrees/branches and the live DB ledger (`db push` has been blocked before; migrations are applied via Supabase MCP `apply_migration`, which writes timestamp-based ledger versions, not the file's numeric prefix). A migration numbered `1248_ai_calls_enrichment.sql` may already exist and/or be applied on `main`/other worktrees by the time this phase is planned/executed, independent of this branch. **The operator applying this phase's migration must confirm the actual highest-applied migration number against the live DB immediately before naming the new file(s)**, not assume `1248` is free. This is a process/coordination risk, not a technical blocker — flagging per this repo's `CLAUDE.md` convention ("migrations are applied via Supabase MCP `apply_migration` by the operator, never edit old migrations").

**Suggested file split** (smallest independently-revertable units):
- `NNNN_bookings_organizer_overlap_guard.sql` — adds `organizer_user_id` column + backfill + trigger + `CHECK (start_at < end_at)` + `EXCLUDE USING gist` constraint (CAL-02). Ship after the pre-flight audit query confirms no existing violations.
- `NNNN_calendar_rls_least_privilege.sql` — drops/narrows `bookings_public_insert`, `user_availability_public_select`, `event_types_public_select` (CAL-04).

## Code Examples

### Server-derived `end_at` + active check (already correct in `createBooking`, missing in MCP tool)
```typescript
// Source: src/app/(dashboard)/calendar/_actions/bookings.ts lines 458-465, 475-476 (this repo, existing, correct)
const { data: et } = await supabase
  .from('event_types')
  .select('duration_minutes, org_id, user_id, title, location_type, location_value, allowed_location_kinds')
  .eq('id', parsed.data.event_type_id)
  .eq('active', true)          // <-- present here
  .single()
if (!et) return { ok: false, error: 'event_type_not_found' }
const startAt = new Date(parsed.data.start_at)
const endAt = addMinutes(startAt, et.duration_minutes)   // <-- derived here, not trusted from client
```

### The gap in the MCP tool (what to fix)
```typescript
// Source: src/lib/mcp/tools/bookings.ts lines 109-158 (this repo, existing, the CAL-01 gap)
inputSchema: z.object({
  event_type_id: z.string().uuid(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),   // <-- trusts the caller's end_at directly
  ...
}),
handler: async (input, { auth }) => {
  const { data: et } = await supabase
    .from('event_types')
    .select('id')                  // <-- no .eq('active', true), no duration_minutes fetched
    .eq('id', input.event_type_id)
    .eq('org_id', auth.orgId)
    .maybeSingle()
  if (!et) return { error: 'not_found', ... }
  // No availability/conflict pre-check at all before .insert(...)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Partial unique index `(event_type_id, start_at) WHERE status='confirmed'` | Organizer-scoped GiST exclusion constraint `(organizer_user_id, tstzrange) WHERE status='confirmed' AND external_source IS NULL` | This phase (126) | Closes the cross-event-type double-booking gap; requires `btree_gist` + a new denormalized column. |
| Cancellation mutates on GET render | Cancellation mutates only via a `<form action={...}>` POST (Server Action) | This phase (126) | Eliminates crawler/link-preview accidental cancellations; gains Next.js's built-in Origin-check CSRF protection for free. |
| Anon-key-writable/readable calendar RLS (`USING/WITH CHECK (true)`) | Service-role-only writes/reads for public booking flows; RLS scoped to authenticated org members only | This phase (126) | No client code change needed — public pages already exclusively use `createServiceRoleClient()`. |

**Deprecated/outdated:**
- `bookings_public_insert` / `user_availability_public_select` / `event_types_public_select` policies from migration `071_scheduling.sql`: written for an architecture (anon-key client-side booking) this codebase no longer uses. Confirmed via grep that no browser/anon client exists for these tables anywhere in `src/`.

## Open Questions

1. **Does production `bookings` data already contain a cross-event-type overlap for some organizer?**
   - What we know: The only DB-level guard today (`idx_bookings_event_slot_unique`) is scoped to `event_type_id`, so it would not have caught this class of conflict.
   - What's unclear: This agent has no live-DB query access from the worktree session (no MCP DB tools available here) to run the audit query.
   - Recommendation: The plan's first task for the CAL-02 migration should be an explicit audit `SELECT` step (see Pitfall 2) run by the operator via Supabase MCP or SQL editor before `ADD CONSTRAINT`, with a documented remediation path (manually re-flag conflicting rows as `cancelled`, or contact-and-reschedule) if violations are found.

2. **Is the actual next-free migration number `1248`, or has it already been claimed on another branch/worktree?**
   - What we know: This worktree's `supabase/migrations/` tops out at `1247`. Project memory notes a `1248_ai_calls_enrichment.sql` may exist on `main`/another worktree, and that migration-ledger desync has happened before with `db push`.
   - What's unclear: The actual highest-applied migration in the live DB ledger at plan-execution time.
   - Recommendation: Verify via Supabase MCP (`list_migrations`/ledger query) immediately before naming new migration files, per this repo's established "operator applies via MCP `apply_migration`" convention.

3. **Should the multi-slot `user_availability` `.maybeSingle()` bug (Pitfall 5) be fixed in this phase?**
   - What we know: It's a latent correctness bug that predates this phase and is not literally one of CAL-01..04's four success criteria.
   - What's unclear: Whether any org today actually has a split-availability day configured (would already be erroring in production if so).
   - Recommendation: Since Pattern 1's shared slot-validation helper touches this exact query path, folding in a `.select(...)` (array) + "does any window contain this slot" check instead of `.maybeSingle()` is nearly free once that helper is being written anyway — the agent's discretion, not a hard requirement.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (repo root) — `environment: 'node'`, `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`, `setupFiles: ['tests/setup/load-env.ts']` (loads `.env.local`) |
| Quick run command | `npx vitest run tests/calendar-bookings.test.ts tests/calendar-slots.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAL-01 | `createBooking` still derives `end_at` server-side, rejects inactive event types (regression) | unit (mocked Supabase) | `npx vitest run tests/calendar-bookings.test.ts` | ✅ Exists (`tests/calendar-bookings.test.ts`, Tests 1-3) — extend, don't replace |
| CAL-01 | MCP `bookings_create` rejects inactive event type; derives/ignores client `end_at`; rejects a time outside configured availability | unit (mocked Supabase, same pattern as `tests/calendar-bookings.test.ts`) | `npx vitest run tests/mcp-bookings.test.ts` | ❌ Wave 0 — no MCP booking-tool test file exists today (`src/lib/mcp/tools/bookings.ts` is untested) |
| CAL-02 | `CHECK (start_at < end_at)` rejects a malformed interval | integration (real DB via `pg.Client`) | `npx vitest run tests/calendar-overlap-constraint.test.ts` | ❌ Wave 0 |
| CAL-02 | Exclusion constraint rejects two overlapping `confirmed` bookings for the same organizer across two different `event_type_id`s | integration (real DB, same `pg.Client` pattern as `tests/contact-identity-trigger.test.ts`) | `npx vitest run tests/calendar-overlap-constraint.test.ts` | ❌ Wave 0 (same file as above) |
| CAL-02 | Constraint does NOT reject back-to-back bookings (touching endpoints) | integration (real DB) | same file | ❌ Wave 0 |
| CAL-02 | Constraint does NOT reject overlapping Xkedule mirror rows (`external_source='xkedule'`) | integration (real DB) | same file | ❌ Wave 0 |
| CAL-03 | GET `/book/cancel/[id]?token=...` does not change `booking.status` (no mutation on render) | integration (mocked Supabase, assert `cancelBookingByToken`/update is never called on GET path) or Playwright/manual | `npx vitest run tests/calendar-cancel-page.test.ts` | ❌ Wave 0 — no test file for the cancel page component exists |
| CAL-03 | POST/form-submit with a valid token cancels the booking (regression of existing behavior) | unit (mocked Supabase) | `npx vitest run tests/calendar-bookings.test.ts` | ✅ Exists (Tests 4-6 already cover `cancelBookingByToken` directly) |
| CAL-04 | Anon key cannot INSERT into `bookings` after the RLS change | integration (real anon+service Supabase clients, same pattern as `tests/rls-isolation.test.ts`) | `npx vitest run tests/calendar-rls.test.ts` | ❌ Wave 0 |
| CAL-04 | Anon key cannot SELECT `user_availability` / `event_types` for an org it has no session for | integration (real anon client) | same file | ❌ Wave 0 |
| CAL-04 | Authenticated org member reads/writes are unaffected (regression) | integration (real DB) | same file | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/calendar-bookings.test.ts tests/calendar-slots.test.ts` (fast, mocked — no live DB dependency, safe to run every commit)
- **Per wave merge:** `npx vitest run tests/calendar-overlap-constraint.test.ts tests/calendar-rls.test.ts tests/mcp-bookings.test.ts tests/calendar-cancel-page.test.ts` (requires `SUPABASE_DB_URL`/`DATABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SERVICE_ROLE_KEY` env vars present, matching the existing soft-skip pattern in `tests/contact-identity-trigger.test.ts` / `tests/rls-isolation.test.ts` — these suites `describe.skip` themselves when the env vars are absent rather than failing)
- **Phase gate:** Full suite (`npm test`) green before `/gsd:verify-work`, including the real-DB suites (do not merge with them soft-skipped — confirm `.env.local` has the required vars locally, or run against a Supabase branch/staging DB)

### Wave 0 Gaps
- [ ] `tests/calendar-overlap-constraint.test.ts` — real-DB `pg.Client` test for the new `CHECK` + exclusion constraint (CAL-02); copy the `BEGIN/COMMIT` + soft-skip-on-missing-env pattern from `tests/contact-identity-trigger.test.ts`
- [ ] `tests/calendar-rls.test.ts` — real anon-client RLS negative-test for `bookings`/`user_availability`/`event_types` (CAL-04); copy the `createClient(url, anonKey)` pattern from `tests/rls-isolation.test.ts`
- [ ] `tests/mcp-bookings.test.ts` — mocked-Supabase unit test for `src/lib/mcp/tools/bookings.ts::bookings_create` validation gaps (CAL-01); no precedent test file exists for this tool today — model it on `tests/calendar-bookings.test.ts`'s `buildFakeAdmin` proxy pattern
- [ ] `tests/calendar-cancel-page.test.ts` — assert the cancel page's GET path performs zero writes (CAL-03); decide file-vs-inline based on whatever shape the planner gives the refactored `page.tsx` (server action extracted or inline)

## Sources

### Primary (HIGH confidence — read directly from this worktree)
- `src/app/(dashboard)/calendar/_actions/bookings.ts` — full file read
- `src/lib/calendar/slots.ts` — full file read
- `src/app/book/cancel/[id]/page.tsx` — full file read
- `src/app/book/[slug]/page.tsx`, `src/app/book/[slug]/[eventType]/page.tsx` — full files read
- `src/lib/mcp/tools/bookings.ts` — full file read
- `src/app/api/xkedule/webhook/route.ts` (lines 180-249) — read
- `src/app/oauth/authorize/page.tsx` (lines 1-60, 191-211) — read
- `src/lib/supabase/admin.ts`, `src/lib/rate-limit.ts`, `src/lib/calendar/emails.ts`, `src/lib/calendar/scope.ts` — full files read
- `supabase/migrations/071_scheduling.sql`, `073_scheduling_hardening.sql`, `089_event_types_location_kinds.sql`, `090_bookings_location_kind.sql`, `1139_event_types_booking_type.sql`, `1140_user_availability_multi_slot.sql`, `1142_scheduling_conflict_calendars.sql`, `1202_rename_scheduling_to_calendar.sql`, `1212_xkedule_booking_mirror.sql`, `1224_booking_status_showed.sql` — full files read
- `tests/calendar-bookings.test.ts`, `tests/calendar-slots.test.ts`, `tests/contact-identity-trigger.test.ts`, `tests/rls-isolation.test.ts`, `tests/agents/rls.test.ts` — full/partial reads
- `src/types/database.ts` (bookings Row/Insert types, lines 4521-4561) — read
- `vitest.config.ts`, `tests/setup/load-env.ts`, `package.json` — read
- `.planning/config.json` (`workflow.nyquist_validation: true`) — read

### Secondary (MEDIUM-HIGH confidence — WebSearch, cross-verified against multiple sources)
- [PostgreSQL 18 Range Types documentation](https://www.postgresql.org/docs/current/rangetypes.html) — exclusion constraint / range type semantics
- [Postgres Extensions Overview | Supabase Docs](https://supabase.com/docs/guides/database/extensions) — confirms `btree_gist` is a standard available extension on Supabase
- [The btree_gist extension - Neon Docs](https://neon.com/docs/extensions/btree_gist) — corroborating syntax/usage source
- [PostgreSQL's GiST Exclusion Constraint: The Database-Level Answer to Double Bookings](https://amitavroy.com/articles/postgresql-gist-exclusion-constraintthe-database-evel-answer-to-double-bookings)
- [Avoiding range overlaps in PostgreSQL with EXCLUDE constraint — DEV Community](https://dev.to/franckpachot/postgresql-exclude-constraints-for-better-concurrency-than-serializable-pob)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all versions read directly from this worktree's `package.json`.
- Architecture (exclusion constraint approach): HIGH — cross-verified with 3+ independent current sources plus official Postgres docs; the `'[)'` half-open bound recommendation is derived directly from this codebase's own existing `overlaps()` semantics, not an external assumption.
- RLS findings: HIGH — every current policy on the 4 relevant tables was read from the actual migration files (cumulative history 071→1224), and "no anon client usage" was confirmed by grep across `src/`, not assumed.
- Migration numbering: MEDIUM — the worktree's own file listing is HIGH confidence; the live-DB ledger state is unverifiable from this session (no DB access), hence flagged as an Open Question requiring operator verification.

**Research date:** 2026-07-15
**Valid until:** ~2026-08-14 (30 days — stable domain, but the migration-numbering caveat should be re-checked at plan-execution time regardless of this date, since it depends on concurrent branch activity, not calendar time)
