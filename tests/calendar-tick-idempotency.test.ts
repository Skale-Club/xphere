// tests/calendar-tick-idempotency.test.ts
//
// Phase 128 (SCH-01/SCH-02/SCH-03) — proves, against a real (but rolled-back,
// never-committed) Postgres transaction:
//
//   - `calendar_tick_watermark` (this plan's migration) persists a durable
//     scan-progress cursor per event_type, and can be upserted (advanced)
//     without losing prior state — this IS the "durable scheduling progress"
//     SCH-03 requires.
//   - Two claim attempts at the same (workflow_id, booking_id, event_type,
//     offset-derived target_minute) key — simulating an overlapping or
//     retried tick covering the same due-moment — result in exactly one
//     successful row (the second is rejected by the existing composite
//     primary key on `scheduled_workflow_ticks`, migration 087).
//   - Contrastingly, the OLD wall-clock-derived key shape (what the pre-fix
//     route.ts wrote) would NOT have caught this collision: two different
//     wall-clock-derived `fired_minute` values for the same
//     (workflow, booking, event_type) both succeed — proving why the key
//     must be offset-derived, not just documenting that it now is.
//
// IMPORTANT: this plan's migration (supabase/migrations/1252_calendar_tick_
// watermark.sql) is NOT yet applied to production (that happens via Plan
// 128-06's operator checkpoint). This suite must never leave schema changes
// or test data behind in a database it doesn't own the lifecycle of —
// `.env.local` in this worktree points at the production Supabase project.
// So the ENTIRE suite runs inside a single Postgres transaction: BEGIN →
// apply the migration's SQL verbatim → create fixtures → exercise the
// constraint (using SAVEPOINTs around statements expected to fail, so the
// outer transaction survives them) → ROLLBACK in afterAll, always. Nothing
// here is ever committed. Soft-skips when SUPABASE_DB_URL/DATABASE_URL is
// absent, matching tests/calendar-overlap-constraint.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

import { computeStartsInTargetMinute, computeEndedTargetMinute } from '@/lib/calendar/tick'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[calendar-tick-idempotency] SUPABASE_DB_URL/DATABASE_URL missing — skipping watermark + dedup-key idempotency tests',
  )
}

const FIXTURE_START_AT = '2099-05-01T14:00:00Z'
const FIXTURE_END_AT = '2099-05-01T14:30:00Z'

