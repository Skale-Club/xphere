// Round-2 Meta adapter coverage: update_targeting's new fields (placements,
// custom audiences), campaign/ad-set bid strategy, creative swap, and
// campaign/ad-set/ad duplication. tests/ads-meta-adapter.test.ts covers the
// round-1 surface (status/rename/budget/basic targeting) — this file only
// adds what round 2 introduced, following the same mocking style: only the
// transport (getObject / updateObject / getAdAccountInfo / copyObject /
// listCustomAudiences) is faked, MetaAdsError stays real.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const getObjectMock = vi.fn()
const updateObjectMock = vi.fn()
const getAdAccountInfoMock = vi.fn()
const copyObjectMock = vi.fn()
const listCustomAudiencesMock = vi.fn()

vi.mock('@/lib/ads/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/meta-api')>('@/lib/ads/meta-api')
  return {
    ...actual,
    getObject: (...args: unknown[]) => getObjectMock(...args),
    updateObject: (...args: unknown[]) => updateObjectMock(...args),
    getAdAccountInfo: (...args: unknown[]) => getAdAccountInfoMock(...args),
    copyObject: (...args: unknown[]) => copyObjectMock(...args),
    listCustomAudiences: (...args: unknown[]) => listCustomAudiencesMock(...args),
  }
})

import { metaAdapter } from '@/lib/ads/providers/meta-adapter'
import { MetaAdsError } from '@/lib/ads/meta-api'
import { AdsValidationError } from '@/lib/ads/validation'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { ResourceSnapshot } from '@/lib/ads/commands/types'

const ctx: AdapterContext = { orgId: 'org-1', adAccountId: 'act_123456789', credential: 'token' }

beforeEach(() => {
  vi.clearAllMocks()
  getAdAccountInfoMock.mockResolvedValue({ id: 'act_123456789', name: 'Acme', currency: 'USD', account_status: 1 })
  updateObjectMock.mockResolvedValue({ success: true })
  listCustomAudiencesMock.mockResolvedValue([])
})

function targetingFieldsFor(t: {
  age_min?: number
  age_max?: number
  genders?: number[]
  geo_locations?: { countries?: string[] }
  publisher_platforms?: string[]
  facebook_positions?: string[]
  instagram_positions?: string[]
  custom_audiences?: Array<{ id: string }>
  excluded_custom_audiences?: Array<{ id: string }>
}) {
  return {
    age_min: t.age_min ?? null,
    age_max: t.age_max ?? null,
    genders: t.genders ?? [],
    countries: t.geo_locations?.countries ?? [],
    publisher_platforms: t.publisher_platforms ?? null,
    facebook_positions: t.facebook_positions ?? null,
    instagram_positions: t.instagram_positions ?? null,
    custom_audience_ids: (t.custom_audiences ?? []).map((a) => a.id),
    excluded_custom_audience_ids: (t.excluded_custom_audiences ?? []).map((a) => a.id),
  }
}

// ─── update_targeting: placements ──────────────────────────────────────────────

describe('plan — update_targeting placements', () => {
  it('merges facebook_positions / instagram_positions into the wire payload', async () => {
    const targeting = { publisher_platforms: ['facebook', 'instagram'] }
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      facebook_positions: ['feed', 'facebook_reels'],
      instagram_positions: ['stream', 'story'],
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(targeting), targeting },
    }
    await metaAdapter.execute(ctx, command, before)
    const [, fields] = updateObjectMock.mock.calls[0]
    expect(fields.targeting).toMatchObject({
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions: ['feed', 'facebook_reels'],
      instagram_positions: ['stream', 'story'],
    })
  })

  it('errors when facebook_positions is set but publisher_platforms (after merge) excludes facebook', () => {
    const targeting = { publisher_platforms: ['instagram'] }
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      facebook_positions: ['feed'],
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(targeting), targeting },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('placement_platform_mismatch')
  })

  it('errors when instagram_positions is set but the command itself removes instagram from publisher_platforms', () => {
    const targeting = { publisher_platforms: ['facebook', 'instagram'] }
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      publisher_platforms: ['facebook'] as Array<'facebook' | 'instagram' | 'audience_network' | 'messenger' | 'threads'>,
      instagram_positions: ['stream'],
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(targeting), targeting },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('placement_platform_mismatch')
  })

  it('warns (does not error) when positions are set while placements are still Advantage+ automatic', () => {
    const targeting = {}
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      facebook_positions: ['feed'],
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(targeting), targeting },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => /Advantage\+ automatic/.test(w))).toBe(true)
  })

  it('accepts facebook_positions and instagram_positions set together with matching publisher_platforms', () => {
    const targeting = {}
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      publisher_platforms: ['facebook', 'instagram'] as Array<'facebook' | 'instagram' | 'audience_network' | 'messenger' | 'threads'>,
      facebook_positions: ['feed'],
      instagram_positions: ['stream'],
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(targeting), targeting },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.facebook_positions).toEqual(['feed'])
      expect(plan.intended.instagram_positions).toEqual(['stream'])
    }
  })
})

