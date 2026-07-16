// tests/calendar-lifecycle-rpc.test.ts
//
// Phase 127 (LIFE-01) — proves the exact behavior of migration 1251
// (supabase/migrations/1251_booking_lifecycle_transition.sql):
//
//   - A real transition (confirmed -> cancelled) atomically flips status and
//     returns {transitioned:true, old_status, new_status}.
//   - Re-requesting the SAME status is idempotent: returns
//     {transitioned:false, ...}, no exception, row unchanged.
//   - Requesting a DIFFERENT status not in p_allowed_from from a non-matching
//     current status raises illegal_transition.
//   - A p_org_id that does not match the booking's real org_id raises
//     booking_not_found (same error as a missing row -- proves the tenant
//     boundary re-check inside the RPC is real, not merely documented).
//   - A non-existent p_booking_id raises booking_not_found.
//   - The function body contains "FOR UPDATE" (row lock, proxy for atomicity
//     in this single-connection transactional test harness).
//
// IMPORTANT: migration 1251 is NOT yet applied to production (that happens
// via Plan 127-08's operator checkpoint). This suite must never leave schema
// changes or test data behind in a database it doesn't own the lifecycle
// of -- `.env.local` in this worktree points at the production Supabase
// project. So the ENTIRE suite runs inside a single Postgres transaction:
// BEGIN -> apply migration 1251's SQL verbatim -> create fixtures -> exercise
// the RPC (using SAVEPOINTs around statements expected to raise, so the
// outer transaction survives them) -> ROLLBACK in afterAll, always. Nothing
// here is ever committed. Soft-skips when SUPABASE_DB_URL/DATABASE_URL is
// absent, matching tests/calendar-overlap-constraint.test.ts.

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[calendar-lifecycle-rpc] SUPABASE_DB_URL/DATABASE_URL missing — skipping lifecycle RPC tests',
  )
}

interface TransitionResult {
  transitioned: boolean
  old_status: string
  new_status: string
}

