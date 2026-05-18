// tests/accounts-csv-import.test.ts
// Phase 65 Plan 05 — ACC-17 coverage: parser, mapping, dedup, idempotency.
//
// Tier 1: pure parser + heuristic + normaliser (always runs).
// Tier 2: vi.mock action-level tests — invoke importAccountsCsv directly
//         to cover MAX_CSV_BYTES, name_column_required, and the happy-path
//         AccountImportSummary shape. Plan-checker flagged that the prior
//         version of this plan never invoked the action, only simulated it.
// Tier 3: DB-level simulateImport — supplementary proof that the dedup
//         logic works against real existing rows; idempotency on rerun.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// ─── Tier 2 setup — mock @/lib/supabase/server BEFORE importing the action ──

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

// `revalidatePath` from next/cache throws "static generation store missing"
// outside a Next.js render context. We mock it as a no-op so the happy-path
// importAccountsCsv test (which calls revalidatePath on success) can complete.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { serviceClient, seedTestOrg, type TestOrgFixture } from './agents/fixtures'
import { createClient, getUser } from '@/lib/supabase/server'
import { importAccountsCsv } from '@/app/(dashboard)/accounts/actions'
import {
  parseCsv,
  suggestAccountColumnMapping,
  ACCOUNT_CSV_FIELDS,
  type AccountCsvField,
} from '@/lib/accounts/csv'
import { normaliseDomain } from '@/lib/accounts'

// ─── Tier 1 — pure parser + mapper smoke (always runs) ───────────────────────

describe('parseCsv via @/lib/accounts/csv (re-export)', () => {
  it('round-trips a simple accounts CSV', () => {
    const txt = 'name,domain,industry\nAcme,acme.com,SaaS\nBeta Co,beta.io,Fintech'
    const r = parseCsv(txt)
    expect(r.headers).toEqual(['name', 'domain', 'industry'])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toEqual(['Acme', 'acme.com', 'SaaS'])
  })
  it('handles quoted commas in addresses', () => {
    const txt = 'name,address\n"Acme, Inc.","1 Main St, Suite 200"'
    const r = parseCsv(txt)
    expect(r.rows[0]).toEqual(['Acme, Inc.', '1 Main St, Suite 200'])
  })
})

describe('suggestAccountColumnMapping coverage', () => {
  it('every suggestion is a valid ACCOUNT_CSV_FIELDS entry or null', () => {
    const headers = ['Name', 'Domain', 'Industry', 'Website', 'Tags', 'Garbage']
    const m = suggestAccountColumnMapping(headers)
    for (const v of Object.values(m)) {
      if (v !== null) expect(ACCOUNT_CSV_FIELDS).toContain(v)
    }
  })
})

describe('domain dedup key derivation', () => {
  it('normaliseDomain collapses casing + protocol + trailing slash', () => {
    expect(normaliseDomain('https://Acme.COM/')).toBe('acme.com')
    expect(normaliseDomain('Acme.COM')).toBe('acme.com')
    expect(normaliseDomain('acme.com')).toBe('acme.com')
  })
})

// ─── Tier 2 — vi.mock action-level (always runs) ─────────────────────────────
//
// Invokes importAccountsCsv DIRECTLY. Asserts the discriminated ActionResult
// return values for the control-flow paths the plan-checker flagged as
// uncovered (MAX_CSV_BYTES, name_column_required, AccountImportSummary).

function buildFakeSupabaseClient(opts: {
  rpcOrgId?: string | null
  existingAccounts?: Array<{ id: string; name: string; domain: string | null }>
  insertResult?: {
    data: Array<{ id: string }> | null
    error: { message: string } | null
  }
}) {
  const make = (result: unknown): any => {
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
    proxy.then = (resolve: (v: unknown) => void) =>
      Promise.resolve(result).then(resolve)
    return proxy
  }
  return {
    rpc: vi.fn(async () => ({ data: opts.rpcOrgId ?? 'test-org-id', error: null })),
    from: vi.fn((table: string) => {
      if (table === 'accounts') {
        return {
          select: () => make({ data: opts.existingAccounts ?? [], error: null }),
          insert: () => make(opts.insertResult ?? { data: [], error: null }),
          eq: vi.fn(),
        }
      }
      return make({ data: null, error: null })
    }),
  }
}

