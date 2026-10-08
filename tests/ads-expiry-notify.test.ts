import { describe, expect, it, vi } from 'vitest'

const insertNotification = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/notifications/insert', () => ({ insertNotification }))

import { planExpiryNotices, sendExpiryNotices, type ExpiryCandidate } from '@/lib/ads/expiry-notify'

function candidate(overrides: Partial<ExpiryCandidate> = {}): ExpiryCandidate {
  return {
    org_id: 'org-1',
    platform: 'meta',
    ad_account_id: 'act_1',
    ad_account_name: 'Skale Club | U$',
    status: 'active',
    health: 'ok',
    daysLeft: 14,
    ...overrides,
  }
}

describe('planExpiryNotices', () => {
  it('notifies on the countdown days only', () => {
    for (const days of [14, 7, 3, 1]) {
      expect(planExpiryNotices([candidate({ daysLeft: days })])).toEqual([
        { orgId: 'org-1', platform: 'meta', kind: 'expiring', daysLeft: days, accounts: ['Skale Club | U$'] },
      ])
    }
    for (const days of [30, 13, 8, 6, 2]) {
      expect(planExpiryNotices([candidate({ daysLeft: days })])).toEqual([])
    }
  })

  it('announces an expiry once, on the night it is first seen', () => {
    expect(planExpiryNotices([candidate({ daysLeft: 0, health: 'ok' })])).toMatchObject([{ kind: 'expired', daysLeft: 0 }])
    expect(planExpiryNotices([candidate({ daysLeft: -1, health: 'error' })])).toEqual([])
  })

  it('ignores connections the org does not use', () => {
    expect(planExpiryNotices([candidate({ status: 'available' })])).toEqual([])
  })

  it('groups the accounts sharing one token into a single notice per org and platform', () => {
    const notices = planExpiryNotices([
      candidate({ ad_account_id: 'act_1', ad_account_name: 'A' }),
      candidate({ ad_account_id: 'act_2', ad_account_name: null }),
      candidate({ org_id: 'org-2', ad_account_id: 'act_3', ad_account_name: 'C' }),
    ])
    expect(notices).toEqual([
      { orgId: 'org-1', platform: 'meta', kind: 'expiring', daysLeft: 14, accounts: ['A', 'act_2'] },
      { orgId: 'org-2', platform: 'meta', kind: 'expiring', daysLeft: 14, accounts: ['C'] },
    ])
  })
})

describe('sendExpiryNotices', () => {
  it('targets owners and admins only, and skips an org without any', async () => {
    const roles: unknown[] = []
    const supabase = {
      from: () => ({
        select: () => ({
          eq: (_col: string, orgId: string) => ({
            in: async (_c: string, values: unknown[]) => {
              roles.push(values)
              return { data: orgId === 'org-1' ? [{ user_id: 'owner-1' }, { user_id: 'admin-1' }] : [], error: null }
            },
          }),
        }),
      }),
    }
    const sent = await sendExpiryNotices(supabase as never, [
      { orgId: 'org-1', platform: 'meta', kind: 'expiring', daysLeft: 7, accounts: ['A'] },
      { orgId: 'org-2', platform: 'meta', kind: 'expired', daysLeft: 0, accounts: ['B'] },
    ])
    expect(sent).toBe(1)
    expect(roles[0]).toEqual(['owner', 'admin'])
    expect(insertNotification).toHaveBeenCalledOnce()
    expect(insertNotification).toHaveBeenCalledWith(
      'org-1',
      'ads_connection_expiring',
      { platform: 'meta', kind: 'expiring', days_left: 7, accounts: ['A'], account_count: 1 },
      ['owner-1', 'admin-1'],
    )
  })
})
