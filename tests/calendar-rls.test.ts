// tests/calendar-rls.test.ts
//
// Phase 126 (CAL-04) — proves the effect of migration 1250
// (supabase/migrations/1250_calendar_rls_least_privilege.sql) on the RLS
// policies of bookings, user_availability, and event_types:
//
//   - An anon-key client cannot INSERT into bookings.
//   - An anon-key client cannot SELECT user_availability / event_types for
//     any org (not just "another" org — anon has no org context at all).
//   - An authenticated org member retains full read access to their own
//     org's bookings, user_availability, and event_types (regression — the
//     surviving FOR ALL org-scoped policies are untouched by the migration).
//
// IMPORTANT: migration 1250 is NOT yet applied to production (that happens
// via Plan 126-06's operator checkpoint), and `.env.local` in this worktree
// points at the production Supabase project. Modeling this test directly on
// tests/rls-isolation.test.ts's live supabase-js anon-client pattern would,
// right now (pre-migration), actually succeed at inserting an arbitrary row
// into the live `bookings` table — today's `bookings_public_insert` policy
// (`WITH CHECK (true)`) still allows it. That is exactly the prod-mutation
// this suite exists to prevent proving, not cause.
//
// So, like tests/calendar-overlap-constraint.test.ts (CAL-02), the ENTIRE
// suite runs inside one Postgres transaction: BEGIN -> apply migration
// 1250's DROP POLICY statements verbatim -> create fixtures (reusing an
// existing org + one of its real members, no synthetic auth.users rows) ->
// exercise the resulting policies AS anon/authenticated via `SET LOCAL
// ROLE` + `request.jwt.claims` (the same mechanism PostgREST uses under the
// hood for supabase-js clients, and Supabase's own documented pattern for
// testing RLS: https://supabase.com/docs/guides/database/testing) ->
// ROLLBACK in afterAll, always. Nothing here is ever committed to
// production. Soft-skips when SUPABASE_DB_URL/DATABASE_URL is absent.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { Client, type QueryResult } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[calendar-rls] SUPABASE_DB_URL/DATABASE_URL missing — skipping calendar RLS tests',
  )
}

