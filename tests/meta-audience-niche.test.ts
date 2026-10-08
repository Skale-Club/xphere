import { describe, expect, it, vi } from 'vitest'
import { markMetaAudiencesDirty } from '@/lib/meta/audience-dirty'
import { projectAudienceMember, projectAudienceMembers, type AudienceSourceEntity } from '@/lib/meta/audience-members'
import { SupabaseAudienceReconcileStore } from '@/lib/meta/audience-reconcile'
import {
  DEFAULT_SCRAPE_SOURCE_TYPES,
  matchesXcraperFacets,
  normalizeAudienceSourceDefinition,
  type AudienceSourceDefinition,
} from '@/lib/meta/audience-source'

function master(extra: Record<string, unknown> = {}): AudienceSourceDefinition {
  return normalizeAudienceSourceDefinition('xcraper_master', { sourceTypes: ['xcraper'], ...extra })
}

describe('xcraper_master definition normalization (niches / categories)', () => {
  it('keeps the exact old shape when no facet is stored', () => {
    expect(normalizeAudienceSourceDefinition('xcraper_master', {})).toEqual({
      kind: 'xcraper_master',
      sourceTypes: [...DEFAULT_SCRAPE_SOURCE_TYPES],
    })
    expect(normalizeAudienceSourceDefinition('xcraper_master', { sourceTypes: ['xcraper'], niches: [], categories: [] }))
      .toEqual({ kind: 'xcraper_master', sourceTypes: ['xcraper'] })
  })

  it('reads niches and categories, lowercasing niches and de-duplicating both', () => {
    expect(master({ niches: ['Barbershop', 'barbershop', ' nail_salon '], categories: ['Barber shop', 'barber SHOP', 'Hair salon'] }))
      .toEqual({
        kind: 'xcraper_master',
        sourceTypes: ['xcraper'],
        niches: ['barbershop', 'nail_salon'],
        categories: ['Barber shop', 'Hair salon'],
      })
  })

  it('ignores blank and non-string facet entries, and a non-array facet', () => {
    expect(master({ niches: ['', '  ', 4, null], categories: 'Barber shop' }))
      .toEqual({ kind: 'xcraper_master', sourceTypes: ['xcraper'] })
  })
})

describe('matchesXcraperFacets', () => {
  it('passes everything when no facet is set (including no custom fields at all)', () => {
    expect(matchesXcraperFacets(undefined, master())).toBe(true)
    expect(matchesXcraperFacets({ category: 'Anything' }, master())).toBe(true)
  })

  it('matches a niche through the niches array or the single niche', () => {
    const def = master({ niches: ['barbershop'] })
    expect(matchesXcraperFacets({ niches: ['hair_salon', 'barbershop'] }, def)).toBe(true)
    expect(matchesXcraperFacets({ niche: 'barbershop' }, def)).toBe(true)
    expect(matchesXcraperFacets({ niches: ['nail_salon'] }, def)).toBe(false)
    expect(matchesXcraperFacets({}, def)).toBe(false)
    expect(matchesXcraperFacets(undefined, def)).toBe(false)
  })

  it('matches any of several niches', () => {
    const def = master({ niches: ['barbershop', 'hair_salon'] })
    expect(matchesXcraperFacets({ niches: ['hair_salon'] }, def)).toBe(true)
    expect(matchesXcraperFacets({ niches: ['nail_salon'] }, def)).toBe(false)
  })

  it('matches a category case-insensitively, exactly', () => {
    const def = master({ categories: ['Barber shop'] })
    expect(matchesXcraperFacets({ category: 'barber SHOP' }, def)).toBe(true)
    expect(matchesXcraperFacets({ category: ' Barber shop ' }, def)).toBe(true)
    expect(matchesXcraperFacets({ category: 'Hair salon' }, def)).toBe(false)
    expect(matchesXcraperFacets({ category: null }, def)).toBe(false)
    expect(matchesXcraperFacets({}, def)).toBe(false)
  })

  it('needs both facets to match when both are set', () => {
    const def = master({ niches: ['barbershop'], categories: ['Barber shop'] })
    expect(matchesXcraperFacets({ niches: ['barbershop'], category: 'Barber shop' }, def)).toBe(true)
    expect(matchesXcraperFacets({ niches: ['barbershop'], category: 'Hair salon' }, def)).toBe(false)
    expect(matchesXcraperFacets({ niches: ['nail_salon'], category: 'Barber shop' }, def)).toBe(false)
  })
})

