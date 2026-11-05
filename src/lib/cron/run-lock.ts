// Run lock for cron jobs that must never overlap (long jobs that respond
// immediately and work inside `after()`).
//
// There is no lock table and this change adds no migration, so the lock is:
//   1. an in-process lease (globalThis map with a TTL): covers every overlap
//      inside one container, which is the normal case (single app container);
//   2. when REDIS_URL is set and the client is ready, a Redis `SET NX PX` lease
//      on top of it: covers the brief two-container window of a rolling deploy.
// Redis failures fall back to the in-process lease only; they never block a run.
//
// The lease always has a TTL, so a crashed run cannot wedge the job forever:
// the in-process entry dies with the process and the Redis key expires.
//
// Data-level idempotency is NOT delegated to this lock. The audience sync still
// claims each audience in the database (claim_meta_audience_sync) and CAPI
// events are deduplicated by Meta on event_id; the lock only avoids wasted and
// concurrent work.

import { randomUUID } from 'node:crypto'

export interface RedisLeaseClient {
  isReady: boolean
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
}

export interface RunLock {
  release(): Promise<void>
}

export interface AcquireOptions {
  /** Inject a Redis-like client (tests). `null` forces in-process only. */
  redis?: RedisLeaseClient | null
  now?: () => number
}

type Leases = Map<string, { token: string; expiresAt: number }>

declare global {
  // eslint-disable-next-line no-var
  var __xphereCronLeases: Leases | undefined
}

function leases(): Leases {
  return (globalThis.__xphereCronLeases ??= new Map())
}

async function defaultRedis(): Promise<RedisLeaseClient | null> {
  if (!process.env.REDIS_URL) return null
  try {
    const mod = await import('@/lib/redis')
    const client = mod.default as unknown as RedisLeaseClient
    return client?.isReady ? client : null
  } catch {
    return null
  }
}

/**
 * Try to take the lease `name` for `ttlMs`. Returns a handle to release it, or
 * null when another run already holds it.
 */
export async function acquireRunLock(
  name: string,
  ttlMs: number,
  options: AcquireOptions = {},
): Promise<RunLock | null> {
  const now = options.now ?? Date.now
  const map = leases()
  const held = map.get(name)
  if (held && held.expiresAt > now()) return null

  const token = randomUUID()
  // Claim the in-process slot synchronously (before any await) so two concurrent
  // requests in this process cannot both pass the check above.
  map.set(name, { token, expiresAt: now() + ttlMs })

  const redis = options.redis === undefined ? await defaultRedis() : options.redis
  const redisKey = `xphere:cron-lock:${name}`
  let redisHeld = false
  if (redis && redis.isReady) {
    try {
      const ok = await redis.set(redisKey, token, { NX: true, PX: ttlMs })
      if (ok !== 'OK') {
        // Another container holds it.
        if (map.get(name)?.token === token) map.delete(name)
        return null
      }
      redisHeld = true
    } catch (err) {
      console.error('[run-lock] redis unavailable, using in-process lease only:', err instanceof Error ? err.message : err)
    }
  }

  let released = false
  return {
    async release() {
      if (released) return
      released = true
      if (map.get(name)?.token === token) map.delete(name)
      if (redis && redisHeld) {
        try {
          if ((await redis.get(redisKey)) === token) await redis.del(redisKey)
        } catch {
          // TTL will clear it.
        }
      }
    },
  }
}

/** Test helper: drop every in-process lease. */
export function resetRunLocksForTests(): void {
  globalThis.__xphereCronLeases = undefined
}
