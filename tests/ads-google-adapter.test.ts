import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Only the transport (runGaqlQuery / mutateResources) is faked — GoogleAdsError
// and parseTokens stay real so classifyError and credential parsing are
// exercised as written, not re-implemented in the mock.

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

import { googleAdapter, criterionIdFromResourceName, toMicros } from '@/lib/ads/providers/google-adapter'
import { GoogleAdsError } from '@/lib/ads/google-api'
import type { AdapterContext } from '@/lib/ads/providers/types'
import type { ResourceSnapshot } from '@/lib/ads/commands/types'

const ctx: AdapterContext = {
  orgId: 'org-1',
  adAccountId: '1234567890',
  credential: JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── toMicros rounding ──────────────────────────────────────────────────────────

describe('toMicros', () => {
  it('rounds to whole cents before converting to micros, so a typo does not become a rejected amount', () => {
    // 12.345 -> 12.35 (nearest cent) -> 12_350_000 micros.
    expect(toMicros(12.345)).toBe('12350000')
  })

  it('is exact for a value already at whole cents', () => {
    expect(toMicros(50)).toBe('50000000')
  })
})

// ─── Snapshot + plan: campaign status (enables fact) ───────────────────────────

describe('snapshot + plan — campaign status', () => {
  it('flags an enabling change via the "enables" policy fact', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Prospecting', status: 'PAUSED' }, customer: { currencyCode: 'USD' } },
    ])
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'ENABLED' as const,
    }
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before).not.toBeNull()
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.facts.enables).toBe(true)
      expect(plan.diff[0]).toMatchObject({ field: 'status', before: 'PAUSED', after: 'ENABLED' })
    }
  })

  it('does not flag "enables" when pausing', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' }, customer: { currencyCode: 'USD' } },
    ])
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'PAUSED' as const,
    }
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.facts.enables).toBeFalsy()
  })

  it('rejects a status change on a REMOVED resource', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Old', status: 'REMOVED' }, customer: { currencyCode: 'USD' } },
    ])
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'ENABLED' as const,
    }
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_removed')
  })

  it('is a no_op when the status already matches', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' }, customer: { currencyCode: 'USD' } },
    ])
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'ENABLED' as const,
    }
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })
})

// ─── Plan — daily budget ────────────────────────────────────────────────────────

describe('plan — campaign daily budget', () => {
  const command = {
    platform: 'google' as const,
    ad_account_id: '1234567890',
    type: 'google.campaign.set_daily_budget' as const,
    campaign_id: '111',
    daily_budget: 12.345,
  }

  it('rounds the intended budget to the nearest cent (12.345 -> 12.35)', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' },
        campaignBudget: { id: '999', amountMicros: '10000000', explicitlyShared: false, referenceCount: '1' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.intended.daily_budget).toBeCloseTo(12.35, 5)
      expect(plan.facts.budgetBefore).toBe(10)
      expect(plan.facts.budgetAfter).toBeCloseTo(12.35, 5)
    }
  })

  it('warns when the budget is shared by more than one campaign', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' },
        campaignBudget: { id: '999', amountMicros: '10000000', explicitlyShared: true, referenceCount: '3' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.some((w) => /shared by 3 campaigns/.test(w))).toBe(true)
  })

  it('does not warn when the budget belongs to exactly one campaign', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      {
        campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' },
        campaignBudget: { id: '999', amountMicros: '10000000', explicitlyShared: false, referenceCount: '1' },
        customer: { currencyCode: 'USD' },
      },
    ])
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings).toHaveLength(0)
  })

  it('rejects a budget change when the campaign has no campaign budget at all', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' }, customer: { currencyCode: 'USD' } },
    ])
    const before = await googleAdapter.snapshot(ctx, command)
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_budget')
  })
})

// ─── Plan — keyword.add already_exists ──────────────────────────────────────────

describe('plan — keyword.add', () => {
  const command = {
    platform: 'google' as const,
    ad_account_id: '1234567890',
    type: 'google.keyword.add' as const,
    ad_group_id: '222',
    text: 'Running Shoes',
    match_type: 'EXACT' as const,
  }

  it('matches an existing keyword case-insensitively and rejects the add', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG1' }, campaign: { id: '111', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          adGroupCriterion: { criterionId: '777', status: 'ENABLED', negative: false, keyword: { text: 'running shoes', matchType: 'EXACT' } },
          adGroup: { id: '222' },
          campaign: { id: '111' },
        },
      ])
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_criterion_id).toBe('777')
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('already_exists')
  })

  it('does not match when the match type differs', async () => {
    runGaqlQueryMock
      .mockResolvedValueOnce([{ adGroup: { id: '222', name: 'AG1' }, campaign: { id: '111', biddingStrategyType: 'MANUAL_CPC' }, customer: { currencyCode: 'USD' } }])
      .mockResolvedValueOnce([
        {
          adGroupCriterion: { criterionId: '777', status: 'ENABLED', negative: false, keyword: { text: 'running shoes', matchType: 'PHRASE' } },
          adGroup: { id: '222' },
          campaign: { id: '111' },
        },
      ])
    const before = await googleAdapter.snapshot(ctx, command)
    expect(before?.fields.existing_criterion_id).toBeNull()
    const plan = googleAdapter.plan(command, before!)
    expect(plan.ok).toBe(true)
  })
})

