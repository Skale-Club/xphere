// tests/integrations-rls.test.ts
//
// SYNC-01 (Google org ownership) — regression proof, NOT a fix. Confirms a
// premise correction in 129-RESEARCH.md: the `integrations` table (storing
// each org's Google Calendar OAuth connection, provider = 'google_calendar')
// has been org-scoped via RLS since migration 002 — organization_id NOT NULL,
// UNIQUE (organization_id, provider) since migration 009, and
// integrations_select/insert/update/delete policies scoped to
// organization_id = get_current_org_id(). No migration is required for
// SYNC-01's org-ownership clause; this test exists so a future regression
// (e.g. someone loosening these policies) fails CI instead of silently
// reopening cross-tenant Google Calendar credential access.
//
// Like tests/calendar-rls.test.ts (Phase 126, CAL-04), this runs entirely
// inside one Postgres transaction (fixtures inserted, probed via SET LOCAL
// ROLE + request.jwt.claims, then ROLLBACK in afterAll) because .env.local
// in this worktree points at the PRODUCTION Supabase project — no row from
// this suite is ever committed. Soft-skips when SUPABASE_DB_URL/DATABASE_URL
// is absent.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client, type QueryResult } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn('[integrations-rls] SUPABASE_DB_URL/DATABASE_URL missing — skipping integrations RLS tests')
}

suite('SYNC-01 integrations org-ownership (regression proof, no migration)', () => {
  let client: Client
  let orgAId: string
  let orgAUserId: string
  let orgBId: string
  let integrationAId: string
  let integrationBId: string
  let savepointCounter = 0

  async function asRole<T>(
    role: 'anon' | 'authenticated',
    jwtClaims: Record<string, unknown> | null,
    fn: () => Promise<T>,
  ): Promise<{ result?: T; error?: unknown }> {
    const sp = `sp_${savepointCounter++}`
    await client.query(`SAVEPOINT ${sp}`)
    await client.query(`SET LOCAL ROLE ${role}`)
    if (jwtClaims) {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(jwtClaims)])
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

    // Two DISTINCT orgs, each with a real single-org member (get_current_org_id()
    // prefers user_active_org before falling back to org_members — a single-org
    // member resolves deterministically without a synthetic override row).
    const { rows } = await client.query<{ organization_id: string; user_id: string }>(
      `SELECT om.organization_id, om.user_id
       FROM public.org_members om
       WHERE (SELECT COUNT(*) FROM public.org_members om2 WHERE om2.user_id = om.user_id) = 1
       ORDER BY om.organization_id, om.created_at ASC`,
    )
    const distinctOrgs = new Map<string, string>()
    for (const r of rows) {
      if (!distinctOrgs.has(r.organization_id)) distinctOrgs.set(r.organization_id, r.user_id)
      if (distinctOrgs.size === 2) break
    }
    if (distinctOrgs.size < 2) {
      throw new Error('Need at least 2 distinct single-org org_members rows in DB to run SYNC-01 RLS tests')
    }
    const entries = [...distinctOrgs.entries()]
    orgAId = entries[0][0]; orgAUserId = entries[0][1]
    orgBId = entries[1][0]

    integrationAId = randomUUID()
    integrationBId = randomUUID()
    await client.query(
      `INSERT INTO public.integrations (id, organization_id, provider, name, encrypted_api_key, config)
       VALUES ($1, $2, 'google_calendar', 'Org A Google Calendar', 'test-enc-blob-a', '{}'::jsonb)`,
      [integrationAId, orgAId],
    )
    await client.query(
      `INSERT INTO public.integrations (id, organization_id, provider, name, encrypted_api_key, config)
       VALUES ($1, $2, 'google_calendar', 'Org B Google Calendar', 'test-enc-blob-b', '{}'::jsonb)`,
      [integrationBId, orgBId],
    )
  }, 30000)

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {})
      await client.end()
    }
  }, 30000)

  it("test 1 — an authenticated member of org A reading google_calendar integrations sees only org A's row", async () => {
    const { result, error } = await asRole('authenticated', { sub: orgAUserId, role: 'authenticated' }, () =>
      client.query(`SELECT id, organization_id FROM public.integrations WHERE provider = 'google_calendar'`),
    )
    expect(error).toBeUndefined()
    const ids = (result as QueryResult | undefined)?.rows.map((r) => r.id) ?? []
    expect(ids).toContain(integrationAId)
    expect(ids).not.toContain(integrationBId)
  })

  it('test 2 — anon (no JWT claims) cannot read any integrations row', async () => {
    const { result, error } = await asRole('anon', null, () =>
      client.query(`SELECT id FROM public.integrations WHERE provider = 'google_calendar'`),
    )
    expect(error).toBeUndefined()
    expect((result as QueryResult | undefined)?.rows).toHaveLength(0)
  })

  it("test 3 — an authenticated member of org A cannot INSERT an integrations row claiming org B's organization_id", async () => {
    const forgedId = randomUUID()
    const { error } = await asRole('authenticated', { sub: orgAUserId, role: 'authenticated' }, () =>
      client.query(
        `INSERT INTO public.integrations (id, organization_id, provider, name, encrypted_api_key, config)
         VALUES ($1, $2, 'google_calendar', 'forged', 'x', '{}'::jsonb)`,
        [forgedId, orgBId],
      ),
    )
    expect(error).toBeTruthy()
    const { rows } = await client.query(`SELECT id FROM public.integrations WHERE id = $1`, [forgedId])
    expect(rows).toHaveLength(0)
  })
})
