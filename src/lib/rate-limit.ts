// src/lib/rate-limit.ts
// Fixed-window rate limiter backed by the singleton Redis client.
//
// Pattern: INCR a per-key counter. If the counter is 1 (first hit in the
// window) set EXPIRE so the key self-cleans. Once the counter exceeds
// `limit`, reject until the window expires.
//
// Fail-open contract (default, failMode 'open'): if Redis is not ready or
// any operation throws, the caller is allowed through (with a console
// warning). The booking flow must not break when Upstash is offline.
//
// failMode extension (CHT-01): callers may opt into 'memory' (per-instance
// in-process fallback counter — coarse but non-zero protection) or 'closed'
// (deny outright — reserved for fail-closed commerce write budgets). Every
// pre-existing 3-arg call site is unaffected: default failMode is 'open',
// which reproduces the original behavior exactly.

import redis from '@/lib/redis'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // Unix ms timestamp; 0 when fail-open or unknown
}

export type RateLimitFailMode = 'open' | 'memory' | 'closed'

// ---------------------------------------------------------------------------
// In-process memory fallback (failMode 'memory')
//
// NOTE ON WORDING: the phase contract/requirements describe this as a
// "token-bucket" fallback; the locked CONTEXT decision for this phase calls
// for a "fixed-window Map" instead. This implementation follows the CONTEXT
// decision (fixed-window, matching the Redis-backed algorithm above) — the
// wording drift is intentional, not a bug.
//
// TRADE-OFF (accepted, do not "fix"): memory-mode windows are per-instance
// and reset on deploy/restart/crash. With Redis up this never applies (Redis
// TTL is authoritative); it's only the degraded-mode behavior, and it is
// still strictly better than fail-open for the callers that opt into it.
// ---------------------------------------------------------------------------

interface MemoryEntry {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, MemoryEntry>()
const MEMORY_STORE_MAX = 10_000

function memoryRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  let entry = memoryStore.get(key)
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 }
  }
  entry.count += 1
  memoryStore.delete(key) // re-insert so Map insertion order doubles as LRU
  memoryStore.set(key, entry)

  if (memoryStore.size > MEMORY_STORE_MAX) {
    // Sweep expired entries first...
    for (const [k, e] of memoryStore) {
      if (now >= e.resetAt) memoryStore.delete(k)
    }
    // ...then evict oldest-inserted until back under the bound.
    while (memoryStore.size > MEMORY_STORE_MAX) {
      const oldest = memoryStore.keys().next().value
      if (oldest === undefined) break
      memoryStore.delete(oldest)
    }
  }

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  }
}

function onRedisUnavailable(
  key: string,
  limit: number,
  windowSeconds: number,
  failMode: RateLimitFailMode,
): RateLimitResult {
  if (failMode === 'closed') {
    return { allowed: false, remaining: 0, resetAt: 0 }
  }
  if (failMode === 'memory') {
    return memoryRateLimit(key, limit, windowSeconds)
  }
  // 'open' — unchanged legacy behavior
  return { allowed: true, remaining: limit, resetAt: 0 }
}

/** Test-only: clear the in-process fallback store between tests. */
export function __resetMemoryStoreForTests(): void {
  memoryStore.clear()
}

/** Test-only: introspect fallback store size (bounding tests). */
export function __memoryStoreSizeForTests(): number {
  return memoryStore.size
}

/**
 * rateLimit | fixed-window counter per `key`.
 *
 * @param key            opaque identifier (e.g. `booking:1.2.3.4:event-uuid`)
 * @param limit          max requests allowed in the window
 * @param windowSeconds  window length in seconds
 * @param opts.failMode  behavior when Redis is unavailable/erroring:
 *                       'open' (default, legacy) | 'memory' | 'closed'
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts?: { failMode?: RateLimitFailMode },
): Promise<RateLimitResult> {
  const failMode = opts?.failMode ?? 'open'

  // Redis not connected (build time, Upstash down, missing REDIS_URL in env).
  if (!redis.isReady) {
    console.warn('[rate-limit] redis not ready, failMode', failMode, 'for', key)
    return onRedisUnavailable(key, limit, windowSeconds, failMode)
  }

  const fullKey = `rl:${key}`

  try {
    const count = await redis.incr(fullKey)

    // On the first hit in this window, set the TTL.
    if (count === 1) {
      await redis.expire(fullKey, windowSeconds)
    }

    const ttl = await redis.ttl(fullKey)
    const resetAt = ttl > 0 ? Date.now() + ttl * 1000 : 0
    const remaining = Math.max(0, limit - count)

    return {
      allowed: count <= limit,
      remaining,
      resetAt,
    }
  } catch (err) {
    // Any Redis exception → route through the same failMode switch as a
    // disconnected client. We never silently fail open unless failMode is
    // 'open' (the default, matching legacy behavior).
    console.warn(
      '[rate-limit] redis error, failMode',
      failMode,
      'for',
      key,
      err instanceof Error ? err.message : err,
    )
    return onRedisUnavailable(key, limit, windowSeconds, failMode)
  }
}
