import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Same approach as ads-google-adapter-r2.test.ts: only the transport is faked.
// The three "create" commands additionally go through googleAdsMutate
// (google.campaign.create_search, a multi-service googleAds:mutate batch) or
// mutateResources (google.ad_group.create / google.ad.create_responsive_search,
// single-service :mutate) — both are mocked here.

const runGaqlQueryMock = vi.fn()
const mutateResourcesMock = vi.fn()
const googleAdsMutateMock = vi.fn()

vi.mock('@/lib/ads/google-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/google-api')>('@/lib/ads/google-api')
  return {
    ...actual,
    runGaqlQuery: (...args: unknown[]) => runGaqlQueryMock(...args),
    mutateResources: (...args: unknown[]) => mutateResourcesMock(...args),
    googleAdsMutate: (...args: unknown[]) => googleAdsMutateMock(...args),
  }
})

import { googleAdapter } from '@/lib/ads/providers/google-adapter'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { ResourceSnapshot } from '@/lib/ads/commands/types'
import type { AdsCommand } from '@/lib/ads/commands/catalog'

const ctx: AdapterContext = {
  orgId: 'org-1',
  adAccountId: '1234567890',
  credential: JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
}

beforeEach(() => {
  vi.clearAllMocks()
})

const g = (type: string, fields: Record<string, unknown>) =>
  ({ platform: 'google' as const, ad_account_id: '1234567890', type, ...fields }) as AdsCommand

// ─── google.campaign.create_search ─────────────────────────────────────────────

describe('snapshot + plan — campaign.create_search', () => {
  it('reads account currency and finds no existing campaign by name', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ customer: { currencyCode: 'BRL' } }]).mockResolvedValueOnce([])
    const command = g('google.campaign.create_search', {
      name: 'New Campaign',
      daily_budget: 50,
      bidding: 'MAXIMIZE_CONVERSIONS',
      target_cpa: 10,
      search_partners: false,
      location_ids: ['2620'],
      language_ids: ['1000'],
    })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.currency).toBe('BRL')
    expect(before?.fields.existing_campaign_id).toBeNull()

    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ name: 'New Campaign', daily_budget: 50, status: 'PAUSED' })
      expect(plan.facts).toEqual({ budgetAfter: 50, biddingChange: true })
      expect(plan.diff.some((d) => d.field === 'locations' && d.after === 1)).toBe(true)
    }
  })

  it('rejects a name that matches a non-removed campaign, case-insensitively', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ campaign: { id: '999', name: 'existing campaign' } }])
    const command = g('google.campaign.create_search', {
      name: 'Existing Campaign',
      daily_budget: 20,
      bidding: 'MAXIMIZE_CLICKS',
      search_partners: false,
      location_ids: ['2620'],
      language_ids: [],
    })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_campaign_id).toBe('999')
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('does not set biddingChange when no target CPA is given', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ customer: { currencyCode: 'USD' } }]).mockResolvedValueOnce([])
    const command = g('google.campaign.create_search', {
      name: 'Clicks Campaign',
      daily_budget: 30,
      bidding: 'MAXIMIZE_CLICKS',
      search_partners: false,
      location_ids: ['2620'],
      language_ids: [],
    })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.facts.biddingChange).toBe(false)
  })
})