suite('LIFE-01 transition_booking_status RPC (migration 1251, applied in-transaction only)', () => {
  let client: Client
  let orgId: string
  let userId: string
  let eventTypeId: string
  let bookingId: string
  let savepointCounter = 0

  // Runs `query` inside a SAVEPOINT and asserts it rejects, then rolls back
  // to the savepoint so the outer transaction remains usable for subsequent
  // statements — a plain failed query would otherwise abort the whole
  // transaction (including the migration DDL applied in beforeAll).
  async function expectRpcRejected(query: string, params: unknown[]) {
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

    // ----- Apply migration 1251's SQL verbatim, in-transaction only -----
    await client.query(`
      CREATE OR REPLACE FUNCTION public.transition_booking_status(
        p_booking_id uuid,
        p_org_id uuid,
        p_new_status text,
        p_allowed_from text[]
      ) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_current text;
        v_org_id uuid;
      BEGIN
        IF p_new_status NOT IN ('confirmed', 'cancelled', 'no_show', 'showed') THEN
          RAISE EXCEPTION 'invalid target status: %', p_new_status;
        END IF;

        SELECT status, org_id INTO v_current, v_org_id
          FROM public.bookings
          WHERE id = p_booking_id
          FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'booking_not_found';
        END IF;

        IF v_org_id IS DISTINCT FROM p_org_id THEN
          RAISE EXCEPTION 'booking_not_found';
        END IF;

        IF v_current = p_new_status THEN
          RETURN jsonb_build_object(
            'transitioned', false,
            'old_status', v_current,
            'new_status', v_current
          );
        END IF;

        IF NOT (v_current = ANY(p_allowed_from)) THEN
          RAISE EXCEPTION 'illegal_transition: cannot go from % to %', v_current, p_new_status;
        END IF;

        UPDATE public.bookings
          SET status = p_new_status, updated_at = now()
          WHERE id = p_booking_id;

        RETURN jsonb_build_object(
          'transitioned', true,
          'old_status', v_current,
          'new_status', p_new_status
        );
      END $$;
    `)

    await client.query(`
      REVOKE ALL ON FUNCTION public.transition_booking_status(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated
    `)
    await client.query(`
      GRANT EXECUTE ON FUNCTION public.transition_booking_status(uuid, uuid, text, text[]) TO service_role
    `)

    // ----- Fixtures: one org, one user, one event type, one confirmed booking -----
    const { rows: orgRows } = await client.query<{ id: string }>(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!orgRows[0]) throw new Error('No organizations in DB — cannot run LIFE-01 lifecycle RPC tests')
    orgId = orgRows[0].id

    const { rows: userRows } = await client.query<{ id: string }>(
      'SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1',
    )
    if (!userRows[0]) throw new Error('No auth.users in DB — cannot run LIFE-01 lifecycle RPC tests')
    userId = userRows[0].id

    eventTypeId = randomUUID()
    await client.query(
      `INSERT INTO public.event_types (id, org_id, user_id, title, slug, duration_minutes)
       VALUES ($1, $2, $3, 'LIFE-01 test type', $4, 30)`,
      [eventTypeId, orgId, userId, `life01-test-${randomUUID()}`],
    )

    bookingId = randomUUID()
    await client.query(
      `INSERT INTO public.bookings
         (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
       VALUES ($1, $2, $3, 'life01', 'life01@e.com', '2099-04-01T10:00:00Z', '2099-04-01T10:30:00Z', 'confirmed')`,
      [bookingId, orgId, eventTypeId],
    )
  }, 30000)

  afterAll(async () => {
    if (client) {
      // The whole suite (migration DDL + fixtures + RPC calls) ran inside
      // this one transaction. ROLLBACK discards everything — migration 1251
      // is intentionally NOT applied to production by this test; that
      // happens via Plan 127-08's operator checkpoint.
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  }, 30000)

  it('test 1 — real transition: confirmed -> cancelled returns transitioned:true and persists', async () => {
    const { rows } = await client.query<{ transition_booking_status: TransitionResult }>(
      `SELECT public.transition_booking_status($1, $2, 'cancelled', ARRAY['confirmed']) AS transition_booking_status`,
      [bookingId, orgId],
    )
    expect(rows[0].transition_booking_status).toEqual({
      transitioned: true,
      old_status: 'confirmed',
      new_status: 'cancelled',
    })

    const { rows: bookingRows } = await client.query<{ status: string }>(
      `SELECT status FROM public.bookings WHERE id = $1`,
      [bookingId],
    )
    expect(bookingRows[0].status).toBe('cancelled')
  })

  it('test 2 — idempotent no-op: re-requesting the SAME status returns transitioned:false, no exception', async () => {
    const { rows } = await client.query<{ transition_booking_status: TransitionResult }>(
      `SELECT public.transition_booking_status($1, $2, 'cancelled', ARRAY['confirmed']) AS transition_booking_status`,
      [bookingId, orgId],
    )
    expect(rows[0].transition_booking_status).toEqual({
      transitioned: false,
      old_status: 'cancelled',
      new_status: 'cancelled',
    })

    const { rows: bookingRows } = await client.query<{ status: string }>(
      `SELECT status FROM public.bookings WHERE id = $1`,
      [bookingId],
    )
    expect(bookingRows[0].status).toBe('cancelled')
  })

  it('test 3 — illegal_transition: a different target from a non-allowed current status raises', async () => {
    // Current status is now 'cancelled' (from test 1); p_allowed_from only
    // permits 'confirmed' -> this must raise, never silently apply.
    await expectRpcRejected(
      `SELECT public.transition_booking_status($1, $2, 'no_show', ARRAY['confirmed'])`,
      [bookingId, orgId],
    )

    const { rows: bookingRows } = await client.query<{ status: string }>(
      `SELECT status FROM public.bookings WHERE id = $1`,
      [bookingId],
    )
    expect(bookingRows[0].status).toBe('cancelled')
  })

  it('test 4 — booking_not_found: a p_org_id that does not match the booking real org_id raises', async () => {
    await expectRpcRejected(
      `SELECT public.transition_booking_status($1, $2, 'no_show', ARRAY['confirmed', 'cancelled'])`,
      [bookingId, randomUUID()],
    )

    const { rows: bookingRows } = await client.query<{ status: string }>(
      `SELECT status FROM public.bookings WHERE id = $1`,
      [bookingId],
    )
    expect(bookingRows[0].status).toBe('cancelled')
  })

  it('test 5 — booking_not_found: a non-existent p_booking_id raises', async () => {
    await expectRpcRejected(
      `SELECT public.transition_booking_status($1, $2, 'confirmed', ARRAY['cancelled'])`,
      [randomUUID(), orgId],
    )
  })

  it('test 6 — function body locks the row via FOR UPDATE (atomicity proxy)', async () => {
    const { rows } = await client.query<{ prosrc: string }>(
      `SELECT prosrc FROM pg_proc WHERE proname = 'transition_booking_status'`,
    )
    expect(rows[0]?.prosrc).toMatch(/FOR UPDATE/)
  })
})
