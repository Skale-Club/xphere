import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Same approach as ads-google-create.test.ts / ads-google-adapter-r2.test.ts:
// only the transport is faked (GoogleAdsError stays real). biddingHandler's
// commands go through mutateResources (single-service :mutate) for everything
// except google.campaign.create_display, which — like google.campaign.create_search
// in google-adapter.ts — is one atomic googleAds:mutate batch.

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

import { biddingHandler, listCampaignProximities } from '@/lib/ads/providers/google/bidding'
import { googleAdapter } from '@/lib/ads/providers/google-adapter'
import { withHandlers } from '@/lib/ads/providers/handlers'
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

// ─── capabilities() ─────────────────────────────────────────────────────────────

describe('capabilities', () => {
  it('exposes every command type this handler owns, composed over the base adapter', () => {
    const adapter = withHandlers(googleAdapter, [biddingHandler])
    const types = adapter.capabilities().map((c) => c.type)
    for (const t of biddingHandler.types) {
      expect(types).toContain(t)
    }
  })
})

// ─── google.campaign.set_bidding_strategy ──────────────────────────────────────

describe('set_bidding_strategy — snapshot + plan', () => {
  it('reads the current strategy and its target', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: {
          id: '1',
          name: 'C',
          status: 'ENABLED',
          advertisingChannelType: 'SEARCH',
          biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
          maximizeConversions: { targetCpaMicros: '5000000' },
        },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CONVERSIONS', target_cpa: 10 })
    const before = await biddingHandler.snapshot(ctx, command)
    expect(before?.fields.bidding_strategy_type).toBe('MAXIMIZE_CONVERSIONS')
    expect(before?.fields.target_cpa).toBe(5)
  })

  it('rejects a removed campaign', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { id: '1', name: 'C', status: 'REMOVED' }, customer: { currencyCode: 'USD' } }])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_removed')
  })

  it('rejects a non-Search/Display campaign type', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '1', name: 'C', status: 'ENABLED', advertisingChannelType: 'PERFORMANCE_MAX' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('unsupported_campaign_type')
  })

  it('rejects a portfolio (shared) bidding strategy', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '1', name: 'C', status: 'ENABLED', advertisingChannelType: 'SEARCH', biddingStrategy: 'customers/1/biddingStrategies/9' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('portfolio_bidding_strategy')
  })

  it('is a no-op when the campaign already uses the requested strategy with no target given', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '1', name: 'C', status: 'ENABLED', advertisingChannelType: 'SEARCH', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('plans a switch to Maximize Clicks with a CPC ceiling, warns about the learning period', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '1', name: 'C', status: 'ENABLED', advertisingChannelType: 'SEARCH', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CLICKS', cpc_bid_ceiling: 3 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ bidding_strategy_type: 'TARGET_SPEND', cpc_bid_ceiling: 3 })
      expect(plan.facts.biddingChange).toBe(true)
      expect(plan.warnings.some((w) => /learning period/i.test(w))).toBe(true)
    }
  })
})

