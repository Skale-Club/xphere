// Coverage for the meta/adsets.ts CommandHandler: ad set creation, lifetime
// budgets (campaign + ad set), ad set settings, full targeting replacement,
// and campaign special ad categories.
//
// Same mocking style as tests/ads-meta-create.test.ts: only the transport
// (getObject / getAdAccountInfo / createObject / updateObject /
// listAdSetsDetailed) is faked; MetaAdsError stays real. The handler is
// exercised directly (not through the composed meta adapter), since this
// module is the only thing in scope here.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const getObjectMock = vi.fn()
const updateObjectMock = vi.fn()
const getAdAccountInfoMock = vi.fn()
const createObjectMock = vi.fn()
const listAdSetsDetailedMock = vi.fn()

vi.mock('@/lib/ads/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/meta-api')>('@/lib/ads/meta-api')
  return {
    ...actual,
    getObject: (...args: unknown[]) => getObjectMock(...args),
    updateObject: (...args: unknown[]) => updateObjectMock(...args),
    getAdAccountInfo: (...args: unknown[]) => getAdAccountInfoMock(...args),
    createObject: (...args: unknown[]) => createObjectMock(...args),
    listAdSetsDetailed: (...args: unknown[]) => listAdSetsDetailedMock(...args),
  }
})

import { adsetsHandler } from '@/lib/ads/providers/meta/adsets'
import { MetaAdsError } from '@/lib/ads/meta-api'
import type { AdapterContext } from '@/lib/ads/providers/types'

const ctx: AdapterContext = { orgId: 'org-1', adAccountId: 'act_123456789', credential: 'token' }

beforeEach(() => {
  vi.clearAllMocks()
  getAdAccountInfoMock.mockResolvedValue({ id: 'act_123456789', name: 'Acme', currency: 'USD', account_status: 1 })
  listAdSetsDetailedMock.mockResolvedValue([])
})

// ─── guard ──────────────────────────────────────────────────────────────────

it('rejects a command from another handler', async () => {
  const foreign = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.set_status' as const,
    campaign_id: 'c1',
    status: 'ACTIVE' as const,
  }
  await expect(adsetsHandler.snapshot(ctx, foreign)).rejects.toThrow('Not an ad-sets command')
})

// ─── meta.adset.create ──────────────────────────────────────────────────────

