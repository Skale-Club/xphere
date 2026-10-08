import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceRoleClient } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('@/lib/prospects/outreach-eligibility', () => ({
  isDndBlocked: vi.fn(() => false),
  loadEmailSuppressions: vi.fn(async () => new Set<string>()),
  normalizeOutreachEmail: vi.fn((value: string | null) => value?.trim().toLowerCase() ?? null),
}))

import { metaAudienceTools } from '@/lib/mcp/tools/meta-audiences'
import { prospectsTools } from '@/lib/mcp/tools/prospects'

const ctx = { auth: { orgId: 'org-1' } } as never

// ── meta_audience_create_niche ───────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 30 * 24 * 3600_000).toISOString()

function configRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-master',
    org_id: 'org-1',
    ads_connection_id: 'conn-1',
    meta_ad_account_id: '123456',
    custom_audience_id: 'remote-1',
    audience_name: 'Skale Club - Xcraper Prospects',
    audience_kind: 'xcraper_master',
    source_definition: { kind: 'xcraper_master', sourceTypes: ['xcraper', 'google-maps'] },
    sync_enabled: true,
    consent_basis: 'USER_PROVIDED_ONLY',
    terms_accepted_at: '2026-09-01T00:00:00Z',
    terms_accepted_by: 'user-1',
    operational_status: 'idle',
    last_synced_at: null,
    last_sync_stats: null,
    last_error_code: null,
    last_error_message: null,
    ...overrides,
  }
}

const connectionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  status: 'active',
  usable: true,
  ad_account_id: '123456',
  token_expires_at: FUTURE,
  ...overrides,
})

function arrangeAudiences(configs: Array<Record<string, unknown>>, connection: Record<string, unknown> | null = connectionRow()) {
  const inserted: Array<Record<string, unknown>> = []
  const from = vi.fn((table: string) => {
    if (table === 'meta_audience_config') {
      const chain: Record<string, unknown> = {}
      let inserting: Record<string, unknown> | null = null
      for (const method of ['select', 'eq']) chain[method] = vi.fn(() => chain)
      chain.order = vi.fn(async () => ({ data: configs, error: null }))
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        inserting = row
        inserted.push(row)
        return chain
      })
      chain.single = vi.fn(async () => ({ data: { ...configRow(), id: 'cfg-new', custom_audience_id: null, ...inserting }, error: null }))
      return chain
    }
    if (table === 'ads_connections') {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq']) chain[method] = vi.fn(() => chain)
      chain.maybeSingle = vi.fn(async () => ({ data: connection, error: null }))
      return chain
    }
    throw new Error(`unexpected table ${table}`)
  })
  createServiceRoleClient.mockReturnValue({ from })
  return { inserted }
}

const createNiche = metaAudienceTools.find((tool) => tool.name === 'meta_audience_create_niche')!
const run = (input: Record<string, unknown>) => createNiche.handler(createNiche.inputSchema.parse(input), ctx) as Promise<Record<string, unknown>>

