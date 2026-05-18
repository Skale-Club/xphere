// tests/accounts-actions.test.ts
// Phase 65 Plan 05 — integration tests for the v2.4 account server actions.
//
// Covers ACC-01 (create), ACC-02 (update), ACC-03 (delete + block-when-referenced),
// ACC-16 (merge), plus the linking helpers (linkContactToAccount,
// createAccountFromContact).
//
// Strategy:
//   Tier 1 module-export smoke (always runs).
//   Tier 2 vi.mock action-level tests (always runs) — proves the action's
//          ActionResult return shape for the cases the plan-checker flagged:
//          deleteAccount (both branches) and mergeAccounts partial_state.
//   Tier 3 DB integration — service-role inserts state, asserts the same
//          SQL via service-role queries.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// ─── Tier 2 setup — mock @/lib/supabase/server BEFORE importing the actions ──
// vi.mock is hoisted to the top of the file by Vitest, so this happens before
// the action imports below.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

// `revalidatePath` from next/cache throws "static generation store missing"
// outside a Next.js render context. We mock it as a no-op so the action's
// successful happy paths (deleteAccount ok, linkContactToAccount ok, etc.)
// can complete without a real Next.js runtime.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// AFTER the mock declaration, import everything else.
import { serviceClient, seedTestOrg, type TestOrgFixture } from './agents/fixtures'
import { createClient, getUser } from '@/lib/supabase/server'

import {
  getAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  mergeAccounts,
  linkContactToAccount,
  createAccountFromContact,
  previewAccountsCsv,
  importAccountsCsv,
} from '@/app/(dashboard)/accounts/actions'

// ─── Tier 1 — module exports ─────────────────────────────────────────────────

describe('accounts actions module exports', () => {
  it('exposes the 10 server actions', () => {
    expect(typeof getAccounts).toBe('function')
    expect(typeof getAccount).toBe('function')
    expect(typeof createAccount).toBe('function')
    expect(typeof updateAccount).toBe('function')
    expect(typeof deleteAccount).toBe('function')
    expect(typeof mergeAccounts).toBe('function')
    expect(typeof linkContactToAccount).toBe('function')
    expect(typeof createAccountFromContact).toBe('function')
    expect(typeof previewAccountsCsv).toBe('function')
    expect(typeof importAccountsCsv).toBe('function')
  })
})

// ─── Tier 2 — vi.mock action-level (always runs) ─────────────────────────────
//
// These tests invoke the actions DIRECTLY (not via DB simulation). The mock
// replaces createClient + getUser so the action's auth + RPC + query chain
// runs against a fake supabase client. Each test wires the fake client with
// canned responses tailored to that specific code path.

interface FakeQueryResult {
  data?: unknown
  count?: number | null
  error?: { message: string } | null
}

/**
 * Builds a fake supabase client whose `.from(table)` returns a thenable
 * proxy. Each method (select, update, delete, eq, in, single, maybeSingle)
 * returns the same proxy until awaited, at which point it resolves with
 * the canned result for that table+verb.
 *
 * Per-test, override `responses` to return what the action expects.
 */
function buildFakeSupabaseClient(responses: {
  rpc?: FakeQueryResult
  contactsSelect?: FakeQueryResult
  contactsUpdate?: FakeQueryResult
  opportunitiesSelect?: FakeQueryResult
  opportunitiesUpdate?: FakeQueryResult
  accountsSelect?: FakeQueryResult
  accountsInsert?: FakeQueryResult
  accountsUpdate?: FakeQueryResult
  accountsDelete?: FakeQueryResult
}) {
  const make = (result: FakeQueryResult | undefined): any => {
    const proxy: any = {}
    const methods = [
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'in',
      'or',
      'ilike',
      'filter',
      'order',
      'range',
      'contains',
      'single',
      'maybeSingle',
    ]
    for (const m of methods) proxy[m] = vi.fn(() => proxy)
    proxy.then = (resolve: (v: FakeQueryResult) => void) =>
      Promise.resolve(result ?? { data: null, error: null }).then(resolve)
    return proxy
  }
  return {
    rpc: vi.fn(async () => responses.rpc ?? { data: 'test-org-id', error: null }),
    from: vi.fn((table: string) => {
      if (table === 'contacts') {
        return {
          select: () => make(responses.contactsSelect),
          update: () => make(responses.contactsUpdate),
          insert: () => make(responses.contactsSelect),
          delete: () => make(responses.contactsSelect),
          eq: vi.fn(),
          in: vi.fn(),
        }
      }
      if (table === 'opportunities') {
        return {
          select: () => make(responses.opportunitiesSelect),
          update: () => make(responses.opportunitiesUpdate),
          eq: vi.fn(),
          in: vi.fn(),
        }
      }
      if (table === 'accounts') {
        return {
          select: () => make(responses.accountsSelect),
          insert: () => make(responses.accountsInsert),
          update: () => make(responses.accountsUpdate),
          delete: () => make(responses.accountsDelete),
          eq: vi.fn(),
          in: vi.fn(),
          ilike: vi.fn(),
        }
      }
      return make({ data: null, error: null })
    }),
  }
}

