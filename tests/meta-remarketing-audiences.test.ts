import { describe, expect, it, vi } from 'vitest'
import {
  isAudienceDefinitionValid,
  isMemberListAudience,
  matchesCrmContactsDefinition,
  normalizeAudienceSourceDefinition,
  type CrmContactsDefinition,
} from '@/lib/meta/audience-source'
import { projectAudienceMembers, type AudienceSourceEntity } from '@/lib/meta/audience-members'
import { buildWebsiteAudienceRule } from '@/lib/meta/custom-audiences'
import { reconcileMetaAudience } from '@/lib/meta/audience-reconcile'
import { markMetaAudiencesDirty } from '@/lib/meta/audience-dirty'
import { REMARKETING_PACK, remarketingPackName } from '@/lib/meta/remarketing-pack'

const PIXEL = '335155035165495'

describe('crm_contacts source definition', () => {
  it('defaults to every inbound stage and drops unknown or prospect stages', () => {
    expect(normalizeAudienceSourceDefinition('crm_contacts', {})).toEqual({
      kind: 'crm_contacts', lifecycleStages: ['lead', 'opportunity', 'customer'], sources: [], sourceTypes: [], tags: [],
    })
    const narrowed = normalizeAudienceSourceDefinition('crm_contacts', {
      lifecycleStages: ['customer', 'prospect', 'bogus', 'customer'], sources: ['api', ' ', 'api'], tags: ['vip'],
    })
    expect(narrowed).toMatchObject({ lifecycleStages: ['customer'], sources: ['api'], tags: ['vip'] })
  })

  it('matches on stage, then narrows by source, source type and any-of tags', () => {
    const definition = normalizeAudienceSourceDefinition('crm_contacts', {
      lifecycleStages: ['lead'], sources: ['api'], sourceTypes: ['skaleclub'], tags: ['webinar', 'quote'],
    }) as CrmContactsDefinition
    const base = { lifecycleStage: 'lead', source: 'api', sourceType: 'skaleclub', tags: ['quote'] }
    expect(matchesCrmContactsDefinition(base, definition)).toBe(true)
    expect(matchesCrmContactsDefinition({ ...base, lifecycleStage: 'prospect' }, definition)).toBe(false)
    expect(matchesCrmContactsDefinition({ ...base, source: 'whatsapp' }, definition)).toBe(false)
    expect(matchesCrmContactsDefinition({ ...base, sourceType: null }, definition)).toBe(false)
    expect(matchesCrmContactsDefinition({ ...base, tags: ['other'] }, definition)).toBe(false)
  })
})

describe('pixel_website source definition', () => {
  it('clamps retention to Meta limits and keeps the pixel and events', () => {
    expect(normalizeAudienceSourceDefinition('pixel_website', {
      pixelId: ` ${PIXEL} `, events: ['PageView', 'PageView'], retentionDays: 400, urlContains: '  ',
    })).toEqual({ kind: 'pixel_website', pixelId: PIXEL, events: ['PageView'], retentionDays: 180, urlContains: null })
    expect(normalizeAudienceSourceDefinition('pixel_website', { pixelId: PIXEL, events: ['Lead'], retentionDays: 0 }))
      .toMatchObject({ retentionDays: 1 })
  })

  it('is valid only with a numeric pixel id and at least one event, and never uploads members', () => {
    const ok = normalizeAudienceSourceDefinition('pixel_website', { pixelId: PIXEL, events: ['PageView'] })
    expect(isAudienceDefinitionValid(ok)).toBe(true)
    expect(isMemberListAudience(ok)).toBe(false)
    expect(isAudienceDefinitionValid(normalizeAudienceSourceDefinition('pixel_website', { pixelId: 'abc', events: ['PageView'] }))).toBe(false)
    expect(isAudienceDefinitionValid(normalizeAudienceSourceDefinition('pixel_website', { pixelId: PIXEL, events: [] }))).toBe(false)
  })
})