// ─── update_targeting: custom audiences ────────────────────────────────────────

describe('snapshot + plan — update_targeting custom audiences', () => {
  const adsetNode = { id: 'as1', name: 'AdSet', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1', targeting: {} }

  it('fetches the account audience list only when custom_audience_ids or excluded_custom_audience_ids are set', async () => {
    getObjectMock.mockResolvedValueOnce(adsetNode)
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      age_min: 21,
    }
    await metaAdapter.snapshot(ctx, command)
    expect(listCustomAudiencesMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown custom audience id', async () => {
    getObjectMock.mockResolvedValueOnce(adsetNode)
    listCustomAudiencesMock.mockResolvedValueOnce([{ id: 'aud_known', name: 'Known', approximate_count_lower_bound: 5000, operation_status: { code: 200, description: 'Normal' } }])
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      custom_audience_ids: ['aud_unknown'],
    }
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('unknown_audience')
  })

  it('rejects a custom audience id that belongs to a different ad account (absent from this account listing)', async () => {
    getObjectMock.mockResolvedValueOnce(adsetNode)
    listCustomAudiencesMock.mockResolvedValueOnce([]) // the id belongs to another account, so it never shows up here
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      excluded_custom_audience_ids: ['aud_other_account'],
    }
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('unknown_audience')
  })

  it('warns when an included audience is small or not ready, and accepts the change', async () => {
    getObjectMock.mockResolvedValueOnce(adsetNode)
    listCustomAudiencesMock.mockResolvedValueOnce([
      { id: 'aud_small', name: 'Tiny list', approximate_count_lower_bound: 50, operation_status: { code: 300, description: 'In progress' } },
    ])
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      custom_audience_ids: ['aud_small'],
    }
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.warnings.some((w) => /not ready yet/.test(w))).toBe(true)
      expect(plan.warnings.some((w) => /is small/.test(w))).toBe(true)
    }
  })

  it('sends custom_audiences / excluded_custom_audiences as [{id}] arrays on the wire', async () => {
    getObjectMock.mockResolvedValueOnce(adsetNode)
    listCustomAudiencesMock.mockResolvedValueOnce([
      { id: 'aud_in', name: 'In', approximate_count_lower_bound: 9000, operation_status: { code: 200, description: 'Normal' } },
      { id: 'aud_out', name: 'Out', approximate_count_lower_bound: 9000, operation_status: { code: 200, description: 'Normal' } },
    ])
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      custom_audience_ids: ['aud_in'],
      excluded_custom_audience_ids: ['aud_out'],
    }
    const before = await metaAdapter.snapshot(ctx, command)
    await metaAdapter.execute(ctx, command, before!)
    const [, fields] = updateObjectMock.mock.calls[0]
    expect(fields.targeting).toMatchObject({
      custom_audiences: [{ id: 'aud_in' }],
      excluded_custom_audiences: [{ id: 'aud_out' }],
    })
  })

  it('an empty custom_audience_ids array removes the custom_audiences key entirely', async () => {
    const targeting = { custom_audiences: [{ id: 'aud_old' }] }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(targeting), targeting },
    }
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      custom_audience_ids: [] as string[],
    }
    await metaAdapter.execute(ctx, command, before)
    const [, fields] = updateObjectMock.mock.calls[0]
    expect(fields.targeting).not.toHaveProperty('custom_audiences')
  })
})

// ─── Bid strategy: campaign ─────────────────────────────────────────────────────

