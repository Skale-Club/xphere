import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Only the transport (getObject / updateObject / getAdAccountInfo) is faked —
// MetaAdsError stays real so classifyError is exercised as written.

const getObjectMock = vi.fn()
const updateObjectMock = vi.fn()
const getAdAccountInfoMock = vi.fn()

vi.mock('@/lib/ads/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/meta-api')>('@/lib/ads/meta-api')
  return {
    ...actual,
    getObject: (...args: unknown[]) => getObjectMock(...args),
    updateObject: (...args: unknown[]) => updateObjectMock(...args),
    getAdAccountInfo: (...args: unknown[]) => getAdAccountInfoMock(...args),
  }
})

import { metaAdapter } from '@/lib/ads/providers/meta-adapter'
import { MetaAdsError } from '@/lib/ads/meta-api'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { ResourceSnapshot } from '@/lib/ads/commands/types'

const ctx: AdapterContext = { orgId: 'org-1', adAccountId: 'act_123456789', credential: 'token' }

beforeEach(() => {
  vi.clearAllMocks()
  getAdAccountInfoMock.mockResolvedValue({ id: 'act_123456789', name: 'Acme', currency: 'USD', account_status: 1 })
  updateObjectMock.mockResolvedValue({ success: true })
})

// ─── Cross-account safety ───────────────────────────────────────────────────────

describe('snapshot — cross-account safety', () => {
  it('returns null when the object belongs to a different ad account than the command names', async () => {
    // One Meta token can reach many ad accounts; without this check a command
    // scoped to act_123456789 could edit a campaign that actually lives in
    // some other account the same token happens to see.
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_999999999' })
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status' as const,
      campaign_id: 'c1',
      status: 'PAUSED' as const,
    }
    expect(await metaAdapter.snapshot(ctx, command)).toBeNull()
  })

  it('returns the snapshot when the account matches', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789' })
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status' as const,
      campaign_id: 'c1',
      status: 'PAUSED' as const,
    }
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
  })
})

// ─── Budget rules ────────────────────────────────────────────────────────────────

describe('plan — campaign budget', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.set_daily_budget' as const,
    campaign_id: 'c1',
    daily_budget: 50,
  }

  it('rejects a campaign daily budget change when the campaign uses ad set budgets (ABO)', () => {
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: 'c1',
      resourceName: 'Campaign',
      campaignId: 'c1',
      currency: 'USD',
      fields: { daily_budget: null, lifetime_budget: null },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('adset_budgets')
  })

  it('rejects a campaign daily budget change when the campaign uses a lifetime budget', () => {
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: 'c1',
      resourceName: 'Campaign',
      campaignId: 'c1',
      currency: 'USD',
      fields: { daily_budget: null, lifetime_budget: 1000 },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('lifetime_budget')
  })

  it('accepts a campaign daily budget change on a normal CBO campaign', () => {
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: 'c1',
      resourceName: 'Campaign',
      campaignId: 'c1',
      currency: 'USD',
      fields: { daily_budget: 20, lifetime_budget: null },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
  })
})

describe('plan — ad set budget', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.set_daily_budget' as const,
    adset_id: 'as1',
    daily_budget: 50,
  }

  it('rejects an ad set budget change when the parent campaign uses CBO', () => {
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { daily_budget: 20, lifetime_budget: null, campaign_budget_optimization: true },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_budget')
  })

  it('rejects an ad set budget change when the ad set uses a lifetime budget', () => {
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { daily_budget: null, lifetime_budget: 500, campaign_budget_optimization: false },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('lifetime_budget')
  })

  it('accepts an ad set budget change under ABO with no lifetime budget', () => {
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { daily_budget: 20, lifetime_budget: null, campaign_budget_optimization: false },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
  })
})

// ─── Currency: minor units per major unit ───────────────────────────────────────

describe('execute — currency-aware minor unit conversion', () => {
  it('sends a JPY budget unchanged (zero-decimal currency: 5000 -> "5000")', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_daily_budget' as const,
      campaign_id: 'c1',
      daily_budget: 5000,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'C', campaignId: 'c1', currency: 'JPY', fields: { daily_budget: 3000 } }
    await metaAdapter.execute(ctx, command, before)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { daily_budget: '5000' }, 'token')
  })

  it('sends a BRL budget converted to minor units (50 -> "5000")', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_daily_budget' as const,
      campaign_id: 'c1',
      daily_budget: 50,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'C', campaignId: 'c1', currency: 'BRL', fields: { daily_budget: 30 } }
    await metaAdapter.execute(ctx, command, before)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { daily_budget: '5000' }, 'token')
  })
})

// ─── update_targeting ────────────────────────────────────────────────────────────