describe('meta.adset.create', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.create' as const,
    campaign_id: 'c1',
    name: 'New Ad Set',
    optimization_goal: 'LEAD_GENERATION',
    billing_event: 'IMPRESSIONS',
    targeting: { geo_locations: { countries: ['US'] } } as Record<string, unknown>,
    // LEAD_GENERATION requires a promoted object (Meta rule, pre-checked in plan).
    promoted_object: { page_id: '999' } as Record<string, unknown>,
  }
  const aboCampaign = { id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789' }
  const cboCampaign = { ...aboCampaign, daily_budget: '5000' }

  it('snapshot returns null when the campaign belongs to a different account', async () => {
    getObjectMock.mockResolvedValueOnce({ ...aboCampaign, account_id: 'act_999999999' })
    const before = await adsetsHandler.snapshot(ctx, { ...command, daily_budget: 50 })
    expect(before).toBeNull()
  })

  it('rejects when the campaign is ARCHIVED', async () => {
    getObjectMock.mockResolvedValueOnce({ ...aboCampaign, status: 'ARCHIVED' })
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    expect(before).not.toBeNull()
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_archived')
  })

  it('rejects when an ad set with the same name already exists (non-deleted)', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    listAdSetsDetailedMock.mockResolvedValueOnce([{ id: 'as_old', name: 'New Ad Set', status: 'ACTIVE' }])
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    expect(listAdSetsDetailedMock).toHaveBeenCalledWith('act_123456789', 'token', 'c1')
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('already_exists')
      expect(plan.message).toContain('as_old')
    }
  })

  it('ignores a DELETED ad set with the same name (not a collision)', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    listAdSetsDetailedMock.mockResolvedValueOnce([{ id: 'as_old', name: 'New Ad Set', status: 'DELETED' }])
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
  })

  it('rejects a budget when the campaign uses a campaign budget (CBO)', async () => {
    getObjectMock.mockResolvedValueOnce(cboCampaign)
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_budget')
  })

  it('requires a budget when the campaign has no campaign budget (ABO)', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('budget_required')
  })

  it('plans a daily-budget ad set and records facts.budgetAfter', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toMatchObject({
        name: 'New Ad Set',
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        daily_budget: 50,
      })
      expect(plan.facts.budgetAfter).toBe(50)
    }
  })

  it('plans a lifetime-budget ad set without setting facts.budgetAfter', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, lifetime_budget: 500, end_time: '2027-01-01T00:00:00Z' }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.lifetime_budget).toBe(500)
      expect(plan.intended.end_time).toBe('2027-01-01T00:00:00.000Z')
      expect(plan.facts.budgetAfter).toBeUndefined()
    }
  })

  it('warns when targeting has no geo_locations', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50, targeting: {} }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('geo_locations'))).toBe(true)
  })

  it('warns when targeting reaches the EU without DSA fields', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50, targeting: { geo_locations: { countries: ['DE'] } } }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('EU'))).toBe(true)
  })

  it('does not warn about the EU/DSA when dsa_beneficiary and dsa_payor are set', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = {
      ...command,
      daily_budget: 50,
      targeting: { geo_locations: { countries: ['DE'] } },
      dsa_beneficiary: 'Acme',
      dsa_payor: 'Acme',
    }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('EU'))).toBe(false)
  })

  it('warns when targeting includes a regionally regulated country without regional fields', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50, targeting: { geo_locations: { countries: ['BR'] } } }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('BR'))).toBe(true)
  })

  it('wire: POSTs to act_x/adsets with status PAUSED and money in minor units', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50, bid_amount: 2.5 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    createObjectMock.mockResolvedValueOnce({ id: 'as_new' })
    const result = await adsetsHandler.execute(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/adsets',
      expect.objectContaining({
        name: 'New Ad Set',
        campaign_id: 'c1',
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        daily_budget: '5000',
        bid_amount: 250,
      }),
      'token',
    )
    expect(result.providerRef).toBe('as_new')
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('validate() sends execution_options: [validate_only] and does not call updateObject', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    await adsetsHandler.validate(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith('act_123456789/adsets', expect.any(Object), 'token', { validateOnly: true })
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('throws when Meta returns no id on create', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    createObjectMock.mockResolvedValueOnce({})
    await expect(adsetsHandler.execute(ctx, cmd, before!)).rejects.toThrow(MetaAdsError)
  })

  it('verify() re-reads the new ad set by providerRef and confirms PAUSED, name and account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'as_new', name: 'New Ad Set', status: 'PAUSED', account_id: 'act_123456789' })
    const result = await adsetsHandler.verify(ctx, command, {}, 'as_new')
    expect(result.ok).toBe(true)
  })

  it('verify() fails when the new ad set is not PAUSED', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'as_new', name: 'New Ad Set', status: 'ACTIVE', account_id: 'act_123456789' })
    const result = await adsetsHandler.verify(ctx, command, {}, 'as_new')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'status')).toBe(true)
  })

  it('verify() fails when there is no providerRef', async () => {
    const result = await adsetsHandler.verify(ctx, command, {}, null)
    expect(result.ok).toBe(false)
    expect(getObjectMock).not.toHaveBeenCalled()
  })

  it('buildRollback returns null — a create has no automatic inverse', async () => {
    getObjectMock.mockResolvedValueOnce(aboCampaign)
    const cmd = { ...command, daily_budget: 50 }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    expect(adsetsHandler.buildRollback(cmd, before!, 'as_new')).toBeNull()
  })
})

// ─── meta.campaign.set_lifetime_budget ──────────────────────────────────────

describe('meta.campaign.set_lifetime_budget', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.set_lifetime_budget' as const,
    campaign_id: 'c1',
    lifetime_budget: 1000,
  }

  it('rejects a campaign that uses ad set budgets (no CBO)', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('not_cbo')
  })

  it('rejects an ARCHIVED campaign', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ARCHIVED', account_id: 'act_123456789', daily_budget: '5000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('plans the change with a money diff and policy facts, warning about the daily budget', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789', daily_budget: '5000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.lifetime_budget).toBe(1000)
      // budgetBefore reflects the previous *lifetime* budget (none here — this
      // campaign was on a daily budget), not the daily budget being replaced.
      expect(plan.facts.budgetBefore).toBeNull()
      expect(plan.facts.budgetAfter).toBe(1000)
      expect(plan.warnings.some((w) => w.includes('daily budget'))).toBe(true)
    }
  })

  it('wire: sends lifetime_budget in minor units', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789', daily_budget: '5000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    updateObjectMock.mockResolvedValueOnce({ success: true })
    const result = await adsetsHandler.execute(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { lifetime_budget: '100000' }, 'token')
    expect(result.providerRef).toBe('c1')
  })

  it('validate() passes validateOnly through to updateObject', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789', daily_budget: '5000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    await adsetsHandler.validate(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { lifetime_budget: '100000' }, 'token', { validateOnly: true })
  })

  it('buildRollback reverts to the previous daily budget when there was one', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789', daily_budget: '5000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, 'c1')
    expect(rollback).toMatchObject({ type: 'meta.campaign.set_daily_budget', campaign_id: 'c1', daily_budget: 50 })
  })

  it('buildRollback reverts to the previous lifetime budget when there was one and no daily budget', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789', lifetime_budget: '20000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, 'c1')
    expect(rollback).toMatchObject({ type: 'meta.campaign.set_lifetime_budget', campaign_id: 'c1', lifetime_budget: 200 })
  })
})