describe('plan — meta.campaign.set_bid_strategy', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.set_bid_strategy' as const,
    campaign_id: 'c1',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP' as const,
  }

  it('rejects when the campaign is not CBO (no daily/lifetime budget)', () => {
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: 'c1',
      resourceName: 'C',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: null, daily_budget: null, lifetime_budget: null },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('not_cbo')
  })

  it('accepts on a CBO campaign and sends bid_strategy on the wire', async () => {
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: 'c1',
      resourceName: 'C',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: 'LOWEST_COST_WITH_BID_CAP', daily_budget: 50, lifetime_budget: null },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
    await metaAdapter.execute(ctx, command, before)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { bid_strategy: 'LOWEST_COST_WITHOUT_CAP' }, 'token')
  })
})

// ─── Bid strategy: ad set ────────────────────────────────────────────────────────

describe('plan + execute — meta.adset.set_bid_strategy', () => {
  it('rejects when the parent campaign uses a campaign budget (CBO)', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.set_bid_strategy' as const,
      adset_id: 'as1',
      bid_strategy: 'LOWEST_COST_WITH_BID_CAP' as const,
      bid_amount: 10,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: null, bid_amount: null, roas_floor: null, campaign_budget_optimization: true },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_budget')
  })

  it('sends bid_amount in minor units on the wire', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.set_bid_strategy' as const,
      adset_id: 'as1',
      bid_strategy: 'COST_CAP' as const,
      bid_amount: 12.5,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: null, bid_amount: null, roas_floor: null, campaign_budget_optimization: false },
    }
    await metaAdapter.execute(ctx, command, before)
    expect(updateObjectMock).toHaveBeenCalledWith('as1', { bid_strategy: 'COST_CAP', bid_amount: 1250 }, 'token')
  })

  it('sends roas_average_floor as roas_floor * 10000 for LOWEST_COST_WITH_MIN_ROAS', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.set_bid_strategy' as const,
      adset_id: 'as1',
      bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS' as const,
      roas_floor: 2.5,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: null, bid_amount: null, roas_floor: null, campaign_budget_optimization: false },
    }
    await metaAdapter.execute(ctx, command, before)
    expect(updateObjectMock).toHaveBeenCalledWith(
      'as1',
      { bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS', bid_constraints: { roas_average_floor: 25000 } },
      'token',
    )
  })
})

describe('buildRollback — bid strategy', () => {
  it('rolls a campaign bid strategy back to the prior value', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_bid_strategy' as const,
      campaign_id: 'c1',
      bid_strategy: 'LOWEST_COST_WITH_BID_CAP' as const,
    }
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: 'c1',
      resourceName: 'C',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: 'LOWEST_COST_WITHOUT_CAP', daily_budget: 50, lifetime_budget: null },
    }
    const inverse = metaAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'meta.campaign.set_bid_strategy', campaign_id: 'c1', bid_strategy: 'LOWEST_COST_WITHOUT_CAP' })
  })

  it('returns null rolling back an ad set to COST_CAP when there is no prior bid_amount to restore', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.set_bid_strategy' as const,
      adset_id: 'as1',
      bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS' as const,
      roas_floor: 2.5,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      // Was previously COST_CAP but with no bid_amount on file — an inverse
      // to COST_CAP would violate the catalog's own "requires bid_amount" rule.
      fields: { bid_strategy: 'COST_CAP', bid_amount: null, roas_floor: null, campaign_budget_optimization: false },
    }
    expect(metaAdapter.buildRollback(command, before, null)).toBeNull()
  })

  it('rolls an ad set back to LOWEST_COST_WITH_MIN_ROAS carrying its prior roas_floor', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.set_bid_strategy' as const,
      adset_id: 'as1',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP' as const,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS', bid_amount: null, roas_floor: 2.5, campaign_budget_optimization: false },
    }
    const inverse = metaAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'meta.adset.set_bid_strategy', adset_id: 'as1', bid_strategy: 'LOWEST_COST_WITH_MIN_ROAS', roas_floor: 2.5 })
  })
})

// ─── Advanced ad settings ────────────────────────────────────────────────────

describe('snapshot + plan — meta.ad.update_settings', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.ad.update_settings' as const,
    ad_id: 'ad1',
    conversion_domain: 'shop.example.com',
    display_sequence: 2,
  }

  it('diffs, validates and writes the advanced ad fields', async () => {
    getObjectMock.mockResolvedValueOnce({
      id: 'ad1', name: 'Ad', status: 'PAUSED', account_id: 'act_123456789', campaign_id: 'c1',
      conversion_domain: 'old.example.com', display_sequence: 1,
    })
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended).toEqual({ conversion_domain: 'shop.example.com', display_sequence: 2 })
    await metaAdapter.validate(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith(
      'ad1',
      { conversion_domain: 'shop.example.com', display_sequence: 2 },
      'token',
      { validateOnly: true },
    )
  })
})