describe('execute — campaign.create_search', () => {
  it('sends one atomic googleAds:mutate batch with temporary resource ids and PAUSED everywhere', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({
      mutateOperationResponses: [
        { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/1001' } },
        { campaignResult: { resourceName: 'customers/1234567890/campaigns/2002' } },
        { campaignCriterionResult: { resourceName: 'customers/1234567890/campaignCriteria/2002~3003' } },
      ],
    })
    const command = g('google.campaign.create_search', {
      name: 'Summer Sale',
      daily_budget: 100,
      bidding: 'MAXIMIZE_CONVERSIONS',
      target_cpa: 15,
      search_partners: true,
      start_date_time: '2026-01-01 00:00:00',
      location_ids: ['2620', '2076'],
      language_ids: ['1000'],
    })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'Summer Sale', campaignId: null, currency: 'USD', fields: {} }

    const result = await googleAdapter.execute(ctx, command, before)

    expect(googleAdsMutateMock).toHaveBeenCalledTimes(1)
    const [customerId, , operations, opts] = googleAdsMutateMock.mock.calls[0]
    expect(customerId).toBe('1234567890')
    expect(opts).toBeUndefined()
    expect(operations).toEqual([
      {
        campaignBudgetOperation: {
          create: {
            resourceName: 'customers/1234567890/campaignBudgets/-1',
            name: expect.stringMatching(/^Summer Sale budget \d+$/),
            amountMicros: '100000000',
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: 'customers/1234567890/campaigns/-2',
            name: 'Summer Sale',
            status: 'PAUSED',
            advertisingChannelType: 'SEARCH',
            campaignBudget: 'customers/1234567890/campaignBudgets/-1',
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: true,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
            startDateTime: '2026-01-01 00:00:00',
            maximizeConversions: { targetCpaMicros: '15000000' },
          },
        },
      },
      {
        campaignCriterionOperation: {
          create: { campaign: 'customers/1234567890/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2620' } },
        },
      },
      {
        campaignCriterionOperation: {
          create: { campaign: 'customers/1234567890/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2076' } },
        },
      },
      {
        campaignCriterionOperation: {
          create: { campaign: 'customers/1234567890/campaigns/-2', language: { languageConstant: 'languageConstants/1000' } },
        },
      },
    ])
    // providerRef is the campaign's resource name, not the budget's or a criterion's.
    expect(result.providerRef).toBe('customers/1234567890/campaigns/2002')
  })

  it('uses targetSpend for MAXIMIZE_CLICKS and manualCpc for MANUAL_CPC', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/1' } }] })
    const clicksCommand = g('google.campaign.create_search', {
      name: 'Clicks', daily_budget: 10, bidding: 'MAXIMIZE_CLICKS', search_partners: false, location_ids: ['2620'], language_ids: [],
    })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'Clicks', campaignId: null, currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, clicksCommand, before)
    const [, , clicksOps] = googleAdsMutateMock.mock.calls[0]
    expect((clicksOps as Array<{ campaignOperation?: { create: Record<string, unknown> } }>)[1].campaignOperation?.create).toMatchObject({ targetSpend: {} })

    googleAdsMutateMock.mockResolvedValueOnce({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/2' } }] })
    const manualCommand = g('google.campaign.create_search', {
      name: 'Manual', daily_budget: 10, bidding: 'MANUAL_CPC', search_partners: false, location_ids: ['2620'], language_ids: [],
    })
    await googleAdapter.execute(ctx, manualCommand, before)
    const [, , manualOps] = googleAdsMutateMock.mock.calls[1]
    expect((manualOps as Array<{ campaignOperation?: { create: Record<string, unknown> } }>)[1].campaignOperation?.create).toMatchObject({ manualCpc: {} })
  })

  it('declares EU political advertising when explicitly requested', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/3' } }] })
    const command = g('google.campaign.create_search', {
      name: 'Political', daily_budget: 10, bidding: 'MANUAL_CPC', search_partners: false,
      location_ids: ['2276'], language_ids: ['1014'], contains_eu_political_advertising: true,
    })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'Political', campaignId: null, currency: 'EUR', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , operations] = googleAdsMutateMock.mock.calls[0]
    expect((operations as Array<{ campaignOperation?: { create: Record<string, unknown> } }>)[1].campaignOperation?.create)
      .toHaveProperty('containsEuPoliticalAdvertising', 'CONTAINS_EU_POLITICAL_ADVERTISING')
  })

  it('passes validateOnly through to the batch mutate call', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({})
    const command = g('google.campaign.create_search', {
      name: 'X', daily_budget: 10, bidding: 'MANUAL_CPC', search_partners: false, location_ids: ['2620'], language_ids: [],
    })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'X', campaignId: null, currency: 'USD', fields: {} }
    await googleAdapter.validate(ctx, command, before)
    const [, , , opts] = googleAdsMutateMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('verify + rollback — campaign.create_search', () => {
  it('verifies the created campaign exists, is PAUSED, and has the intended budget', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '2002', name: 'Summer Sale', status: 'PAUSED' }, campaignBudget: { amountMicros: '100000000' } },
    ])
    const command = g('google.campaign.create_search', {
      name: 'Summer Sale', daily_budget: 100, bidding: 'MANUAL_CPC', search_partners: false, location_ids: ['2620'], language_ids: [],
    })
    const verdict = await googleAdapter.verify(
      ctx,
      command,
      { name: 'Summer Sale', daily_budget: 100, status: 'PAUSED' },
      'customers/1234567890/campaigns/2002',
    )
    expect(verdict.ok).toBe(true)
  })

  it('fails verification when the providerRef cannot be resolved', async () => {
    const command = g('google.campaign.create_search', {
      name: 'Summer Sale', daily_budget: 100, bidding: 'MANUAL_CPC', search_partners: false, location_ids: ['2620'], language_ids: [],
    })
    const verdict = await googleAdapter.verify(ctx, command, { name: 'Summer Sale', daily_budget: 100, status: 'PAUSED' }, null)
    expect(verdict.ok).toBe(false)
  })

  it('has no rollback — the campaign was created paused', () => {
    const command = g('google.campaign.create_search', {
      name: 'Summer Sale', daily_budget: 100, bidding: 'MANUAL_CPC', search_partners: false, location_ids: ['2620'], language_ids: [],
    })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'Summer Sale', campaignId: null, currency: 'USD', fields: {} }
    expect(googleAdapter.buildRollback(command, before, 'customers/1234567890/campaigns/2002')).toBeNull()
  })
})