// ─── meta.adset.set_lifetime_budget ─────────────────────────────────────────

describe('meta.adset.set_lifetime_budget', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.set_lifetime_budget' as const,
    adset_id: 'as1',
    lifetime_budget: 300,
  }
  const adsetBase = { id: 'as1', name: 'AdSet', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1' }

  it('rejects when the parent campaign uses a campaign budget (CBO)', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetBase, campaign: { id: 'c1', daily_budget: '5000' } })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('campaign_budget')
  })

  it('requires an end_time when the ad set has none and the command supplies none', async () => {
    getObjectMock.mockResolvedValueOnce(adsetBase)
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('end_time_required')
  })

  it('rejects an end_time in the past', async () => {
    getObjectMock.mockResolvedValueOnce(adsetBase)
    const cmd = { ...command, end_time: '2000-01-01T00:00:00Z' }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('end_in_past')
  })

  it('reuses an existing end_time when the command supplies none, without adding it to the diff', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetBase, end_time: '2099-01-01T00:00:00+0000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.end_time).toBeUndefined()
      expect(plan.diff.some((d) => d.field === 'end_time')).toBe(false)
    }
  })

  it('warns when switching from a daily budget to a lifetime budget', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetBase, daily_budget: '2000', end_time: '2099-01-01T00:00:00+0000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('daily budget'))).toBe(true)
  })

  it('wire: sends lifetime_budget and end_time (from the command) in one call', async () => {
    getObjectMock.mockResolvedValueOnce(adsetBase)
    const cmd = { ...command, end_time: '2099-06-01T00:00:00Z' }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    updateObjectMock.mockResolvedValueOnce({ success: true })
    await adsetsHandler.execute(ctx, cmd, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('as1', { lifetime_budget: '30000', end_time: '2099-06-01T00:00:00.000Z' }, 'token')
  })

  it('buildRollback prefers the previous daily budget when there was one', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetBase, daily_budget: '2000', end_time: '2099-01-01T00:00:00+0000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, 'as1')
    expect(rollback).toMatchObject({ type: 'meta.adset.set_daily_budget', adset_id: 'as1', daily_budget: 20 })
  })

  it('buildRollback falls back to the previous lifetime budget + end_time when there was no daily budget', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetBase, lifetime_budget: '15000', end_time: '2099-01-01T00:00:00+0000' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, 'as1')
    expect(rollback).toMatchObject({ type: 'meta.adset.set_lifetime_budget', adset_id: 'as1', lifetime_budget: 150 })
    expect((rollback as { end_time?: string }).end_time).toBeTruthy()
  })

  it('buildRollback returns null when there was no prior budget at all', async () => {
    getObjectMock.mockResolvedValueOnce(adsetBase)
    const before = await adsetsHandler.snapshot(ctx, command)
    expect(adsetsHandler.buildRollback(command, before!, 'as1')).toBeNull()
  })
})

// ─── meta.adset.update_settings ─────────────────────────────────────────────