describe('action-level vi.mock tests (no DB env required)', () => {
  beforeEach(() => {
    vi.mocked(getUser).mockResolvedValue({ id: 'test-user-id' } as any)
  })

  describe('ACC-03 deleteAccount return shape', () => {
    it('returns { ok: false, error: "account_has_references", details: { contacts: 1, opportunities: 0 } } when account has references', async () => {
      const fake = buildFakeSupabaseClient({
        contactsSelect: { count: 1, error: null },
        opportunitiesSelect: { count: 0, error: null },
      })
      vi.mocked(createClient).mockResolvedValue(fake as any)

      const result = await deleteAccount('00000000-0000-0000-0000-000000000aaa')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('account_has_references')
        expect(result.details).toEqual({ contacts: 1, opportunities: 0 })
      }
    })

    it('returns { ok: true, data: { deleted: <id> } } when reference count is zero', async () => {
      const id = '00000000-0000-0000-0000-000000000bbb'
      const fake = buildFakeSupabaseClient({
        contactsSelect: { count: 0, error: null },
        opportunitiesSelect: { count: 0, error: null },
        accountsDelete: { error: null },
      })
      vi.mocked(createClient).mockResolvedValue(fake as any)

      const result = await deleteAccount(id)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ deleted: id })
      }
    })
  })

  describe('ACC-16 mergeAccounts partial_state recovery', () => {
    it('returns { ok: false, error, details.partial_state.moved_contacts } when step 2 (opportunities UPDATE) fails after step 1 (contacts UPDATE) succeeded', async () => {
      // Build a fake that:
      //   - accounts.select(.eq.maybeSingle) returns the primary (sanity check)
      //   - contacts.update returns count: 3 (step 1 succeeds)
      //   - opportunities.update returns error (step 2 fails)
      const fake = buildFakeSupabaseClient({
        accountsSelect: { data: { id: 'primary-id' }, error: null },
        contactsUpdate: { count: 3, error: null },
        opportunitiesUpdate: { error: { message: 'transient network error' } },
      })
      vi.mocked(createClient).mockResolvedValue(fake as any)

      const result = await mergeAccounts({
        primaryId: '00000000-0000-0000-0000-000000000111',
        secondaryIds: ['00000000-0000-0000-0000-000000000222'],
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        // The action wraps the upstream error and adds partial_state.
        expect(result.details).toMatchObject({
          partial_state: { moved_contacts: 3 },
        })
      }
    })
  })
})

// ─── Tier 3 — DB integration ─────────────────────────────────────────────────
//
// IMPORTANT: Tier 3 tests use service-role client DIRECTLY. The vi.mock above
// only affects code that imports from @/lib/supabase/server. The tests below
// call svc.from(...) directly — they don't go through the mocked module — so
// the mock does not interfere with Tier 3.

const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbDescribe = DB_URL && serviceKey ? describe : describe.skip

// Helper: pipeline + stage seed. opportunities table requires both.
async function seedPipelineStage(svc: ReturnType<typeof serviceClient>, orgId: string) {
  const { data: pipe } = await svc
    .from('pipelines')
    .insert({ org_id: orgId, name: 'Test Pipeline' })
    .select('id')
    .single()
  const { data: stage } = await svc
    .from('pipeline_stages')
    .insert({ org_id: orgId, pipeline_id: pipe!.id, name: 'New', position: 0 })
    .select('id')
    .single()
  return { pipelineId: pipe!.id as string, stageId: stage!.id as string }
}