describe('set_bidding_strategy — execute + validate', () => {
  const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: {} }

  it('manualCpc: {} with mask "manualCpc"', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/1' }] })
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaigns')
    expect(operations).toEqual([{ update: { resourceName: 'customers/1234567890/campaigns/1', manualCpc: {} }, updateMask: 'manualCpc' }])
  })

  it('targetSpend with cpcBidCeilingMicros, mask "targetSpend.cpcBidCeilingMicros"', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/1' }] })
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CLICKS', cpc_bid_ceiling: 3 })
    await biddingHandler.execute(ctx, command, before)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/1', targetSpend: { cpcBidCeilingMicros: '3000000' } }, updateMask: 'targetSpend.cpcBidCeilingMicros' },
    ])
  })

  it('targetSpend: {} (no ceiling given), mask "targetSpend"', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CLICKS' })
    await biddingHandler.execute(ctx, command, before)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect(operations).toEqual([{ update: { resourceName: 'customers/1234567890/campaigns/1', targetSpend: {} }, updateMask: 'targetSpend' }])
  })

  it('maximizeConversions with targetCpaMicros, mask "maximizeConversions.targetCpaMicros"', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CONVERSIONS', target_cpa: 12.5 })
    await biddingHandler.execute(ctx, command, before)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/1', maximizeConversions: { targetCpaMicros: '12500000' } }, updateMask: 'maximizeConversions.targetCpaMicros' },
    ])
  })

  it('maximizeConversionValue with targetRoas, mask "maximizeConversionValue.targetRoas"', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CONVERSION_VALUE', target_roas: 3.5 })
    await biddingHandler.execute(ctx, command, before)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/1', maximizeConversionValue: { targetRoas: 3.5 } }, updateMask: 'maximizeConversionValue.targetRoas' },
    ])
  })

  it('passes validateOnly through to mutateResources', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    await biddingHandler.validate(ctx, command, before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('set_bidding_strategy — verify + rollback', () => {
  it('verifies the new strategy and target by re-reading the campaign', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '1', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', maximizeConversions: { targetCpaMicros: '10000000' } } },
    ])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CONVERSIONS', target_cpa: 10 })
    const verdict = await biddingHandler.verify(ctx, command, { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS', target_cpa: 10 }, 'customers/1234567890/campaigns/1')
    expect(verdict.ok).toBe(true)
  })

  it('fails verification on a mismatch', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { id: '1', biddingStrategyType: 'MANUAL_CPC' } }])
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MAXIMIZE_CONVERSIONS', target_cpa: 10 })
    const verdict = await biddingHandler.verify(ctx, command, { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS', target_cpa: 10 }, 'customers/1234567890/campaigns/1')
    expect(verdict.ok).toBe(false)
  })

  it('rolls TARGET_SPEND back to MAXIMIZE_CLICKS with its previous ceiling', () => {
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { bidding_strategy_type: 'TARGET_SPEND', cpc_bid_ceiling: 4 } }
    expect(biddingHandler.buildRollback(command, before, null)).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.campaign.set_bidding_strategy', campaign_id: '1', strategy: 'MAXIMIZE_CLICKS', cpc_bid_ceiling: 4,
    })
  })

  it('rolls TARGET_CPA back to MAXIMIZE_CONVERSIONS with its previous target', () => {
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { bidding_strategy_type: 'TARGET_CPA', target_cpa: 8 } }
    expect(biddingHandler.buildRollback(command, before, null)).toMatchObject({ strategy: 'MAXIMIZE_CONVERSIONS', target_cpa: 8 })
  })

  it('rolls TARGET_ROAS back to MAXIMIZE_CONVERSION_VALUE with its previous target', () => {
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { bidding_strategy_type: 'TARGET_ROAS', target_roas: 4.2 } }
    expect(biddingHandler.buildRollback(command, before, null)).toMatchObject({ strategy: 'MAXIMIZE_CONVERSION_VALUE', target_roas: 4.2 })
  })

  it('returns null when the previous strategy is not expressible (e.g. TARGET_IMPRESSION_SHARE)', () => {
    const command = g('google.campaign.set_bidding_strategy', { campaign_id: '1', strategy: 'MANUAL_CPC' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { bidding_strategy_type: 'TARGET_IMPRESSION_SHARE' } }
    expect(biddingHandler.buildRollback(command, before, null)).toBeNull()
  })
})

// ─── google.campaign.set_cpc_bid_ceiling ────────────────────────────────────────