describe('meta.adset.update_settings', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.update_settings' as const,
    adset_id: 'as1',
    optimization_goal: 'OFFSITE_CONVERSIONS',
  }
  const adset = { id: 'as1', name: 'AdSet', status: 'PAUSED', account_id: 'act_123456789', campaign_id: 'c1', optimization_goal: 'LINK_CLICKS' }

  it('rejects an ARCHIVED ad set', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, status: 'ARCHIVED' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('diffs only the provided field', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toEqual({ optimization_goal: 'OFFSITE_CONVERSIONS' })
      expect(plan.diff).toHaveLength(1)
      expect(plan.diff[0]).toMatchObject({ field: 'optimization_goal', before: 'LINK_CLICKS', after: 'OFFSITE_CONVERSIONS' })
    }
  })

  it('is a no-op when the value already matches', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, optimization_goal: 'OFFSITE_CONVERSIONS' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('warns when changing optimization_goal on a delivering (ACTIVE) ad set', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, status: 'ACTIVE' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('learning'))).toBe(true)
  })

  it('does not warn when the ad set is PAUSED', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.length).toBe(0)
  })

  it('builds a wire payload containing only the provided fields', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const cmd = { ...command, dsa_beneficiary: 'Acme', dsa_payor: 'Acme' }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    updateObjectMock.mockResolvedValueOnce({ success: true })
    await adsetsHandler.execute(ctx, cmd, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('as1', { optimization_goal: 'OFFSITE_CONVERSIONS', dsa_beneficiary: 'Acme', dsa_payor: 'Acme' }, 'token')
  })

  it('validate() passes validateOnly through', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    await adsetsHandler.validate(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('as1', { optimization_goal: 'OFFSITE_CONVERSIONS' }, 'token', { validateOnly: true })
  })

  it('buildRollback returns null when the changed field had no previous value', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, optimization_goal: undefined })
    const before = await adsetsHandler.snapshot(ctx, command)
    expect(adsetsHandler.buildRollback(command, before!, null)).toBeNull()
  })

  it('buildRollback reverts to the previous value when it existed', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, null)
    expect(rollback).toMatchObject({ type: 'meta.adset.update_settings', adset_id: 'as1', optimization_goal: 'LINK_CLICKS' })
  })

  it('buildRollback reverts array/record fields to empty when there was no previous value', async () => {
    const cmd = { ...command, optimization_goal: undefined, regional_regulated_categories: ['BRAZIL_REGULATION' as const] }
    getObjectMock.mockResolvedValueOnce({ ...adset, optimization_goal: undefined, regional_regulated_categories: undefined })
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const rollback = adsetsHandler.buildRollback(cmd, before!, null)
    expect(rollback).toMatchObject({ type: 'meta.adset.update_settings', adset_id: 'as1', regional_regulated_categories: [] })
  })
})

// ─── meta.adset.replace_targeting ───────────────────────────────────────────

describe('meta.adset.replace_targeting', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.adset.replace_targeting' as const,
    adset_id: 'as1',
    targeting: { geo_locations: { countries: ['US'] }, age_min: 21 } as Record<string, unknown>,
  }
  const adset = {
    id: 'as1',
    name: 'AdSet',
    status: 'PAUSED',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    targeting: { geo_locations: { countries: ['US'] }, age_min: 18 },
  }

  it('rejects an ARCHIVED ad set', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, status: 'ARCHIVED' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('is a no-op when the targeting is identical', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const cmd = { ...command, targeting: adset.targeting }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('summarizes added/removed/changed top-level keys instead of dumping JSON', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const cmd = { ...command, targeting: { geo_locations: { countries: ['US'] }, age_min: 21, interests: [{ id: '1' }] } }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const entry = plan.diff[0]
      expect(entry.field).toBe('targeting')
      expect(entry.afterDisplay).toContain('+interests')
      expect(entry.afterDisplay).toContain('~age_min')
    }
  })

  it('warns when geo_locations is removed', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const cmd = { ...command, targeting: { age_min: 21 } }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('geo_locations'))).toBe(true)
  })

  it('wire: sends the full replacement targeting object', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    updateObjectMock.mockResolvedValueOnce({ success: true })
    await adsetsHandler.execute(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('as1', { targeting: command.targeting }, 'token')
  })

  it('validate() passes validateOnly through', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    await adsetsHandler.validate(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('as1', { targeting: command.targeting }, 'token', { validateOnly: true })
  })

  it('buildRollback replaces with the previous targeting object', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, null)
    expect(rollback).toMatchObject({ type: 'meta.adset.replace_targeting', adset_id: 'as1', targeting: adset.targeting })
  })

  it('buildRollback returns null when there was no previous targeting', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, targeting: undefined })
    const before = await adsetsHandler.snapshot(ctx, command)
    // snapshot defaults a missing targeting to {} — replacing {} with {} is a
    // no-op at plan() time, but buildRollback is exercised directly here to
    // confirm it still degrades safely if ever called on such a snapshot.
    const rollback = adsetsHandler.buildRollback(command, before!, null)
    expect(rollback).toMatchObject({ type: 'meta.adset.replace_targeting', adset_id: 'as1', targeting: {} })
  })
})

// ─── meta.campaign.update_settings ──────────────────────────────────────────