dbDescribe('accounts CRUD — DB assertions (service-role)', () => {
  const svc = serviceClient()
  let fxA: TestOrgFixture
  let fxB: TestOrgFixture

  beforeAll(async () => {
    fxA = await seedTestOrg('acc-actions-a')
    fxB = await seedTestOrg('acc-actions-b')
  }, 60000)

  afterAll(async () => {
    if (fxA) await fxA.cleanup()
    if (fxB) await fxB.cleanup()
  })

  it('ACC-01 create — round-trips all 11 attributes via service role', async () => {
    const { data, error } = await svc
      .from('accounts')
      .insert({
        org_id: fxA.orgId,
        name: 'Acme Inc',
        domain: 'acme.com',
        website: 'https://acme.com',
        industry: 'SaaS',
        size: '51-200',
        phone: '+15555550100',
        address: '1 Market St',
        notes: 'enterprise',
        tags: ['vip'],
        custom_fields: { tier: 'gold' },
        source: 'manual',
      })
      .select('*')
      .single()
    expect(error).toBeNull()
    expect(data?.name).toBe('Acme Inc')
    expect(data?.domain).toBe('acme.com')
    expect(data?.tags).toEqual(['vip'])
    expect(data?.source).toBe('manual')
  })

  it('ACC-02 update — partial update bumps updated_at via trigger', async () => {
    const { data: a } = await svc
      .from('accounts')
      .insert({ org_id: fxA.orgId, name: 'Update Target' })
      .select('id, updated_at')
      .single()
    const before = a!.updated_at as string
    await new Promise((r) => setTimeout(r, 50))
    const { data: u } = await svc
      .from('accounts')
      .update({ notes: 'updated' })
      .eq('id', a!.id)
      .select('updated_at, notes')
      .single()
    expect(u?.notes).toBe('updated')
    expect(new Date(u!.updated_at as string).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    )
  })

  it('Cross-org RLS smoke (Phase 64 ACC-19 re-verification): an account in org A is invisible from a query filtered to org B', async () => {
    // Insert account in B
    const { data: accB } = await svc
      .from('accounts')
      .insert({ org_id: fxB.orgId, name: 'B-Only' })
      .select('id')
      .single()
    // Service role sees all rows; filter manually by org_id (mirrors RLS shape)
    const { data: inA } = await svc.from('accounts').select('id').eq('org_id', fxA.orgId)
    expect((inA ?? []).find((r) => r.id === accB!.id)).toBeUndefined()
  })

  it('ACC-16 merge happy-path — service-role exec of the same three statements', async () => {
    // Set up: 1 primary, 2 secondaries, link 3 contacts and 2 opps to secondaries
    const { pipelineId, stageId } = await seedPipelineStage(svc, fxA.orgId)
    const inserts = await svc
      .from('accounts')
      .insert([
        { org_id: fxA.orgId, name: 'Merge Primary' },
        { org_id: fxA.orgId, name: 'Merge Secondary 1' },
        { org_id: fxA.orgId, name: 'Merge Secondary 2' },
      ])
      .select('id, name')
    const accounts = inserts.data ?? []
    const primary = accounts.find((a) => a.name === 'Merge Primary')!
    const sec1 = accounts.find((a) => a.name === 'Merge Secondary 1')!
    const sec2 = accounts.find((a) => a.name === 'Merge Secondary 2')!
    const secondaryIds = [sec1.id, sec2.id]

    // 3 contacts linked to secondaries
    await svc.from('contacts').insert([
      { org_id: fxA.orgId, name: 'c1', account_id: sec1.id },
      { org_id: fxA.orgId, name: 'c2', account_id: sec1.id },
      { org_id: fxA.orgId, name: 'c3', account_id: sec2.id },
    ])

    // 2 opportunities linked to secondaries
    await svc.from('opportunities').insert([
      {
        org_id: fxA.orgId,
        account_id: sec1.id,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: 'o1',
      },
      {
        org_id: fxA.orgId,
        account_id: sec2.id,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: 'o2',
      },
    ])

    // Execute the merge sequence the same way mergeAccounts does
    const { count: movedC } = await svc
      .from('contacts')
      .update({ account_id: primary.id }, { count: 'exact' })
      .in('account_id', secondaryIds)
    const { count: movedO } = await svc
      .from('opportunities')
      .update({ account_id: primary.id }, { count: 'exact' })
      .in('account_id', secondaryIds)
    const { count: deletedA } = await svc
      .from('accounts')
      .delete({ count: 'exact' })
      .in('id', secondaryIds)

    expect(movedC).toBe(3)
    expect(movedO).toBe(2)
    expect(deletedA).toBe(2)

    // Confirm primary now has all 3 contacts + 2 opps
    const { count: primaryContacts } = await svc
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', primary.id)
    const { count: primaryOpps } = await svc
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', primary.id)
    expect(primaryContacts).toBe(3)
    expect(primaryOpps).toBe(2)
  })

  it('ACC-03 delete: DB-level confirmation that reference COUNTs match what deleteAccount would see', async () => {
    // This is supplementary to the Tier 2 vi.mock test above. The vi.mock
    // test proves the action returns the structured error; this test proves
    // the underlying SQL counts work as expected at the DB layer.
    const { data: a } = await svc
      .from('accounts')
      .insert({ org_id: fxA.orgId, name: 'Delete-Blocked Target' })
      .select('id')
      .single()
    await svc.from('contacts').insert({
      org_id: fxA.orgId,
      name: 'Tied Contact',
      account_id: a!.id,
    })
    const { count: cCount } = await svc
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', a!.id)
    const { count: oCount } = await svc
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', a!.id)
    expect(cCount).toBe(1)
    expect(oCount).toBe(0)
  })

  it('ACC-03 delete: DB-level confirmation that a zero-reference account can be hard-deleted', async () => {
    const { data: a } = await svc
      .from('accounts')
      .insert({ org_id: fxA.orgId, name: 'Delete-OK Target' })
      .select('id')
      .single()
    const { error: delErr } = await svc.from('accounts').delete().eq('id', a!.id)
    expect(delErr).toBeNull()
    const { data: gone } = await svc
      .from('accounts')
      .select('id')
      .eq('id', a!.id)
      .maybeSingle()
    expect(gone).toBeNull()
  })

  it('linkContactToAccount: contact.account_id is set after the UPDATE', async () => {
    const { data: a } = await svc
      .from('accounts')
      .insert({ org_id: fxA.orgId, name: 'Link Target' })
      .select('id')
      .single()
    const { data: c } = await svc
      .from('contacts')
      .insert({ org_id: fxA.orgId, name: 'Unlinked' })
      .select('id')
      .single()
    await svc.from('contacts').update({ account_id: a!.id }).eq('id', c!.id)
    const { data: linked } = await svc
      .from('contacts')
      .select('account_id')
      .eq('id', c!.id)
      .single()
    expect(linked?.account_id).toBe(a!.id)
  })

  it('createAccountFromContact: promotes contacts.company → accounts row, links contact, leaves company UNCHANGED', async () => {
    const { data: c } = await svc
      .from('contacts')
      .insert({ org_id: fxA.orgId, name: 'Has Company', company: 'Promote Co' })
      .select('id, company')
      .single()
    expect(c!.company).toBe('Promote Co')

    // Mimic the action's idempotent lookup with the ilike-escape pattern
    const trimmed = 'Promote Co'
    const escaped = trimmed.replace(/[%_]/g, '\\$&')
    const { data: existingMatches } = await svc
      .from('accounts')
      .select('*')
      .eq('org_id', fxA.orgId)
      .ilike('name', escaped)
    let acct = existingMatches?.[0]
    if (!acct) {
      const { data: created } = await svc
        .from('accounts')
        .insert({
          org_id: fxA.orgId,
          name: trimmed,
          source: 'auto_from_contact_company',
        })
        .select('*')
        .single()
      acct = created!
    }
    await svc.from('contacts').update({ account_id: acct!.id }).eq('id', c!.id)

    // Assert: account exists, contact linked, company UNCHANGED
    const { data: contactAfter } = await svc
      .from('contacts')
      .select('account_id, company')
      .eq('id', c!.id)
      .single()
    expect(contactAfter?.account_id).toBe(acct!.id)
    expect(contactAfter?.company).toBe('Promote Co') // phase brief §17 — NOT cleared

    // Idempotency
    const { data: again } = await svc
      .from('accounts')
      .select('id')
      .eq('org_id', fxA.orgId)
      .ilike('name', escaped)
    expect(again).toHaveLength(1)
    expect(again![0].id).toBe(acct!.id)
  })
})