describe('set_cpc_bid_ceiling', () => {
  it('rejects a campaign not on Maximize Clicks (TARGET_SPEND)', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '1', name: 'C', status: 'ENABLED', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_cpc_bid_ceiling', { campaign_id: '1', cpc_bid_ceiling: 5 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('incompatible_bidding_strategy')
  })

  it('plans a ceiling change with a money diff', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '1', name: 'C', status: 'ENABLED', biddingStrategyType: 'TARGET_SPEND', targetSpend: { cpcBidCeilingMicros: '2000000' } },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.campaign.set_cpc_bid_ceiling', { campaign_id: '1', cpc_bid_ceiling: 5 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ cpc_bid_ceiling: 5 })
      expect(plan.diff[0]).toMatchObject({ field: 'cpc_bid_ceiling', before: 2, after: 5 })
      expect(plan.facts.biddingChange).toBe(true)
    }
  })

  it('sends targetSpend.cpcBidCeilingMicros with the matching mask', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_cpc_bid_ceiling', { campaign_id: '1', cpc_bid_ceiling: 5 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: {} }
    await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaigns')
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/1', targetSpend: { cpcBidCeilingMicros: '5000000' } }, updateMask: 'targetSpend.cpcBidCeilingMicros' },
    ])
  })

  it('verifies by re-reading the ceiling', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { targetSpend: { cpcBidCeilingMicros: '5000000' } } }])
    const command = g('google.campaign.set_cpc_bid_ceiling', { campaign_id: '1', cpc_bid_ceiling: 5 })
    const verdict = await biddingHandler.verify(ctx, command, { cpc_bid_ceiling: 5 }, null)
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to the previous ceiling', () => {
    const command = g('google.campaign.set_cpc_bid_ceiling', { campaign_id: '1', cpc_bid_ceiling: 5 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { cpc_bid_ceiling: 2 } }
    expect(biddingHandler.buildRollback(command, before, null)).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.campaign.set_cpc_bid_ceiling', campaign_id: '1', cpc_bid_ceiling: 2,
    })
  })

  it('has no rollback when there was no previous ceiling', () => {
    const command = g('google.campaign.set_cpc_bid_ceiling', { campaign_id: '1', cpc_bid_ceiling: 5 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { cpc_bid_ceiling: null } }
    expect(biddingHandler.buildRollback(command, before, null)).toBeNull()
  })
})

// ─── google.campaign.set_total_budget ──────────────────────────────────────────

describe('set_total_budget', () => {
  it('rejects a campaign with no campaign budget', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { id: '1', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 500 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_budget')
  })

  it('requires an end date', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '1', name: 'C', status: 'ENABLED' }, campaignBudget: { id: '9', amountMicros: '10000000' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 500 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_missing_end_date')
  })

  it('warns about a shared budget and reports the implied daily average', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '1', name: 'C', status: 'ENABLED', startDateTime: '2026-01-01 00:00:00', endDateTime: '2026-01-11 00:00:00' },
        campaignBudget: { id: '9', amountMicros: '10000000', period: 'DAILY', explicitlyShared: true, referenceCount: '3' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ total_budget: 1000 })
      expect(plan.facts.budgetAfter).toBeUndefined()
      expect(plan.warnings.some((w) => /shared by 3 campaigns/i.test(w))).toBe(true)
      expect(plan.warnings.some((w) => /100\.00 per day|100 per day|~\$100/i.test(w) || /implied/i.test(w))).toBe(true)
    }
  })

  it('is a no-op when the total already matches', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '1', name: 'C', status: 'ENABLED', endDateTime: '2026-01-11 00:00:00' },
        campaignBudget: { id: '9', totalAmountMicros: '1000000000', period: 'CUSTOM_PERIOD' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('sends totalAmountMicros + period CUSTOM_PERIOD against campaignBudgets', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { budget_id: '9' } }
    await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignBudgets')
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaignBudgets/9', totalAmountMicros: '1000000000', period: 'CUSTOM_PERIOD' }, updateMask: 'totalAmountMicros,period' },
    ])
  })

  it('passes validateOnly through', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { budget_id: '9' } }
    await biddingHandler.validate(ctx, command, before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })

  it('verifies the new total by re-reading the budget', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { id: '1' }, campaignBudget: { totalAmountMicros: '1000000000' } }])
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const verdict = await biddingHandler.verify(ctx, command, { total_budget: 1000 }, null)
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to a previous total budget', () => {
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { budget_period: 'CUSTOM_PERIOD', total_budget: 400 } }
    expect(biddingHandler.buildRollback(command, before, null)).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.campaign.set_total_budget', campaign_id: '1', total_budget: 400,
    })
  })

  it('has no rollback when the budget was previously daily', () => {
    const command = g('google.campaign.set_total_budget', { campaign_id: '1', total_budget: 1000 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '1', resourceName: 'C', campaignId: '1', currency: 'USD', fields: { budget_period: 'DAILY', total_budget: null } }
    expect(biddingHandler.buildRollback(command, before, null)).toBeNull()
  })
})