describe('meta.campaign.update_settings', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.update_settings' as const,
    campaign_id: 'c1',
    special_ad_categories: ['HOUSING' as const],
  }
  const campaign = { id: 'c1', name: 'Campaign', status: 'ACTIVE', account_id: 'act_123456789', special_ad_categories: [] as string[] }

  it('rejects a DELETED campaign', async () => {
    getObjectMock.mockResolvedValueOnce({ ...campaign, status: 'DELETED' })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('warns when adding HOUSING/EMPLOYMENT/CREDIT', async () => {
    getObjectMock.mockResolvedValueOnce(campaign)
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => w.includes('restricts'))).toBe(true)
  })

  it('does not warn for a non-restricted category', async () => {
    getObjectMock.mockResolvedValueOnce(campaign)
    const cmd = { ...command, special_ad_categories: ['ISSUES_ELECTIONS_POLITICS' as const] }
    const before = await adsetsHandler.snapshot(ctx, cmd)
    const plan = adsetsHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.length).toBe(0)
  })

  it('is a no-op when the categories are unchanged', async () => {
    getObjectMock.mockResolvedValueOnce({ ...campaign, special_ad_categories: ['HOUSING'] })
    const before = await adsetsHandler.snapshot(ctx, command)
    const plan = adsetsHandler.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('wire: sends the full replacement list', async () => {
    getObjectMock.mockResolvedValueOnce(campaign)
    const before = await adsetsHandler.snapshot(ctx, command)
    updateObjectMock.mockResolvedValueOnce({ success: true })
    await adsetsHandler.execute(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { special_ad_categories: ['HOUSING'] }, 'token')
  })

  it('validate() passes validateOnly through', async () => {
    getObjectMock.mockResolvedValueOnce(campaign)
    const before = await adsetsHandler.snapshot(ctx, command)
    await adsetsHandler.validate(ctx, command, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('c1', { special_ad_categories: ['HOUSING'] }, 'token', { validateOnly: true })
  })

  it('buildRollback reverts to the previous list', async () => {
    getObjectMock.mockResolvedValueOnce(campaign)
    const before = await adsetsHandler.snapshot(ctx, command)
    const rollback = adsetsHandler.buildRollback(command, before!, null)
    expect(rollback).toMatchObject({ type: 'meta.campaign.update_settings', campaign_id: 'c1', special_ad_categories: [] })
  })
})

describe('meta.adset.create — CBO optimization goal consistency', () => {
  it('refuses a goal different from the existing ad sets of a lowest-cost CBO campaign, naming the goal to use', () => {
    const before = {
      resourceType: 'adset' as const, resourceId: null, resourceName: 'New', campaignId: 'c1', currency: 'USD',
      fields: {
        campaign_status: 'PAUSED', campaign_uses_cbo: true, already_exists: false, existing_adset_id: null,
        campaign_bid_strategy: 'LOWEST_COST_WITHOUT_CAP', sibling_optimization_goals: ['LEAD_GENERATION'],
      },
    }
    const plan = adsetsHandler.plan({
      platform: 'meta', ad_account_id: 'act_1', type: 'meta.adset.create', campaign_id: 'c1', name: 'New',
      optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS', targeting: { geo_locations: { countries: ['US'] } },
    } as never, before)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('optimization_goal_mismatch')
      expect(plan.message).toContain('LEAD_GENERATION')
    }
  })
})

describe('meta.adset.create — promoted_object', () => {
  const base = {
    resourceType: 'adset' as const, resourceId: null, resourceName: 'New', campaignId: 'c1', currency: 'USD',
    fields: { campaign_status: 'PAUSED', campaign_uses_cbo: false, already_exists: false, existing_adset_id: null, sibling_optimization_goals: [] },
  }
  const cmd = {
    platform: 'meta', ad_account_id: 'act_1', type: 'meta.adset.create', campaign_id: 'c1', name: 'New',
    optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', daily_budget: 10,
    targeting: { geo_locations: { countries: ['US'] } },
  }

  it('copies the promoted object a sibling ad set with the same goal already uses, and says so', () => {
    const before = { ...base, fields: { ...base.fields, sibling_promoted_object: { pixel_id: 'px', custom_event_type: 'LEAD' }, sibling_promoted_object_adset: 'as9' } }
    const plan = adsetsHandler.plan(cmd as never, before)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.promoted_object).toEqual({ pixel_id: 'px', custom_event_type: 'LEAD' })
      expect(plan.warnings.join(' ')).toContain('as9')
    }
  })

  it('explains what is missing when the goal needs one and nothing can be copied', () => {
    const plan = adsetsHandler.plan(cmd as never, base)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('promoted_object_required')
  })

  it('does not require one for goals Meta accepts without it', () => {
    const plan = adsetsHandler.plan({ ...cmd, optimization_goal: 'LINK_CLICKS' } as never, base)
    expect(plan.ok).toBe(true)
  })
})
