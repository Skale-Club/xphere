// Database exit seam (docs/database/execution-plan.md, item A4).
//
// Everything here is inert until env says otherwise, so production is unchanged on merge:
//
//   DB_JWT_SECRET       The app signs the database tokens itself (HS256): the per-user token in
//                       mintSupabaseJwt and a long-lived service_role token used as the service
//                       key. PostgREST must be configured with the same secret.
//   SUPABASE_REST_URL   Where server-side supabase-js clients reach PostgREST (for example
//                       http://xphere-postgrest:3000). supabase-js always calls
//                       `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/...`; PostgREST serves at the root,
//                       so that prefix is rewritten. Nothing else is.
//
// Server only. Not imported by browser code. No 'server-only' marker so scripts can use it too.

import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ─── JWT signing ─────────────────────────────────────────────────────────────

/** Lifetime of a per-user token, the same as the Supabase-issued one it replaces. */
export const USER_JWT_TTL_SECONDS = 60 * 60
/** The service_role token is signed once per process and effectively never expires. */
export const SERVICE_JWT_TTL_SECONDS = 10 * 365 * 24 * 60 * 60

export function dbJwtSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.DB_JWT_SECRET
  return secret && secret.length > 0 ? secret : null
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** HS256 JWT. Hand-rolled over node:crypto so signing is synchronous and needs no dependency. */
export function signHs256(claims: Record<string, unknown>, secret: string): string {
  const signingInput = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  const signature = createHmac('sha256', secret).update(signingInput).digest()
  return `${signingInput}.${b64url(signature)}`
}

type JwtUser = { id: string; email?: string; phone?: string }

/**
 * Per-user database token. The policies and functions only read auth.uid() (sub) and auth.role()
 * (role); no migration reads auth.jwt(). email and phone are kept because the Supabase-issued
 * token carried them and tooling may log them.
 */
export function signUserJwt(
  user: JwtUser,
  secret: string,
  nowSeconds: number,
): { token: string; expiresAt: number } {
  const expiresAt = nowSeconds + USER_JWT_TTL_SECONDS
  const claims: Record<string, unknown> = {
    sub: user.id,
    role: 'authenticated',
    aud: 'authenticated',
    iat: nowSeconds,
    exp: expiresAt,
    ...(user.email ? { email: user.email } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    app_metadata: { provider: 'app', providers: ['app'] },
    is_anonymous: false,
  }
  return { token: signHs256(claims, secret), expiresAt }
}

let serviceToken: { secret: string; token: string } | null = null

/** Signed service_role token for `secret`, cached for the life of the process. */
export function signServiceRoleJwt(secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (serviceToken && serviceToken.secret === secret) return serviceToken.token
  const token = signHs256(
    { role: 'service_role', iss: 'xphere', iat: nowSeconds, exp: nowSeconds + SERVICE_JWT_TTL_SECONDS },
    secret,
  )
  serviceToken = { secret, token }
  return token
}

/** Test hook: forget the cached service token. */
export function resetServiceRoleJwtForTests(): void {
  serviceToken = null
}

/**
 * The key for service-role supabase-js clients: a locally signed token when DB_JWT_SECRET is set,
 * otherwise SUPABASE_SERVICE_ROLE_KEY exactly as before. Undefined when neither is available.
 */
export function getServiceRoleKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const secret = dbJwtSecret(env)
  if (secret) return signServiceRoleJwt(secret)
  return env.SUPABASE_SERVICE_ROLE_KEY
}

// ─── REST rewrite and leftover guard ─────────────────────────────────────────

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const STORAGE_KEYWORDS = new Set(['public', 'authenticated', 'sign', 'list', 'info', 'upload', 'move', 'copy'])

/** The bucket a `/storage/v1/...` path addresses, or null when the path carries none (move, copy). */
export function storageBucketFromPath(pathname: string): string | null {
  const marker = '/storage/v1/'
  const at = pathname.indexOf(marker)
  if (at === -1) return null
  const segments = pathname
    .slice(at + marker.length)
    .split('/')
    .filter(Boolean)
  if (segments[0] === 'object' || segments[0] === 'bucket') segments.shift()
  while (segments.length > 0 && STORAGE_KEYWORDS.has(segments[0]!)) segments.shift()
  return segments[0] ?? null
}

function r2Buckets(env: Env): Set<string> {
  return new Set((env.STORAGE_R2_BUCKETS ?? '').split(',').map((s) => s.trim()).filter(Boolean))
}