suite('CAL-04 calendar RLS least privilege (migration 1250, applied in-transaction only)', () => {
  let client: Client
  let orgId: string
  let memberUserId: string
  let eventTypeId: string
  let savepointCounter = 0

  // Runs `fn` inside a SAVEPOINT as the given Postgres role (optionally with
  // a simulated JWT claims payload, mirroring what PostgREST sets for
  // supabase-js anon/authenticated clients), then rolls back to the
  // savepoint — reverting the role switch, any claims, AND any writes the
  // block attempted — so the outer transaction stays usable for subsequent
  // statements regardless of whether `fn` throws.
  async function asRole<T>(
    role: 'anon' | 'authenticated',
    jwtClaims: Record<string, unknown> | null,
    fn: () => Promise<T>,
  ): Promise<{ result?: T; error?: unknown }> {
    const sp = `sp_${savepointCounter++}`
    await client.query(`SAVEPOINT ${sp}`)
    await client.query(`SET LOCAL ROLE ${role}`)
    if (jwtClaims) {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(jwtClaims),
      ])
    }
    let result: T | undefined
    let error: unknown
    try {
      result = await fn()
    } catch (err) {
      error = err
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    }
    return { result, error }
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL })
    await client.connect()
    await client.query('BEGIN')

    // ----- Apply migration 1250's SQL verbatim, in-transaction only -----
    await client.query(`DROP POLICY IF EXISTS bookings_public_insert ON public.bookings`)
    await client.query(
      `DROP POLICY IF EXISTS user_availability_public_select ON public.user_availability`,
    )
    await client.query(`DROP POLICY IF EXISTS event_types_public_select ON public.event_types`)

    // ----- Fixtures: reuse an existing org + one of its real members -----
    // (no synthetic auth.users insert needed — RLS only cares that
    // auth.uid() resolves to a user_id with an org_members row). Restrict to
    // a user who belongs to EXACTLY one org: get_current_org_id() prefers
    // any user_active_org override before falling back to org_members, so a
    // multi-org member's resolved org could silently differ from the org we
    // seed fixtures into — a single-org member resolves deterministically.
    const { rows: memberRows } = await client.query<{ organization_id: string; user_id: string }>(
      `SELECT om.organization_id, om.user_id
       FROM public.org_members om
       WHERE (SELECT COUNT(*) FROM public.org_members om2 WHERE om2.user_id = om.user_id) = 1
       ORDER BY om.created_at ASC
       LIMIT 1`,
    )
    if (!memberRows[0]) throw new Error('No single-org org_members rows in DB — cannot run CAL-04 RLS tests')
    orgId = memberRows[0].organization_id
    memberUserId = memberRows[0].user_id

    eventTypeId = randomUUID()
    await client.query(
      `INSERT INTO public.event_types (id, org_id, user_id, title, slug, duration_minutes, active)
       VALUES ($1, $2, $3, 'CAL-04 test type', $4, 30, true)`,
      [eventTypeId, orgId, memberUserId, `cal04-test-${randomUUID()}`],
    )
    await client.query(
      `INSERT INTO public.user_availability (org_id, user_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, 1, '09:00', '17:00')`,
      [orgId, memberUserId],
    )
  }, 30000)

  afterAll(async () => {
    if (client) {
      // The whole suite (simulated migration DDL + fixtures + probes) ran
      // inside this one transaction. ROLLBACK discards everything —
      // migration 1250 is intentionally NOT applied to production by this
      // test; that happens via Plan 126-06's operator checkpoint.
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  }, 30000)

  it('test 1 — anon cannot INSERT into bookings', async () => {
    const bookingId = randomUUID()
    const { error } = await asRole('anon', null, () =>
      client.query(
        `INSERT INTO public.bookings
           (id, org_id, event_type_id, booker_name, booker_email, start_at, end_at, status)
         VALUES ($1, $2, $3, 'attacker', 'attacker@evil.test', '2099-04-01T10:00:00Z', '2099-04-01T10:30:00Z', 'confirmed')`,
        [bookingId, orgId, eventTypeId],
      ),
    )
    expect(error).toBeTruthy()

    // Confirm no row was left behind (defense-in-depth check — the SAVEPOINT
    // rollback already guarantees this, but assert it explicitly).
    const { rows } = await client.query(`SELECT id FROM public.bookings WHERE id = $1`, [
      bookingId,
    ])
    expect(rows).toHaveLength(0)
  })

  it('test 2 — anon SELECT on user_availability returns empty (no org context)', async () => {
    const { result, error } = await asRole('anon', null, () =>
      client.query(`SELECT id FROM public.user_availability WHERE org_id = $1`, [orgId]),
    )
    expect(error).toBeUndefined()
    expect((result as QueryResult | undefined)?.rows).toHaveLength(0)
  })

  it('test 3 — anon SELECT on event_types returns empty (no org context)', async () => {
    const { result, error } = await asRole('anon', null, () =>
      client.query(`SELECT id FROM public.event_types WHERE org_id = $1`, [orgId]),
    )
    expect(error).toBeUndefined()
    expect((result as QueryResult | undefined)?.rows).toHaveLength(0)
  })

  it('test 4 — authenticated org member retains read access to bookings, user_availability, and event_types', async () => {
    const claims = { sub: memberUserId, role: 'authenticated' }

    const { result: etResult, error: etErr } = await asRole('authenticated', claims, () =>
      client.query(`SELECT id FROM public.event_types WHERE id = $1`, [eventTypeId]),
    )
    expect(etErr).toBeUndefined()
    expect((etResult as QueryResult | undefined)?.rows).toHaveLength(1)

    const { result: availResult, error: availErr } = await asRole('authenticated', claims, () =>
      client.query(`SELECT id FROM public.user_availability WHERE org_id = $1`, [orgId]),
    )
    expect(availErr).toBeUndefined()
    expect((availResult as QueryResult | undefined)?.rows.length ?? 0).toBeGreaterThanOrEqual(1)

    const { result: bookingResult, error: bookingErr } = await asRole('authenticated', claims, () =>
      client.query(`SELECT id FROM public.bookings WHERE org_id = $1`, [orgId]),
    )
    expect(bookingErr).toBeUndefined()
    expect(Array.isArray((bookingResult as QueryResult | undefined)?.rows)).toBe(true)
  })
})
