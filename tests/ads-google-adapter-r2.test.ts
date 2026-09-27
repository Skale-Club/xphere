import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Same approach as ads-google-adapter.test.ts: only the transport is faked.
// google-reads.ts calls runGaqlQuery too, so mocking it here also covers
// listCampaignTargeting / listConversionActions / listCampaignConversionGoals,
// which the adapter calls internally for the R2 commands.

const runGaqlQueryMock = vi.fn()
const mutateResourcesMock = vi.fn()

vi.mock('@/lib/ads/google-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/google-api')>('@/lib/ads/google-api')
  return {
    ...actual,
    runGaqlQuery: (...args: unknown[]) => runGaqlQueryMock(...args),
    mutateResources: (...args: unknown[]) => mutateResourcesMock(...args),
  }
})

// suggestGeoTargetConstants goes through the real gadsRequest → getFreshAccessToken
// path (it isn't part of the mock above). A cache hit here means it never calls
// refreshAccessToken or touches Redis, so the test hits no network but the
// google-api transport.
vi.mock('@/lib/ads/cache', () => ({
  getCachedAccessToken: vi.fn().mockResolvedValue('cached-access-token'),
  setCachedAccessToken: vi.fn().mockResolvedValue(undefined),
  clearCachedAccessToken: vi.fn().mockResolvedValue(undefined),
}))

import { googleAdapter, criterionIdFromResourceName } from '@/lib/ads/providers/google-adapter'
import { suggestGeoTargetConstants } from '@/lib/ads/google-api'
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
  it('lists all 28 implemented Google command types, and nothing unimplemented', () => {
    const caps = googleAdapter.capabilities()
    const types = caps.map((c) => c.type)
    expect(types).toHaveLength(28)
    expect(types).toContain('google.campaign.add_location')
    expect(types).toContain('google.campaign.set_conversion_goal_biddable')
    expect(types).toContain('google.campaign.create_search')
    expect(types).toContain('google.ad_group.create')
    expect(types).toContain('google.ad.create_responsive_search')
    expect(new Set(types).size).toBe(types.length) // no duplicates
  })
})

// ─── set_dates ──────────────────────────────────────────────────────────────────