describe('meta_audience_create_niche', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects anything that is not a niche slug', () => {
    for (const niche of ['Barbershop', 'nail salon', 'x', '', 'a'.repeat(41)]) {
      expect(createNiche.inputSchema.safeParse({ niche }).success).toBe(false)
    }
    expect(createNiche.inputSchema.safeParse({ niche: 'nail_salon' }).success).toBe(true)
  })

  it('creates an enabled, dirty niche audience reusing the master connection, consent basis and terms', async () => {
    const { inserted } = arrangeAudiences([configRow()])

    const result = await run({ niche: 'barbershop' })

    expect(result.created).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      org_id: 'org-1',
      ads_connection_id: 'conn-1',
      meta_ad_account_id: '123456',
      audience_name: 'Skale Club - Prospects - Barbershops',
      audience_kind: 'xcraper_master',
      source_definition: { kind: 'xcraper_master', sourceTypes: ['xcraper', 'google-maps'], niches: ['barbershop'] },
      consent_basis: 'USER_PROVIDED_ONLY',
      terms_accepted_at: '2026-09-01T00:00:00Z',
      terms_accepted_by: 'user-1',
      sync_enabled: true,
      operational_status: 'dirty',
      dirty_reason: 'niche_audience_created',
    })
    expect(inserted[0].dirty_at).toBeTruthy()
    expect(inserted[0].next_sync_at).toBeTruthy()
    expect(result.audience).toMatchObject({ niches: ['barbershop'], categories: [], sync_enabled: true, remote_audience_created: false })
  })

  it('uses the given name and categories', async () => {
    const { inserted } = arrangeAudiences([configRow()])

    await run({ niche: 'nail_salon', name: 'Nails', categories: ['Nail salon', 'nail salon', 'Beauty salon'] })

    expect(inserted[0]).toMatchObject({
      audience_name: 'Nails',
      source_definition: { kind: 'xcraper_master', niches: ['nail_salon'], categories: ['Nail salon', 'Beauty salon'] },
    })
  })

  it('is idempotent: an existing audience for the niche is returned, nothing is inserted', async () => {
    const existing = configRow({
      id: 'cfg-barber',
      audience_name: 'Skale Club - Prospects - Barbershops',
      source_definition: { kind: 'xcraper_master', sourceTypes: ['xcraper'], niches: ['barbershop'] },
    })
    const { inserted } = arrangeAudiences([configRow(), existing])

    const result = await run({ niche: 'barbershop' })

    expect(result.created).toBe(false)
    expect(inserted).toHaveLength(0)
    expect(result.audience).toMatchObject({ id: 'cfg-barber', niches: ['barbershop'] })
  })

  it('tells the caller when a repeated request asks for different categories than the stored audience', async () => {
    const existing = configRow({
      id: 'cfg-barber',
      source_definition: { kind: 'xcraper_master', sourceTypes: ['xcraper'], niches: ['barbershop'], categories: ['Barber shop'] },
    })
    arrangeAudiences([configRow(), existing])

    const result = await run({ niche: 'barbershop', categories: ['Hair salon'] })

    expect(result.created).toBe(false)
    expect(String(result.message)).toMatch(/categories differ/)
  })

  it('prefers the unfiltered master as the donor, even when a niche audience came first', async () => {
    const nailAudience = configRow({
      id: 'cfg-nails',
      ads_connection_id: 'conn-OTHER',
      source_definition: { kind: 'xcraper_master', sourceTypes: ['xcraper'], niches: ['nail_salon'] },
    })
    const { inserted } = arrangeAudiences([nailAudience, configRow()])

    await run({ niche: 'barbershop' })

    expect(inserted[0].ads_connection_id).toBe('conn-1')
  })

  it.each([
    ['there is no prospect audience at all', []],
    ['the master is not enabled', [configRow({ sync_enabled: false })]],
    ['the master never had its terms accepted', [configRow({ terms_accepted_at: null })]],
    ['the master has no accepted-by user', [configRow({ terms_accepted_by: null })]],
    ['the master has no connection', [configRow({ ads_connection_id: null })]],
    ['only a CRM audience exists', [configRow({ audience_kind: 'crm_contacts' })]],
  ])('refuses when %s', async (_name, configs) => {
    const { inserted } = arrangeAudiences(configs as Array<Record<string, unknown>>)

    const result = await run({ niche: 'barbershop' })

    expect(result.error).toBe('meta_audience_master_required')
    expect(inserted).toHaveLength(0)
  })

  it('keeps the safety checks on the connection', async () => {
    let arranged = arrangeAudiences([configRow()], null)
    expect((await run({ niche: 'barbershop' })).error).toBe('meta_audience_connection_not_found')
    expect(arranged.inserted).toHaveLength(0)

    arranged = arrangeAudiences([configRow()], connectionRow({ ad_account_id: '999' }))
    expect((await run({ niche: 'barbershop' })).error).toBe('meta_audience_connection_not_found')

    arranged = arrangeAudiences([configRow()], connectionRow({ usable: false }))
    expect((await run({ niche: 'barbershop' })).error).toBe('meta_audience_connection_inactive')
    expect(arranged.inserted).toHaveLength(0)

    arranged = arrangeAudiences([configRow()], connectionRow({ token_expires_at: new Date(Date.now() - 1000).toISOString() }))
    expect((await run({ niche: 'barbershop' })).error).toBe('meta_audience_connection_expired')
    expect(arranged.inserted).toHaveLength(0)
  })
})