suite('SCH-01/SCH-02/SCH-03 calendar tick watermark + offset-derived dedup key (migration 1252, applied in-transaction only)', () => {
  let client: Client
  let orgId: string
  let userId: string
  let eventTypeId: string
  let workflowId: string
  let bookingId: string
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

    // ----- Apply this plan's migration SQL verbatim, in-transaction only -----
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.calendar_tick_watermark (
        event_type  text        PRIMARY KEY,
        scanned_to  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `)

    await client.query(
      `DROP TRIGGER IF EXISTS trg_calendar_tick_watermark_updated_at ON public.calendar_tick_watermark`,
    )
    await client.query(`
      CREATE TRIGGER trg_calendar_tick_watermark_updated_at
        BEFORE UPDATE ON public.calendar_tick_watermark
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()
    `)

    await client.query(`ALTER TABLE public.calendar_tick_watermark ENABLE ROW LEVEL SECURITY`)

    await client.query(`
      INSERT INTO public.calendar_tick_watermark (event_type, scanned_to)
      VALUES ('meeting.starts_in', now()), ('meeting.ended', now())
      ON CONFLICT (event_type) DO NOTHING
    `)

    await client.query(`
      COMMENT ON COLUMN public.scheduled_workflow_ticks.fired_minute IS
        'SCH-02: the offset-derived due-moment (booking.start_at + offset, or booking.end_at, truncated to the minute) — NOT wall-clock tick time. Must be stable across retries/catch-up so the composite primary key on this table is a true exactly-once guarantee. See src/lib/calendar/tick.ts computeStartsInTargetMinute / computeEndedTargetMinute.'
    `)

    await client.query(`
      COMMENT ON TABLE public.calendar_tick_watermark IS
        'SCH-01/SCH-03: durable scan-progress cursor for calendar-tick. One row per event_type; scanned_to advances after each tick pass that completed with zero released dispatches.'
    `)

    // ----- Fixtures: one org, one user, one event type, one workflow, one booking -----
    const { rows: orgRows } = await client.query<{ id: string }>(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!orgRows[0]) throw new Error('No organizations in DB — cannot run calendar-tick idempotency tests')
    orgId = orgRows[0].id

    const { rows: userRows } = await client.query<{ id: string }>(
      'SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1',
    )
    if (!userRows[0]) throw new Error('No auth.users in DB — cannot run calendar-tick idempotency tests')
    userId = userRows[0].id

    eventTypeId = randomUUID()
    await client.query(
      `INSERT INTO public.event_types (id, org_id, user_id, title, slug, duration_minutes)
       VALUES ($1, $2, $3, 'CAL-128-04 test type', $4, 30)`,
      [eventTypeId, orgId, userId, `cal-128-04-test-${randomUUID()}`],
    )

    workflowId = randomUUID()
    await client.query(
      `INSERT INTO public.workflows (id, org_id, name, slug, trigger_type, trigger_config, is_active)
       VALUES ($1, $2, 'CAL-128-04 test workflow', $3, 'event', $4::jsonb, true)`,
      [
        workflowId,
        orgId,
        `cal-128-04-test-wf-${randomUUID()}`,
        JSON.stringify({ event: 'meeting.starts_in', offset: '-5m' }),
      ],
    )

    bookingId = randomUUID()
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'CAL-128-04 test booker', 'cal128-04@example.com', $4, $5, 'confirmed')`,
      [bookingId, orgId, eventTypeId, FIXTURE_START_AT, FIXTURE_END_AT],
    )
  }, 30000)

  afterAll(async () => {
    if (client) {
      // The whole suite (migration DDL + fixtures + test rows) ran inside
      // this one transaction. ROLLBACK discards everything — this plan's
      // migration is intentionally NOT applied to production by this test;
      // that happens via Plan 128-06's operator checkpoint.
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  }, 30000)

  it('test 1 — computeStartsInTargetMinute is stable across repeated calls with the identical (startAt, offset) pair', () => {
    const startAt = new Date(FIXTURE_START_AT)
    const first = computeStartsInTargetMinute(startAt, -5)
    const second = computeStartsInTargetMinute(startAt, -5)
    expect(first.toISOString()).toBe(second.toISOString())
    expect(first.toISOString()).toBe('2099-05-01T13:55:00.000Z')

    // Sanity-check computeEndedTargetMinute's truncation too, since both
    // functions feed the same fired_minute column.
    expect(computeEndedTargetMinute(new Date(FIXTURE_END_AT)).toISOString()).toBe(
      '2099-05-01T14:30:00.000Z',
    )
  })

  it('test 2+3 — offset-derived key: first claim succeeds, a retried/overlapping tick recomputing the identical key is rejected by the composite primary key', async () => {
    const targetMinute = computeStartsInTargetMinute(new Date(FIXTURE_START_AT), -5)

    await client.query(
      `INSERT INTO public.scheduled_workflow_ticks (workflow_id, booking_id, event_type, fired_minute)
       VALUES ($1, $2, 'meeting.starts_in', $3)`,
      [workflowId, bookingId, targetMinute.toISOString()],
    )

    // Same booking's due-moment, recomputed by a second, later/overlapping
    // tick invocation — must resolve to the identical key and be rejected.
    await expectInsertRejected(
      `INSERT INTO public.scheduled_workflow_ticks (workflow_id, booking_id, event_type, fired_minute)
       VALUES ($1, $2, 'meeting.starts_in', $3)`,
      [workflowId, bookingId, targetMinute.toISOString()],
    )
  })

  it('test 4 — contrast case: two DIFFERENT wall-clock-derived fired_minute values for the same (workflow, booking, event_type) both succeed, proving the OLD key shape could not have prevented double-dispatch', async () => {
    const secondBookingId = randomUUID()
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'CAL-128-04 test booker 2', 'cal128-04-b@example.com', '2099-05-02T09:00:00Z', '2099-05-02T09:30:00Z', 'confirmed')`,
      [secondBookingId, orgId, eventTypeId],
    )

    // Two different ticks scanning the SAME real-world due-moment, but each
    // stamping fired_minute with its OWN wall-clock dispatch time (the
    // pre-fix bug) — the composite PK does not catch this, because the key
    // values genuinely differ. This is the exact gap the offset-derived key
    // (tests 2+3 above) closes.
    await client.query(
      `INSERT INTO public.scheduled_workflow_ticks (workflow_id, booking_id, event_type, fired_minute)
       VALUES ($1, $2, 'meeting.starts_in', '2099-05-02T10:00:00Z')`,
      [workflowId, secondBookingId],
    )
    await client.query(
      `INSERT INTO public.scheduled_workflow_ticks (workflow_id, booking_id, event_type, fired_minute)
       VALUES ($1, $2, 'meeting.starts_in', '2099-05-02T13:00:00Z')`,
      [workflowId, secondBookingId],
    )

    const { rows } = await client.query<{ fired_minute: string }>(
      `SELECT fired_minute FROM public.scheduled_workflow_ticks WHERE booking_id = $1`,
      [secondBookingId],
    )
    expect(rows).toHaveLength(2)

    // This test intentionally creates a duplicate real-world dispatch — clean
    // it up explicitly so it doesn't leak into later assertions even within
    // the rolled-back transaction.
    await client.query(`DELETE FROM public.scheduled_workflow_ticks WHERE booking_id = $1`, [
      secondBookingId,
    ])
    await client.query(`DELETE FROM public.bookings WHERE id = $1`, [secondBookingId])
  })

  it('test 5 — calendar_tick_watermark is seeded with both known event types, each with a non-null scanned_to', async () => {
    const { rows } = await client.query<{ event_type: string; scanned_to: string | null }>(
      `SELECT event_type, scanned_to FROM public.calendar_tick_watermark ORDER BY event_type`,
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.event_type)).toEqual(['meeting.ended', 'meeting.starts_in'])
    for (const row of rows) {
      expect(row.scanned_to).not.toBeNull()
    }
  })

  it('test 6 — upserting calendar_tick_watermark advances scanned_to durably, proving the persisted-progress mechanism', async () => {
    await client.query(
      `INSERT INTO public.calendar_tick_watermark (event_type, scanned_to)
       VALUES ('meeting.starts_in', $1)
       ON CONFLICT (event_type) DO UPDATE SET scanned_to = EXCLUDED.scanned_to`,
      ['2099-05-01T15:00:00Z'],
    )

    const { rows } = await client.query<{ scanned_to: string }>(
      `SELECT scanned_to FROM public.calendar_tick_watermark WHERE event_type = 'meeting.starts_in'`,
    )
    expect(new Date(rows[0].scanned_to).toISOString()).toBe('2099-05-01T15:00:00.000Z')
  })
})