describe('snapshot + plan — campaign.set_dates', () => {
  it('sets start and end dates when the campaign has none yet, and warns about the account time zone', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
    const command = g('google.campaign.set_dates', { campaign_id: '111', start_date_time: '2026-01-01 00:00:00', end_date_time: '2026-02-01 00:00:00' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ start_date_time: '2026-01-01 00:00:00', end_date_time: '2026-02-01 00:00:00' })
      expect(plan.warnings.some((w) => /time zone/i.test(w))).toBe(true)
    }
  })

  it('rejects changing the start date once the campaign has already started', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', startDateTime: '2020-01-01 00:00:00' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_dates', { campaign_id: '111', start_date_time: '2027-01-01 00:00:00' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_already_started')
  })

  it('allows changing only the end date on a campaign that already started', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', startDateTime: '2020-01-01 00:00:00', endDateTime: '2020-06-01 00:00:00' } , customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_dates', { campaign_id: '111', end_date_time: '2030-01-01 00:00:00' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('builds a flat update for both date fields', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    const command = g('google.campaign.set_dates', { campaign_id: '111', start_date_time: '2026-01-01 00:00:00', end_date_time: '2026-02-01 00:00:00' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaigns')
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/111', startDateTime: '2026-01-01 00:00:00', endDateTime: '2026-02-01 00:00:00' }, updateMask: 'startDateTime,endDateTime' },
    ])
  })

  it('rolls back only the fields that had a prior value', () => {
    const command = g('google.campaign.set_dates', { campaign_id: '111', start_date_time: '2026-01-01 00:00:00', end_date_time: '2026-02-01 00:00:00' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { start_date_time: '2020-01-01 00:00:00', end_date_time: null } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.set_dates', campaign_id: '111', start_date_time: '2020-01-01 00:00:00' })
    expect(inverse).not.toHaveProperty('end_date_time')
  })

  it('returns null when neither changed field had a prior value', () => {
    const command = g('google.campaign.set_dates', { campaign_id: '111', start_date_time: '2026-01-01 00:00:00' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { start_date_time: null } }
    expect(googleAdapter.buildRollback(command, before, null)).toBeNull()
  })
})

// ─── set_target_cpa ─────────────────────────────────────────────────────────────

describe('snapshot + plan + execute — campaign.set_target_cpa', () => {
  it('reads the TARGET_CPA field when the campaign uses TARGET_CPA bidding', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'TARGET_CPA', targetCpa: { targetCpaMicros: '5000000' } }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_target_cpa', { campaign_id: '111', target_cpa: 8 })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.target_cpa).toBe(5)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.facts.biddingChange).toBe(true)

    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    await googleAdapter.execute(ctx, command, before!)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaigns')
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/111', targetCpa: { targetCpaMicros: '8000000' } }, updateMask: 'targetCpa.targetCpaMicros' },
    ])
  })

  it('reads the MAXIMIZE_CONVERSIONS field and writes through it when the campaign uses that strategy', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', maximizeConversions: { targetCpaMicros: '3000000' } }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_target_cpa', { campaign_id: '111', target_cpa: 6 })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.target_cpa).toBe(3)

    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    await googleAdapter.execute(ctx, command, before!)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect((operations as Array<{ update: Record<string, unknown> }>)[0].update).toMatchObject({ maximizeConversions: { targetCpaMicros: '6000000' } })
    expect((operations as Array<{ updateMask: string }>)[0].updateMask).toBe('maximizeConversions.targetCpaMicros')
  })

  it('rejects an incompatible bidding strategy', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_target_cpa', { campaign_id: '111', target_cpa: 6 })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('incompatible_bidding_strategy')
  })

  it('rejects a portfolio (shared) bidding strategy', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'TARGET_CPA', biddingStrategy: 'customers/1234567890/biddingStrategies/999', targetCpa: { targetCpaMicros: '5000000' } },
        customer: { currencyCode: 'USD' },
      },
    ])
    const command = g('google.campaign.set_target_cpa', { campaign_id: '111', target_cpa: 6 })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.is_portfolio).toBe(true)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('portfolio_bidding_strategy')
  })

  it('rolls back to the previous target CPA', () => {
    const command = g('google.campaign.set_target_cpa', { campaign_id: '111', target_cpa: 8 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { target_cpa: 5 } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.set_target_cpa', campaign_id: '111', target_cpa: 5 })
  })

  it('has no rollback when there was no prior target CPA', () => {
    const command = g('google.campaign.set_target_cpa', { campaign_id: '111', target_cpa: 8 })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { target_cpa: null } }
    expect(googleAdapter.buildRollback(command, before, null)).toBeNull()
  })
})

// ─── set_target_roas ────────────────────────────────────────────────────────────

describe('snapshot + plan + execute — campaign.set_target_roas', () => {
  it('reads and writes the TARGET_ROAS double field directly (not micros)', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'TARGET_ROAS', targetRoas: { targetRoas: 3.5 } }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_target_roas', { campaign_id: '111', target_roas: 4.2 })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.target_roas).toBe(3.5)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)

    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    await googleAdapter.execute(ctx, command, before!)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaigns')
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaigns/111', targetRoas: { targetRoas: 4.2 } }, updateMask: 'targetRoas.targetRoas' },
    ])
  })

  it('uses maximizeConversionValue.targetRoas under MAXIMIZE_CONVERSION_VALUE bidding', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'MAXIMIZE_CONVERSION_VALUE', maximizeConversionValue: { targetRoas: 2.1 } }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_target_roas', { campaign_id: '111', target_roas: 2.8 })
    const before = await googleAdapter.snapshot(ctx, command)
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    await googleAdapter.execute(ctx, command, before!)
    const [, , , operations] = mutateResourcesMock.mock.calls[0]
    expect((operations as Array<{ updateMask: string }>)[0].updateMask).toBe('maximizeConversionValue.targetRoas')
  })

  it('rejects an incompatible bidding strategy', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_target_roas', { campaign_id: '111', target_roas: 2.8 })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('incompatible_bidding_strategy')
  })
})

// ─── set_tracking ───────────────────────────────────────────────────────────────

