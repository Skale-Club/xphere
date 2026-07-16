// tests/calendar-tick-route.test.ts
// Phase 128 Plan 02 — SCH-03: calendar-tick route auth behavior.
// Mirrors tests/ghl-reengagement-route.test.ts's mock-Supabase + direct-handler-import
// pattern. Because route.ts calls createClient from @supabase/supabase-js directly
// (not via a repo wrapper), @supabase/supabase-js itself must be intercepted so the
// "correct secret" test case never issues a real network/DB call against this
// worktree's production-pointed .env.local.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function makeChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn(() => makeChain()) })),
}))

import { GET, runtime } from '@/app/api/cron/calendar-tick/route'

const VALID_SECRET = 'test_calendar_tick_secret_abc123'

function makeRequest(auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth !== undefined) headers['Authorization'] = auth
  return new Request('http://localhost/api/cron/calendar-tick', { headers })
}

describe('GET /api/cron/calendar-tick (SCH-03)', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('CRON_SECRET unset → 503 with error mentioning CRON_SECRET', async () => {
    delete process.env.CRON_SECRET
    const response = await GET(makeRequest())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toContain('CRON_SECRET')
  })

  it('CRON_SECRET set, no Authorization header → 401', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    const response = await GET(makeRequest())
    expect(response.status).toBe(401)
  })

  it('CRON_SECRET set, wrong Authorization header value → 401', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    const response = await GET(makeRequest('Bearer wrong_secret_value'))
    expect(response.status).toBe(401)
  })

  it('CRON_SECRET set, correct Authorization header → does NOT return 401 or 503', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    const response = await GET(makeRequest(`Bearer ${VALID_SECRET}`))
    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(503)
  })

  it('runtime export equals "nodejs"', () => {
    expect(runtime).toBe('nodejs')
  })
})
