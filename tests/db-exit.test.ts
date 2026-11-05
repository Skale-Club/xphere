import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeJwt, jwtVerify } from 'jose'

const m = vi.hoisted(() => ({ createClient: vi.fn(() => ({ marker: 'client' })) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: m.createClient }))

import {
  createDbClient,
  createDbExitFetch,
  getServiceRoleKey,
  logDbExitLeftover,
  resetServiceRoleJwtForTests,
  storageBucketFromPath,
  withDbExit,
} from '@/lib/supabase/db-exit'

const SECRET = 'test-secret-at-least-32-bytes-long-0123456789'
const BASE = 'https://proj.supabase.co'
const REST = 'http://xphere-postgrest:3000'
const env = { NEXT_PUBLIC_SUPABASE_URL: BASE, SUPABASE_REST_URL: REST }

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetServiceRoleJwtForTests()
  vi.clearAllMocks()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('getServiceRoleKey', () => {
  it('returns SUPABASE_SERVICE_ROLE_KEY when DB_JWT_SECRET is unset', () => {
    expect(getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })).toBe('legacy')
    expect(getServiceRoleKey({})).toBeUndefined()
  })

  it('signs a long-lived service_role token when DB_JWT_SECRET is set, ignoring the legacy key', async () => {
    const key = getServiceRoleKey({ DB_JWT_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'legacy' })!
    expect(key).not.toBe('legacy')

    const { payload, protectedHeader } = await jwtVerify(key, new TextEncoder().encode(SECRET))
    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.role).toBe('service_role')
    expect(payload).not.toHaveProperty('sub')
    expect(payload.exp! - payload.iat!).toBeGreaterThan(5 * 365 * 24 * 3600)
  })

  it('works with no legacy key at all, and caches the token per process', () => {
    const a = getServiceRoleKey({ DB_JWT_SECRET: SECRET })!
    const b = getServiceRoleKey({ DB_JWT_SECRET: SECRET })!
    expect(b).toBe(a)
    expect(decodeJwt(a).role).toBe('service_role')
  })

  it('signs again when the secret changes', () => {
    const a = getServiceRoleKey({ DB_JWT_SECRET: SECRET })!
    const b = getServiceRoleKey({ DB_JWT_SECRET: `${SECRET}-rotated` })!
    expect(b).not.toBe(a)
  })
})

describe('createServiceRoleClient', () => {
  it('uses the signed service key when DB_JWT_SECRET is set, the legacy key otherwise', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'legacy')
    vi.stubEnv('DB_JWT_SECRET', '')
    vi.stubEnv('SUPABASE_REST_URL', '')
    const { createServiceRoleClient } = await import('@/lib/supabase/admin')

    createServiceRoleClient()
    expect(m.createClient).toHaveBeenLastCalledWith(BASE, 'legacy', { auth: { persistSession: false } })

    vi.stubEnv('DB_JWT_SECRET', SECRET)
    createServiceRoleClient()
    const key = (m.createClient.mock.calls.at(-1) as unknown as unknown[])[1] as string
    expect(decodeJwt(key).role).toBe('service_role')
  })
})

describe('withDbExit / createDbClient', () => {
  it('passes options through untouched when SUPABASE_REST_URL is unset', () => {
    const options = { auth: { persistSession: false } }
    expect(withDbExit(options, {})).toBe(options)
    expect(withDbExit(undefined, {})).toBeUndefined()
  })

  it('adds a custom fetch and keeps the other options when it is set', () => {
    const out = withDbExit({ auth: { persistSession: false }, global: { headers: { 'x-xphere-org': 'o1' } } }, env)
    expect(out.auth).toEqual({ persistSession: false })
    expect(out.global?.headers).toEqual({ 'x-xphere-org': 'o1' })
    expect(typeof out.global?.fetch).toBe('function')
  })

  it('createDbClient hands supabase-js the exact arguments when unset', () => {
    vi.stubEnv('SUPABASE_REST_URL', '')
    const options = { auth: { persistSession: false } }
    createDbClient(BASE, 'key', options)
    expect(m.createClient).toHaveBeenCalledWith(BASE, 'key', options)
  })
})

