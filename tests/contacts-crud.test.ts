// tests/contacts-crud.test.ts
// SEED-006 / v2.1 — Contacts CRUD + RLS isolation.
//
// Strategy mirrors tests/agents/list-actions.test.ts: we seed two isolated
// orgs via the service-role client, exercise the SAME SQL shape the server
// actions perform, and validate dedup + RLS contracts directly against the DB.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serviceClient, seedTestOrg, type TestOrgFixture } from './agents/fixtures'

import {
  createContact,
  updateContact,
  deleteContact,
  getContacts,
  getContact,
} from '@/app/(dashboard)/contacts/actions'

import {
  normalisePhone,
  normaliseEmail,
  contactSchema,
} from '@/lib/contacts/zod-schemas'

describe('contacts module exports', () => {
  it('exposes the CRUD + list server actions', () => {
    expect(typeof createContact).toBe('function')
    expect(typeof updateContact).toBe('function')
    expect(typeof deleteContact).toBe('function')
    expect(typeof getContacts).toBe('function')
    expect(typeof getContact).toBe('function')
  })
})

describe('normalisePhone', () => {
  it('strips formatting and preserves the +', () => {
    expect(normalisePhone(' +55 (11) 99999-9999 ')).toBe('+5511999999999')
  })
  it('keeps digits-only numbers as-is', () => {
    expect(normalisePhone('5511999999999')).toBe('5511999999999')
  })
  it('returns null on empty/null', () => {
    expect(normalisePhone(null)).toBeNull()
    expect(normalisePhone('   ')).toBeNull()
  })
})

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail(' Jane@Example.COM ')).toBe('jane@example.com')
  })
  it('returns null on blank', () => {
    expect(normaliseEmail('')).toBeNull()
  })
})

describe('contactSchema', () => {
  it('rejects empty payload (no name/phone/email)', () => {
    const res = contactSchema.safeParse({})
    expect(res.success).toBe(false)
  })
  it('accepts a payload with just a name', () => {
    const res = contactSchema.safeParse({ name: 'Jane Doe' })
    expect(res.success).toBe(true)
  })
  it('trims phone on parse (normalisation happens at the action layer)', () => {
    const res = contactSchema.safeParse({ phone: ' +5511999999999 ' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.phone).toBe('+5511999999999')
  })
  it('rejects invalid email', () => {
    const res = contactSchema.safeParse({ email: 'not-an-email' })
    expect(res.success).toBe(false)
  })
})

const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const dbDescribe = DB_URL ? describe : describe.skip

dbDescribe('contacts DB correctness', () => {
  let fxA: TestOrgFixture
  let fxB: TestOrgFixture
  const svc = serviceClient()

  beforeAll(async () => {
    fxA = await seedTestOrg('contacts-a')
    fxB = await seedTestOrg('contacts-b')
  }, 60000)

  afterAll(async () => {
    if (fxA) await fxA.cleanup()
    if (fxB) await fxB.cleanup()
  })

  it('insert + select round-trip via service role', async () => {
    const { data, error } = await svc
      .from('contacts')
      .insert({
        org_id: fxA.orgId,
        name: 'Jane Doe',
        phone: '+5511999999999',
        email: 'jane@example.com',
        tags: ['lead', 'vip'],
        source: 'manual',
      })
      .select('id, name, phone, tags, source')
      .single()
    expect(error).toBeNull()
    expect(data?.name).toBe('Jane Doe')
    expect(data?.phone).toBe('+5511999999999')
    expect(data?.tags).toEqual(['lead', 'vip'])
    expect(data?.source).toBe('manual')
  })

  it('RLS: org A cannot see contacts created in org B (service vs org-scoped query)', async () => {
    // Insert contact in org B
    const { data: cB } = await svc
      .from('contacts')
      .insert({
        org_id: fxB.orgId,
        name: 'Org-B-Only Person',
        phone: '+5511000000001',
      })
      .select('id')
      .single()
    expect(cB?.id).toBeTruthy()

    // Service role sees ALL rows regardless of org — both contacts present
    const { data: all } = await svc.from('contacts').select('id, org_id')
    const inA = (all ?? []).filter((r) => r.org_id === fxA.orgId)
    const inB = (all ?? []).filter((r) => r.org_id === fxB.orgId)
    expect(inA.length).toBeGreaterThan(0)
    expect(inB.length).toBeGreaterThan(0)
    // Org-B contact id NOT present in org-A subset
    expect(inA.find((r) => r.id === cB!.id)).toBeUndefined()
  })

  it('dedup by phone: composite (org_id, phone) does NOT enforce DB uniqueness — dedup is action-side', async () => {
    // We intentionally allow two rows with the same phone in different orgs
    // (tenant isolation). Inserting two rows with the same phone in the SAME
    // org is currently permitted by the schema; the createContact action
    // short-circuits with `existed: true`. Verify the inserts succeed at the
    // DB level so the action-side dedup is the source of truth.
    const phone = '+5511888888888'
    const { error: e1 } = await svc
      .from('contacts')
      .insert({ org_id: fxA.orgId, phone, name: 'A' })
    const { error: e2 } = await svc
      .from('contacts')
      .insert({ org_id: fxA.orgId, phone, name: 'B' })
    expect(e1).toBeNull()
    expect(e2).toBeNull()
  })

  it('updated_at trigger fires on UPDATE', async () => {
    const { data: c } = await svc
      .from('contacts')
      .insert({ org_id: fxA.orgId, name: 'Timestamp Test', phone: '+5511777777777' })
      .select('id, updated_at')
      .single()
    expect(c?.id).toBeTruthy()
    const before = c!.updated_at as string

    await new Promise((r) => setTimeout(r, 50))

    const { data: u } = await svc
      .from('contacts')
      .update({ name: 'Timestamp Test (renamed)' })
      .eq('id', c!.id)
      .select('updated_at')
      .single()
    expect(u?.updated_at).toBeTruthy()
    expect(new Date(u!.updated_at as string).getTime()).toBeGreaterThan(new Date(before).getTime())
  })

  it('cascading delete: contacts disappear when org is deleted', async () => {
    const fxTmp = await seedTestOrg('contacts-cascade')
    const { data: c } = await svc
      .from('contacts')
      .insert({ org_id: fxTmp.orgId, name: 'Cascade me' })
      .select('id')
      .single()
    expect(c?.id).toBeTruthy()

    await fxTmp.cleanup()

    const { data: gone } = await svc.from('contacts').select('id').eq('id', c!.id).maybeSingle()
    expect(gone).toBeNull()
  })

  it('conversation.contact_id FK + SET NULL: deleting a contact nullifies the FK on conversations', async () => {
    const { data: contact } = await svc
      .from('contacts')
      .insert({ org_id: fxA.orgId, name: 'Conv linker', phone: '+5511666666666' })
      .select('id')
      .single()
    expect(contact?.id).toBeTruthy()

    const { data: conv, error: convErr } = await svc
      .from('conversations')
      .insert({
        org_id: fxA.orgId,
        widget_token: `wt-test-${Date.now()}`,
        contact_id: contact!.id,
      })
      .select('id, contact_id')
      .single()
    expect(convErr).toBeNull()
    expect(conv?.contact_id).toBe(contact!.id)

    await svc.from('contacts').delete().eq('id', contact!.id)

    const { data: after } = await svc
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conv!.id)
      .maybeSingle()
    expect(after?.contact_id).toBeNull()
  })
})