// ─── Creative swap ──────────────────────────────────────────────────────────────

describe('snapshot + plan — meta.ad.set_creative', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.ad.set_creative' as const,
    ad_id: 'ad1',
    creative_id: 'cr_new',
  }

  it('rejects a creative_id that does not exist', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad1', name: 'Ad', status: 'ACTIVE', account_id: 'act_123456789', creative: { id: 'cr_old' } })
    getObjectMock.mockRejectedValueOnce(new MetaAdsError('Object does not exist', 100, 33))
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('creative_not_found')
  })

  it('rejects a creative_id that belongs to a different ad account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad1', name: 'Ad', status: 'ACTIVE', account_id: 'act_123456789', creative: { id: 'cr_old' } })
    getObjectMock.mockResolvedValueOnce({ id: 'cr_new', name: 'New creative', account_id: 'act_999999999' })
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('cross_account_creative')
  })

  it('accepts a valid same-account creative and sends { creative: { creative_id } } on the wire', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad1', name: 'Ad', status: 'ACTIVE', account_id: 'act_123456789', creative: { id: 'cr_old' } })
    getObjectMock.mockResolvedValueOnce({ id: 'cr_new', name: 'New creative', account_id: 'act_123456789' })
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    await metaAdapter.execute(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('ad1', { creative: { creative_id: 'cr_new' } }, 'token')
  })

  it('validate() sends validate_only for the creative swap like any other single-object update', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad1', name: 'Ad', status: 'ACTIVE', account_id: 'act_123456789', creative: { id: 'cr_old' } })
    getObjectMock.mockResolvedValueOnce({ id: 'cr_new', name: 'New creative', account_id: 'act_123456789' })
    const before = await metaAdapter.snapshot(ctx, command)
    await metaAdapter.validate(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('ad1', { creative: { creative_id: 'cr_new' } }, 'token', { validateOnly: true })
  })

  it('buildRollback restores the previous creative_id', () => {
    const before: ResourceSnapshot = {
      resourceType: 'ad',
      resourceId: 'ad1',
      resourceName: 'Ad',
      campaignId: 'c1',
      currency: 'USD',
      fields: { creative_id: 'cr_old', target_creative_exists: true, target_creative_same_account: true },
    }
    const inverse = metaAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'meta.ad.set_creative', ad_id: 'ad1', creative_id: 'cr_old' })
  })
})

// ─── Duplication ────────────────────────────────────────────────────────────────

describe('duplicate — meta.campaign.duplicate', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.duplicate' as const,
    campaign_id: 'c1',
    deep_copy: true,
    rename_suffix: ' (copy)',
  }

  it('plans a diff naming the new campaign', () => {
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'Campaign', campaignId: 'c1', currency: 'USD', fields: { name: 'Campaign' } }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.intended.new_name).toBe('Campaign (copy)')
  })

  it('execute() calls copyObject with status_option PAUSED, deep_copy and rename_options, and returns the new id', async () => {
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'Campaign', campaignId: 'c1', currency: 'USD', fields: { name: 'Campaign' } }
    copyObjectMock.mockResolvedValueOnce({ copied_campaign_id: 'c2' })
    const result = await metaAdapter.execute(ctx, command, before)
    expect(copyObjectMock).toHaveBeenCalledWith('c1', { status_option: 'PAUSED', deep_copy: true, rename_options: { rename_suffix: ' (copy)' } }, 'token')
    expect(result.providerRef).toBe('c2')
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('throws when Meta returns no copy id', async () => {
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'Campaign', campaignId: 'c1', currency: 'USD', fields: { name: 'Campaign' } }
    copyObjectMock.mockResolvedValueOnce({})
    await expect(metaAdapter.execute(ctx, command, before)).rejects.toThrow(MetaAdsError)
  })

  it('verify() re-reads the COPY (not the source) and confirms it is PAUSED in the same account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c2', status: 'PAUSED', account_id: 'act_123456789' })
    const result = await metaAdapter.verify(ctx, command, { source_name: 'Campaign' }, 'c2')
    expect(getObjectMock).toHaveBeenCalledWith('c2', expect.any(String), 'token')
    expect(result.ok).toBe(true)
  })

  it('verify() fails when the copy is not PAUSED', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c2', status: 'ACTIVE', account_id: 'act_123456789' })
    const result = await metaAdapter.verify(ctx, command, { source_name: 'Campaign' }, 'c2')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'status')).toBe(true)
  })

  it('buildRollback returns null — a duplicate has no automatic inverse', () => {
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'Campaign', campaignId: 'c1', currency: 'USD', fields: { name: 'Campaign' } }
    expect(metaAdapter.buildRollback(command, before, 'c2')).toBeNull()
  })
})