function account(id: string, customFields: Record<string, unknown>): AudienceSourceEntity {
  return {
    entityType: 'account',
    entityId: id,
    sourceType: 'xcraper',
    lifecycleStage: 'prospect',
    email: null,
    phone: `+1508555${id.padStart(4, '0')}`,
    customFields: customFields as AudienceSourceEntity['customFields'],
    emailStatus: null,
    engagementStatus: 'not_contacted',
    emailSuppressed: false,
    deletedAt: null,
  }
}

describe('audience projection with niche / category facets', () => {
  const barber = account('1', { niches: ['barbershop'], category: 'Barber shop' })
  const barberHairCategory = account('2', { niches: ['barbershop'], category: 'Hair salon' })
  const nail = account('3', { niches: ['nail_salon'], category: 'Nail salon' })
  const untagged = account('4', { category: 'Barber shop' })
  const both = account('5', { niches: ['barbershop', 'nail_salon'], category: 'Barber shop' })
  const all = [barber, barberHairCategory, nail, untagged, both]

  async function ids(definition: AudienceSourceDefinition) {
    const { members } = await projectAudienceMembers(all, definition)
    return members.map((member) => member.entityId).sort()
  }

  it('without facets the audience keeps every scraped prospect (old behaviour)', async () => {
    expect(await ids(master())).toEqual(['1', '2', '3', '4', '5'])
  })

  it('niche only: members whose niches include it, whatever their category', async () => {
    expect(await ids(master({ niches: ['barbershop'] }))).toEqual(['1', '2', '5'])
    expect(await ids(master({ niches: ['nail_salon'] }))).toEqual(['3', '5'])
  })

  it('category only: members of that Google category, whatever their niche', async () => {
    expect(await ids(master({ categories: ['barber shop'] }))).toEqual(['1', '4', '5'])
  })

  it('niche and category together: both must hold', async () => {
    expect(await ids(master({ niches: ['barbershop'], categories: ['Barber shop'] }))).toEqual(['1', '5'])
  })

  it('neither matches: nobody is selected and the reason is source_not_selected', async () => {
    const definition = master({ niches: ['lash_studio'] })
    expect(await ids(definition)).toEqual([])
    const result = await projectAudienceMember(barber, definition)
    expect(result).toMatchObject({ eligible: false, reason: 'source_not_selected' })
  })

  it('a contact (no custom fields) never belongs to a faceted audience, but still belongs to the plain one', async () => {
    const contact: AudienceSourceEntity = {
      entityType: 'contact',
      entityId: '9',
      sourceType: 'xcraper',
      lifecycleStage: 'prospect',
      email: 'owner@example.com',
      phone: null,
      emailSuppressed: false,
    }
    expect((await projectAudienceMember(contact, master())).eligible).toBe(true)
    expect((await projectAudienceMember(contact, master({ niches: ['barbershop'] }))).eligible).toBe(false)
  })
})