/**
 * Logs `[db-exit]` for a server call that still goes to Supabase Storage (bucket not on R2) or to
 * an Edge Function. Only active while SUPABASE_REST_URL is set. Never blocks, never logs secrets:
 * the path only, no query string or headers.
 */
export function logDbExitLeftover(url: string, env: Env = process.env): void {
  if (!env.SUPABASE_REST_URL) return
  const base = env.NEXT_PUBLIC_SUPABASE_URL ? stripTrailingSlashes(env.NEXT_PUBLIC_SUPABASE_URL) : null
  if (!base || !url.startsWith(base)) return
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return
  }
  if (pathname.startsWith('/functions/v1')) {
    console.error(`[db-exit] server call to a Supabase Edge Function is still in use: ${pathname}`)
    return
  }
  if (pathname.startsWith('/storage/v1')) {
    const bucket = storageBucketFromPath(pathname)
    if (bucket && r2Buckets(env).has(bucket)) return
    console.error(
      `[db-exit] server call to Supabase Storage for a bucket not on R2 (${bucket ?? 'unknown'}): ${pathname}`,
    )
  }
}

function isJwtShaped(token: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)
}

/**
 * Wraps `base` so supabase-js reaches PostgREST at SUPABASE_REST_URL. Only the
 * `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1` prefix is rewritten; method, body, query string and every
 * header (x-xphere-org included) pass through. supabase-js falls back to the publishable key as
 * the bearer when there is no session; that is not a JWT and PostgREST would answer 401, so it is
 * dropped and the request runs as the anon role. Legacy Supabase Storage calls from this
 * service client retain the original Supabase service credential; user credentials stay intact.
 */
export function createDbExitFetch(base: FetchFn, env: Env = process.env): FetchFn {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const restUrl = env.SUPABASE_REST_URL
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
    if (!restUrl || !supabaseUrl) return base(input, init)

    const original = urlOf(input)
    const prefix = `${stripTrailingSlashes(supabaseUrl)}/rest/v1`
    const matches =
      original === prefix || original.startsWith(`${prefix}/`) || original.startsWith(`${prefix}?`)
    if (!matches) {
      logDbExitLeftover(original, env)
      // Retention still removes legacy objects from Supabase after the database
      // cutover. Its locally signed database JWT is not valid at Supabase Storage.
      // Replace credentials only for this service client at the exact old Storage
      // origin/path; authenticated user calls must never gain service access.
      const legacyKey = env.SUPABASE_SERVICE_ROLE_KEY
      if (
        dbJwtSecret(env) && legacyKey &&
        original.startsWith(`${stripTrailingSlashes(supabaseUrl)}/storage/v1/`)
      ) {
        const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined))
        if (headers.get('authorization') === `Bearer ${getServiceRoleKey(env)}`) {
          headers.set('authorization', `Bearer ${legacyKey}`)
          headers.set('apikey', legacyKey)
          return base(input, { ...init, headers })
        }
      }
      return base(input, init)
    }

    const target = stripTrailingSlashes(restUrl) + original.slice(prefix.length)
    const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined))
    const auth = headers.get('authorization')
    if (auth && !isJwtShaped(auth.replace(/^Bearer\s+/i, ''))) headers.delete('authorization')

    if (typeof input === 'object' && !(input instanceof URL)) {
      // A Request: keep its method and body, swap the URL and the cleaned headers.
      return base(new Request(target, input), { ...init, headers })
    }
    return base(target, { ...init, headers })
  }) as FetchFn
}

type ClientOptions = NonNullable<Parameters<typeof createClient>[2]>

/** Options for a server-side client: unchanged unless SUPABASE_REST_URL is set. */
export function withDbExit<T extends ClientOptions | undefined>(options: T, env: Env = process.env): T {
  if (!env.SUPABASE_REST_URL) return options
  const inner: FetchFn = options?.global?.fetch ?? ((...args) => fetch(...args))
  return {
    ...options,
    global: { ...options?.global, fetch: createDbExitFetch(inner, env) },
  } as T
}

/**
 * Drop-in for supabase-js `createClient` on the server. With SUPABASE_REST_URL unset it calls
 * createClient with exactly the arguments it was given.
 */
export const createDbClient = ((url: string, key: string, options?: ClientOptions) =>
  createClient(url, key, withDbExit(options))) as typeof createClient

/**
 * `fetch` for direct server calls to Supabase URLs that are not supabase-js clients (Edge
 * Function calls). Behaves as fetch, and logs the leftover when SUPABASE_REST_URL is set.
 */
export const dbExitFetch: FetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
  logDbExitLeftover(urlOf(input))
  return fetch(input, init)
}) as FetchFn