describe('duplicate — meta.adset.duplicate', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.duplicate' as const,
    adset_id: 'as1',
    deep_copy: false,
    target_campaign_id: 'c2',
  }

  it('snapshot rejects when target_campaign_id belongs to a different account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'as1', name: 'AdSet', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1' })
    getObjectMock.mockResolvedValueOnce({ id: 'c2', account_id: 'act_999999999' })
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('execute() sends campaign_id (the target) in the copy body', async () => {
    const before: ResourceSnapshot = { resourceType: 'adset', resourceId: 'as1', resourceName: 'AdSet', campaignId: 'c1', currency: 'USD', fields: { name: 'AdSet' } }
    copyObjectMock.mockResolvedValueOnce({ copied_adset_id: 'as2' })
    const result = await metaAdapter.execute(ctx, command, before)
    expect(copyObjectMock).toHaveBeenCalledWith('as1', { status_option: 'PAUSED', deep_copy: false, campaign_id: 'c2' }, 'token')
    expect(result.providerRef).toBe('as2')
  })

  it('validate() re-confirms the target campaign exists in the account instead of calling updateObject', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c2', account_id: 'act_123456789' })
    const before: ResourceSnapshot = { resourceType: 'adset', resourceId: 'as1', resourceName: 'AdSet', campaignId: 'c1', currency: 'USD', fields: { name: 'AdSet' } }
    await metaAdapter.validate(ctx, command, before)
    expect(updateObjectMock).not.toHaveBeenCalled()
    expect(getObjectMock).toHaveBeenCalledWith('c2', expect.any(String), 'token')
  })

  it('validate() throws when the target campaign is gone', async () => {
    getObjectMock.mockRejectedValueOnce(new MetaAdsError('Object does not exist', 100, 33))
    const before: ResourceSnapshot = { resourceType: 'adset', resourceId: 'as1', resourceName: 'AdSet', campaignId: 'c1', currency: 'USD', fields: { name: 'AdSet' } }
    await expect(metaAdapter.validate(ctx, command, before)).rejects.toThrow(AdsValidationError)
  })
})

describe('duplicate — meta.ad.duplicate', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.ad.duplicate' as const,
    ad_id: 'ad1',
    target_adset_id: 'as2',
  }

  it('execute() sends adset_id (the target) in the copy body, with no deep_copy field', async () => {
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: 'ad1', resourceName: 'Ad', campaignId: 'c1', currency: 'USD', fields: { name: 'Ad' } }
    copyObjectMock.mockResolvedValueOnce({ copied_ad_id: 'ad2' })
    const result = await metaAdapter.execute(ctx, command, before)
    const [id, body] = copyObjectMock.mock.calls[0]
    expect(id).toBe('ad1')
    expect(body).toMatchObject({ status_option: 'PAUSED', adset_id: 'as2' })
    expect(body).not.toHaveProperty('deep_copy')
    expect(result.providerRef).toBe('ad2')
  })

  it('buildRollback returns null', () => {
    const before: ResourceSnapshot = { resourceType: 'ad', resourceId: 'ad1', resourceName: 'Ad', campaignId: 'c1', currency: 'USD', fields: { name: 'Ad' } }
    expect(metaAdapter.buildRollback(command, before, 'ad2')).toBeNull()
  })
})

// ─── capabilities() ─────────────────────────────────────────────────────────────

describe('capabilities', () => {
  it('advertises every round-2 Meta command type', () => {
    const types = metaAdapter.capabilities().map((c) => c.type)
    for (const t of [
      'meta.campaign.set_bid_strategy',
      'meta.adset.set_bid_strategy',
      'meta.ad.set_creative',
      'meta.campaign.duplicate',
      'meta.adset.duplicate',
      'meta.ad.duplicate',
    ]) {
      expect(types).toContain(t)
    }
  })

  it('only lists meta.* command types', () => {
    for (const c of metaAdapter.capabilities()) {
      expect(c.type.startsWith('meta.')).toBe(true)
    }
  })
})
