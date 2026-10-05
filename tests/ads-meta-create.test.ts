// Coverage for the two "create" Meta commands: meta.campaign.create and
// meta.ad.create. Everything Meta creates through these commands comes back
// PAUSED — nothing this adapter creates can start spending on its own.
//
// Same mocking style as tests/ads-meta-adapter-r2.test.ts: only the transport
// (getObject / getAdAccountInfo / createObject / listCampaigns / listAds) is
// faked; MetaAdsError stays real.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const getObjectMock = vi.fn()
const updateObjectMock = vi.fn()
const getAdAccountInfoMock = vi.fn()
const createObjectMock = vi.fn()
const listCampaignsMock = vi.fn()
const listAdsMock = vi.fn()

vi.mock('@/lib/ads/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/meta-api')>('@/lib/ads/meta-api')
  return {
    ...actual,
    getObject: (...args: unknown[]) => getObjectMock(...args),
    updateObject: (...args: unknown[]) => updateObjectMock(...args),
    getAdAccountInfo: (...args: unknown[]) => getAdAccountInfoMock(...args),
    createObject: (...args: unknown[]) => createObjectMock(...args),
    listCampaigns: (...args: unknown[]) => listCampaignsMock(...args),
    listAds: (...args: unknown[]) => listAdsMock(...args),
  }
})

import { metaAdapter } from '@/lib/ads/providers/meta-adapter'
import { MetaAdsError } from '@/lib/ads/meta-api'
import type { AdapterContext } from '@/lib/ads/providers/types'

const ctx: AdapterContext = { orgId: 'org-1', adAccountId: 'act_123456789', credential: 'token' }

beforeEach(() => {
  vi.clearAllMocks()
  getAdAccountInfoMock.mockResolvedValue({ id: 'act_123456789', name: 'Acme', currency: 'USD', account_status: 1 })
  listCampaignsMock.mockResolvedValue([])
  listAdsMock.mockResolvedValue([])
})

// ─── meta.campaign.create ───────────────────────────────────────────────────────

