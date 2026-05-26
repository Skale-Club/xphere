// tests/contact-identity-trigger.test.ts
//
// Phase 109 final validation — proves the three triggers shipped by migration
// 1061 (CID-12, CID-13):
//
//   Trigger 1 (CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED on contacts):
//     - test 1 — deferrable success with Option A channel_only-skip:
//         BEGIN; INSERT contact (identity_status='channel_only'); INSERT cci;
//         COMMIT → no error. Both rows persist.
//     - test 2 — strict invariant raises:
//         BEGIN; INSERT contact (identity_status='identified', no
//         phone/email/identity); COMMIT → RAISE EXCEPTION /identity invariant/.
//
//   Trigger 2 (BEFORE DELETE on contact_channel_identities):
//     - test 3 — orphan block:
//         contact (channel_only) + 1 cci. DELETE cci → RAISE /last channel
//         identity/.
//     - test 4 — orphan allow:
//         contact (identified, phone='+15551234567') + 1 cci. DELETE cci →
//         succeeds (phone covers invariant).
//
//   Trigger 3 (BEFORE UPDATE on contacts WHEN OLD.identity_status='channel_only'):
//     - test 5 — promote channel_only → identified on phone add.
//     - test 6 — archived_duplicate exempt: archive + null phone → no RAISE.
//
// Tests 1 & 2 use raw pg.Client BEGIN/COMMIT because Postgres deferrable
// constraint triggers fire at COMMIT, not at the statement that produced the
// "violating" row. Soft-skips when DATABASE_URL / SUPABASE_DB_URL is not set,
// matching the Phase 107 (tests/contacts-unique-constraint.test.ts) and Phase
// 108 (tests/contact-channel-identity.test.ts) precedent.
//
// CRITICAL cleanup ordering (afterAll): delete from
// contact_channel_identities BEFORE contacts — otherwise the orphan trigger
// on cci.DELETE would block teardown of any channel_only test contact that
// still has its identity row attached. For the orphan-block test (test 3) we
// additionally flip the leftover contact to 'archived_duplicate' so the
// orphan trigger exempts it during cleanup (Phase 109 D-05).

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
vi.mock('server-only', () => ({}))

import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const suite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[contact-identity-trigger] SUPABASE_DB_URL/DATABASE_URL missing — skipping trigger tests',
  )
}

