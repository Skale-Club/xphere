import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { getBookingsForList, getBookingsForRange } from '@/app/(dashboard)/calendar/_actions/bookings'

const USER = { id: 'user-1' }

function makeQuery(result: { data: unknown; error: unknown }) {
  const q: any = {}
  const methods = ['select', 'eq', 'gte', 'lte', 'lt', 'gt', 'in', 'order', 'limit', 'range']
  for (const m of methods) q[m] = vi.fn(() => q)
  q.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return q
}

describe('getBookingsForList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Test 1: bounds every section with .limit(50) — no unbounded select', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    const fakeClient = { from: vi.fn(() => makeQuery({ data: [], error: null })) }
    vi.mocked(createClient).mockResolvedValue(fakeClient as any)

    await getBookingsForList()

    const proxies = fakeClient.from.mock.results.map((r: any) => r.value)
    expect(proxies).toHaveLength(3)
    for (const p of proxies) expect(p.limit).toHaveBeenCalledWith(50)
  })

  it("Test 2: the 'past' section query includes 'showed' in its status filter", async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    const fakeClient = { from: vi.fn(() => makeQuery({ data: [], error: null })) }
    vi.mocked(createClient).mockResolvedValue(fakeClient as any)

    await getBookingsForList()

    const proxies = fakeClient.from.mock.results.map((r: any) => r.value)
    // Promise.all([upcoming, past, cancelled]) evaluates left-to-right —
    // index 1 is the 'past' section.
    expect(proxies[1].in).toHaveBeenCalledWith('status', ['confirmed', 'no_show', 'showed'])
  })

  it('Test 3: returns bucketed sections from each query result', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    const upcomingRow = { id: 'b1', status: 'confirmed', start_at: '2099-01-01T00:00:00Z' }
    const pastRow = { id: 'b2', status: 'showed', start_at: '2020-01-01T00:00:00Z' }
    const cancelledRow = { id: 'b3', status: 'cancelled', start_at: '2020-01-01T00:00:00Z' }
    const results = [
      { data: [upcomingRow], error: null },
      { data: [pastRow], error: null },
      { data: [cancelledRow], error: null },
    ]
    let call = 0
    const fakeClient = { from: vi.fn(() => makeQuery(results[call++])) }
    vi.mocked(createClient).mockResolvedValue(fakeClient as any)

    const result = await getBookingsForList()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.upcoming).toEqual([upcomingRow])
      expect(result.data.past).toEqual([pastRow])
      expect(result.data.cancelled).toEqual([cancelledRow])
    }
  })
})

describe('getBookingsForRange', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Test 4: applies gte/lte date bounds from the given range', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    const fakeClient = { from: vi.fn(() => makeQuery({ data: [], error: null })) }
    vi.mocked(createClient).mockResolvedValue(fakeClient as any)

    await getBookingsForRange({ from: '2026-01-01T00:00:00Z', to: '2026-01-08T00:00:00Z' })

    const proxy = fakeClient.from.mock.results[0].value
    expect(proxy.gte).toHaveBeenCalledWith('start_at', '2026-01-01T00:00:00Z')
    expect(proxy.lte).toHaveBeenCalledWith('start_at', '2026-01-08T00:00:00Z')
  })
})
