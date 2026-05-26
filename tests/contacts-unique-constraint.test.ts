// tests/contacts-unique-constraint.test.ts
//
// Phase 107 race-protection proof for CID-07 (phone) and CID-08 (email)
// partial UNIQUE indexes. Uses TWO distinct pg.Client connections per race
// assertion (D-06) so the two INSERTs are not serialized within a single
// session.
//
// Soft-skips when DATABASE_URL / SUPABASE_DB_URL is not set, matching the
// pattern from tests/customfields-schema.test.ts.

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[contacts-unique-constraint] SUPABASE_DB_URL/DATABASE_URL missing — skipping race tests',
  )
}

let TEST_ORG_ID: string

suite('Phase 107 partial UNIQUE index race protection', () => {
  let probe: Client

  beforeAll(async () => {
    probe = new Client({ connectionString: DB_URL })
    await probe.connect()
    // Pick first org. RESEARCH.md Open Question 2: acceptable for prod (1 org).
    const { rows } = await probe.query(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!rows[0]) throw new Error('No organizations in DB — cannot run race test')
    TEST_ORG_ID = rows[0].id
  }, 30000)

  afterAll(async () => {
    if (probe) await probe.end()
  })

  it('CID-07: parallel inserts on same (org, phone) — exactly one wins', async () => {
    const phone = `+5511${Math.floor(900000000 + Math.random() * 100000000)}`
    const cA = new Client({ connectionString: DB_URL })
    const cB = new Client({ connectionString: DB_URL })
    await cA.connect()
    await cB.connect()
    const idA = randomUUID()
    const idB = randomUUID()
    try {
      const results = await Promise.allSettled([
        cA.query(
          `INSERT INTO public.contacts (id, org_id, name, phone, source)
           VALUES ($1, $2, 'race-A', $3, 'manual')`,
          [idA, TEST_ORG_ID, phone],
        ),
        cB.query(
          `INSERT INTO public.contacts (id, org_id, name, phone, source)
           VALUES ($1, $2, 'race-B', $3, 'manual')`,
          [idB, TEST_ORG_ID, phone],
        ),
      ])
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[]
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0].reason as { code?: string }).code).toBe('23505')
    } finally {
      await probe.query(
        'DELETE FROM public.contacts WHERE id IN ($1, $2)',
        [idA, idB],
      )
      await cA.end()
      await cB.end()
    }
  }, 30000)

  it('CID-08: parallel inserts on same (org, email) — exactly one wins', async () => {
    const email = `race-${randomUUID()}@example.com`
    const cA = new Client({ connectionString: DB_URL })
    const cB = new Client({ connectionString: DB_URL })
    await cA.connect()
    await cB.connect()
    const idA = randomUUID()
    const idB = randomUUID()
    try {
      const results = await Promise.allSettled([
        cA.query(
          `INSERT INTO public.contacts (id, org_id, name, email, source)
           VALUES ($1, $2, 'race-A', $3, 'manual')`,
          [idA, TEST_ORG_ID, email],
        ),
        cB.query(
          `INSERT INTO public.contacts (id, org_id, name, email, source)
           VALUES ($1, $2, 'race-B', $3, 'manual')`,
          [idB, TEST_ORG_ID, email],
        ),
      ])
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[]
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0].reason as { code?: string }).code).toBe('23505')
    } finally {
      await probe.query(
        'DELETE FROM public.contacts WHERE id IN ($1, $2)',
        [idA, idB],
      )
      await cA.end()
      await cB.end()
    }
  }, 30000)

  it('Partial index: archived_duplicate row does NOT block new live insert (same phone)', async () => {
    const phone = `+5511${Math.floor(900000000 + Math.random() * 100000000)}`
    const archivedId = randomUUID()
    const liveId = randomUUID()
    try {
      // 1. Insert archived row first.
      await probe.query(
        `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
         VALUES ($1, $2, 'archived', $3, 'manual', 'archived_duplicate')`,
        [archivedId, TEST_ORG_ID, phone],
      )
      // 2. Insert live row with same phone — should succeed (partial index excludes archived).
      await probe.query(
        `INSERT INTO public.contacts (id, org_id, name, phone, source)
         VALUES ($1, $2, 'live', $3, 'manual')`,
        [liveId, TEST_ORG_ID, phone],
      )
      // If we got here, no 23505 raised. Confirm both rows exist.
      const { rows } = await probe.query(
        'SELECT id, identity_status FROM public.contacts WHERE id IN ($1, $2) ORDER BY identity_status',
        [archivedId, liveId],
      )
      expect(rows).toHaveLength(2)
    } finally {
      await probe.query(
        'DELETE FROM public.contacts WHERE id IN ($1, $2)',
        [archivedId, liveId],
      )
    }
  }, 30000)
})
