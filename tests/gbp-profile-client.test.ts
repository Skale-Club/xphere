import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { diffProfiles, flattenProfile, periodsToRows } from '@/lib/gbp/profile'
import { buildReplyPrompt } from '@/lib/gbp/replies'
import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

vi.mock('@/lib/crypto', () => ({
  encrypt: async (s: string) => `enc:${s}`,
  decrypt: async (s: string) => s.replace(/^enc:/, ''),
}))

import { GbpApiError, GbpClient } from '@/lib/gbp/client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('profile helpers', () => {
  it('reads Google opening hours, including overnight and 24h closes', () => {
    const periods = [
      { openDay: 'FRIDAY', openTime: { hours: 18 }, closeDay: 'SATURDAY', closeTime: { hours: 2 } },
      { openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 24 } },
    ]
    expect(periodsToRows(periods)).toEqual([
      { day: 'MONDAY', open: '09:00', close: '24:00' },
      { day: 'FRIDAY', open: '18:00', close: '02:00' },
    ])
  })

  it('flattens a location and diffs only what changed', () => {
    const flat = flattenProfile({
      name: 'locations/1',
      title: 'Bigode',
      profile: { description: 'd' },
      categories: { primaryCategory: { displayName: 'Barber shop' }, additionalCategories: [{ displayName: 'Hair salon' }] },
      storefrontAddress: { addressLines: ['Rua A, 12'], locality: 'São Paulo' },
    })
    expect(flat).toMatchObject({ title: 'Bigode', description: 'd', primaryCategory: 'Barber shop', additionalCategories: ['Hair salon'], address: 'Rua A, 12, São Paulo' })
    expect(diffProfiles(flat, { ...flat, description: 'e' })).toEqual([{ field: 'description', before: 'd', after: 'e' }])
  })
})

describe('reply prompt', () => {
  it('carries tone, signature and the negative-review rules', () => {
    const p = buildReplyPrompt({
      businessName: 'Bigode',
      review: { rating: 2, comment: 'Demorou muito', reviewer_name: 'Ana' },
      settings: { tone: 'friendly', signature: '— Equipe Bigode', instructions: null, autoReplyPositive: false, autoReplyMinRating: 5 },
    })
    expect(p).toContain('Tone: friendly')
    expect(p).toContain('— Equipe Bigode')
    expect(p).toContain('same language as the review')
    expect(p).toContain('Rating: 2 of 5')
    expect(p).toContain('Never offer refunds')
  })
})

describe('GbpClient', () => {
  function seed(expiresInMs: number) {
    const db = new FakeDb()
    db.rows('gbp_connections').push({
      id: 'c1',
      status: 'active',
      encrypted_tokens: `enc:${JSON.stringify({ access_token: 'old', refresh_token: 'refresh' })}`,
      token_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    })
    return db
  }

  it('refreshes an expiring token before calling Google', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url)
        if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }))
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer new')
        return new Response(JSON.stringify({ accounts: [{ name: 'accounts/1' }] }))
      }),
    )
    const db = seed(10_000)
    const client = new GbpClient(db as unknown as SupabaseClient<Database>, 'c1')
    expect(await client.listAccounts()).toEqual([{ name: 'accounts/1' }])
    expect(calls[0]).toContain('oauth2.googleapis.com/token')
    expect(db.rows('gbp_connections')[0]).toMatchObject({ status: 'active' })
  })

  it('marks the connection broken when Google revokes the refresh token', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    const db = seed(0)
    const client = new GbpClient(db as unknown as SupabaseClient<Database>, 'c1')
    await expect(client.listAccounts()).rejects.toMatchObject({ kind: 'auth' })
    expect(db.rows('gbp_connections')[0]).toMatchObject({ status: 'error' })
  })

  it('maps HTTP errors to kinds', async () => {
    const db = seed(3_600_000)
    const client = new GbpClient(db as unknown as SupabaseClient<Database>, 'c1')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 404 })))
    await expect(client.getReview('x')).rejects.toBeInstanceOf(GbpApiError)
    await expect(client.getReview('x')).rejects.toMatchObject({ kind: 'not_found' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    await expect(client.getReview('x')).rejects.toMatchObject({ kind: 'quota' })
  })

  it('parses daily performance series', async () => {
    const db = seed(3_600_000)
    const client = new GbpClient(db as unknown as SupabaseClient<Database>, 'c1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            multiDailyMetricTimeSeries: [
              { dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: '4' }, { date: { year: 2026, month: 9, day: 2 } }] } }] },
            ],
          }),
        ),
      ),
    )
    expect(await client.fetchDailyMetrics('locations/1', ['CALL_CLICKS'], new Date('2026-09-01'), new Date('2026-09-02'))).toEqual([
      { metric: 'CALL_CLICKS', date: '2026-09-01', value: 4 },
      { metric: 'CALL_CLICKS', date: '2026-09-02', value: 0 },
    ])
  })
})