suite('Phase 109 contact identity triggers (migration 1061)', () => {
  let probe: Client
  let TEST_ORG_ID: string
  const cleanupContactIds: string[] = []

  beforeAll(async () => {
    probe = new Client({ connectionString: DB_URL })
    await probe.connect()
    const { rows } = await probe.query<{ id: string }>(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!rows[0]) throw new Error('No organizations in DB — cannot run Phase 109 trigger tests')
    TEST_ORG_ID = rows[0].id
  }, 30000)

  afterAll(async () => {
    if (probe && cleanupContactIds.length > 0) {
      // Flip any surviving channel_only contacts to archived_duplicate first
      // so the orphan trigger exempts them (D-05). archived_duplicate rows
      // can drop their channel identities freely.
      await probe.query(
        `UPDATE public.contacts
           SET identity_status = 'archived_duplicate'
         WHERE id = ANY($1) AND identity_status = 'channel_only'`,
        [cleanupContactIds],
      )
      // Identities first to avoid the orphan trigger on any non-archived row
      // that does have phone/email (the trigger allows those deletes, but
      // explicit ordering is safer + documents intent).
      await probe.query(
        `DELETE FROM public.contact_channel_identities WHERE contact_id = ANY($1)`,
        [cleanupContactIds],
      )
      await probe.query(
        `DELETE FROM public.contacts WHERE id = ANY($1)`,
        [cleanupContactIds],
      )
    }
    if (probe) await probe.end()
  }, 30000)

  it('test 1 — deferrable + channel_only skip: contact+identity in one txn succeeds', async () => {
    // Dedicated client because BEGIN/COMMIT must not interleave with probe.
    const c = new Client({ connectionString: DB_URL })
    await c.connect()
    const contactId = randomUUID()
    const extId = `p109t1-${randomUUID()}`
    try {
      await c.query('BEGIN')
      try {
        await c.query(
          `INSERT INTO public.contacts (id, org_id, name, source, identity_status)
           VALUES ($1, $2, 'p109-t1-channelonly', 'manual', 'channel_only')`,
          [contactId, TEST_ORG_ID],
        )
        cleanupContactIds.push(contactId)
        await c.query(
          `INSERT INTO public.contact_channel_identities
             (org_id, contact_id, provider, external_id)
           VALUES ($1, $2, 'telegram', $3)`,
          [TEST_ORG_ID, contactId, extId],
        )
        await c.query('COMMIT')
      } catch (err) {
        await c.query('ROLLBACK')
        throw err
      }
      // If COMMIT returned, the deferred constraint trigger fired AND accepted
      // the row (Option A channel_only skip + sibling identity present).
      const { rows } = await probe.query<{ id: string }>(
        'SELECT id FROM public.contacts WHERE id = $1',
        [contactId],
      )
      expect(rows).toHaveLength(1)
    } finally {
      await c.end()
    }
  }, 30000)

  it('test 2 — deferrable failure: identified contact w/ no phone/email/identity → RAISE at COMMIT', async () => {
    const c = new Client({ connectionString: DB_URL })
    await c.connect()
    const contactId = randomUUID()
    let raised = false
    let errMessage = ''
    try {
      await c.query('BEGIN')
      try {
        await c.query(
          `INSERT INTO public.contacts (id, org_id, name, source, identity_status)
           VALUES ($1, $2, 'p109-t2-noidentity', 'manual', 'identified')`,
          [contactId, TEST_ORG_ID],
        )
        // No channel identity, no phone, no email. COMMIT must fire the
        // deferred constraint trigger and RAISE.
        await c.query('COMMIT')
      } catch (err: unknown) {
        raised = true
        errMessage = (err as { message?: string })?.message ?? ''
        await c.query('ROLLBACK').catch(() => {
          /* COMMIT-time errors auto-abort the tx; ROLLBACK may fail. */
        })
      }
    } finally {
      await c.end()
    }
    // The row never committed → no cleanup needed.
    expect(raised).toBe(true)
    expect(errMessage).toMatch(/identity invariant/i)
  }, 30000)

  it('test 3 — orphan block: delete last channel identity of phone-less contact → RAISE', async () => {
    const contactId = randomUUID()
    const extId = `p109t3-${randomUUID()}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, source, identity_status)
       VALUES ($1, $2, 'p109-t3-orphanblock', 'manual', 'channel_only')`,
      [contactId, TEST_ORG_ID],
    )
    cleanupContactIds.push(contactId)
    const { rows: ident } = await probe.query<{ id: string }>(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
      [TEST_ORG_ID, contactId, extId],
    )
    await expect(
      probe.query(
        `DELETE FROM public.contact_channel_identities WHERE id = $1`,
        [ident[0].id],
      ),
    ).rejects.toThrow(/last channel identity/i)
    // Cleanup of this row is handled by afterAll's archived-flip path.
  }, 30000)

  it('test 4 — orphan allow: phone-bearing contact, delete identity → succeeds', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    const extId = `p109t4-${randomUUID()}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p109-t4-orphanallow', $3, 'manual', 'identified')`,
      [contactId, TEST_ORG_ID, phone],
    )
    cleanupContactIds.push(contactId)
    const { rows: ident } = await probe.query<{ id: string }>(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'whatsapp', $3) RETURNING id`,
      [TEST_ORG_ID, contactId, extId],
    )
    // Phone covers the invariant → orphan trigger must allow this delete.
    await probe.query(
      `DELETE FROM public.contact_channel_identities WHERE id = $1`,
      [ident[0].id],
    )
    const { rows: check } = await probe.query<{ id: string }>(
      `SELECT id FROM public.contact_channel_identities WHERE id = $1`,
      [ident[0].id],
    )
    expect(check).toHaveLength(0)
  }, 30000)

  it('test 5 — promotion: update phone on channel_only contact → identity_status auto-promotes to identified', async () => {
    const contactId = randomUUID()
    const extId = `p109t5-${randomUUID()}`
    const newPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, source, identity_status)
       VALUES ($1, $2, 'p109-t5-promote', 'manual', 'channel_only')`,
      [contactId, TEST_ORG_ID],
    )
    cleanupContactIds.push(contactId)
    await probe.query(
      `INSERT INTO public.contact_channel_identities
         (org_id, contact_id, provider, external_id)
       VALUES ($1, $2, 'telegram', $3)`,
      [TEST_ORG_ID, contactId, extId],
    )
    // BEFORE UPDATE trigger mutates NEW.identity_status if NEW.phone is set.
    await probe.query(
      `UPDATE public.contacts SET phone = $2 WHERE id = $1`,
      [contactId, newPhone],
    )
    const { rows: after } = await probe.query<{ identity_status: string }>(
      `SELECT identity_status FROM public.contacts WHERE id = $1`,
      [contactId],
    )
    expect(after).toHaveLength(1)
    expect(after[0].identity_status).toBe('identified')
  }, 30000)

  it('test 6 — archived_duplicate exempt: archive then null phone → no RAISE', async () => {
    const contactId = randomUUID()
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'p109-t6-archived', $3, 'manual', 'identified')`,
      [contactId, TEST_ORG_ID, phone],
    )
    cleanupContactIds.push(contactId)
    // Mark archived first — the enforce trigger skips archived_duplicate rows.
    await probe.query(
      `UPDATE public.contacts SET identity_status = 'archived_duplicate' WHERE id = $1`,
      [contactId],
    )
    // Now null the phone — would violate the strict invariant for a non-
    // archived row (no phone, no email, no identity). The trigger must skip.
    await probe.query(
      `UPDATE public.contacts SET phone = NULL WHERE id = $1`,
      [contactId],
    )
    const { rows } = await probe.query<{ identity_status: string; phone: string | null }>(
      `SELECT identity_status, phone FROM public.contacts WHERE id = $1`,
      [contactId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].identity_status).toBe('archived_duplicate')
    expect(rows[0].phone).toBeNull()
  }, 30000)
})