describe('snapshot + plan + execute — campaign.set_tracking', () => {
  it('sets both tracking template and final URL suffix in one flat update', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'C', status: 'ENABLED', trackingUrlTemplate: '{lpurl}?x=1' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.campaign.set_tracking', { campaign_id: '111', tracking_url_template: '{lpurl}?y=2', final_url_suffix: 'utm_source=google' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)

    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    await googleAdapter.execute(ctx, command, before!)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaigns')
    expect(operations).toEqual([
      {
        update: { resourceName: 'customers/1234567890/campaigns/111', trackingUrlTemplate: '{lpurl}?y=2', finalUrlSuffix: 'utm_source=google' },
        updateMask: 'trackingUrlTemplate,finalUrlSuffix',
      },
    ])
  })

  it('clears a field back to empty string on rollback when it was previously unset', () => {
    const command = g('google.campaign.set_tracking', { campaign_id: '111', tracking_url_template: '{lpurl}?y=2' })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { tracking_url_template: null } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.set_tracking', campaign_id: '111', tracking_url_template: '' })
  })
})

// ─── add_location / remove_location ────────────────────────────────────────────

describe('snapshot + plan — campaign.add_location', () => {
  it('proposes a new location when none identical exists', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.campaign.add_location', { campaign_id: '111', geo_target_constant_id: '2620', negative: false })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_criterion_id).toBeNull()
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('rejects an identical location that is already targeted', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { campaignCriterion: { criterionId: '555', type: 'LOCATION', negative: false, location: { geoTargetConstant: 'geoTargetConstants/2620' } } },
      ])
    const command = g('google.campaign.add_location', { campaign_id: '111', geo_target_constant_id: '2620', negative: false })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_criterion_id).toBe('555')
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('treats the same location with a different negative flag as distinct', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { campaignCriterion: { criterionId: '555', type: 'LOCATION', negative: false, location: { geoTargetConstant: 'geoTargetConstants/2620' } } },
      ])
    const command = g('google.campaign.add_location', { campaign_id: '111', geo_target_constant_id: '2620', negative: true })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_criterion_id).toBeNull()
  })

  it('builds a create operation with a geoTargetConstants resource reference', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaignCriteria/111~9999' }] })
    const command = g('google.campaign.add_location', { campaign_id: '111', geo_target_constant_id: '2620', negative: false })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'L', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignCriteria')
    expect(operations).toEqual([
      { create: { campaign: 'customers/1234567890/campaigns/111', negative: false, location: { geoTargetConstant: 'geoTargetConstants/2620' } } },
    ])
  })

  it('verifies a created location by re-listing targeting and matching the parsed criterion id', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaignCriterion: { criterionId: '9999', type: 'LOCATION', negative: false, location: { geoTargetConstant: 'geoTargetConstants/2620' } } },
    ])
    const command = g('google.campaign.add_location', { campaign_id: '111', geo_target_constant_id: '2620', negative: false })
    const verdict = await googleAdapter.verify(ctx, command, { geo_target_constant_id: '2620', negative: false }, 'customers/1234567890/campaignCriteria/111~9999')
    expect(verdict.ok).toBe(true)
  })

  it('rolls back an added location by removing the newly created criterion', () => {
    const command = g('google.campaign.add_location', { campaign_id: '111', geo_target_constant_id: '2620', negative: false })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'L', campaignId: '111', currency: 'USD', fields: {} }
    const inverse = googleAdapter.buildRollback(command, before, 'customers/1234567890/campaignCriteria/111~9999')
    expect(inverse).toMatchObject({ type: 'google.campaign.remove_location', campaign_id: '111', criterion_id: '9999' })
  })
})