describe('snapshot + plan — meta.campaign.create', () => {
  const baseCommand = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.campaign.create' as const,
    name: 'Fall Sale',
    objective: 'OUTCOME_SALES' as const,
    special_ad_categories: [] as Array<'HOUSING' | 'EMPLOYMENT' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS' | 'FINANCIAL_PRODUCTS_SERVICES'>,
  }

  it('rejects when a non-deleted campaign with the same name already exists', async () => {
    listCampaignsMock.mockResolvedValueOnce([
      { id: 'c_old', name: 'Fall Sale', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_SALES', created_time: '', updated_time: '' },
    ])
    const before = await metaAdapter.snapshot(ctx, baseCommand)
    expect(before).not.toBeNull()
    const plan = metaAdapter.plan(baseCommand, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('already_exists')
      expect(plan.message).toContain('c_old')
    }
  })

  it('ignores a DELETED campaign with the same name (not a collision)', async () => {
    listCampaignsMock.mockResolvedValueOnce([
      { id: 'c_old', name: 'Fall Sale', status: 'DELETED', effective_status: 'DELETED', objective: 'OUTCOME_SALES', created_time: '', updated_time: '' },
    ])
    const before = await metaAdapter.snapshot(ctx, baseCommand)
    const plan = metaAdapter.plan(baseCommand, before!)
    expect(plan.ok).toBe(true)
  })

  it('rejects bid_strategy without daily_budget', async () => {
    const command = { ...baseCommand, bid_strategy: 'LOWEST_COST_WITHOUT_CAP' as const }
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('bid_strategy_requires_budget')
  })

  it('accepts bid_strategy together with daily_budget and plans both', async () => {
    const command = { ...baseCommand, daily_budget: 50, bid_strategy: 'LOWEST_COST_WITHOUT_CAP' as const }
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.bid_strategy).toBe('LOWEST_COST_WITHOUT_CAP')
      expect(plan.intended.daily_budget).toBe(50)
      expect(plan.facts.budgetAfter).toBe(50)
    }
  })

  it('diffs name, objective, status and special_ad_categories with no daily_budget set', async () => {
    const before = await metaAdapter.snapshot(ctx, baseCommand)
    const plan = metaAdapter.plan(baseCommand, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toMatchObject({ name: 'Fall Sale', objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [] })
      expect(plan.intended.daily_budget).toBeUndefined()
      expect(plan.diff.some((d) => d.field === 'status' && d.after === 'PAUSED')).toBe(true)
    }
  })

  it('wire: sends status PAUSED and the budget in minor units on create', async () => {
    const command = { ...baseCommand, daily_budget: 50 }
    const before = await metaAdapter.snapshot(ctx, command)
    createObjectMock.mockResolvedValueOnce({ id: 'c_new' })
    const result = await metaAdapter.execute(ctx, command, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/campaigns',
      { name: 'Fall Sale', objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [], daily_budget: '5000' },
      'token',
    )
    expect(result.providerRef).toBe('c_new')
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('wire: supports a lifetime campaign budget and bid strategy', async () => {
    const command = { ...baseCommand, lifetime_budget: 500, bid_strategy: 'LOWEST_COST_WITHOUT_CAP' as const }
    const before = await metaAdapter.snapshot(ctx, command)
    createObjectMock.mockResolvedValueOnce({ id: 'c_new' })
    await metaAdapter.execute(ctx, command, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/campaigns',
      { name: 'Fall Sale', objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [], lifetime_budget: '50000', bid_strategy: 'LOWEST_COST_WITHOUT_CAP' },
      'token',
    )
  })

  it('wire: omits daily_budget entirely when the command has none (ad set budgets)', async () => {
    const before = await metaAdapter.snapshot(ctx, baseCommand)
    createObjectMock.mockResolvedValueOnce({ id: 'c_new' })
    await metaAdapter.execute(ctx, baseCommand, before!)
    const [, body] = createObjectMock.mock.calls[0]
    expect(body).not.toHaveProperty('daily_budget')
    expect(body).not.toHaveProperty('bid_strategy')
    // Graph v26 refuses an ad-set-budget campaign that doesn't say whether its
    // ad sets may share budget (100 / 4834011) — they must not.
    expect(body).toHaveProperty('is_adset_budget_sharing_enabled', false)
  })

  it('wire: forwards explicit ad-set budget sharing for a no-budget campaign', async () => {
    const command = { ...baseCommand, is_adset_budget_sharing_enabled: true }
    const before = await metaAdapter.snapshot(ctx, command)
    createObjectMock.mockResolvedValueOnce({ id: 'c_new' })
    await metaAdapter.execute(ctx, command, before!)
    expect(createObjectMock.mock.calls[0][1]).toHaveProperty('is_adset_budget_sharing_enabled', true)
  })

  it('wire: does not send is_adset_budget_sharing_enabled with a campaign budget (CBO)', async () => {
    const cmd = { ...baseCommand, daily_budget: 50 }
    const before = await metaAdapter.snapshot(ctx, cmd)
    createObjectMock.mockResolvedValueOnce({ id: 'c_new' })
    await metaAdapter.execute(ctx, cmd, before!)
    const [, body] = createObjectMock.mock.calls[0]
    expect(body).not.toHaveProperty('is_adset_budget_sharing_enabled')
  })

  it('validate() sends execution_options: [validate_only] and does not call updateObject', async () => {
    const command = { ...baseCommand, daily_budget: 50 }
    const before = await metaAdapter.snapshot(ctx, command)
    await metaAdapter.validate(ctx, command, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/campaigns',
      { name: 'Fall Sale', objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [], daily_budget: '5000' },
      'token',
      { validateOnly: true },
    )
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('throws when Meta returns no id on create', async () => {
    const before = await metaAdapter.snapshot(ctx, baseCommand)
    createObjectMock.mockResolvedValueOnce({})
    await expect(metaAdapter.execute(ctx, baseCommand, before!)).rejects.toThrow(MetaAdsError)
  })

  it('verify() re-reads the new campaign by providerRef and confirms PAUSED, name and account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c_new', name: 'Fall Sale', status: 'PAUSED', account_id: 'act_123456789' })
    const result = await metaAdapter.verify(ctx, baseCommand, {}, 'c_new')
    expect(getObjectMock).toHaveBeenCalledWith('c_new', expect.any(String), 'token')
    expect(result.ok).toBe(true)
  })

  it('verify() fails when the new campaign is not PAUSED', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'c_new', name: 'Fall Sale', status: 'ACTIVE', account_id: 'act_123456789' })
    const result = await metaAdapter.verify(ctx, baseCommand, {}, 'c_new')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'status')).toBe(true)
  })

  it('verify() fails when there is no providerRef', async () => {
    const result = await metaAdapter.verify(ctx, baseCommand, {}, null)
    expect(result.ok).toBe(false)
    expect(getObjectMock).not.toHaveBeenCalled()
  })

  it('buildRollback returns null — a create has no automatic inverse', async () => {
    const before = await metaAdapter.snapshot(ctx, baseCommand)
    expect(metaAdapter.buildRollback(baseCommand, before!, 'c_new')).toBeNull()
  })
})