// ─── google.campaign.add_proximity / remove_proximity ──────────────────────────

describe('add_proximity', () => {
  it('detects an identical existing radius target', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '1', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ campaignCriterion: { criterionId: '55', proximity: { geoPoint: { latitudeInMicroDegrees: 38_700_000, longitudeInMicroDegrees: -9_140_000 }, radius: 10, radiusUnits: 'KILOMETERS' } } }])
    const command = g('google.campaign.add_proximity', { campaign_id: '1', latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' })
    const before = await biddingHandler.snapshot(ctx, command)
    expect(before?.fields.existing_criterion_id).toBe('55')
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('plans a new radius target when none matches', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '1', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.campaign.add_proximity', { campaign_id: '1', latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' })
  })

  it('sends a campaignCriteria create with lat/lng in micro-degrees', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaignCriteria/1~55' }] })
    const command = g('google.campaign.add_proximity', { campaign_id: '1', latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'R', campaignId: '1', currency: 'USD', fields: {} }
    const result = await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignCriteria')
    expect(operations).toEqual([
      { create: { campaign: 'customers/1234567890/campaigns/1', proximity: { geoPoint: { latitudeInMicroDegrees: 38_700_000, longitudeInMicroDegrees: -9_140_000 }, radius: 10, radiusUnits: 'KILOMETERS' } } },
    ])
    expect(result.providerRef).toBe('customers/1234567890/campaignCriteria/1~55')
  })

  it('verifies the created criterion via listCampaignProximities', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaignCriterion: { criterionId: '55', proximity: { geoPoint: { latitudeInMicroDegrees: 38_700_000, longitudeInMicroDegrees: -9_140_000 }, radius: 10, radiusUnits: 'KILOMETERS' } } }])
    const command = g('google.campaign.add_proximity', { campaign_id: '1', latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' })
    const verdict = await biddingHandler.verify(ctx, command, { latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' }, 'customers/1234567890/campaignCriteria/1~55')
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to a remove_proximity command using the created criterion id', () => {
    const command = g('google.campaign.add_proximity', { campaign_id: '1', latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'R', campaignId: '1', currency: 'USD', fields: {} }
    expect(biddingHandler.buildRollback(command, before, 'customers/1234567890/campaignCriteria/1~55')).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.campaign.remove_proximity', campaign_id: '1', criterion_id: '55',
    })
  })
})

describe('remove_proximity', () => {
  it('returns null (not found) when the criterion does not exist', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.campaign.remove_proximity', { campaign_id: '1', criterion_id: '55' })
    const before = await biddingHandler.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('plans the removal', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaignCriterion: { criterionId: '55', proximity: { geoPoint: { latitudeInMicroDegrees: 38_700_000, longitudeInMicroDegrees: -9_140_000 }, radius: 10, radiusUnits: 'KILOMETERS' } } }])
    const command = g('google.campaign.remove_proximity', { campaign_id: '1', criterion_id: '55' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ exists: false })
  })

  it('sends a campaignCriteria remove', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.campaign.remove_proximity', { campaign_id: '1', criterion_id: '55' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: '55', resourceName: 'R', campaignId: '1', currency: 'USD', fields: {} }
    await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignCriteria')
    expect(operations).toEqual([{ remove: 'customers/1234567890/campaignCriteria/1~55' }])
  })

  it('verifies the criterion is gone', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.campaign.remove_proximity', { campaign_id: '1', criterion_id: '55' })
    const verdict = await biddingHandler.verify(ctx, command, { exists: false }, null)
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to add_proximity using the stored lat/lng/radius', () => {
    const command = g('google.campaign.remove_proximity', { campaign_id: '1', criterion_id: '55' })
    const before: ResourceSnapshot = {
      resourceType: 'campaign_criterion', resourceId: '55', resourceName: 'R', campaignId: '1', currency: 'USD',
      fields: { latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS' },
    }
    expect(biddingHandler.buildRollback(command, before, null)).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.campaign.add_proximity', campaign_id: '1', latitude: 38.7, longitude: -9.14, radius: 10, radius_units: 'KILOMETERS',
    })
  })
})