describe('SupabaseAudienceReconcileStore.loadProjectedMembers with facets', () => {
  function fakeClient(tables: Record<string, unknown[]>) {
    const queried: string[] = []
    const from = vi.fn((table: string) => {
      queried.push(table)
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'order']) chain[method] = vi.fn(() => chain)
      chain.range = vi.fn(async () => ({ data: tables[table] ?? [], error: null }))
      return chain
    })
    return { client: { from, rpc: vi.fn() } as never, queried }
  }

  const accountRows = [
    {
      id: 'a1', source_type: 'xcraper', lifecycle_stage: 'prospect', phone: '+15085550001',
      custom_fields: { niches: ['barbershop'], category: 'Barber shop' }, email_status: null, engagement_status: 'not_contacted',
    },
    {
      id: 'a2', source_type: 'xcraper', lifecycle_stage: 'prospect', phone: '+15085550002',
      custom_fields: { niches: ['nail_salon'], category: 'Nail salon' }, email_status: null, engagement_status: 'not_contacted',
    },
  ]
  const config = (sourceDefinition: unknown) => ({
    id: 'cfg', orgId: 'org', adsConnectionId: 'conn', metaAdAccountId: '1', customAudienceId: null,
    audienceName: 'x', consentBasis: 'USER_PROVIDED_ONLY' as const, termsAcceptedAt: 'now', termsAcceptedBy: 'u',
    audienceKind: 'xcraper_master', sourceDefinition: sourceDefinition as never,
  })

  it('selects only the niche members and never pages contacts', async () => {
    const { client, queried } = fakeClient({ accounts: accountRows })
    const store = new SupabaseAudienceReconcileStore(client)
    const result = await store.loadProjectedMembers(config({ kind: 'xcraper_master', sourceTypes: ['xcraper'], niches: ['barbershop'] }))

    expect(result.members.map((member) => member.entityId)).toEqual(['a1'])
    expect(queried).not.toContain('contacts')
  })

  it('without facets keeps both accounts and still reads contacts', async () => {
    const { client, queried } = fakeClient({ accounts: accountRows })
    const store = new SupabaseAudienceReconcileStore(client)
    const result = await store.loadProjectedMembers(config({ kind: 'xcraper_master', sourceTypes: ['xcraper'] }))

    expect(result.members.map((member) => member.entityId).sort()).toEqual(['a1', 'a2'])
    expect(queried).toContain('contacts')
  })
})

describe('markMetaAudiencesDirty with niches', () => {
  function builder(awaited: { data: unknown; error: unknown }) {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'update', 'in']) query[method] = vi.fn(() => query)
    query.then = (resolve: (result: { data: unknown; error: unknown }) => unknown) => resolve(awaited)
    return query as Record<string, ReturnType<typeof vi.fn>>
  }

  async function markedIds(niches: string[] | undefined) {
    const discovery = builder({
      data: [
        { id: 'plain', audience_kind: 'xcraper_master', source_definition: { sourceTypes: ['xcraper'] } },
        { id: 'barber', audience_kind: 'xcraper_master', source_definition: { sourceTypes: ['xcraper'], niches: ['barbershop'] } },
        { id: 'nails', audience_kind: 'xcraper_master', source_definition: { sourceTypes: ['xcraper'], niches: ['nail_salon'] } },
      ],
      error: null,
    })
    const update = builder({ data: null, error: null })
    let calls = 0
    const supabase = { from: vi.fn(() => (calls++ === 0 ? discovery : update)) }
    await markMetaAudiencesDirty(supabase as never, {
      orgId: 'org', reason: 'prospect_ingestion', sourceType: 'xcraper', entityType: 'account', entityId: 'a1', niches,
    })
    const call = update.in.mock.calls.find((args) => args[0] === 'id')
    return call ? call[1] : []
  }

  it('schedules the plain master and only the audiences of the entity niches', async () => {
    expect(await markedIds(['barbershop'])).toEqual(['plain', 'barber'])
    expect(await markedIds(['barbershop', 'nail_salon'])).toEqual(['plain', 'barber', 'nails'])
  })

  it('an entity with no niche schedules only the unfiltered master', async () => {
    expect(await markedIds([])).toEqual(['plain'])
  })

  it('without niche information nothing is narrowed (old behaviour)', async () => {
    expect(await markedIds(undefined)).toEqual(['plain', 'barber', 'nails'])
  })
})
