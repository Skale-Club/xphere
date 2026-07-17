// tests/chat-route-contact-linking.test.ts
// UIX-03: findOrCreateContactByEmail (the SHARED email upsert helper) +
// linkVerifiedContact (throttle on contact_id IS NULL, org-scoped,
// fail-soft). Builds a chainable supabase mock supporting
// .select().eq().eq().neq().maybeSingle() (reads), .insert().select().single()
// (create), and .update().eq().eq().is() (link) — copies the buildSupabase
// idiom from tests/medusa-cart-write.test.ts and extends it for insert/single.
// See 137-RESEARCH.md Pattern 4 and .planning/research/INTEGRATION-CONTRACT.md §3.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Row = Record<string, unknown>
interface RecordedCall {
  table: string
  method: string
  args: unknown[]
}

// ---- Chainable, call-recording supabase stub -------------------------------
// Each `.from(table)` returns a chain recording every call. `maybeSingle()`
// and `single()` resolve per-table from the scripted config; `insert()` and
// `update()` are recorded (assertable) and return the same chain so
// `.select().single()` / `.eq().eq().is()` compose naturally.
function buildSupabase(config: {
  contactsMaybeSingle?: Row | null
  contactsMaybeSingleQueue?: (Row | null)[] // consumed in order across multiple maybeSingle() calls on 'contacts'
  contactsSingle?: { data: Row | null; error: unknown }
  conversationsMaybeSingle?: Row | null
  conversationsReject?: boolean
} = {}) {
  const calls: RecordedCall[] = []
  let contactsMaybeSingleCallIndex = 0

  function makeQuery(table: string) {
    const q: {
      select: (...args: unknown[]) => typeof q
      eq: (...args: unknown[]) => typeof q
      neq: (...args: unknown[]) => typeof q
      is: (...args: unknown[]) => typeof q
      insert: (row: Row) => typeof q
      update: (row: Row) => typeof q
      maybeSingle: () => Promise<{ data: Row | null; error: unknown }>
      single: () => Promise<{ data: Row | null; error: unknown }>
    } = {
      select(...args: unknown[]) {
        calls.push({ table, method: 'select', args })
        return q
      },
      eq(...args: unknown[]) {
        calls.push({ table, method: 'eq', args })
        return q
      },
      neq(...args: unknown[]) {
        calls.push({ table, method: 'neq', args })
        return q
      },
      is(...args: unknown[]) {
        calls.push({ table, method: 'is', args })
        return q
      },
      insert(row: Row) {
        calls.push({ table, method: 'insert', args: [row] })
        return q
      },
      update(row: Row) {
        calls.push({ table, method: 'update', args: [row] })
        return q
      },
      async maybeSingle() {
        calls.push({ table, method: 'maybeSingle', args: [] })
        if (table === 'contacts') {
          if (config.contactsMaybeSingleQueue) {
            const data = config.contactsMaybeSingleQueue[contactsMaybeSingleCallIndex] ?? null
            contactsMaybeSingleCallIndex += 1
            return { data, error: null }
          }
          return { data: config.contactsMaybeSingle ?? null, error: null }
        }
        if (table === 'conversations') {
          if (config.conversationsReject) throw new Error('db down')
          return { data: config.conversationsMaybeSingle ?? null, error: null }
        }
        return { data: null, error: null }
      },
      async single() {
        calls.push({ table, method: 'single', args: [] })
        if (table === 'contacts') return config.contactsSingle ?? { data: { id: 'contact-new' }, error: null }
        return { data: null, error: null }
      },
    }
    return q
  }

  return {
    supabase: { from: (table: string) => makeQuery(table) } as unknown as SupabaseClient<Database>,
    calls,
  }
}

const ORG = 'org-1'

// =============================================================================
// findOrCreateContactByEmail
// =============================================================================