describe('listCampaignProximities (exported for the optional MCP read tool)', () => {
  it('maps raw GAQL rows to a flat shape', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaignCriterion: { criterionId: '55', proximity: { geoPoint: { latitudeInMicroDegrees: 38_700_000, longitudeInMicroDegrees: -9_140_000 }, radius: 10, radiusUnits: 'KILOMETERS' } } }])
    const result = await listCampaignProximities(ctx, '1')
    expect(result).toEqual([{ criterion_id: '55', latitude_micro: 38_700_000, longitude_micro: -9_140_000, radius: 10, radius_units: 'KILOMETERS' }])
  })
})

// ─── google.keyword.remove ──────────────────────────────────────────────────────

describe('keyword.remove', () => {
  it('rejects a non-keyword criterion', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ adGroupCriterion: { criterionId: '9', type: 'USER_LIST', status: 'ENABLED' }, adGroup: { id: '2' }, campaign: { id: '1' } }])
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('not_a_keyword')
  })

  it('rejects a negative keyword, pointing at negative_keyword.remove', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupCriterion: { criterionId: '9', type: 'KEYWORD', status: 'ENABLED', negative: true, keyword: { text: 'x', matchType: 'EXACT' } }, adGroup: { id: '2' }, campaign: { id: '1' } },
    ])
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('is_negative_keyword')
  })

  it('rejects an already-removed keyword', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupCriterion: { criterionId: '9', type: 'KEYWORD', status: 'REMOVED', keyword: { text: 'x', matchType: 'EXACT' } }, adGroup: { id: '2' }, campaign: { id: '1' } },
    ])
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_removed')
  })

  it('plans the removal with a permanence warning', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupCriterion: { criterionId: '9', type: 'KEYWORD', status: 'ENABLED', cpcBidMicros: '1500000', keyword: { text: 'shoes', matchType: 'PHRASE' } }, adGroup: { id: '2', name: 'AG' }, campaign: { id: '1' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before = await biddingHandler.snapshot(ctx, command)
    expect(before?.fields.cpc_bid).toBe(1.5)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ exists: false })
      expect(plan.warnings.some((w) => /permanent/i.test(w))).toBe(true)
    }
  })

  it('sends an adGroupCriteria remove', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before: ResourceSnapshot = { resourceType: 'keyword', resourceId: '9', resourceName: 'K', campaignId: '1', currency: 'USD', fields: {} }
    await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupCriteria')
    expect(operations).toEqual([{ remove: 'customers/1234567890/adGroupCriteria/2~9' }])
  })

  it('verifies the keyword no longer exists (status REMOVED)', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupCriterion: { criterionId: '9', type: 'KEYWORD', status: 'REMOVED', keyword: { text: 'shoes', matchType: 'PHRASE' } }, adGroup: { id: '2' }, campaign: { id: '1' } },
    ])
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const verdict = await biddingHandler.verify(ctx, command, { exists: false }, null)
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to keyword.add with the same text, match type and cpc_bid', () => {
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before: ResourceSnapshot = { resourceType: 'keyword', resourceId: '9', resourceName: 'K', campaignId: '1', currency: 'USD', fields: { text: 'shoes', match_type: 'PHRASE', cpc_bid: 1.5 } }
    expect(biddingHandler.buildRollback(command, before, null)).toEqual({
      platform: 'google', ad_account_id: '1234567890', type: 'google.keyword.add', ad_group_id: '2', text: 'shoes', match_type: 'PHRASE', cpc_bid: 1.5,
    })
  })

  it('omits cpc_bid from the rollback when none was set', () => {
    const command = g('google.keyword.remove', { ad_group_id: '2', criterion_id: '9' })
    const before: ResourceSnapshot = { resourceType: 'keyword', resourceId: '9', resourceName: 'K', campaignId: '1', currency: 'USD', fields: { text: 'shoes', match_type: 'EXACT', cpc_bid: null } }
    const rollback = biddingHandler.buildRollback(command, before, null)
    expect(rollback).not.toHaveProperty('cpc_bid')
  })
})