// ─── meta.ad.create ─────────────────────────────────────────────────────────────

describe('snapshot + plan — meta.ad.create', () => {
  const command = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.ad.create' as const,
    adset_id: 'as1',
    name: 'New Ad',
    creative_id: 'cr1',
  }
  const adset = { id: 'as1', name: 'AdSet', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1' }
  const creative = { id: 'cr1', name: 'Creative', account_id: 'act_123456789' }

  it('snapshot returns null when the ad set belongs to a different account', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, account_id: 'act_999999999' })
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).toBeNull()
  })

  it('rejects when the ad set is ARCHIVED', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, status: 'ARCHIVED' })
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('rejects when the ad set is DELETED', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, status: 'DELETED' })
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('rejects an unknown creative_id', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockRejectedValueOnce(new MetaAdsError('Object does not exist', 100, 33))
    const before = await metaAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('creative_not_found')
  })

  it('rejects a creative_id that belongs to a different ad account', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce({ ...creative, account_id: 'act_999999999' })
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('cross_account_creative')
  })

  it('rejects when an ad with the same name already exists in that ad set', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    listAdsMock.mockResolvedValueOnce([
      { id: 'ad_old', name: 'New Ad', adset_id: 'as1', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '' },
    ])
    const before = await metaAdapter.snapshot(ctx, command)
    expect(listAdsMock).toHaveBeenCalledWith('act_123456789', 'token', 'as1')
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.code).toBe('already_exists')
      expect(plan.message).toContain('ad_old')
    }
  })

  it('ignores a DELETED ad with the same name (not a collision)', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    listAdsMock.mockResolvedValueOnce([
      { id: 'ad_old', name: 'New Ad', adset_id: 'as1', status: 'DELETED', effective_status: 'DELETED', created_time: '' },
    ])
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })

  it('accepts a valid ad set + creative and diffs name / ad set / creative / status', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    const plan = metaAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended).toMatchObject({ name: 'New Ad', adset_id: 'as1', creative_id: 'cr1', status: 'PAUSED' })
      expect(plan.diff.some((d) => d.field === 'adset_id' && d.after === 'AdSet')).toBe(true)
      expect(plan.diff.some((d) => d.field === 'creative_id' && d.after === 'Creative')).toBe(true)
    }
  })

  it('wire: POSTs to act_x/ads with creative.creative_id and status PAUSED', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    createObjectMock.mockResolvedValueOnce({ id: 'ad_new' })
    const result = await metaAdapter.execute(ctx, command, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/ads',
      { name: 'New Ad', adset_id: 'as1', creative: { creative_id: 'cr1' }, status: 'PAUSED' },
      'token',
    )
    expect(result.providerRef).toBe('ad_new')
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('validate() passes validate_only through to createObject', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    await metaAdapter.validate(ctx, command, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/ads',
      { name: 'New Ad', adset_id: 'as1', creative: { creative_id: 'cr1' }, status: 'PAUSED' },
      'token',
      { validateOnly: true },
    )
  })

  it('throws when Meta returns no id on create', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    createObjectMock.mockResolvedValueOnce({})
    await expect(metaAdapter.execute(ctx, command, before!)).rejects.toThrow(MetaAdsError)
  })

  it('verify() re-reads the new ad and confirms PAUSED, name and account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad_new', name: 'New Ad', status: 'PAUSED', account_id: 'act_123456789' })
    const result = await metaAdapter.verify(ctx, command, {}, 'ad_new')
    expect(result.ok).toBe(true)
  })

  it('verify() reports a name mismatch', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad_new', name: 'Something Else', status: 'PAUSED', account_id: 'act_123456789' })
    const result = await metaAdapter.verify(ctx, command, {}, 'ad_new')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'name')).toBe(true)
  })

  it('buildRollback returns null — a create has no automatic inverse', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(creative)
    const before = await metaAdapter.snapshot(ctx, command)
    expect(metaAdapter.buildRollback(command, before!, 'ad_new')).toBeNull()
  })
})

// ─── capabilities() ─────────────────────────────────────────────────────────────

describe('capabilities — create commands', () => {
  it('advertises meta.campaign.create and meta.ad.create at risk 4', () => {
    const caps = metaAdapter.capabilities()
    const campaignCreate = caps.find((c) => c.type === 'meta.campaign.create')
    const adCreate = caps.find((c) => c.type === 'meta.ad.create')
    expect(campaignCreate?.risk).toBe(4)
    expect(adCreate?.risk).toBe(4)
  })
})

