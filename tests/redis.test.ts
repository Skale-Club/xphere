import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Redis singleton — src/lib/redis.ts', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exports a default redis client object', async () => {
    // Stub REDIS_URL to a local value so connect() does not throw on missing env
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const mod = await import('@/lib/redis')
    expect(mod.default).toBeDefined()
  })

  it('module loads without crashing when REDIS_URL is set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    // Should not throw during module evaluation
    await expect(import('@/lib/redis')).resolves.toBeDefined()
  })
})

describe('Redis without REDIS_URL', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    delete globalThis._redisClient
  })

  it('does not connect (no localhost:6379 retry loop) and reports not ready', async () => {
    vi.stubEnv('REDIS_URL', '')
    const { default: redis } = await import('@/lib/redis')
    expect(redis.isOpen).toBe(false)
    expect(redis.isReady).toBe(false)
  })
})

describe('describeRedisError', () => {
  it('spells out an AggregateError whose own message is empty', async () => {
    const { describeRedisError } = await import('@/lib/redis')
    const v6 = Object.assign(new Error('connect ECONNREFUSED ::1:6379'), {
      code: 'ECONNREFUSED',
      address: '::1',
      port: 6379,
    })
    const v4 = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
      address: '127.0.0.1',
      port: 6379,
    })
    const msg = describeRedisError(new AggregateError([v6, v4], ''))
    expect(msg).toContain('ECONNREFUSED')
    expect(msg).toContain('::1:6379')
    expect(msg).toContain('127.0.0.1:6379')
  })

  it('falls back to the error name when message and code are empty', async () => {
    const { describeRedisError } = await import('@/lib/redis')
    expect(describeRedisError(new Error(''))).toBe('Error')
  })
})
