// tests/contact-channel-identity.test.ts
//
// Phase 108 final validation — proves the four invariants of
// contact_channel_identities (CID-09, CID-10, CID-11):
//
//   1. UNIQUE (org_id, provider, external_id) — parallel INSERTs of the same
//      tuple collide on the storage layer with SQLSTATE 23505 (D-03a / D-06).
//   2. ON DELETE CASCADE — deleting a contact removes its identity rows.
//   3. findByChannelIdentity resolves the merged_into_contact_id chain to the
//      live survivor (one-hop, mirrors resolveLiveContactId semantics).
//   4. attachChannelIdentity is idempotent — second call with same args returns
//      the same contact_id and does not produce a duplicate row.
//
// Soft-skips when DATABASE_URL / SUPABASE_DB_URL is not set, matching the
// Phase 107 pattern (`tests/contacts-unique-constraint.test.ts`).

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  findByChannelIdentity,
  attachChannelIdentity,
} from '@/lib/contacts/server'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(DB_URL && SUPABASE_URL && SERVICE_KEY)
const suite = hasEnv ? describe : describe.skip

if (!hasEnv) {
  console.warn(
    '[contact-channel-identity] DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / ' +
      'SUPABASE_SERVICE_ROLE_KEY missing — skipping integration tests',
  )
}

suite('Phase 108 contact_channel_identities', () => {
  let probe: Client
  let TEST_ORG_ID: string
  const createdContactIds: string[] = []
  const createdIdentityIds: string[] = []

  beforeAll(async () => {
    probe = new Client({ connectionString: DB_URL })
    await probe.connect()
    const { rows } = await probe.query(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!rows[0]) throw new Error('No organizations in DB — cannot run Phase 108 tests')
    TEST_ORG_ID = rows[0].id
  }, 30000)

  afterAll(async () => {
    // Identities first (some contacts may already be deleted by cascade test).
    if (createdIdentityIds.length) {
      await probe.query(
        'DELETE FROM public.contact_channel_identities WHERE id = ANY($1::uuid[])',
        [createdIdentityIds],
      )
    }
    if (createdContactIds.length) {
      // Cascade removes any remaining identity rows.
      await probe.query(
        'DELETE FROM public.contacts WHERE id = ANY($1::uuid[])',
        [createdContactIds],
      )
    }
    if (probe) await probe.end()
  }, 30000)

  async function insertContact(
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const id = randomUUID()
    const name = 'phase108-test-' + Math.random().toString(36).slice(2, 8)
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, source)
       VALUES ($1, $2, $3, 'manual')`,
      [id, TEST_ORG_ID, name],
    )
    createdContactIds.push(id)
    if (Object.keys(extra).length) {
      const keys = Object.keys(extra)
      const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
      await probe.query(
        `UPDATE public.contacts SET ${setClauses} WHERE id = $1`,
        [id, ...keys.map((k) => extra[k])],
      )
    }
    return id
  }

  it('UNIQUE (org_id, provider, external_id) — parallel INSERTs collide with 23505', async () => {
    const cA = await insertContact()
    const cB = await insertContact()
    const externalId = 'race-' + randomUUID()

    // Two DISTINCT pg.Client connections so the inserts are not serialized
    // within a single session (Phase 107 D-06 pattern).
    const connA = new Client({ connectionString: DB_URL })
    const connB = new Client({ connectionString: DB_URL })
    await connA.connect()
    await connB.connect()
    try {
      const results = await Promise.allSettled([
        connA.query(
          `INSERT INTO public.contact_channel_identities
             (org_id, contact_id, provider, external_id)
           VALUES ($1, $2, 'webchat', $3)`,
          [TEST_ORG_ID, cA, externalId],
        ),
        connB.query(
          `INSERT INTO public.contact_channel_identities
             (org_id, contact_id, provider, external_id)
           VALUES ($1, $2, 'webchat', $3)`,
          [TEST_ORG_ID, cB, externalId],
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
      // Cleanup: remove the surviving identity row by tuple.
      await probe.query(
        `DELETE FROM public.contact_channel_identities
         WHERE org_id = $1 AND provider = 'webchat' AND external_id = $2`,
        [TEST_ORG_ID, externalId],
      )
      await connA.end()
      await connB.end()
    }
  }, 30000)

  it('ON DELETE CASCADE — deleting contact removes its identity rows', async () => {
    const c = await insertContact()
    const externalId = 'cascade-' + randomUUID()
    await probe.query(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'telegram', $3)`,
      [TEST_ORG_ID, c, externalId],
    )

    // Remove c from cleanup list — we delete it here intentionally.
    const idx = createdContactIds.indexOf(c)
    if (idx >= 0) createdContactIds.splice(idx, 1)

    await probe.query('DELETE FROM public.contacts WHERE id = $1', [c])

    const { rows } = await probe.query(
      `SELECT count(*)::int AS n
       FROM public.contact_channel_identities
       WHERE org_id = $1 AND provider = 'telegram' AND external_id = $2`,
      [TEST_ORG_ID, externalId],
    )
    expect(rows[0].n).toBe(0)
  }, 30000)

  it('findByChannelIdentity resolves merged_into chain to live survivor', async () => {
    const survivor = await insertContact()
    const archived = await insertContact({
      identity_status: 'archived_duplicate',
      merged_into_contact_id: survivor,
    })
    const externalId = 'chain-' + randomUUID()
    const { rows: insRows } = await probe.query(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'instagram', $3)
       RETURNING id`,
      [TEST_ORG_ID, archived, externalId],
    )
    createdIdentityIds.push(insRows[0].id)

    const sb = createClient(SUPABASE_URL!, SERVICE_KEY!)
    const hit = await findByChannelIdentity(
      sb,
      TEST_ORG_ID,
      'instagram',
      externalId,
    )
    expect(hit).not.toBeNull()
    expect(hit!.contact_id).toBe(survivor)
  }, 30000)

  it('attachChannelIdentity is idempotent — second call returns same contact_id, no duplicate row', async () => {
    const c = await insertContact()
    const externalId = 'idem-' + randomUUID()
    const sb = createClient(SUPABASE_URL!, SERVICE_KEY!)

    const r1 = await attachChannelIdentity(
      sb,
      TEST_ORG_ID,
      c,
      'whatsapp',
      externalId,
    )
    const r2 = await attachChannelIdentity(
      sb,
      TEST_ORG_ID,
      c,
      'whatsapp',
      externalId,
    )
    expect(r1?.contact_id).toBe(c)
    expect(r2?.contact_id).toBe(c)

    const { rows } = await probe.query(
      `SELECT id FROM public.contact_channel_identities
       WHERE org_id = $1 AND provider = 'whatsapp' AND external_id = $2`,
      [TEST_ORG_ID, externalId],
    )
    expect(rows.length).toBe(1)
    createdIdentityIds.push(rows[0].id)
  }, 30000)
})