describe('snapshot + plan — campaign.remove_location', () => {
  it('finds the location and captures its fields for rollback', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaignCriterion: { criterionId: '555', type: 'LOCATION', negative: true, location: { geoTargetConstant: 'geoTargetConstants/2620' } } },
    ])
    const command = g('google.campaign.remove_location', { campaign_id: '111', criterion_id: '555' })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields).toMatchObject({ geo_target_constant_id: '2620', negative: true })
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('returns null (not found) when the criterion id is not a location on this campaign', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.campaign.remove_location', { campaign_id: '111', criterion_id: '555' })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('builds a remove operation using campaignId~criterionId', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{}] })
    const command = g('google.campaign.remove_location', { campaign_id: '111', criterion_id: '555' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: '555', resourceName: 'L', campaignId: '111', currency: 'USD', fields: { geo_target_constant_id: '2620', negative: false } }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignCriteria')
    expect(operations).toEqual([{ remove: 'customers/1234567890/campaignCriteria/111~555' }])
  })

  it('verifies removal by confirming absence', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([])
    const command = g('google.campaign.remove_location', { campaign_id: '111', criterion_id: '555' })
    const verdict = await googleAdapter.verify(ctx, command, { exists: false }, null)
    expect(verdict.ok).toBe(true)
  })

  it('rolls back a removed location by re-adding it', () => {
    const command = g('google.campaign.remove_location', { campaign_id: '111', criterion_id: '555' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: '555', resourceName: 'L', campaignId: '111', currency: 'USD', fields: { geo_target_constant_id: '2620', negative: true } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.add_location', campaign_id: '111', geo_target_constant_id: '2620', negative: true })
  })
})

// ─── add_language / remove_language ────────────────────────────────────────────