describe('createDbExitFetch', () => {
  const jwt = 'aaa.bbb.ccc'

  function setup() {
    const base = vi.fn().mockResolvedValue(new Response('{}'))
    return { base, f: createDbExitFetch(base as unknown as typeof fetch, env) }
  }

  it('rewrites only the /rest/v1 prefix and keeps path, query, method, body and headers', async () => {
    const { base, f } = setup()

    await f(`${BASE}/rest/v1/contacts?select=*&org_id=eq.1&order=created_at.desc`, {
      method: 'PATCH',
      body: '{"a":1}',
      headers: { Authorization: `Bearer ${jwt}`, apikey: 'pub', 'x-xphere-org': 'org-9', Prefer: 'return=minimal' },
    })

    const [url, init] = base.mock.calls[0]!
    expect(url).toBe(`${REST}/contacts?select=*&org_id=eq.1&order=created_at.desc`)
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe('{"a":1}')
    const headers = init.headers as Headers
    expect(headers.get('authorization')).toBe(`Bearer ${jwt}`)
    expect(headers.get('apikey')).toBe('pub')
    expect(headers.get('x-xphere-org')).toBe('org-9')
    expect(headers.get('prefer')).toBe('return=minimal')
  })

  it('rewrites rpc calls and tolerates a trailing slash on SUPABASE_REST_URL', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'))
    const f = createDbExitFetch(base as unknown as typeof fetch, { ...env, SUPABASE_REST_URL: `${REST}/` })
    await f(new URL(`${BASE}/rest/v1/rpc/get_current_org_id`), { method: 'POST' })
    expect(base.mock.calls[0]![0]).toBe(`${REST}/rpc/get_current_org_id`)
  })

  it('rewrites a Request input, keeping its method and headers', async () => {
    const { base, f } = setup()
    await f(new Request(`${BASE}/rest/v1/tags?select=id`, { method: 'DELETE', headers: { 'x-xphere-org': 'o2' } }))
    const [req, init] = base.mock.calls[0]!
    expect(req.url).toBe(`${REST}/tags?select=id`)
    expect(req.method).toBe('DELETE')
    expect((init.headers as Headers).get('x-xphere-org')).toBe('o2')
  })

  it('does not rewrite other Supabase paths, and passes them through unchanged', async () => {
    const { base, f } = setup()
    const init = { headers: { Authorization: 'Bearer x' } }
    await f(`${BASE}/auth/v1/logout?scope=local`, init)
    await f('https://example.com/rest/v1/contacts', init)
    await f(`${BASE}/rest/v10/contacts`, init)
    expect(base.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/auth/v1/logout?scope=local`,
      'https://example.com/rest/v1/contacts',
      `${BASE}/rest/v10/contacts`,
    ])
    expect(base.mock.calls[0]![1]).toBe(init)
  })

  it('drops a bearer that is not a JWT (the publishable key) so PostgREST runs as anon', async () => {
    const { base, f } = setup()
    await f(`${BASE}/rest/v1/services`, { headers: { Authorization: 'Bearer sb_publishable_abc', apikey: 'sb_publishable_abc' } })
    const headers = base.mock.calls[0]![1].headers as Headers
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('apikey')).toBe('sb_publishable_abc')
  })

  it('is a plain pass-through when SUPABASE_REST_URL is unset', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'))
    const f = createDbExitFetch(base as unknown as typeof fetch, { NEXT_PUBLIC_SUPABASE_URL: BASE })
    const init = { method: 'GET' }
    await f(`${BASE}/rest/v1/contacts`, init)
    expect(base).toHaveBeenCalledWith(`${BASE}/rest/v1/contacts`, init)
  })
})

describe('[db-exit] leftover guard', () => {
  it('logs the path of a Supabase Storage call for a bucket not on R2, without the query string', () => {
    logDbExitLeftover(`${BASE}/storage/v1/object/knowledge-docs/org/file.pdf?token=SECRET`, env)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = String(errorSpy.mock.calls[0]![0])
    expect(line).toContain('[db-exit]')
    expect(line).toContain('/storage/v1/object/knowledge-docs/org/file.pdf')
    expect(line).toContain('knowledge-docs')
    expect(line).not.toContain('SECRET')
  })

  it('stays quiet for a bucket that is on R2', () => {
    logDbExitLeftover(`${BASE}/storage/v1/object/public/avatars/a.png`, { ...env, STORAGE_R2_BUCKETS: 'branding, avatars' })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs Edge Function calls', () => {
    logDbExitLeftover(`${BASE}/functions/v1/process-embeddings`, env)
    expect(String(errorSpy.mock.calls[0]![0])).toMatch(/\[db-exit\].*\/functions\/v1\/process-embeddings/)
  })

  it('logs nothing when SUPABASE_REST_URL is unset, or for other hosts and paths', () => {
    logDbExitLeftover(`${BASE}/functions/v1/x`, { NEXT_PUBLIC_SUPABASE_URL: BASE })
    logDbExitLeftover('https://other.example/storage/v1/object/b/x', env)
    logDbExitLeftover(`${BASE}/rest/v1/contacts`, env)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('does not block: the call still goes out, to the original URL', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'))
    const f = createDbExitFetch(base as unknown as typeof fetch, env)
    const init = { method: 'POST' }
    await f(`${BASE}/storage/v1/object/recordings/a.mp3`, init)
    expect(base).toHaveBeenCalledWith(`${BASE}/storage/v1/object/recordings/a.mp3`, init)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('parses the bucket out of the storage URL shapes supabase-js uses', () => {
    expect(storageBucketFromPath('/storage/v1/object/public/avatars/a/b.png')).toBe('avatars')
    expect(storageBucketFromPath('/storage/v1/object/sign/chat-media/x.png')).toBe('chat-media')
    expect(storageBucketFromPath('/storage/v1/object/upload/sign/recordings/x')).toBe('recordings')
    expect(storageBucketFromPath('/storage/v1/object/list/branding')).toBe('branding')
    expect(storageBucketFromPath('/storage/v1/object/contact-imports/x.csv')).toBe('contact-imports')
    expect(storageBucketFromPath('/storage/v1/object/move')).toBeNull()
  })
})