// ─── Execute — operation shape ──────────────────────────────────────────────────

describe('execute — builds the right operation for the provider call', () => {
  it('sends a campaign status update with the correct resourceName and updateMask', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaigns/111' }] })
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'PAUSED' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { status: 'ENABLED' } }
    const result = await googleAdapter.execute(ctx, command, before)
    expect(mutateResourcesMock).toHaveBeenCalledWith(
      '1234567890',
      'r',
      'campaigns',
      [{ update: { resourceName: 'customers/1234567890/campaigns/111', status: 'PAUSED' }, updateMask: 'status' }],
    )
    expect(result.providerRef).toBe('customers/1234567890/campaigns/111')
  })

  it('builds the adGroupCriteria resourceName as adGroupId~criterionId', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroupCriteria/55~66' }] })
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.keyword.set_status' as const,
      ad_group_id: '55',
      criterion_id: '66',
      status: 'PAUSED' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'keyword', resourceId: '66', resourceName: 'K', campaignId: '111', currency: 'USD', fields: { status: 'ENABLED' } }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupCriteria')
    expect((operations as Array<{ update: { resourceName: string } }>)[0].update.resourceName).toBe(
      'customers/1234567890/adGroupCriteria/55~66',
    )
  })

  it('sends the campaign budget update against the budget id from the snapshot, not the campaign id', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/campaignBudgets/999' }] })
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_daily_budget' as const,
      campaign_id: '111',
      daily_budget: 50,
    }
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: '111',
      resourceName: 'C',
      campaignId: '111',
      currency: 'USD',
      fields: { daily_budget: 10, budget_id: '999', budget_shared: false, budget_reference_count: 1 },
    }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('campaignBudgets')
    expect((operations as Array<{ update: { resourceName: string; amountMicros: string } }>)[0].update).toMatchObject({
      resourceName: 'customers/1234567890/campaignBudgets/999',
      amountMicros: '50000000',
    })
  })

  it('sends a keyword.add as a create operation, not an update', async () => {
    mutateResourcesMock.mockResolvedValueOnce({ results: [{ resourceName: 'customers/1234567890/adGroupCriteria/222~888' }] })
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.keyword.add' as const,
      ad_group_id: '222',
      text: 'new keyword',
      match_type: 'BROAD' as const,
    }
    const before: ResourceSnapshot = {
      resourceType: 'keyword',
      resourceId: null,
      resourceName: 'K',
      campaignId: '111',
      currency: 'USD',
      fields: { existing_criterion_id: null },
    }
    await googleAdapter.execute(ctx, command, before)
    const [, , service, operations] = mutateResourcesMock.mock.calls[0]
    expect(service).toBe('adGroupCriteria')
    expect((operations as Array<{ create: unknown }>)[0]).toHaveProperty('create')
  })
})

// ─── Validate ───────────────────────────────────────────────────────────────────

describe('validate — always validateOnly, no write', () => {
  it('passes validateOnly: true through to mutateResources', async () => {
    mutateResourcesMock.mockResolvedValueOnce({})
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'PAUSED' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { status: 'ENABLED' } }
    await googleAdapter.validate(ctx, command, before)
    const [, , , , opts] = mutateResourcesMock.mock.calls[0]
    expect(opts).toEqual({ validateOnly: true })
  })

  it('skips the provider call entirely for a negative_keyword.remove (nothing left to validate)', async () => {
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.negative_keyword.remove' as const,
      level: 'campaign' as const,
      campaign_id: '111',
      criterion_id: '5',
    }
    const before: ResourceSnapshot = { resourceType: 'negative_keyword', resourceId: '5', resourceName: 'N', campaignId: '111', currency: 'USD', fields: {} }
    await googleAdapter.validate(ctx, command, before)
    expect(mutateResourcesMock).not.toHaveBeenCalled()
  })
})

// ─── Verify ──────────────────────────────────────────────────────────────────────