describe('campaign.add_language / remove_language', () => {
  it('rejects a language already targeted', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ campaignCriterion: { criterionId: '77', type: 'LANGUAGE', language: { languageConstant: 'languageConstants/1014' } } }])
    const command = g('google.campaign.add_language', { campaign_id: '111', language_constant_id: '1014' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('builds a create operation with a languageConstants resource reference', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaignCriteria/111~88' }] })
    const command = g('google.campaign.add_language', { campaign_id: '111', language_constant_id: '1000' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'L', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignCriteria')
    expect(operations).toEqual([{ create: { campaign: 'customers/1234567890/campaigns/111', language: { languageConstant: 'languageConstants/1000' } } }])
  })

  it('rolls back a removed language by re-adding it', () => {
    const command = g('google.campaign.remove_language', { campaign_id: '111', criterion_id: '77' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: '77', resourceName: 'Lang', campaignId: '111', currency: 'USD', fields: { language_constant_id: '1014' } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.add_language', campaign_id: '111', language_constant_id: '1014' })
  })
})

// ─── add_ad_schedule / remove_ad_schedule ──────────────────────────────────────

describe('campaign.add_ad_schedule', () => {
  it('proposes a new schedule when the day has none yet', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([])
    const command = g('google.campaign.add_ad_schedule', { campaign_id: '111', day_of_week: 'MONDAY', start_hour: 9, start_minute: 'ZERO', end_hour: 17, end_minute: 'ZERO' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('rejects a schedule that overlaps an existing one on the same day', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { campaignCriterion: { criterionId: '44', type: 'AD_SCHEDULE', adSchedule: { dayOfWeek: 'MONDAY', startHour: 9, startMinute: 'ZERO', endHour: 17, endMinute: 'ZERO' } } },
      ])
    const command = g('google.campaign.add_ad_schedule', { campaign_id: '111', day_of_week: 'MONDAY', start_hour: 12, start_minute: 'ZERO', end_hour: 20, end_minute: 'ZERO' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('schedule_overlap')
  })

  it('does not flag adjacent (touching, non-overlapping) schedules', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { campaignCriterion: { criterionId: '44', type: 'AD_SCHEDULE', adSchedule: { dayOfWeek: 'MONDAY', startHour: 9, startMinute: 'ZERO', endHour: 17, endMinute: 'ZERO' } } },
      ])
    const command = g('google.campaign.add_ad_schedule', { campaign_id: '111', day_of_week: 'MONDAY', start_hour: 17, start_minute: 'ZERO', end_hour: 20, end_minute: 'ZERO' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('rejects an identical schedule that already exists', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { campaignCriterion: { criterionId: '44', type: 'AD_SCHEDULE', adSchedule: { dayOfWeek: 'MONDAY', startHour: 9, startMinute: 'ZERO', endHour: 17, endMinute: 'ZERO' } } },
      ])
    const command = g('google.campaign.add_ad_schedule', { campaign_id: '111', day_of_week: 'MONDAY', start_hour: 9, start_minute: 'ZERO', end_hour: 17, end_minute: 'ZERO' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('builds a create operation with adSchedule fields and an optional bid modifier', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaignCriteria/111~66' }] })
    const command = g('google.campaign.add_ad_schedule', {
      campaign_id: '111',
      day_of_week: 'TUESDAY',
      start_hour: 8,
      start_minute: 'THIRTY',
      end_hour: 18,
      end_minute: 'ZERO',
      bid_modifier: 1.2,
    })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'S', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignCriteria')
    expect(operations).toEqual([
      {
        create: {
          campaign: 'customers/1234567890/campaigns/111',
          adSchedule: { dayOfWeek: 'TUESDAY', startHour: 8, startMinute: 'THIRTY', endHour: 18, endMinute: 'ZERO' },
          bidModifier: 1.2,
        },
      },
    ])
  })

  it('verifies a created schedule by re-listing and matching the parsed criterion id', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaignCriterion: { criterionId: '66', type: 'AD_SCHEDULE', adSchedule: { dayOfWeek: 'TUESDAY', startHour: 8, startMinute: 'THIRTY', endHour: 18, endMinute: 'ZERO' } } },
    ])
    const command = g('google.campaign.add_ad_schedule', { campaign_id: '111', day_of_week: 'TUESDAY', start_hour: 8, start_minute: 'THIRTY', end_hour: 18, end_minute: 'ZERO' })
    const verdict = await googleAdapter.verify(
      ctx,
      command,
      { day_of_week: 'TUESDAY', start_hour: 8, start_minute: 'THIRTY', end_hour: 18, end_minute: 'ZERO' },
      'customers/1234567890/campaignCriteria/111~66',
    )
    expect(verdict.ok).toBe(true)
  })

  it('rolls back an added schedule by removing the newly created criterion', () => {
    const command = g('google.campaign.add_ad_schedule', { campaign_id: '111', day_of_week: 'TUESDAY', start_hour: 8, start_minute: 'ZERO', end_hour: 18, end_minute: 'ZERO' })
    const before: ResourceSnapshot = { resourceType: 'campaign_criterion', resourceId: null, resourceName: 'S', campaignId: '111', currency: 'USD', fields: {} }
    const inverse = googleAdapter.buildRollback(command, before, 'customers/1234567890/campaignCriteria/111~66')
    expect(inverse).toMatchObject({ type: 'google.campaign.remove_ad_schedule', campaign_id: '111', criterion_id: '66' })
  })
})

describe('campaign.remove_ad_schedule', () => {
  it('finds the schedule and captures its fields for rollback', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaignCriterion: { criterionId: '66', type: 'AD_SCHEDULE', adSchedule: { dayOfWeek: 'TUESDAY', startHour: 8, startMinute: 'ZERO', endHour: 18, endMinute: 'ZERO' }, bidModifier: 1.1 } },
    ])
    const command = g('google.campaign.remove_ad_schedule', { campaign_id: '111', criterion_id: '66' })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields).toMatchObject({ day_of_week: 'TUESDAY', start_hour: 8, end_hour: 18, bid_modifier: 1.1 })
  })

  it('rebuilds the full add_ad_schedule command on rollback, including the bid modifier', () => {
    const command = g('google.campaign.remove_ad_schedule', { campaign_id: '111', criterion_id: '66' })
    const before: ResourceSnapshot = {
      resourceType: 'campaign_criterion',
      resourceId: '66',
      resourceName: 'S',
      campaignId: '111',
      currency: 'USD',
      fields: { day_of_week: 'TUESDAY', start_hour: 8, start_minute: 'ZERO', end_hour: 18, end_minute: 'ZERO', bid_modifier: 1.1 },
    }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.add_ad_schedule', campaign_id: '111', day_of_week: 'TUESDAY', start_hour: 8, end_hour: 18, bid_modifier: 1.1 })
  })
})

// ─── set_final_url ──────────────────────────────────────────────────────────────