// ─── google.ad_group.create ─────────────────────────────────────────────────────

describe('snapshot + plan — ad_group.create', () => {
  it('returns null (not found) when the parent campaign does not exist', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('rejects a removed parent campaign', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'REMOVED', advertisingChannelType: 'SEARCH' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_removed')
  })

  it('rejects a non-Search parent campaign', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED', advertisingChannelType: 'DISPLAY' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_not_search')
  })

  it('rejects a name that matches an existing ad group in the campaign, case-insensitively', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'new ag' } }])
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_ad_group_id).toBe('222')
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('proposes creating the ad group with a max CPC bid', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG', cpc_bid: 2.5 })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ name: 'New AG', status: 'PAUSED', cpc_bid: 2.5 })
      expect(plan.facts.biddingChange).toBe(true)
    }
  })
})

describe('execute + validate — ad_group.create', () => {
  it('builds a PAUSED, SEARCH_STANDARD create operation against adGroups:mutate', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroups/333' }] })
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG', cpc_bid: 2.5 })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New AG', campaignId: '111', currency: 'USD', fields: {} }
    const result = await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroups')
    expect(operations).toEqual([
      { create: { campaign: 'customers/1234567890/campaigns/111', name: 'New AG', status: 'PAUSED', type: 'SEARCH_STANDARD', cpcBidMicros: '2500000' } },
    ])
    expect(result.providerRef).toBe('customers/1234567890/adGroups/333')
  })

  it('omits cpcBidMicros when no cpc_bid is given', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroups/333' }] })
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New AG', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect((operations as Array<{ create: Record<string, unknown> }>)[0].create).not.toHaveProperty('cpcBidMicros')
  })

  it('passes validateOnly through to mutateResources', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New AG', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.validate(ctx, command, before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('verify + rollback — ad_group.create', () => {
  it('verifies the created ad group by re-reading it', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroup: { id: '333', name: 'New AG', status: 'PAUSED', cpcBidMicros: '2500000' }, campaign: { id: '111' } },
    ])
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG', cpc_bid: 2.5 })
    const verdict = await googleAdapter.verify(
      ctx,
      command,
      { name: 'New AG', status: 'PAUSED', cpc_bid: 2.5 },
      'customers/1234567890/adGroups/333',
    )
    expect(verdict.ok).toBe(true)
  })

  it('has no rollback — the ad group was created paused', () => {
    const command = g('google.ad_group.create', { campaign_id: '111', name: 'New AG' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New AG', campaignId: '111', currency: 'USD', fields: {} }
    expect(googleAdapter.buildRollback(command, before, 'customers/1234567890/adGroups/333')).toBeNull()
  })
})

// ─── google.ad.create_responsive_search ────────────────────────────────────────

const rsaCommand = (overrides: Record<string, unknown> = {}) =>
  g('google.ad.create_responsive_search', {
    ad_group_id: '222',
    final_url: 'https://example.com',
    headlines: ['Buy now', 'Great deals', 'Shop today'],
    descriptions: ['Best prices', 'Fast shipping'],
    ...overrides,
  })

