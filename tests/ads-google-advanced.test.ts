import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { advancedGoogleHandler } from '@/lib/ads/providers/google/advanced'
import type { AdapterContext } from '@/lib/ads/providers/types'

const ctx: AdapterContext = {
  orgId: 'org-1',
  adAccountId: '1234567890',
  credential: JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
}

const command = {
  platform: 'google' as const,
  ad_account_id: '1234567890',
  type: 'google.ad_group.set_rotation_mode' as const,
  ad_group_id: '222',
  rotation_mode: 'ROTATE_INDEFINITELY' as const,
}

beforeEach(() => vi.clearAllMocks())

describe('google.ad_group.set_rotation_mode', () => {
  it('previews, validates and writes the narrow ad-group update', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{
      adGroup: { id: '222', name: 'Group', status: 'ENABLED', adRotationMode: 'OPTIMIZE' },
      campaign: { id: '111' },
      customer: { currencyCode: 'USD' },
    }])
    const before = await advancedGoogleHandler.snapshot(ctx, command)
    const plan = advancedGoogleHandler.plan(command, before!)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.diff[0]).toMatchObject({ field: 'rotation_mode', before: 'OPTIMIZE', after: 'ROTATE_INDEFINITELY' })

    mutateResourcesMock.mockResolvedValue({ results: [{ resourceName: 'customers/1234567890/adGroups/222' }] })
    await advancedGoogleHandler.validate(ctx, command, before!)
    expect(mutateResourcesMock).toHaveBeenNthCalledWith(
      1,
      '1234567890',
      'r',
      'adGroups',
      [{ update: { resourceName: 'customers/1234567890/adGroups/222', adRotationMode: 'ROTATE_INDEFINITELY' }, updateMask: 'adRotationMode' }],
      { validateOnly: true },
    )
    const result = await advancedGoogleHandler.execute(ctx, command, before!)
    expect(result.providerRef).toBe('customers/1234567890/adGroups/222')
  })

  it('verifies and can roll back to the prior supported mode', async () => {
    runGaqlQueryMock.mockResolvedValueOnce([{
      adGroup: { id: '222', name: 'Group', status: 'ENABLED', adRotationMode: 'ROTATE_INDEFINITELY' },
      campaign: { id: '111' },
      customer: { currencyCode: 'USD' },
    }])
    const verdict = await advancedGoogleHandler.verify(ctx, command, { rotation_mode: 'ROTATE_INDEFINITELY' }, null)
    expect(verdict.ok).toBe(true)
    expect(advancedGoogleHandler.buildRollback(command, {
      resourceType: 'ad_group', resourceId: '222', resourceName: 'Group', campaignId: '111', currency: 'USD', fields: { rotation_mode: 'OPTIMIZE' },
    }, null)).toMatchObject({ rotation_mode: 'OPTIMIZE' })
  })
})