// ─── google.campaign.create_display ─────────────────────────────────────────────

describe('create_display — snapshot + plan', () => {
  it('finds no existing campaign by name', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ customer: { currencyCode: 'BRL' } }]).mockResolvedValueOnce([])
    const command = g('google.campaign.create_display', {
      name: 'Display Push', daily_budget: 40, bidding: 'MAXIMIZE_CONVERSIONS', target_cpa: 8, location_ids: ['2620'], language_ids: [],
    })
    const before = await biddingHandler.snapshot(ctx, command)
    expect(before?.currency).toBe('BRL')
    expect(before?.fields.existing_campaign_id).toBeNull()
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ name: 'Display Push', daily_budget: 40, status: 'PAUSED' })
      expect(plan.facts).toEqual({ budgetAfter: 40, biddingChange: true })
    }
  })

  it('rejects a duplicate name, case-insensitively', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ customer: { currencyCode: 'USD' } }]).mockResolvedValueOnce([{ campaign: { id: '77', name: 'display push' } }])
    const command = g('google.campaign.create_display', { name: 'Display Push', daily_budget: 40, bidding: 'MANUAL_CPC', location_ids: ['2620'], language_ids: [] })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })
})

describe('create_display — execute + validate', () => {
  it('sends an atomic batch: DISPLAY channel type, no networkSettings, PAUSED', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({
      mutateOperationResponses: [
        { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/1001' } },
        { campaignResult: { resourceName: 'customers/1234567890/campaigns/2002' } },
        { campaignCriterionResult: { resourceName: 'customers/1234567890/campaignCriteria/2002~3003' } },
      ],
    })
    const command = g('google.campaign.create_display', {
      name: 'Display Push', daily_budget: 40, bidding: 'MAXIMIZE_CONVERSIONS', target_cpa: 8, location_ids: ['2620'], language_ids: ['1000'],
    })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'Display Push', campaignId: null, currency: 'USD', fields: {} }
    const result = await biddingHandler.execute(ctx, command, before)
    const [customerId, , operations] = googleAdsMutateMock.mock.calls[0]
    expect(customerId).toBe('1234567890')
    expect(operations).toEqual([
      {
        campaignBudgetOperation: {
          create: { resourceName: 'customers/1234567890/campaignBudgets/-1', name: expect.stringMatching(/^Display Push budget \d+$/), amountMicros: '40000000', deliveryMethod: 'STANDARD', explicitlyShared: false },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: 'customers/1234567890/campaigns/-2',
            name: 'Display Push',
            status: 'PAUSED',
            advertisingChannelType: 'DISPLAY',
            campaignBudget: 'customers/1234567890/campaignBudgets/-1',
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
            maximizeConversions: { targetCpaMicros: '8000000' },
          },
        },
      },
      { campaignCriterionOperation: { create: { campaign: 'customers/1234567890/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2620' } } } },
      { campaignCriterionOperation: { create: { campaign: 'customers/1234567890/campaigns/-2', language: { languageConstant: 'languageConstants/1000' } } } },
    ])
    expect((operations as Array<{ campaignOperation?: { create: Record<string, unknown> } }>)[1].campaignOperation?.create).not.toHaveProperty('networkSettings')
    expect(result.providerRef).toBe('customers/1234567890/campaigns/2002')
  })

  it('passes validateOnly through to the batch mutate call', async () => {
    googleAdsMutateMock.mockResolvedValueOnce({})
    const command = g('google.campaign.create_display', { name: 'X', daily_budget: 10, bidding: 'MANUAL_CPC', location_ids: ['2620'], language_ids: [] })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'X', campaignId: null, currency: 'USD', fields: {} }
    await biddingHandler.validate(ctx, command, before)
    const [, , , opts] = googleAdsMutateMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('create_display — verify + rollback', () => {
  it('verifies the created campaign', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { id: '2002', name: 'Display Push', status: 'PAUSED' }, campaignBudget: { amountMicros: '40000000' } }])
    const command = g('google.campaign.create_display', { name: 'Display Push', daily_budget: 40, bidding: 'MANUAL_CPC', location_ids: ['2620'], language_ids: [] })
    const verdict = await biddingHandler.verify(ctx, command, { name: 'Display Push', daily_budget: 40, status: 'PAUSED' }, 'customers/1234567890/campaigns/2002')
    expect(verdict.ok).toBe(true)
  })

  it('has no rollback — the campaign was created paused', () => {
    const command = g('google.campaign.create_display', { name: 'Display Push', daily_budget: 40, bidding: 'MANUAL_CPC', location_ids: ['2620'], language_ids: [] })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: null, resourceName: 'Display Push', campaignId: null, currency: 'USD', fields: {} }
    expect(biddingHandler.buildRollback(command, before, 'customers/1234567890/campaigns/2002')).toBeNull()
  })
})

