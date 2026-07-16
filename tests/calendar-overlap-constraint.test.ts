// tests/calendar-overlap-constraint.test.ts
//
// Phase 126 (CAL-02) — proves the exact behavior of migration 1249
// (supabase/migrations/1249_bookings_organizer_overlap_guard.sql):
//
//   - CHECK (start_at < end_at) rejects malformed intervals.
//   - EXCLUDE USING gist (organizer_user_id WITH =, tstzrange(...) WITH &&)
//     WHERE (status = 'confirmed' AND external_source IS NULL) rejects two
//     confirmed, native bookings for the same organizer that overlap in
//     time, even across different event_type_ids — the actual CAL-02 gap
//     (today's unique index is scoped to a single event_type_id).
//   - Back-to-back bookings (one ending exactly when the next starts) are
//     NOT rejected — the '[)' half-open range must not falsely collide.
//   - Overlapping Xkedule mirror bookings (external_source='xkedule') are
//     NOT rejected — mirror rows stay exempt per migration 1212's precedent.
//
// IMPORTANT: migration 1249 is NOT yet applied to production (that happens
// via Plan 126-06's operator checkpoint). This suite must never leave schema
// changes or test data behind in a database it doesn't own the lifecycle
// of — `.env.local` in this worktree points at the production Supabase
// project. So the ENTIRE suite runs inside a single Postgres transaction:
// BEGIN → apply migration 1249's SQL verbatim → create fixtures → exercise
// the constraint (using SAVEPOINTs around statements expected to fail, so
// the outer transaction survives them) → ROLLBACK in afterAll, always.
// Nothing here is ever committed. Soft-skips when SUPABASE_DB_URL/
// DATABASE_URL is absent, matching tests/contact-identity-trigger.test.ts.

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[calendar-overlap-constraint] SUPABASE_DB_URL/DATABASE_URL missing — skipping overlap constraint tests',
  )
}