describe('verify', () => {
  it('reports ok when the read-back matches the intended state', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Prospecting', status: 'PAUSED' }, customer: { currencyCode: 'USD' } },
    ])
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'PAUSED' as const,
    }
    const verdict = await googleAdapter.verify(ctx, command, { status: 'PAUSED' }, 'customers/1234567890/campaigns/111')
    expect(verdict.ok).toBe(true)
  })

  it('reports a mismatch when the read-back disagrees with the intended state', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([
      { campaign: { id: '111', name: 'Prospecting', status: 'ENABLED' }, customer: { currencyCode: 'USD' } },
    ])
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'PAUSED' as const,
    }
    const verdict = await googleAdapter.verify(ctx, command, { status: 'PAUSED' }, 'customers/1234567890/campaigns/111')
    expect(verdict.ok).toBe(false)
    expect(verdict.mismatches).toHaveLength(1)
  })
})

// ─── buildRollback ───────────────────────────────────────────────────────────────

describe('buildRollback', () => {
  it('undoes a keyword.add by pausing the newly created criterion, not removing it', () => {
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.keyword.add' as const,
      ad_group_id: '222',
      text: 'new keyword',
      match_type: 'BROAD' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'keyword', resourceId: null, resourceName: 'K', campaignId: '111', currency: 'USD', fields: {} }
    const inverse = googleAdapter.buildRollback(command, before, 'customers/1234567890/adGroupCriteria/222~888')
    expect(inverse).toMatchObject({ type: 'google.keyword.set_status', ad_group_id: '222', criterion_id: '888', status: 'PAUSED' })
  })

  it('undoes a negative_keyword.add with a negative_keyword.remove using the parsed criterion id', () => {
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.negative_keyword.add' as const,
      level: 'campaign' as const,
      campaign_id: '111',
      text: 'competitor',
      match_type: 'PHRASE' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'negative_keyword', resourceId: null, resourceName: 'N', campaignId: '111', currency: 'USD', fields: {} }
    const inverse = googleAdapter.buildRollback(command, before, 'customers/1234567890/campaignCriteria/111~444')
    expect(inverse).toMatchObject({ type: 'google.negative_keyword.remove', level: 'campaign', campaign_id: '111', criterion_id: '444' })
  })

  it('undoes a budget change by restoring the previous budget', () => {
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_daily_budget' as const,
      campaign_id: '111',
      daily_budget: 50,
    }
    const before: ResourceSnapshot = {
      resourceType: 'campaign',
      resourceId: '111',
      resourceName: 'C',
      campaignId: '111',
      currency: 'USD',
      fields: { daily_budget: 20, budget_id: '999' },
    }
    const inverse = googleAdapter.buildRollback(command, before, null)
    expect(inverse).toMatchObject({ type: 'google.campaign.set_daily_budget', campaign_id: '111', daily_budget: 20 })
  })

  it('refuses to build a rollback when the prior status was REMOVED (not a reversible state)', () => {
    const command = {
      platform: 'google' as const,
      ad_account_id: '1234567890',
      type: 'google.campaign.set_status' as const,
      campaign_id: '111',
      status: 'ENABLED' as const,
    }
    const before: ResourceSnapshot = { resourceType: 'campaign', resourceId: '111', resourceName: 'C', campaignId: '111', currency: 'USD', fields: { status: 'REMOVED' } }
    expect(googleAdapter.buildRollback(command, before, null)).toBeNull()
  })
})

describe('criterionIdFromResourceName', () => {
  it('extracts the trailing numeric id after the ~ separator', () => {
    expect(criterionIdFromResourceName('customers/1/adGroupCriteria/22~33')).toBe('33')
  })

  it('returns null for a resourceName with no ~ segment', () => {
    expect(criterionIdFromResourceName('customers/1/campaigns/111')).toBeNull()
    expect(criterionIdFromResourceName(null)).toBeNull()
  })
})

// ─── classifyError ────────────────────────────────────────────────────────────────

describe('classifyError', () => {
  it('treats HTTP 429 as transient', () => {
    const cls = googleAdapter.classifyError(new GoogleAdsError('Too many requests', 'RESOURCE_EXHAUSTED', 429))
    expect(cls.transient).toBe(true)
    expect(cls.auth).toBe(false)
  })

  it('treats a 5xx as transient', () => {
    const cls = googleAdapter.classifyError(new GoogleAdsError('Internal', 'INTERNAL', 500))
    expect(cls.transient).toBe(true)
  })

  it('treats a 400 as not transient', () => {
    const cls = googleAdapter.classifyError(new GoogleAdsError('Bad request', 'INVALID_ARGUMENT', 400))
    expect(cls.transient).toBe(false)
    expect(cls.auth).toBe(false)
  })

  it('flags an auth error (UNAUTHENTICATED) so the connection is marked for reconnect', () => {
    const cls = googleAdapter.classifyError(new GoogleAdsError('Token revoked', 'UNAUTHENTICATED', 401))
    expect(cls.auth).toBe(true)
    expect(cls.transient).toBe(false)
  })
})
