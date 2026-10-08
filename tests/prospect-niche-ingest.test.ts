import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceRoleClientMock = vi.fn()
const markMetaAudiencesDirtyMock = vi.fn(async () => ({ marked: 1 }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}))

vi.mock('@/lib/meta/audience-dirty', () => ({
  markMetaAudiencesDirty: markMetaAudiencesDirtyMock,
}))

type QueryResult = { data: unknown; error: unknown }

function makeBuilder(results: { maybeSingle?: QueryResult; single?: QueryResult; awaited?: QueryResult } = {}) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'ilike', 'insert', 'update', 'in', 'neq', 'limit', 'contains']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => results.maybeSingle ?? { data: null, error: null })
  builder.single = vi.fn(async () => results.single ?? { data: null, error: null })
  builder.then = (resolve: (result: QueryResult) => unknown) => resolve(results.awaited ?? { data: null, error: null })
  return builder as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResult>
}

function requestFor(prospect: Record<string, unknown>) {
  return new Request('https://xphere.app/api/v1/prospects', {
    method: 'POST',
    headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
    body: JSON.stringify({ source: { type: 'xcraper' }, prospects: [prospect] }),
  })
}

/** An org with an existing prospect account (or none) and a way to inspect the write. */
function arrange(existing: Record<string, unknown> | null) {
  const apiKey = makeBuilder({
    maybeSingle: { data: { id: 'key-1', org_id: 'org-skale', scopes: ['prospects:write'] }, error: null },
  })
  const runInsert = makeBuilder({ single: { data: { id: 'run-1' }, error: null } })
  const accountLookup = makeBuilder({ maybeSingle: { data: existing, error: null } })
  const accountWrite = makeBuilder({ single: { data: { id: 'account-new' }, error: null } })
  let prospectSourceCalls = 0
  let accountCalls = 0
  let apiKeyCalls = 0
  const from = vi.fn((table: string) => {
    if (table === 'api_keys') return apiKeyCalls++ === 0 ? apiKey : makeBuilder()
    if (table === 'prospect_sources') return prospectSourceCalls++ === 0 ? runInsert : makeBuilder()
    if (table === 'accounts') return accountCalls++ === 0 ? accountLookup : accountWrite
    if (table === 'prospect_engagement_events') return makeBuilder()
    if (table === 'website_analyses') return makeBuilder()
    throw new Error(`unexpected table: ${table}`)
  })
  createServiceRoleClientMock.mockReturnValue({ from })
  return { accountWrite }
}

const company = (customFields: Record<string, unknown>) => ({
  kind: 'company',
  name: 'Hudson Barber',
  source_id: 'place-1',
  phone: '(978) 555-0100',
  phone_country: 'US',
  custom_fields: customFields,
})

beforeEach(() => {
  createServiceRoleClientMock.mockReset()
  markMetaAudiencesDirtyMock.mockClear()
  vi.resetModules()
})

describe('Xcraper ingest: niche', () => {
  it('stores niche and a one-element niches array on a new account', async () => {
    const { accountWrite } = arrange(null)
    const { POST } = await import('@/app/api/v1/prospects/route')

    const response = await POST(requestFor(company({ category: 'Barber shop', niche: 'barbershop' })))

    expect(response.status).toBe(201)
    expect(accountWrite.insert).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: expect.objectContaining({ category: 'Barber shop', niche: 'barbershop', niches: ['barbershop'] }),
    }))
  })

  it('adds no niche keys to a new account when the payload has none', async () => {
    const { accountWrite } = arrange(null)
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ category: 'Barber shop' })))

    const inserted = accountWrite.insert.mock.calls[0][0] as { custom_fields: Record<string, unknown> }
    expect('niche' in inserted.custom_fields).toBe(false)
    expect('niches' in inserted.custom_fields).toBe(false)
  })

  it('a business found by a second niche scrape belongs to both, and the first is not dropped', async () => {
    const { accountWrite } = arrange({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: { category: 'Barber shop', niche: 'barbershop', niches: ['barbershop'] },
      source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ category: 'Barber shop', niche: 'hair_salon' })))

    expect(accountWrite.update).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: expect.objectContaining({ niche: 'hair_salon', niches: ['barbershop', 'hair_salon'] }),
    }))
  })

  it('re-pushing the same niche does not duplicate it', async () => {
    const { accountWrite } = arrange({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: { niche: 'barbershop', niches: ['barbershop'] },
      source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ niche: 'barbershop' })))

    expect(accountWrite.update).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: expect.objectContaining({ niche: 'barbershop', niches: ['barbershop'] }),
    }))
  })

  it('a re-push from a scrape without a niche keeps every niche the account had', async () => {
    const { accountWrite } = arrange({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: { niche: 'barbershop', niches: ['barbershop', 'hair_salon'] },
      source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ category: 'Barber shop' })))

    expect(accountWrite.update).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: expect.objectContaining({ niche: 'barbershop', niches: ['barbershop', 'hair_salon'] }),
    }))
  })

  it('an account that only had the legacy single niche gets it promoted into niches', async () => {
    const { accountWrite } = arrange({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: { niche: 'barbershop' },
      source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ niche: 'nail_salon' })))

    expect(accountWrite.update).toHaveBeenCalledWith(expect.objectContaining({
      custom_fields: expect.objectContaining({ niches: ['barbershop', 'nail_salon'] }),
    }))
  })

  it('an invalid niche in the payload is not stored', async () => {
    const { accountWrite } = arrange(null)
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ niche: 'Nail Salon' })))

    const inserted = accountWrite.insert.mock.calls[0][0] as { custom_fields: Record<string, unknown> }
    expect('niche' in inserted.custom_fields).toBe(false)
    expect('niches' in inserted.custom_fields).toBe(false)
  })

  it('marks Meta audiences dirty with the niches the account now belongs to', async () => {
    arrange({
      id: 'account-1',
      lifecycle_stage: 'prospect',
      custom_fields: { niches: ['barbershop'] },
      source_payload: {},
    })
    const { POST } = await import('@/app/api/v1/prospects/route')

    await POST(requestFor(company({ niche: 'hair_salon' })))

    expect(markMetaAudiencesDirtyMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org-skale',
        sourceType: 'xcraper',
        entityType: 'account',
        niches: ['barbershop', 'hair_salon'],
      }),
    )
  })
})