suite('CAL-02 booking organizer overlap guard (migration 1249, applied in-transaction only)', () => {
  let client: Client
  let orgId: string
  let userId: string
  let eventTypeId1: string
  let eventTypeId2: string
  let savepointCounter = 0

  // Runs `query` inside a SAVEPOINT and asserts it rejects, then rolls back
  // to the savepoint so the outer transaction remains usable for subsequent
  // statements — a plain failed query would otherwise abort the whole
  // transaction (including the migration DDL applied in beforeAll).
  async function expectInsertRejected(query: string, params: unknown[]) {
    const sp = `sp_${savepointCounter++}`
    await client.query(`SAVEPOINT ${sp}`)
    let threw = false
    try {
      await client.query(query, params)
    } catch {
      threw = true
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    }
    expect(threw).toBe(true)
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL })
    await client.connect()
    await client.query('BEGIN')

    // ----- Apply migration 1249's SQL verbatim, in-transaction only -----
    await client.query(`CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions`)

    await client.query(`
      ALTER TABLE public.bookings
        ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id)
    `)

    await client.query(`
      UPDATE public.bookings b
        SET organizer_user_id = et.user_id
        FROM public.event_types et
        WHERE b.event_type_id = et.id AND b.organizer_user_id IS NULL
    `)

    await client.query(`
      CREATE OR REPLACE FUNCTION public.set_booking_organizer()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.organizer_user_id IS NULL THEN
          SELECT user_id INTO NEW.organizer_user_id
          FROM public.event_types WHERE id = NEW.event_type_id;
        END IF;
        RETURN NEW;
      END;
      $$
    `)

    await client.query(`DROP TRIGGER IF EXISTS trg_bookings_set_organizer ON public.bookings`)
    await client.query(`
      CREATE TRIGGER trg_bookings_set_organizer
        BEFORE INSERT OR UPDATE OF event_type_id ON public.bookings
        FOR EACH ROW EXECUTE FUNCTION public.set_booking_organizer()
    `)

    await client.query(`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_valid_interval`)
    await client.query(`
      ALTER TABLE public.bookings
        ADD CONSTRAINT bookings_valid_interval CHECK (start_at < end_at)
    `)

    await client.query(`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_organizer_overlap`)
    await client.query(`
      ALTER TABLE public.bookings
        ADD CONSTRAINT bookings_no_organizer_overlap
        EXCLUDE USING gist (
          organizer_user_id WITH =,
          tstzrange(start_at, end_at, '[)') WITH &&
        )
        WHERE (status = 'confirmed' AND external_source IS NULL)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_organizer_user_id
        ON public.bookings (organizer_user_id)
    `)

    // ----- Fixtures: one org, one user, two event types for that user -----
    const { rows: orgRows } = await client.query<{ id: string }>(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!orgRows[0]) throw new Error('No organizations in DB — cannot run CAL-02 overlap tests')
    orgId = orgRows[0].id

    const { rows: userRows } = await client.query<{ id: string }>(
      'SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1',
    )
    if (!userRows[0]) throw new Error('No auth.users in DB — cannot run CAL-02 overlap tests')
    userId = userRows[0].id

    eventTypeId1 = randomUUID()
    eventTypeId2 = randomUUID()
    await client.query(
      `INSERT INTO public.event_types (id, org_id, user_id, title, slug, duration_minutes)
       VALUES ($1, $2, $3, 'CAL-02 test type A', $4, 30)`,
      [eventTypeId1, orgId, userId, `cal02-test-a-${randomUUID()}`],
    )
    await client.query(
      `INSERT INTO public.event_types (id, org_id, user_id, title, slug, duration_minutes)
       VALUES ($1, $2, $3, 'CAL-02 test type B', $4, 30)`,
      [eventTypeId2, orgId, userId, `cal02-test-b-${randomUUID()}`],
    )
  }, 30000)

  afterAll(async () => {
    if (client) {
      // The whole suite (migration DDL + fixtures + test bookings) ran
      // inside this one transaction. ROLLBACK discards everything —
      // migration 1249 is intentionally NOT applied to production by this
      // test; that happens via Plan 126-06's operator checkpoint.
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  }, 30000)

  it('test 1 — CHECK(start_at < end_at): malformed interval is rejected', async () => {
    await expectInsertRejected(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 't', 't@e.com', $4, $5, 'confirmed')`,
      [randomUUID(), orgId, eventTypeId1, '2099-03-01T12:00:00Z', '2099-03-01T11:00:00Z'],
    )
  })

  it('test 2 — cross-event-type overlap for the same organizer is rejected', async () => {
    const bookingAId = randomUUID()
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'a', 'a@e.com', '2099-03-02T10:00:00Z', '2099-03-02T10:30:00Z', 'confirmed')`,
      [bookingAId, orgId, eventTypeId1],
    )

    // Same organizer (eventTypeId2 shares userId), overlapping range, DIFFERENT
    // event_type_id — the actual CAL-02 gap: idx_bookings_event_slot_unique
    // (migration 073/1212) is scoped to event_type_id and would NOT catch this.
    await expectInsertRejected(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'b', 'b@e.com', '2099-03-02T10:15:00Z', '2099-03-02T10:45:00Z', 'confirmed')`,
      [randomUUID(), orgId, eventTypeId2],
    )

    await client.query(`DELETE FROM public.bookings WHERE id = $1`, [bookingAId])
  })

  it('test 3 — back-to-back bookings (touching endpoints) are allowed', async () => {
    const bookingAId = randomUUID()
    const bookingBId = randomUUID()
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'a', 'a@e.com', '2099-03-03T10:00:00Z', '2099-03-03T10:30:00Z', 'confirmed')`,
      [bookingAId, orgId, eventTypeId1],
    )
    // Booking B starts exactly when booking A ends — the '[)' half-open
    // range must NOT treat this as an overlap.
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'b', 'b@e.com', '2099-03-03T10:30:00Z', '2099-03-03T11:00:00Z', 'confirmed')`,
      [bookingBId, orgId, eventTypeId2],
    )

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM public.bookings WHERE id = ANY($1::uuid[])`,
      [[bookingAId, bookingBId]],
    )
    expect(rows).toHaveLength(2)

    await client.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[])`, [[bookingAId, bookingBId]])
  })

  it('test 4 — overlapping Xkedule mirror bookings (external_source=xkedule) are exempt', async () => {
    const bookingAId = randomUUID()
    const bookingBId = randomUUID()
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status, external_source)
       VALUES ($1, $2, $3, 'a', 'a@e.com', '2099-03-04T10:00:00Z', '2099-03-04T10:30:00Z', 'confirmed', NULL)`,
      [bookingAId, orgId, eventTypeId1],
    )
    // Fully overlapping range, same organizer, but external_source='xkedule'
    // — the constraint's WHERE (external_source IS NULL) exempts mirror rows.
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status, external_source, external_id)
       VALUES ($1, $2, $3, 'b', 'b@e.com', '2099-03-04T10:00:00Z', '2099-03-04T10:30:00Z', 'confirmed', 'xkedule', $4)`,
      [bookingBId, orgId, eventTypeId2, `cal02-xkedule-${randomUUID()}`],
    )

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM public.bookings WHERE id = ANY($1::uuid[])`,
      [[bookingAId, bookingBId]],
    )
    expect(rows).toHaveLength(2)

    await client.query(`DELETE FROM public.bookings WHERE id = ANY($1::uuid[])`, [[bookingAId, bookingBId]])
  })
})