describe('importAccountsCsv action-level (vi.mock — no DB env required)', () => {
  beforeEach(() => {
    vi.mocked(getUser).mockResolvedValue({ id: 'test-user-id' } as any)
  })

  it('returns { ok: false, error: "name_column_required" } when mapping has no name column', async () => {
    const fake = buildFakeSupabaseClient({})
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const csv = 'domain,industry\nacme.com,SaaS\n'
    const mapping: Record<string, AccountCsvField | null> = {
      domain: 'domain',
      industry: 'industry',
      // intentionally NO mapping to 'name'
    }
    const result = await importAccountsCsv(csv, mapping)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('name_column_required')
    }
  })

  it('returns { ok: false, error: "csv_too_large" } when csv text exceeds MAX_CSV_BYTES (5MB)', async () => {
    const fake = buildFakeSupabaseClient({})
    vi.mocked(createClient).mockResolvedValue(fake as any)

    // Construct a string just over 5MB. We don't need it to be valid CSV —
    // the size guard runs before parseCsv.
    const big = 'x'.repeat(5 * 1024 * 1024 + 1)
    const result = await importAccountsCsv(big, { name: 'name' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('csv_too_large')
    }
  })

  it('returns { ok: false, error: "csv_empty" } when csv text is empty', async () => {
    const fake = buildFakeSupabaseClient({})
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await importAccountsCsv('', { name: 'name' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('csv_empty')
    }
  })

  it('returns { ok: true, data: AccountImportSummary } for a tiny happy-path CSV', async () => {
    // No existing accounts → both rows insert. The action's chunked-insert
    // call returns canned ids; summary.inserted increments from data.length.
    const fake = buildFakeSupabaseClient({
      existingAccounts: [],
      insertResult: {
        data: [{ id: 'new-1' }, { id: 'new-2' }],
        error: null,
      },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const csv = 'name,domain\nAcme,acme.com\nBeta Co,beta.io\n'
    const mapping: Record<string, AccountCsvField | null> = {
      name: 'name',
      domain: 'domain',
    }
    const result = await importAccountsCsv(csv, mapping)

    expect(result.ok).toBe(true)
    if (result.ok) {
      // AccountImportSummary shape: { inserted, skipped, errors[] }
      expect(result.data).toHaveProperty('inserted')
      expect(result.data).toHaveProperty('skipped')
      expect(result.data).toHaveProperty('errors')
      expect(Array.isArray(result.data.errors)).toBe(true)
      expect(typeof result.data.inserted).toBe('number')
      expect(typeof result.data.skipped).toBe('number')
    }
  })
})

// ─── Tier 3 — DB integration: simulated importAccountsCsv at the SQL layer ───

const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbDescribe = DB_URL && serviceKey ? describe : describe.skip

/**
 * Mimics the importAccountsCsv action's dedup + insert behavior at the
 * service-role layer. SUPPLEMENTARY to the Tier 2 vi.mock tests — it proves
 * the dedup keys + idempotency hold against real existing rows in a real org.
 */
async function simulateImport(
  svc: ReturnType<typeof serviceClient>,
  orgId: string,
  csvText: string,
  mapping: Record<string, AccountCsvField | null>,
): Promise<{ inserted: number; skipped: number }> {
  const parsed = parseCsv(csvText)
  const fieldToIdx: Partial<Record<AccountCsvField, number>> = {}
  for (const [h, f] of Object.entries(mapping)) {
    if (!f) continue
    const idx = parsed.headers.indexOf(h)
    if (idx >= 0) fieldToIdx[f] = idx
  }
  if (fieldToIdx.name === undefined) throw new Error('name column required')

  const { data: existing } = await svc
    .from('accounts')
    .select('id, name, domain')
    .eq('org_id', orgId)
  const existingNames = new Set(
    (existing ?? []).map((r) => (r.name ?? '').trim().toLowerCase()),
  )
  const existingDomains = new Set(
    (existing ?? [])
      .map((r) => normaliseDomain(r.domain))
      .filter((d): d is string => Boolean(d)),
  )

  let inserted = 0
  let skipped = 0
  const seenInBatchNames = new Set<string>()
  const seenInBatchDomains = new Set<string>()

  const get = (row: string[], f: AccountCsvField): string | null => {
    const idx = fieldToIdx[f]
    if (idx === undefined) return null
    const v = (row[idx] ?? '').trim()
    return v || null
  }

  for (const row of parsed.rows) {
    const name = get(row, 'name')
    if (!name) {
      skipped++
      continue
    }
    const nk = name.toLowerCase()
    const domain = normaliseDomain(get(row, 'domain'))
    if (existingNames.has(nk) || seenInBatchNames.has(nk)) {
      skipped++
      continue
    }
    if (domain && (existingDomains.has(domain) || seenInBatchDomains.has(domain))) {
      skipped++
      continue
    }
    seenInBatchNames.add(nk)
    if (domain) seenInBatchDomains.add(domain)
    const { error } = await svc.from('accounts').insert({
      org_id: orgId,
      name,
      domain,
      source: 'csv_import',
    })
    if (error) {
      skipped++
      continue
    }
    inserted++
  }
  return { inserted, skipped }
}

dbDescribe('importAccountsCsv — DB-level simulation (supplementary dedup proof)', () => {
  const svc = serviceClient()
  let fx: TestOrgFixture

  beforeAll(async () => {
    fx = await seedTestOrg('acc-csv-import')
  }, 60000)

  afterAll(async () => {
    if (fx) await fx.cleanup()
  })

  it('ACC-17 inserts 5 distinct rows on first run', async () => {
    const csv =
      'name,domain,industry\n' +
      'Acme,acme.com,SaaS\n' +
      'Beta Co,beta.io,Fintech\n' +
      'Gamma LLC,gamma.dev,DevTools\n' +
      'Delta,,Healthcare\n' +
      'Epsilon Inc,epsilon.com,Retail\n'
    const mapping: Record<string, AccountCsvField | null> = {
      name: 'name',
      domain: 'domain',
      industry: 'industry',
    }
    const r = await simulateImport(svc, fx.orgId, csv, mapping)
    expect(r.inserted).toBe(5)
    expect(r.skipped).toBe(0)
  })

  it('ACC-17 idempotent: re-running the same CSV inserts 0, skips all', async () => {
    const csv =
      'name,domain\n' +
      'Acme,acme.com\n' +
      'Beta Co,beta.io\n' +
      'Gamma LLC,gamma.dev\n' +
      'Delta,\n' +
      'Epsilon Inc,epsilon.com\n'
    const mapping: Record<string, AccountCsvField | null> = {
      name: 'name',
      domain: 'domain',
    }
    const r = await simulateImport(svc, fx.orgId, csv, mapping)
    expect(r.inserted).toBe(0)
    expect(r.skipped).toBe(5)
  })

  it('ACC-17 dedup by domain: two rows sharing a domain — one inserted, one skipped', async () => {
    const csv =
      'name,domain\n' +
      'Acme New,brand-new-domain.test\n' +
      'Acme Renamed,brand-new-domain.test\n'
    const mapping: Record<string, AccountCsvField | null> = {
      name: 'name',
      domain: 'domain',
    }
    const r = await simulateImport(svc, fx.orgId, csv, mapping)
    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
  })

  it('ACC-17 dedup by name (case-insensitive): two rows sharing lower(name)', async () => {
    const csv =
      'name,domain\n' +
      'Zulu Corp,zulu1.test\n' +
      'ZULU CORP,zulu2.test\n'
    const mapping: Record<string, AccountCsvField | null> = {
      name: 'name',
      domain: 'domain',
    }
    const r = await simulateImport(svc, fx.orgId, csv, mapping)
    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
  })

  it('ACC-17 skips rows missing name', async () => {
    const csv = 'name,domain\n,no-name.test\nValid Account,valid.test\n'
    const mapping: Record<string, AccountCsvField | null> = {
      name: 'name',
      domain: 'domain',
    }
    const r = await simulateImport(svc, fx.orgId, csv, mapping)
    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
  })
})