describe('ad.set_final_url', () => {
  it('replaces the final URL', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupAd: { status: 'ENABLED', ad: { id: '888', name: 'Ad', finalUrls: ['https://old.example.com'] } }, adGroup: { id: '222', name: 'AG' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.ad.set_final_url', { ad_group_id: '222', ad_id: '888', final_url: 'https://new.example.com' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.diff[0]).toMatchObject({ before: 'https://old.example.com', after: 'https://new.example.com' })
  })

  it('is a no_op when the ad already has that final URL', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { adGroupAd: { status: 'ENABLED', ad: { id: '888', name: 'Ad', finalUrls: ['https://same.example.com'] } }, adGroup: { id: '222', name: 'AG' }, campaign: { id: '111' }, customer: { currencyCode: 'USD' } },
    ])
    const command = g('google.ad.set_final_url', { ad_group_id: '222', ad_id: '888', final_url: 'https://same.example.com' })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('builds an ads:mutate update against customers/{id}/ads/{adId}, not adGroupAds', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/ads/888' }] })
    const command = g('google.ad.set_final_url', { ad_group_id: '222', ad_id: '888', final_url: 'https://new.example.com' })
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: '222~888', resourceName: 'Ad', campaignId: '111', currency: 'USD', fields: { final_urls: [] } }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('ads')
    expect(operations).toEqual([{ update: { resourceName: 'customers/1234567890/ads/888', finalUrls: ['https://new.example.com'] }, updateMask: 'finalUrls' }])
  })

  it('rolls back to the previous final URL when one existed', () => {
    const command = g('google.ad.set_final_url', { ad_group_id: '222', ad_id: '888', final_url: 'https://new.example.com' })
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: '222~888', resourceName: 'Ad', campaignId: '111', currency: 'USD', fields: { final_urls: ['https://old.example.com'] } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.ad.set_final_url', ad_group_id: '222', ad_id: '888', final_url: 'https://old.example.com' })
  })

  it('has no rollback when the ad had no prior final URL', () => {
    const command = g('google.ad.set_final_url', { ad_group_id: '222', ad_id: '888', final_url: 'https://new.example.com' })
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: '222~888', resourceName: 'Ad', campaignId: '111', currency: 'USD', fields: { final_urls: [] } }
    expect(googleAdapter.buildRollback(command, before, null)).toBeNull()
  })
})

// ─── conversion_action.set_primary ──────────────────────────────────────────────

describe('conversion_action.set_primary', () => {
  it('flips primary_for_goal', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { conversionAction: { id: '555', name: 'Purchase', status: 'ENABLED', category: 'PURCHASE', primaryForGoal: false } },
    ])
    const command = g('google.conversion_action.set_primary', { conversion_action_id: '555', primary: true })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.diff[0]).toMatchObject({ before: false, after: true })
  })

  it('rejects a removed conversion action', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ conversionAction: { id: '555', name: 'Purchase', status: 'REMOVED', primaryForGoal: false } }])
    const command = g('google.conversion_action.set_primary', { conversion_action_id: '555', primary: true })
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_removed')
  })

  it('builds a conversionActions:mutate update', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/conversionActions/555' }] })
    const command = g('google.conversion_action.set_primary', { conversion_action_id: '555', primary: true })
    const before: ResourceSnapshot = { resourceType: 'conversion_action', resourceId: '555', resourceName: 'Purchase', campaignId: null, currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('conversionActions')
    expect(operations).toEqual([{ update: { resourceName: 'customers/1234567890/conversionActions/555', primaryForGoal: true }, updateMask: 'primaryForGoal' }])
  })

  it('verifies via a fresh read of the conversion action', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{ conversionAction: { id: '555', name: 'Purchase', status: 'ENABLED', primaryForGoal: true } }])
    const command = g('google.conversion_action.set_primary', { conversion_action_id: '555', primary: true })
    const verdict = await googleAdapter.verify(ctx, command, { primary_for_goal: true }, null)
    expect(verdict.ok).toBe(true)
  })

  it('rolls back to the previous primary_for_goal value', () => {
    const command = g('google.conversion_action.set_primary', { conversion_action_id: '555', primary: true })
    const before: ResourceSnapshot = { resourceType: 'conversion_action', resourceId: '555', resourceName: 'Purchase', campaignId: null, currency: 'USD', fields: { primary_for_goal: false } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.conversion_action.set_primary', conversion_action_id: '555', primary: false })
  })
})

