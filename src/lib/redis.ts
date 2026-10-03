// src/lib/redis.ts
// Redis singleton client for chat session storage (Phase 2+)
// Uses globalThis guard to survive Next.js HMR module re-evaluations in development.
// Pattern: mirrors src/lib/supabase/server.ts singleton approach.
import { createClient, type RedisClientType } from 'redis'

declare global {
  // var is required inside declare global (not let/const) | TypeScript strict mode rule
  // eslint-disable-next-line no-var
  var _redisClient: RedisClientType | undefined
}

// A refused connection to a host that resolves to both IPv4 and IPv6 (e.g.
// `localhost`) surfaces as an AggregateError whose own `.message` is empty —
// which is how production logged hundreds of bare `[redis] error:` lines.
// Spell out the code/address of each underlying error instead.
export function describeRedisError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return err.errors.map(describeRedisError).join('; ')
  }
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException & { address?: string; port?: number }
    const where = e.address ? ` ${e.address}${e.port ? `:${e.port}` : ''}` : ''
    const parts = [e.code, err.message].filter(Boolean).join(' ')
    return `${err.name}${parts ? `: ${parts}` : ''}${where}`
  }
  return String(err)
}

function buildClient(): RedisClientType {
  const url = process.env.REDIS_URL

  const client = createClient({ url }) as RedisClientType

  // Without REDIS_URL the client would default to localhost:6379 and retry
  // forever, flooding the log. Leave it unconnected instead: `isReady` stays
  // false, which every caller already treats as "Redis unavailable".
  if (!url) {
    console.warn('[redis] REDIS_URL is not set; Redis features are disabled')
    return client
  }

  // D-07: Log errors but do not crash the app. Callers check redis.isReady before use.
  // The client emits an error on every reconnect attempt, so repeat messages
  // are suppressed until the connection recovers.
  let lastError = ''
  client.on('error', (err: unknown) => {
    const message = describeRedisError(err)
    if (message === lastError) return
    lastError = message
    console.error('[redis] error:', message)
  })
  client.on('ready', () => {
    if (lastError) console.info('[redis] connection recovered')
    lastError = ''
  })

  void client.connect().catch((err: unknown) => {
    console.error('[redis] connect failed:', describeRedisError(err))
  })

  return client
}

// In development: attach to globalThis so HMR module re-evaluations reuse the same
// connection instead of opening a new one on every file save.
// In production: module is evaluated once per process; no globalThis guard needed.
const redis: RedisClientType =
  process.env.NODE_ENV !== 'production'
    ? (global._redisClient ??= buildClient())
    : buildClient()

export default redis
