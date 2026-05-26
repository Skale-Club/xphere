// tests/contact-verifications.test.ts
//
// Phase 110 Plan 03 — integration tests for migration 1062 contact_verifications
// + the markContactVerified server action semantics (CID-14).
//
// Tests cover (D-01, D-01a, D-05, Pitfall 6):
//   T1 — INSERT contact_verifications row succeeds (service-role pg client)
//   T2 — UNIQUE (org_id, contact_id, identifier_type, identifier_value) collision
//        returns 23505 (idempotent re-verification path)
//   T3 — CASCADE on contact delete removes verification row
//   T4 — Status bump simulation:
//        identity_status='identified' + INSERT verification + conditional
//        UPDATE WHERE identity_status='identified' → row becomes 'verified'
//   T5 — Status guard: identity_status='channel_only' → UPDATE WHERE no-op
//   T6 — Status guard: identity_status='merge_conflict' → UPDATE WHERE no-op
//   T7 — Status guard: identity_status='archived_duplicate' → UPDATE WHERE no-op
//
// Tests T5-T7 prove Pitfall 2 closed: the conditional UPDATE never bumps
// non-'identified' rows even when a verification row exists, which is the
// exact guard markContactVerified relies on.
//
// markContactVerified RLS-gated rejection (unauthenticated / non-admin) is
// exercised at the action layer in unit/E2E suites — not via the service-role
// pg client used here, matching the precedent in tests/contact-identity-trigger.test.ts.
//
// Soft-skips when DATABASE_URL / SUPABASE_DB_URL is not set.

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[contact-verifications] SUPABASE_DB_URL/DATABASE_URL missing — skipping verification tests',
  )
}

