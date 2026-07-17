import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/redis with a controllable { isReady, incr, expire, ttl } —
// tests must never depend on live Redis (research Pitfall 2).
// ---------------------------------------------------------------------------
const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    isReady: false,
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  },
}))

vi.mock('@/lib/redis', () => ({ default: mockRedis }))

import { rateLimit, __resetMemoryStoreForTests, __memoryStoreSizeForTests } from '@/lib/rate-limit'

beforeEach(() => {
  vi.clearAllMocks()
  mockRedis.isReady = false
  __resetMemoryStoreForTests()
})

describe('rateLimit backward compatibility (3-arg calls, no opts)', () => {
  it('seam 1: redis not ready -> fails open exactly as before', async () => {
    const rl = await rateLimit('k', 5, 60)
    expect(rl).toEqual({ allowed: true, remaining: 5, resetAt: 0 })
  })

  it('seam 2: redis throws -> fails open exactly as before', async () => {
    mockRedis.isReady = true
    mockRedis.incr.mockRejectedValue(new Error('boom'))
    const rl = await rateLimit('k', 5, 60)
    expect(rl.allowed).toBe(true)
  })
})

describe("failMode 'closed'", () => {
  it('seam 1: redis not ready -> denies', async () => {
    const rl = await rateLimit('k', 5, 60, { failMode: 'closed' })
    expect(rl).toEqual({ allowed: false, remaining: 0, resetAt: 0 })
  })

  it('seam 2: redis throws -> denies', async () => {
    mockRedis.isReady = true
    mockRedis.incr.mockRejectedValue(new Error('boom'))
    const rl = await rateLimit('k', 5, 60, { failMode: 'closed' })
    expect(rl.allowed).toBe(false)
  })
})

describe("failMode 'memory'", () => {
  it('seam 1: counts per key in-process, denies the (limit+1)th call', async () => {
    for (let i = 0; i < 3; i++) {
      const rl = await rateLimit('mk', 3, 60, { failMode: 'memory' })
      expect(rl.allowed).toBe(true)
    }
    const fourth = await rateLimit('mk', 3, 60, { failMode: 'memory' })
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
  })

  it('window reset: allows again after windowSeconds elapses', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      for (let i = 0; i < 3; i++) {
        await rateLimit('reset-key', 3, 60, { failMode: 'memory' })
      }
      const denied = await rateLimit('reset-key', 3, 60, { failMode: 'memory' })
      expect(denied.allowed).toBe(false)

      vi.setSystemTime(60_001) // past the 60s window
      const allowedAgain = await rateLimit('reset-key', 3, 60, { failMode: 'memory' })
      expect(allowedAgain.allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('seam 2: redis throws -> memory mode counts (same store as seam 1)', async () => {
    mockRedis.isReady = true
    mockRedis.incr.mockRejectedValue(new Error('boom'))
    const first = await rateLimit('err-key', 1, 60, { failMode: 'memory' })
    expect(first.allowed).toBe(true)
    const second = await rateLimit('err-key', 1, 60, { failMode: 'memory' })
    expect(second.allowed).toBe(false)
  })

  it('key isolation: different keys count independently', async () => {
    await rateLimit('key-a', 1, 60, { failMode: 'memory' })
    const a2 = await rateLimit('key-a', 1, 60, { failMode: 'memory' })
    const b1 = await rateLimit('key-b', 1, 60, { failMode: 'memory' })
    expect(a2.allowed).toBe(false)
    expect(b1.allowed).toBe(true)
  })

  it('bounding: memory store never exceeds 10,000 entries', async () => {
    for (let i = 0; i < 10_001; i++) {
      await rateLimit(`bound-key-${i}`, 5, 60, { failMode: 'memory' })
    }
    expect(__memoryStoreSizeForTests()).toBeLessThanOrEqual(10_000)
  })
})

describe('redis healthy path (identical for every failMode)', () => {
  it('uses redis INCR/EXPIRE/TTL and never touches the memory store', async () => {
    mockRedis.isReady = true
    mockRedis.incr.mockResolvedValue(1)
    mockRedis.expire.mockResolvedValue(true)
    mockRedis.ttl.mockResolvedValue(60)

    const rl = await rateLimit('healthy-key', 5, 60, { failMode: 'memory' })

    expect(rl.allowed).toBe(true)
    expect(mockRedis.incr).toHaveBeenCalledWith('rl:healthy-key')
    expect(__memoryStoreSizeForTests()).toBe(0)
  })
})