describe('plan + execute — meta.adset.update_targeting', () => {
  const baseTargeting = {
    age_min: 18,
    age_max: 65,
    genders: [1],
    geo_locations: { countries: ['US'], cities: [{ key: '123', radius: 10 }] },
    publisher_platforms: ['facebook', 'instagram'],
  }

  it('merges the change into the existing targeting, keeping untouched keys', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      age_min: 21,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(baseTargeting), targeting: baseTargeting },
    }
    await metaAdapter.execute(ctx, command, before)
    const [, fields] = updateObjectMock.mock.calls[0]
    expect(fields.targeting).toMatchObject({ age_min: 21, age_max: 65, genders: [1], publisher_platforms: ['facebook', 'instagram'] })
  })

  it('an empty genders array removes the key entirely (all genders)', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      genders: [] as Array<1 | 2>,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(baseTargeting), targeting: baseTargeting },
    }
    await metaAdapter.execute(ctx, command, before)
    const [, fields] = updateObjectMock.mock.calls[0]
    expect(fields.targeting).not.toHaveProperty('genders')
  })

  it('replaces only geo_locations.countries, and warns when other geo keys (regions/cities) exist', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      countries: ['BR'],
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { ...targetingFieldsFor(baseTargeting), targeting: baseTargeting },
    }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.countries).toEqual(['BR'])
      expect(plan.warnings.some((w) => /regions\/cities\/zips/.test(w))).toBe(true)
    }
  })

  it('does not warn about other geo keys when there are none', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      countries: ['BR'],
    }
    const targeting = { ...baseTargeting, geo_locations: { countries: ['US'] } }
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
    if (plan.ok) expect(plan.warnings.some((w) => /regions\/cities\/zips/.test(w))).toBe(false)
  })
})

type TestTargeting = {
  age_min?: number
  age_max?: number
  genders?: number[]
  geo_locations?: { countries?: string[] } & Record<string, unknown>
  publisher_platforms?: string[]
}

function targetingFieldsFor(t: TestTargeting) {
  return {
    age_min: t.age_min ?? null,
    age_max: t.age_max ?? null,
    genders: t.genders ?? [],
    countries: t.geo_locations?.countries ?? [],
    publisher_platforms: t.publisher_platforms ?? null,
  }
}

// ─── Locked (archived) resources ────────────────────────────────────────────────

describe('plan — locked resource status', () => {
  it('rejects a status change on an ARCHIVED object', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status' as const,
      campaign_id: 'c1',
      status: 'ACTIVE' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'C', campaignId: 'c1', currency: 'USD', fields: { status: 'ARCHIVED' } }
    const plan = metaAdapter.plan(command, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })
})

// ─── Validate ─────────────────────────────────────────────────────────────────────

describe('validate', () => {
  it('sends execution_options: validate_only via the validateOnly flag', async () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.campaign.set_status' as const,
      campaign_id: 'c1',
      status: 'PAUSED' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: 'c1', resourceName: 'C', campaignId: 'c1', currency: 'USD', fields: { status: 'ACTIVE' } }
    await metaAdapter.validate(ctx, command, before)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { status: 'PAUSED' }, 'token', { validateOnly: true })
  })
})

// ─── buildRollback ────────────────────────────────────────────────────────────────

describe('buildRollback — update_targeting', () => {
  it('returns null when a changed field had no explicit prior value', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      age_min: 25,
    }
    // age_min was never explicitly set before (null) — there is nothing safe to roll back to.
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { age_min: null, age_max: 65, genders: [], countries: [], publisher_platforms: null },
    }
    expect(metaAdapter.buildRollback(command, before, null)).toBeNull()
  })

  it('builds a rollback when the changed field did have an explicit prior value', () => {
    const command = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.adset.update_targeting' as const,
      adset_id: 'as1',
      age_min: 25,
    }
    const before: ResourceSnapshot = {
      resourceType: 'adset',
      resourceId: 'as1',
      resourceName: 'AdSet',
      campaignId: 'c1',
      currency: 'USD',
      fields: { age_min: 18, age_max: 65, genders: [], countries: [], publisher_platforms: null },
    }
    const inverse = metaAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'meta.adset.update_targeting', adset_id: 'as1', age_min: 18 })
  })
})

// ─── classifyError ────────────────────────────────────────────────────────────────

describe('classifyError', () => {
  it('treats Meta error code 17 (API rate limit) as transient', () => {
    const cls = metaAdapter.classifyError(new MetaAdsError('User request limit reached', 17))
    expect(cls.transient).toBe(true)
  })

  it('treats an unrecognized error code as not transient', () => {
    const cls = metaAdapter.classifyError(new MetaAdsError('Invalid parameter', 100))
    expect(cls.transient).toBe(false)
  })
})