describe('meta_audiences_status niches / categories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows each audience filter; empty arrays mean no filter', async () => {
    const tool = metaAudienceTools.find((candidate) => candidate.name === 'meta_audiences_status')!
    const rows: Record<string, unknown[]> = {
      meta_audience_config: [
        configRow(),
        configRow({
          id: 'cfg-barber',
          source_definition: { kind: 'xcraper_master', sourceTypes: ['xcraper'], niches: ['barbershop'], categories: ['Barber shop'] },
        }),
        configRow({ id: 'cfg-crm', audience_kind: 'crm_contacts', source_definition: { kind: 'crm_contacts' } }),
      ],
      ads_connections: [connectionRow()],
      meta_audience_sync_runs: [],
    }
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = vi.fn(() => chain)
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows[table], error: null })
      return chain
    })
    createServiceRoleClient.mockReturnValue({ from })

    const result = await tool.handler(tool.inputSchema.parse({}), ctx) as { audiences: Array<Record<string, unknown>> }

    expect(result.audiences[0]).toMatchObject({ id: 'cfg-master', niches: [], categories: [] })
    expect(result.audiences[1]).toMatchObject({ id: 'cfg-barber', niches: ['barbershop'], categories: ['Barber shop'] })
    expect(result.audiences[2]).toMatchObject({ id: 'cfg-crm', niches: [], categories: [] })
  })
})

// ── prospects_list niche ─────────────────────────────────────────────────────

function accountsQuery(rows: Array<Record<string, unknown>>) {
  const calls = { or: vi.fn() }
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    ilike: vi.fn(() => query),
    contains: vi.fn(() => query),
    or: calls.or.mockImplementation(() => query),
    limit: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return { query, calls }
}

describe('prospects_list niche', () => {
  beforeEach(() => vi.clearAllMocks())

  const base = { domain: null, website: null, address: null, score: 50, source_type: 'xcraper', engagement_status: 'not_contacted' }
  const rows = [
    { ...base, id: 'a', name: 'Barber A', phone: '+15085550001', custom_fields: { niche: 'barbershop', niches: ['barbershop'] } },
    { ...base, id: 'b', name: 'Both', phone: '+15085550002', custom_fields: { niche: 'nail_salon', niches: ['barbershop', 'nail_salon'] } },
    { ...base, id: 'c', name: 'Legacy', phone: '+15085550003', custom_fields: { niche: 'nail_salon' } },
    { ...base, id: 'd', name: 'Untagged', phone: '+15085550004', custom_fields: {} },
  ]
  const list = prospectsTools.find((tool) => tool.name === 'prospects_list')!

  it('rejects a niche that is not a slug', () => {
    expect(list.inputSchema.safeParse({ niche: 'Nail Salon' }).success).toBe(false)
    expect(list.inputSchema.safeParse({ niche: 'nail_salon' }).success).toBe(true)
  })

  it('filters on niches containing the slug, falling back to the single niche', async () => {
    const { query, calls } = accountsQuery([rows[0], rows[1]])
    createServiceRoleClient.mockReturnValue({ from: vi.fn(() => query) })

    await list.handler(list.inputSchema.parse({ kind: 'company', niche: 'barbershop' }), ctx)

    expect(calls.or).toHaveBeenCalledWith(
      'custom_fields.cs.{"niches":["barbershop"]},custom_fields.cs.{"niche":"barbershop"}',
    )
  })

  it('does not filter by niche when none is given', async () => {
    const { query, calls } = accountsQuery(rows)
    createServiceRoleClient.mockReturnValue({ from: vi.fn(() => query) })

    await list.handler(list.inputSchema.parse({ kind: 'company' }), ctx)

    expect(calls.or).not.toHaveBeenCalled()
  })

  it('summarises counts per niche: a business in two niches counts in both, none is unclassified', async () => {
    const { query } = accountsQuery(rows)
    createServiceRoleClient.mockReturnValue({ from: vi.fn(() => query) })

    const result = await list.handler(list.inputSchema.parse({ kind: 'company' }), ctx) as Record<string, unknown>

    expect(result.total).toBe(4)
    expect(result.by_niche).toEqual({ barbershop: 2, nail_salon: 2, unclassified: 1 })
    const prospects = result.prospects as Array<Record<string, unknown>>
    expect(prospects.find((prospect) => prospect.id === 'b')?.niches).toEqual(['barbershop', 'nail_salon'])
    expect(prospects.find((prospect) => prospect.id === 'c')?.niches).toEqual(['nail_salon'])
  })
})