describe('snapshot + plan — ad.create_responsive_search', () => {
  it('returns null (not found) when the parent ad group does not exist', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const before = await googleAdapter.snapshot(ctx, rsaCommand())
    expect(before).toBeNull()
  })

  it('rejects a removed parent ad group', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG', status: 'REMOVED' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = rsaCommand()
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('ad_group_removed')
  })

  it('warns when the ad group already has 3+ responsive search ads', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG', status: 'ENABLED' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { adGroupAd: { status: 'ENABLED', ad: { type: 'RESPONSIVE_SEARCH_AD' } } },
        { adGroupAd: { status: 'PAUSED', ad: { type: 'RESPONSIVE_SEARCH_AD' } } },
        { adGroupAd: { status: 'ENABLED', ad: { type: 'RESPONSIVE_SEARCH_AD' } } },
      ])
    const command = rsaCommand()
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_rsa_count).toBe(3)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => /responsive search ad/i.test(w))).toBe(true)
  })

  it('does not warn below 3 existing responsive search ads', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG', status: 'ENABLED' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ adGroupAd: { status: 'ENABLED', ad: { type: 'RESPONSIVE_SEARCH_AD' } } }])
    const command = rsaCommand()
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_rsa_count).toBe(1)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings).toHaveLength(0)
  })

  it('ignores non-RSA ad types when counting', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG', status: 'ENABLED' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { adGroupAd: { status: 'ENABLED', ad: { type: 'EXPANDED_TEXT_AD' } } },
        { adGroupAd: { status: 'ENABLED', ad: { type: 'RESPONSIVE_SEARCH_AD' } } },
      ])
    const before = await googleAdapter.snapshot(ctx, rsaCommand())
    expect(before?.fields.existing_rsa_count).toBe(1)
  })
})

describe('execute + validate — ad.create_responsive_search', () => {
  it('builds a PAUSED create operation against adGroupAds:mutate, including path1/path2', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroupAds/222~444' }] })
    const command = rsaCommand({ path1: 'sale', path2: 'summer' })
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: null, resourceName: 'RSA', campaignId: '111', currency: 'USD', fields: {} }
    const result = await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupAds')
    expect(operations).toEqual([
      {
        create: {
          adGroup: 'customers/1234567890/adGroups/222',
          status: 'PAUSED',
          ad: {
            finalUrls: ['https://example.com'],
            responsiveSearchAd: {
              headlines: [{ text: 'Buy now' }, { text: 'Great deals' }, { text: 'Shop today' }],
              descriptions: [{ text: 'Best prices' }, { text: 'Fast shipping' }],
              path1: 'sale',
              path2: 'summer',
            },
          },
        },
      },
    ])
    expect(result.providerRef).toBe('customers/1234567890/adGroupAds/222~444')
  })

  it('omits path1/path2 when not given', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroupAds/222~444' }] })
    await googleAdapter.execute(ctx, rsaCommand(), { resourceType: 'ad', resourceId: null, resourceName: 'RSA', campaignId: '111', currency: 'USD', fields: {} })
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    const create = (operations as Array<{ create: { ad: { responsiveSearchAd: Record<string, unknown> } } }>)[0].create
    expect(create.ad.responsiveSearchAd).not.toHaveProperty('path1')
    expect(create.ad.responsiveSearchAd).not.toHaveProperty('path2')
  })

  it('passes validateOnly through to mutateResources', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: null, resourceName: 'RSA', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.validate(ctx, rsaCommand(), before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('verify + rollback — ad.create_responsive_search', () => {
  it('verifies the created ad by re-reading it, including headline/description counts', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        adGroupAd: {
          status: 'PAUSED',
          ad: {
            id: '444',
            finalUrls: ['https://example.com'],
            responsiveSearchAd: {
              headlines: [{ text: 'Buy now' }, { text: 'Great deals' }, { text: 'Shop today' }],
              descriptions: [{ text: 'Best prices' }, { text: 'Fast shipping' }],
            },
          },
        },
      },
    ])
    const verdict = await googleAdapter.verify(
      ctx,
      rsaCommand(),
      { final_url: 'https://example.com', status: 'PAUSED', headline_count: 3, description_count: 2 },
      'customers/1234567890/adGroupAds/222~444',
    )
    expect(verdict.ok).toBe(true)
  })

  it('fails verification when the created ad cannot be found', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const verdict = await googleAdapter.verify(
      ctx,
      rsaCommand(),
      { final_url: 'https://example.com', status: 'PAUSED', headline_count: 3, description_count: 2 },
      'customers/1234567890/adGroupAds/222~444',
    )
    expect(verdict.ok).toBe(false)
  })

  it('has no rollback — the ad was created paused', () => {
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: null, resourceName: 'RSA', campaignId: '111', currency: 'USD', fields: {} }
    expect(googleAdapter.buildRollback(rsaCommand(), before, 'customers/1234567890/adGroupAds/222~444')).toBeNull()
  })
})