describe('buildWebsiteAudienceRule', () => {
  it('builds a single-event rule with retention in seconds', () => {
    expect(buildWebsiteAudienceRule({ pixelId: PIXEL, events: ['PageView'], retentionDays: 30 })).toEqual({
      inclusions: {
        operator: 'or',
        rules: [{
          event_sources: [{ id: PIXEL, type: 'pixel' }],
          retention_seconds: 30 * 86_400,
          filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'PageView' }] },
        }],
      },
    })
  })

  it('ORs several events and ANDs an optional URL fragment', () => {
    const rule = buildWebsiteAudienceRule({ pixelId: PIXEL, events: ['Lead', 'Contact'], retentionDays: 180, urlContains: '/pricing' })
    const filter = (rule.inclusions as { rules: Array<{ filter: unknown }> }).rules[0].filter
    expect(filter).toEqual({
      operator: 'and',
      filters: [
        { operator: 'or', filters: [
          { field: 'event', operator: 'eq', value: 'Lead' },
          { field: 'event', operator: 'eq', value: 'Contact' },
        ] },
        { field: 'url', operator: 'i_contains', value: '/pricing' },
      ],
    })
  })

  it('refuses a rule with no events', () => {
    expect(() => buildWebsiteAudienceRule({ pixelId: PIXEL, events: [], retentionDays: 30 })).toThrow()
  })
})

describe('projecting CRM contact audiences', () => {
  function contact(id: string, overrides: Partial<AudienceSourceEntity> = {}): AudienceSourceEntity {
    return {
      entityType: 'contact', entityId: id, sourceType: null, lifecycleStage: 'lead', source: 'api', tags: [],
      email: `${id}@example.com`, phone: null, ...overrides,
    }
  }

  it('selects inbound contacts and keeps prospects, accounts and opted-out people out', async () => {
    const definition = normalizeAudienceSourceDefinition('crm_contacts', {})
    const { members, exclusions } = await projectAudienceMembers([
      contact('lead-1'),
      contact('customer-1', { lifecycleStage: 'customer' }),
      contact('prospect-1', { lifecycleStage: 'prospect' }),
      contact('dnd-1', { dndEnabled: true }),
      { ...contact('account-1'), entityType: 'account' },
    ], definition)
    expect(members.map((member) => member.entityId).sort()).toEqual(['customer-1', 'lead-1'])
    expect(Object.fromEntries(exclusions.map((item) => [item.entityId, item.reason]))).toEqual({
      'prospect-1': 'source_not_selected',
      'dnd-1': 'dnd',
      'account-1': 'source_not_selected',
    })
  })

  it('selects nobody for a pixel audience', async () => {
    const definition = normalizeAudienceSourceDefinition('pixel_website', { pixelId: PIXEL, events: ['PageView'] })
    const { members } = await projectAudienceMembers([contact('lead-1')], definition)
    expect(members).toEqual([])
  })
})

