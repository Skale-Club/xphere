import { describe, expect, it } from 'vitest'
import { summarizeAdsConnection, type AdsConnectionSummaryRow } from '@/lib/ads/expiry'
import { safeReturnPath } from '@/lib/ads/meta-oauth'

const NOW = new Date('2026-10-07T12:00:00Z')
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000 + 3_600_000).toISOString()

function row(overrides: Partial<AdsConnectionSummaryRow> = {}): AdsConnectionSummaryRow {
  return {
    ad_account_id: 'act_1',
    ad_account_name: 'Skale Club | U$',
    status: 'active',
    health: 'ok',
    token_expires_at: inDays(32),
    ...overrides,
  }
}

describe('summarizeAdsConnection', () => {
  it('reports not connected with no rows', () => {
    expect(summarizeAdsConnection([], NOW)).toMatchObject({ state: 'not_connected', accountCount: 0 })
  })

  it('is ok far from expiry and names the selected accounts', () => {
    const summary = summarizeAdsConnection([row(), row({ ad_account_id: 'act_2', ad_account_name: 'Other', status: 'available' })], NOW)
    expect(summary).toMatchObject({ state: 'ok', accountCount: 2, activeAccounts: ['Skale Club | U$'], daysLeft: 32 })
  })

  it('warns inside the 14-day window and flags an expired token', () => {
    expect(summarizeAdsConnection([row({ token_expires_at: inDays(14) })], NOW)).toMatchObject({ state: 'expiring', daysLeft: 14 })
    expect(summarizeAdsConnection([row({ token_expires_at: inDays(15) })], NOW).state).toBe('ok')
    expect(summarizeAdsConnection([row({ token_expires_at: inDays(-2) })], NOW).state).toBe('expired')
  })

  it('judges only the accounts in use when some are selected', () => {
    const summary = summarizeAdsConnection([
      row({ token_expires_at: inDays(40) }),
      row({ ad_account_id: 'act_2', status: 'available', health: 'error', token_expires_at: inDays(2) }),
    ], NOW)
    expect(summary).toMatchObject({ state: 'ok', daysLeft: 40 })
  })

  it('reports a rejected credential as broken', () => {
    expect(summarizeAdsConnection([row({ health: 'error' })], NOW).state).toBe('broken')
  })
})

describe('safeReturnPath', () => {
  it('accepts plain dashboard paths', () => {
    expect(safeReturnPath('/settings/integrations')).toBe('/settings/integrations')
    expect(safeReturnPath('/ads')).toBe('/ads')
  })

  it.each([
    null, '', 'settings', '//evil.example', 'https://evil.example', '/ads?x=1', '/a/../b', '/\\evil', `/${'a'.repeat(250)}`,
  ])('rejects %p', (value) => {
    expect(safeReturnPath(value)).toBeNull()
  })
})