suite('Phase 110 contact_verifications (migration 1062) + status-bump semantics', () => {
  let probe: Client
  let TEST_ORG_ID: string
  const cleanupContactIds: string[] = []

  beforeAll(async () => {
    probe = new Client({ connectionString: DB_URL })
    await probe.connect()
    const { rows } = await probe.query<{ id: string }>(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!rows[0]) throw new Error('No organizations in DB — cannot run Phase 110 verification tests')
    TEST_ORG_ID = rows[0].id
  }, 30000)

  afterAll(async () => {
    if (probe && cleanupContactIds.length > 0) {
      // Flip channel_only/identified to archived_duplicate so any leftover
      // identities can be dropped without tripping the orphan trigger.
      await probe.query(
        `UPDATE public.contacts
           SET identity_status = 'archived_duplicate'
         WHERE id = ANY($1) AND identity_status IN ('channel_only', 'identified', 'merge_conflict')`,
        [cleanupContactIds],
      )
      await probe.query(
        `DELETE FROM public.contact_channel_identities WHERE contact_id = ANY($1)`,
        [cleanupContactIds],
      )
      // contact_verifications has ON DELETE CASCADE, so deleting contacts
      // sweeps the verification rows too.
      await probe.query(
        `DELETE FROM public.contacts WHERE id = ANY($1)`,
        [cleanupContactIds],
      )
    }
    if (probe) await probe.end()
  }, 30000)

  it('T1 — INSERT contact_verifications succeeds for identified contact', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p110t1-verify', $3, 'manual', 'identified')`,
      [contactId, TEST_ORG_ID, phone],
    )
    cleanupContactIds.push(contactId)

    const { rows } = await probe.query<{ id: string }>(
      `INSERT INTO public.contact_verifications
         (org_id, contact_id, identifier_type, identifier_value, method)
       VALUES ($1, $2, 'phone', $3, 'manual')
       RETURNING id`,
      [TEST_ORG_ID, contactId, phone],
    )
    expect(rows).toHaveLength(1)
  }, 30000)

  it('T2 — UNIQUE collision returns 23505 (idempotent re-verification)', async () => {
    const contactId = randomUUID()
    const email = `verify-t2-${randomUUID()}@example.test`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, email, source, identity_status)
       VALUES ($1, $2, 'p110t2-dup', $3, 'manual', 'identified')`,
      [contactId, TEST_ORG_ID, email],
    )
    cleanupContactIds.push(contactId)

    await probe.query(
      `INSERT INTO public.contact_verifications
         (org_id, contact_id, identifier_type, identifier_value, method)
       VALUES ($1, $2, 'email', $3, 'manual')`,
      [TEST_ORG_ID, contactId, email],
    )

    let raisedCode = ''
    try {
      await probe.query(
        `INSERT INTO public.contact_verifications
           (org_id, contact_id, identifier_type, identifier_value, method)
         VALUES ($1, $2, 'email', $3, 'manual')`,
        [TEST_ORG_ID, contactId, email],
      )
    } catch (err: unknown) {
      raisedCode = (err as { code?: string })?.code ?? ''
    }
    expect(raisedCode).toBe('23505')
  }, 30000)

  it('T3 — CASCADE on contact delete removes verification rows', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p110t3-cascade', $3, 'manual', 'identified')`,
      [contactId, TEST_ORG_ID, phone],
    )
    await probe.query(
      `INSERT INTO public.contact_verifications
         (org_id, contact_id, identifier_type, identifier_value, method)
       VALUES ($1, $2, 'phone', $3, 'manual')`,
      [TEST_ORG_ID, contactId, phone],
    )
    // Delete contact directly (do NOT push to cleanup list — we're deleting now).
    await probe.query(`DELETE FROM public.contacts WHERE id = $1`, [contactId])
    const { rows } = await probe.query(
      `SELECT 1 FROM public.contact_verifications WHERE contact_id = $1`,
      [contactId],
    )
    expect(rows).toHaveLength(0)
  }, 30000)

  it('T4 — status bump: identified → verified via conditional UPDATE', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p110t4-bump', $3, 'manual', 'identified')`,
      [contactId, TEST_ORG_ID, phone],
    )
    cleanupContactIds.push(contactId)

    await probe.query(
      `INSERT INTO public.contact_verifications
         (org_id, contact_id, identifier_type, identifier_value, method)
       VALUES ($1, $2, 'phone', $3, 'manual')`,
      [TEST_ORG_ID, contactId, phone],
    )

    // Conditional UPDATE (mirrors markContactVerified)
    const result = await probe.query(
      `UPDATE public.contacts
          SET identity_status = 'verified'
        WHERE id = $1 AND identity_status = 'identified'`,
      [contactId],
    )
    expect(result.rowCount).toBe(1)

    const { rows } = await probe.query<{ identity_status: string }>(
      `SELECT identity_status FROM public.contacts WHERE id = $1`,
      [contactId],
    )
    expect(rows[0].identity_status).toBe('verified')
  }, 30000)

  it('T5 — status guard: channel_only NOT bumped by conditional UPDATE', async () => {
    const contactId = randomUUID()
    const extId = `p110t5-${randomUUID()}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, source, identity_status)
       VALUES ($1, $2, 'p110t5-channel', 'manual', 'channel_only')`,
      [contactId, TEST_ORG_ID],
    )
    cleanupContactIds.push(contactId)
    await probe.query(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'telegram', $3)`,
      [TEST_ORG_ID, contactId, extId],
    )

    const result = await probe.query(
      `UPDATE public.contacts
          SET identity_status = 'verified'
        WHERE id = $1 AND identity_status = 'identified'`,
      [contactId],
    )
    expect(result.rowCount).toBe(0)

    const { rows } = await probe.query<{ identity_status: string }>(
      `SELECT identity_status FROM public.contacts WHERE id = $1`,
      [contactId],
    )
    expect(rows[0].identity_status).toBe('channel_only')
  }, 30000)

  it('T6 — status guard: merge_conflict NOT bumped by conditional UPDATE', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p110t6-conflict', $3, 'manual', 'merge_conflict')`,
      [contactId, TEST_ORG_ID, phone],
    )
    cleanupContactIds.push(contactId)

    const result = await probe.query(
      `UPDATE public.contacts
          SET identity_status = 'verified'
        WHERE id = $1 AND identity_status = 'identified'`,
      [contactId],
    )
    expect(result.rowCount).toBe(0)

    const { rows } = await probe.query<{ identity_status: string }>(
      `SELECT identity_status FROM public.contacts WHERE id = $1`,
      [contactId],
    )
    expect(rows[0].identity_status).toBe('merge_conflict')
  }, 30000)

  it('T7 — status guard: archived_duplicate NOT bumped by conditional UPDATE', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p110t7-archived', $3, 'manual', 'archived_duplicate')`,
      [contactId, TEST_ORG_ID, phone],
    )
    cleanupContactIds.push(contactId)

    const result = await probe.query(
      `UPDATE public.contacts
          SET identity_status = 'verified'
        WHERE id = $1 AND identity_status = 'identified'`,
      [contactId],
    )
    expect(result.rowCount).toBe(0)

    const { rows } = await probe.query<{ identity_status: string }>(
      `SELECT identity_status FROM public.contacts WHERE id = $1`,
      [contactId],
    )
    expect(rows[0].identity_status).toBe('archived_duplicate')
  }, 30000)
})