// ─── set_conversion_goal_biddable ───────────────────────────────────────────────

describe('campaign.set_conversion_goal_biddable', () => {
  it('finds the matching category/origin goal and flips biddable', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        { campaignConversionGoal: { category: 'PURCHASE', origin: 'WEBSITE', biddable: false } },
        { campaignConversionGoal: { category: 'SUBMIT_LEAD_FORM', origin: 'WEBSITE', biddable: true } },
      ])
    const command = g('google.campaign.set_conversion_goal_biddable', { campaign_id: '111', category: 'PURCHASE', origin: 'WEBSITE', biddable: true })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.biddable).toBe(false)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('returns not-found (null snapshot) when no goal matches the category/origin pair', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C', status: 'ENABLED' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([{ campaignConversionGoal: { category: 'SUBMIT_LEAD_FORM', origin: 'WEBSITE', biddable: true } }])
    const command = g('google.campaign.set_conversion_goal_biddable', { campaign_id: '111', category: 'PURCHASE', origin: 'WEBSITE', biddable: true })
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('builds a campaignConversionGoals:mutate update with the composite resource name', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{}] })
    const command = g('google.campaign.set_conversion_goal_biddable', { campaign_id: '111', category: 'PURCHASE', origin: 'WEBSITE', biddable: false })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignConversionGoals')
    expect(operations).toEqual([
      { update: { resourceName: 'customers/1234567890/campaignConversionGoals/111~PURCHASE~WEBSITE', biddable: false }, updateMask: 'biddable' },
    ])
  })

  it('rolls back to the previous biddable value', () => {
    const command = g('google.campaign.set_conversion_goal_biddable', { campaign_id: '111', category: 'PURCHASE', origin: 'WEBSITE', biddable: true })
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { biddable: false } }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.set_conversion_goal_biddable', campaign_id: '111', category: 'PURCHASE', origin: 'WEBSITE', biddable: false })
  })
})

// ─── criterionIdFromResourceName reused for campaignCriteria ───────────────────

describe('criterionIdFromResourceName — campaignCriteria resource names', () => {
  it('parses the trailing id from a campaignCriteria resource name too', () => {
    expect(criterionIdFromResourceName('customers/1234567890/campaignCriteria/111~9999')).toBe('9999')
  })
})

// ─── suggestGeoTargetConstants (google-api.ts) ─────────────────────────────────

describe('suggestGeoTargetConstants', () => {
  it('POSTs to geoTargetConstants:suggest without a customer id or login-customer-id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        geoTargetConstantSuggestions: [
          { geoTargetConstant: { id: '2620', name: 'Portugal', countryCode: 'PT', targetType: 'Country', canonicalName: 'Portugal', status: 'ENABLED' } },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await suggestGeoTargetConstants('refresh-token-1', { locale: 'pt', countryCode: 'PT', locationNames: ['Lisboa'] })

    expect(results).toHaveLength(1)
    expect(results[0].geoTargetConstant.id).toBe('2620')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://googleads.googleapis.com/v25/geoTargetConstants:suggest')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['login-customer-id']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer cached-access-token')
    expect(JSON.parse(init.body as string)).toEqual({ locale: 'pt', countryCode: 'PT', locationNames: { names: ['Lisboa'] } })

    vi.unstubAllGlobals()
  })

  it('omits countryCode from the body when not given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ geoTargetConstantSuggestions: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await suggestGeoTargetConstants('refresh-token-1', { locale: 'en', locationNames: ['Springfield'] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ locale: 'en', locationNames: { names: ['Springfield'] } })

    vi.unstubAllGlobals()
  })
})

describe('formatAdSchedule', () => {
  it('renders Google minute enums as clock time, not raw enum names', async () => {
    const { formatAdSchedule } = await import('@/lib/ads/providers/google-adapter')
    expect(
      formatAdSchedule({ day_of_week: 'SUNDAY', start_hour: 3, start_minute: 'ZERO', end_hour: 14, end_minute: 'FORTY_FIVE' }),
    ).toBe('SUNDAY 03:00–14:45')
  })
})
