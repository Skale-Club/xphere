// The nightly /api/cron/ads-tick runs the outcome reviewer after the daily
// snapshot. The reviewer is a bonus on top of the capture: it must run after
// the snapshot, honour skip_outcomes, and never turn a good tick into a 500.
// Same hermetic mock layout as tests/ads-tick-route.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const order = vi.hoisted(() => ({ calls: [] as string[] }))

const { reviewMock, captureMock } = vi.hoisted(() => ({
  reviewMock: vi.fn(),
  captureMock: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => {
      const api = {
        select: () => api,
        in: () => api,
        not: () => api,
        neq: () => api,
        eq: () => api,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
      }
      return api
    },
  })),
}))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() }),
}))
vi.mock('@/lib/api-error', () => ({ captureApiError: vi.fn() }))
// Expiry notifications have their own suite (tests/ads-expiry-notify.test.ts).
vi.mock('@/lib/ads/expiry-notify', () => ({ planExpiryNotices: vi.fn(() => []), sendExpiryNotices: vi.fn(async () => 0) }))
vi.mock('@/lib/ads/connection-health', () => ({
  EXPIRY_WARNING_DAYS: 7,
  daysUntilExpiry: () => null,
  markConnectionError: vi.fn(async () => {}),
}))
vi.mock('@/lib/ads/snapshot-daily', () => ({ captureDailyInsights: captureMock }))
vi.mock('@/lib/ads/outcomes', () => ({ reviewChangeOutcomes: reviewMock }))

async function importRoute() {
  vi.resetModules()
  process.env.CRON_SECRET = 'test-ads-tick-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  return import('@/app/api/cron/ads-tick/route')
}

const request = (qs = '') =>
  new Request(`http://localhost/api/cron/ads-tick${qs}`, { headers: { Authorization: 'Bearer test-ads-tick-secret' } })

beforeEach(() => {
  order.calls = []
  reviewMock.mockReset()
  captureMock.mockReset()
  captureMock.mockImplementation(async () => {
    order.calls.push('snapshot')
    return []
  })
  reviewMock.mockImplementation(async () => {
    order.calls.push('outcomes')
    return { reviewed: 2, memories: 1, noData: 1, skipped: 0, expired: 0 }
  })
})

describe('GET /api/cron/ads-tick — outcome review', () => {
  it('runs the reviewer after the snapshot and reports its counts', async () => {
    const { GET } = await importRoute()
    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(order.calls).toEqual(['snapshot', 'outcomes'])
    expect(body.outcomes).toEqual({ reviewed: 2, memories: 1, noData: 1, skipped: 0, expired: 0 })
    expect(reviewMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
  })

  it('passes org_id through for a manual single-org run', async () => {
    const { GET } = await importRoute()
    await GET(request('?org_id=org-9'))
    expect(reviewMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-9' }))
  })

  it('a reviewer failure does not fail the tick', async () => {
    reviewMock.mockRejectedValueOnce(new Error('db down'))
    const { GET } = await importRoute()
    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.outcomes.error).toBe('Outcome review failed')
  })

  it('skip_outcomes=true skips it', async () => {
    const { GET } = await importRoute()
    const res = await GET(request('?skip_outcomes=true'))
    const body = await res.json()
    expect(reviewMock).not.toHaveBeenCalled()
    expect(body.outcomes).toEqual({ disabled: true })
  })
})