// ─── google.ad_group.create_display ─────────────────────────────────────────────

describe('ad_group.create_display — snapshot + plan', () => {
  it('rejects a non-Display parent campaign', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_not_display')
  })

  it('rejects a removed parent campaign', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'REMOVED', advertisingChannelType: 'DISPLAY' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_removed')
  })

  it('rejects a duplicate ad group name, case-insensitively', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED', advertisingChannelType: 'DISPLAY' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'new dg' } }])
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG' })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('plans creation with a max CPC bid', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED', advertisingChannelType: 'DISPLAY' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG', cpc_bid: 1.75 })
    const before = await biddingHandler.snapshot(ctx, command)
    const plan = biddingHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ name: 'New DG', status: 'PAUSED', cpc_bid: 1.75 })
      expect(plan.facts.biddingChange).toBe(true)
    }
  })
})

describe('ad_group.create_display — execute + validate', () => {
  it('creates a PAUSED DISPLAY_STANDARD ad group', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroups/333' }] })
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG', cpc_bid: 1.75 })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New DG', campaignId: '111', currency: 'USD', fields: {} }
    const result = await biddingHandler.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroups')
    expect(operations).toEqual([
      { create: { campaign: 'customers/1234567890/campaigns/111', name: 'New DG', status: 'PAUSED', type: 'DISPLAY_STANDARD', cpcBidMicros: '1750000' } },
    ])
    expect(result.providerRef).toBe('customers/1234567890/adGroups/333')
  })

  it('omits cpcBidMicros when no cpc_bid is given', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroups/333' }] })
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New DG', campaignId: '111', currency: 'USD', fields: {} }
    await biddingHandler.execute(ctx, command, before)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect((operations as Array<{ create: Record<string, unknown> }>)[0].create).not.toHaveProperty('cpcBidMicros')
  })

  it('passes validateOnly through', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New DG', campaignId: '111', currency: 'USD', fields: {} }
    await biddingHandler.validate(ctx, command, before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })
})

describe('ad_group.create_display — verify + rollback', () => {
  it('verifies the created ad group by re-reading it', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ adGroup: { id: '333', name: 'New DG', status: 'PAUSED', cpcBidMicros: '1750000' } }])
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG', cpc_bid: 1.75 })
    const verdict = await biddingHandler.verify(ctx, command, { name: 'New DG', status: 'PAUSED', cpc_bid: 1.75 }, 'customers/1234567890/adGroups/333')
    expect(verdict.ok).toBe(true)
  })

  it('has no rollback — the ad group was created paused', () => {
    const command = g('google.ad_group.create_display', { campaign_id: '111', name: 'New DG' })
    const before: ResourceSnapshot = { resourceType: 'ad_group', resourceId: null, resourceName: 'New DG', campaignId: '111', currency: 'USD', fields: {} }
    expect(biddingHandler.buildRollback(command, before, 'customers/1234567890/adGroups/333')).toBeNull()
  })
})