describe('findOrCreateContactByEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('existing contact: returns it, NO insert attempted', async () => {
    const { supabase, calls } = buildSupabase({ contactsMaybeSingle: { id: 'c_1' } })
    const { findOrCreateContactByEmail } = await import('@/lib/contacts/find-or-create-by-email')

    const result = await findOrCreateContactByEmail(supabase, ORG, 'a@b.com')

    expect(result).toEqual({ contactId: 'c_1', created: false, email: 'a@b.com' })
    expect(calls.some((c) => c.table === 'contacts' && c.method === 'insert')).toBe(false)
    expect(calls.some((c) => c.table === 'contacts' && c.method === 'neq' && c.args[1] === 'archived_duplicate')).toBe(
      true,
    )
  })

  it('new contact: lookup misses, inserts with org_id/email/source/lifecycle_stage default', async () => {
    const { supabase, calls } = buildSupabase({
      contactsMaybeSingle: null,
      contactsSingle: { data: { id: 'c_new' }, error: null },
    })
    const { findOrCreateContactByEmail } = await import('@/lib/contacts/find-or-create-by-email')

    const result = await findOrCreateContactByEmail(supabase, ORG, 'a@b.com')

    expect(result).toEqual({ contactId: 'c_new', created: true, email: 'a@b.com' })
    const insertCall = calls.find((c) => c.table === 'contacts' && c.method === 'insert')
    expect(insertCall).toBeDefined()
    expect(insertCall!.args[0]).toMatchObject({
      org_id: ORG,
      email: 'a@b.com',
      source: 'api',
      lifecycle_stage: 'lead',
    })
    const lookupCall = calls.find((c) => c.table === 'contacts' && c.method === 'eq' && c.args[0] === 'email_normalized')
    expect(lookupCall).toBeDefined()
  })

  it('insert race: insert fails, re-select by email_normalized finds the raced row (created:false)', async () => {
    const { supabase } = buildSupabase({
      contactsMaybeSingleQueue: [null, { id: 'c_raced' }],
      contactsSingle: { data: null, error: { message: 'conflict' } },
    })
    const { findOrCreateContactByEmail } = await import('@/lib/contacts/find-or-create-by-email')

    const result = await findOrCreateContactByEmail(supabase, ORG, 'a@b.com')

    expect(result).toEqual({ contactId: 'c_raced', created: false, email: 'a@b.com' })
  })

  it('unusable email: returns nulls, makes NO db calls', async () => {
    const { supabase, calls } = buildSupabase()
    const { findOrCreateContactByEmail } = await import('@/lib/contacts/find-or-create-by-email')

    const result = await findOrCreateContactByEmail(supabase, ORG, '   ')

    expect(result).toEqual({ contactId: null, created: false, email: null })
    expect(calls.length).toBe(0)
  })

  it('options pass-through: lifecycleStage/sourceType/sourceId land in the insert payload', async () => {
    const { supabase, calls } = buildSupabase({
      contactsMaybeSingle: null,
      contactsSingle: { data: { id: 'c_new' }, error: null },
    })
    const { findOrCreateContactByEmail } = await import('@/lib/contacts/find-or-create-by-email')

    await findOrCreateContactByEmail(supabase, ORG, 'a@b.com', {
      lifecycleStage: 'customer',
      sourceType: 'medusa',
      sourceId: 'order_1',
    })

    const insertCall = calls.find((c) => c.table === 'contacts' && c.method === 'insert')
    expect(insertCall!.args[0]).toMatchObject({
      lifecycle_stage: 'customer',
      source_type: 'medusa',
      source_id: 'order_1',
    })
  })
})

// =============================================================================
// linkVerifiedContact
// =============================================================================

describe('linkVerifiedContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('already linked (throttle): skips find-or-create AND the update', async () => {
    const { supabase, calls } = buildSupabase({ conversationsMaybeSingle: { contact_id: 'c_existing' } })
    const { linkVerifiedContact } = await import('@/lib/contacts/link-verified-contact')

    await linkVerifiedContact(supabase, ORG, 'conv-1', 'a@b.com')

    expect(calls.some((c) => c.table === 'contacts')).toBe(false)
    expect(calls.some((c) => c.table === 'conversations' && c.method === 'update')).toBe(false)
  })

  it('fresh link: updates conversations with contact_id + visitor_email, IS-NULL guarded', async () => {
    const { supabase, calls } = buildSupabase({
      conversationsMaybeSingle: { contact_id: null },
      contactsMaybeSingle: { id: 'c_1' },
    })
    const { linkVerifiedContact } = await import('@/lib/contacts/link-verified-contact')

    await linkVerifiedContact(supabase, ORG, 'conv-1', 'a@b.com')

    const updateCall = calls.find((c) => c.table === 'conversations' && c.method === 'update')
    expect(updateCall).toBeDefined()
    expect(updateCall!.args[0]).toEqual({ contact_id: 'c_1', visitor_email: 'a@b.com' })
    const isCall = calls.find((c) => c.table === 'conversations' && c.method === 'is')
    expect(isCall).toBeDefined()
    expect(isCall!.args).toEqual(['contact_id', null])
  })

  it('unusable email: NO conversations update', async () => {
    const { supabase, calls } = buildSupabase({ conversationsMaybeSingle: { contact_id: null } })
    const { linkVerifiedContact } = await import('@/lib/contacts/link-verified-contact')

    await linkVerifiedContact(supabase, ORG, 'conv-1', '   ')

    expect(calls.some((c) => c.table === 'conversations' && c.method === 'update')).toBe(false)
  })

  it('never throws: a rejecting conversations lookup resolves without throwing', async () => {
    const { supabase } = buildSupabase({ conversationsReject: true })
    const { linkVerifiedContact } = await import('@/lib/contacts/link-verified-contact')

    await expect(linkVerifiedContact(supabase, ORG, 'conv-1', 'a@b.com')).resolves.toBeUndefined()
  })

  it('org scoping: every read/update chain includes eq(org_id, ORG)', async () => {
    const { supabase, calls } = buildSupabase({
      conversationsMaybeSingle: { contact_id: null },
      contactsMaybeSingle: { id: 'c_1' },
    })
    const { linkVerifiedContact } = await import('@/lib/contacts/link-verified-contact')

    await linkVerifiedContact(supabase, ORG, 'conv-1', 'a@b.com')

    const orgScopedCalls = calls.filter((c) => c.method === 'eq' && c.args[0] === 'org_id' && c.args[1] === ORG)
    expect(orgScopedCalls.length).toBeGreaterThanOrEqual(2) // conversations lookup + conversations update (contacts lookup/insert also org-scoped inside the helper)
  })
})
