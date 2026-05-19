// src/lib/rate-limit.ts
// Fixed-window rate limiter backed by the singleton Redis client.
//
// Pattern: INCR a per-key counter. If the counter is 1 (first hit in the
// window) set EXPIRE so the key self-cleans. Once the counter exceeds
// `limit`, reject until the window expires.
//
// Fail-open contract: if Redis is not ready or any operation throws, the
// caller is allowed through (with a console warning). The booking flow must
// not break when Upstash is offline.

import redis from '@/lib/redis'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number // Unix ms timestamp; 0 when fail-open or unknown
}

/**
 * rateLimit — fixed-window counter per `key`.
 *
 * @param key            opaque identifier (e.g. `booking:1.2.3.4:event-uuid`)
 * @param limit          max requests allowed in the window
 * @param windowSeconds  window length in seconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  // Fail open when Redis is not connected (build time, Upstash down, missing
  // REDIS_URL in env). Booking must not break because Redis is unavailable.
  if (!redis.isReady) {
    console.warn('[rate-limit] redis not ready, failing open for', key)
    return { allowed: true, remaining: limit, resetAt: 0 }
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
    // Any Redis exception → fail open. We never want to block legitimate
    // traffic because of a transient Redis issue.
    console.warn(
      '[rate-limit] redis error, failing open for',
      key,
      err instanceof Error ? err.message : err,
    )
    return { allowed: true, remaining: limit, resetAt: 0 }
  }
}