describe('reconciling a pixel website audience', () => {
  function harness(customAudienceId: string | null) {
    const config = {
      id: 'config-pixel', orgId: 'org-1', adsConnectionId: 'connection-1', metaAdAccountId: 'act_123',
      customAudienceId, audienceName: 'Skale Club | Site Visitors 30D', consentBasis: 'USER_PROVIDED_ONLY' as const,
      termsAcceptedAt: '2026-10-07T00:00:00Z', termsAcceptedBy: 'user-1',
      audienceKind: 'pixel_website',
      sourceDefinition: { kind: 'pixel_website', pixelId: PIXEL, events: ['PageView'], retentionDays: 30 },
    }
    const store = {
      claim: vi.fn(async () => ({ claimed: true as const, runId: 'run-1', claimId: 'claim-1' })),
      loadConfig: vi.fn(async () => config),
      loadProjectedMembers: vi.fn(),
      loadMemberships: vi.fn(),
      setRemoteAudienceId: vi.fn(async () => undefined),
      commitSuccess: vi.fn(async () => undefined),
      completeDryRun: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    }
    const provider = { getConnection: vi.fn(async () => ({ token: 'secret-token', adAccountId: 'act_123' })) }
    const transport = {
      createAudience: vi.fn(),
      createWebsiteAudience: vi.fn(async () => ({ id: 'meta-pixel-audience' })),
      syncHashes: vi.fn(),
    }
    return { store, provider, transport }
  }

  it('creates the rule audience once and commits an empty member set', async () => {
    const { store, provider, transport } = harness(null)
    const result = await reconcileMetaAudience({
      store, provider, transport, orgId: 'org-1', audienceConfigId: 'config-pixel', trigger: 'scheduled', dryRun: false,
    })
    expect(result).toMatchObject({ status: 'succeeded', dryRun: false, targetCount: 0 })
    expect(transport.createWebsiteAudience).toHaveBeenCalledWith('act_123', 'secret-token', {
      name: 'Skale Club | Site Visitors 30D', pixelId: PIXEL, events: ['PageView'], retentionDays: 30, urlContains: null,
    })
    expect(store.setRemoteAudienceId).toHaveBeenCalledWith(expect.objectContaining({ audienceId: 'meta-pixel-audience' }))
    expect(store.commitSuccess).toHaveBeenCalledWith(expect.objectContaining({ members: [] }))
    expect(transport.syncHashes).not.toHaveBeenCalled()
    expect(transport.createAudience).not.toHaveBeenCalled()
    expect(store.loadProjectedMembers).not.toHaveBeenCalled()
  })

  it('does not recreate an existing audience and writes nothing on a dry run', async () => {
    const existing = harness('meta-pixel-audience')
    await reconcileMetaAudience({ ...existing, orgId: 'org-1', audienceConfigId: 'config-pixel', trigger: 'scheduled', dryRun: false })
    expect(existing.transport.createWebsiteAudience).not.toHaveBeenCalled()
    expect(existing.store.commitSuccess).toHaveBeenCalled()

    const dry = harness(null)
    const result = await reconcileMetaAudience({ ...dry, orgId: 'org-1', audienceConfigId: 'config-pixel', trigger: 'manual', dryRun: true })
    expect(result).toMatchObject({ status: 'succeeded', dryRun: true })
    expect(dry.transport.createWebsiteAudience).not.toHaveBeenCalled()
    expect(dry.store.completeDryRun).toHaveBeenCalled()
  })

  it('fails closed as misconfigured when the pixel scope is invalid', async () => {
    const { store, provider, transport } = harness(null)
    store.loadConfig.mockResolvedValueOnce({
      ...(await store.loadConfig()),
      sourceDefinition: { kind: 'pixel_website', pixelId: '', events: [], retentionDays: 30 },
    })
    const result = await reconcileMetaAudience({
      store, provider, transport, orgId: 'org-1', audienceConfigId: 'config-pixel', trigger: 'scheduled', dryRun: false,
    })
    expect(result).toMatchObject({ status: 'failed', errorCode: 'INVALID_SCOPE' })
    expect(store.fail).toHaveBeenCalledWith(expect.objectContaining({ misconfigured: true }))
    expect(provider.getConnection).not.toHaveBeenCalled()
  })
})

describe('scheduling CRM audiences from contact changes', () => {
  function client(scopes: Array<{ id: string; audience_kind: string; source_definition: unknown }>) {
    const update = vi.fn(() => ({ eq: () => ({ in: async () => ({ error: null }) }) }))
    const select = vi.fn(() => ({ eq: () => ({ eq: async () => ({ data: scopes, error: null }) }) }))
    return { from: vi.fn(() => ({ select, update })), update }
  }

  it('marks crm_contacts scopes dirty for a contact change but leaves pixel and prospect scopes alone', async () => {
    const db = client([
      { id: 'crm', audience_kind: 'crm_contacts', source_definition: {} },
      { id: 'pixel', audience_kind: 'pixel_website', source_definition: { pixelId: PIXEL, events: ['PageView'] } },
      { id: 'xcraper', audience_kind: 'xcraper_master', source_definition: {} },
    ])
    const result = await markMetaAudiencesDirty(db as never, {
      orgId: 'org-1', reason: 'contact.created', entityType: 'contact', entityId: '00000000-0000-0000-0000-000000000001',
    })
    expect(result).toEqual({ marked: 1 })
  })
})

describe('remarketing pack', () => {
  it('covers visitors, form submitters, leads and customers with brand-first names', () => {
    expect(REMARKETING_PACK.map((preset) => `${preset.kind}:${preset.label}`)).toEqual([
      'pixel_website:Site Visitors 30D',
      'pixel_website:Site Visitors 180D',
      'pixel_website:Site Form Submitters 180D',
      'crm_contacts:CRM Leads',
      'crm_contacts:CRM Customers',
    ])
    expect(remarketingPackName('Skale Club', 'CRM Leads')).toBe('Skale Club | CRM Leads')
    expect(remarketingPackName('  ', 'CRM Leads')).toBe('Xphere | CRM Leads')
  })

  it('only holds definitions that validate once a pixel is filled in', () => {
    for (const preset of REMARKETING_PACK) {
      const definition = normalizeAudienceSourceDefinition(preset.kind, { pixelId: PIXEL, ...preset.definition })
      expect(isAudienceDefinitionValid(definition)).toBe(true)
    }
  })
})
