// Meta CAPI drain, Meta audience sync and the agent eval harness run inside the
// app (src/app/api/cron/*) since the 2026-11-05 database cutover. These tests
// cover route auth, the run lock, and the lib entry points with fakes.
// No network, no database.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

const afterCallbacks: Array<() => Promise<void> | void> = []
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void> | void) => {
    afterCallbacks.push(fn)
  },
}))

vi.mock('@/lib/api-error', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    throw new Error('createServiceRoleClient must not be reached in tests (inject a fake)')
  },
}))
vi.mock('@/lib/agent-runtime', () => ({ runAgent: vi.fn() }))
vi.mock('@/lib/evals/judge', () => ({ judgeResponse: vi.fn() }))

const capiDrain = vi.fn()
vi.mock('@/lib/meta/capi-worker', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
  return { ...actual, runCapiDrain: (...a: unknown[]) => capiDrain(...a) }
})

const audienceRun = vi.fn()
const audienceRequire = vi.fn()
vi.mock('@/lib/meta/audience-job', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/audience-job')>('@/lib/meta/audience-job')
  return {
    ...actual,
    runAudienceJob: (...a: unknown[]) => audienceRun(...a),
    requireRuntime: (...a: unknown[]) => audienceRequire(...a),
  }
})

const evalRun = vi.fn()
vi.mock('@/lib/evals/run-eval', async () => {
  const actual = await vi.importActual<typeof import('@/lib/evals/run-eval')>('@/lib/evals/run-eval')
  return { ...actual, runEvalSuite: (...a: unknown[]) => evalRun(...a) }
})

import { acquireRunLock, resetRunLocksForTests, type RedisLeaseClient } from '@/lib/cron/run-lock'
import { GET as capiGET } from '@/app/api/cron/meta-capi-worker/route'
import { GET as audienceGET } from '@/app/api/cron/meta-audience-sync/route'
import { GET as evalGET } from '@/app/api/cron/eval-harness/route'

const SECRET = 'test-cron-secret'

function req(path: string, auth: string | null = `Bearer ${SECRET}`): Request {
  return new Request(`http://localhost${path}`, auth ? { headers: { authorization: auth } } : undefined)
}

async function flushAfter() {
  const cbs = afterCallbacks.splice(0)
  for (const cb of cbs) await cb()
}

beforeEach(() => {
  resetRunLocksForTests()
  afterCallbacks.length = 0
  capiDrain.mockReset()
  audienceRun.mockReset()
  audienceRequire.mockReset()
  evalRun.mockReset()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('REDIS_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Route auth ───────────────────────────────────────────────────────────────

const ROUTES: Array<[string, (r: Request) => Promise<Response>, string]> = [
  ['meta-capi-worker', capiGET, '/api/cron/meta-capi-worker'],
  ['meta-audience-sync', audienceGET, '/api/cron/meta-audience-sync'],
  ['eval-harness', evalGET, '/api/cron/eval-harness'],
]

describe.each(ROUTES)('%s route auth', (_name, handler, path) => {
  it('fails closed with 503 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await handler(req(path))
    expect(res.status).toBe(503)
    expect(capiDrain).not.toHaveBeenCalled()
    expect(audienceRun).not.toHaveBeenCalled()
    expect(evalRun).not.toHaveBeenCalled()
  })

  it('returns 401 without the header or with the wrong secret', async () => {
    expect((await handler(req(path, null))).status).toBe(401)
    expect((await handler(req(path, 'Bearer nope'))).status).toBe(401)
    expect(capiDrain).not.toHaveBeenCalled()
    expect(audienceRun).not.toHaveBeenCalled()
    expect(evalRun).not.toHaveBeenCalled()
  })
})

// ── CAPI route ───────────────────────────────────────────────────────────────

describe('meta-capi-worker route', () => {
  it('runs the drain inline with the manual query flags and returns counts only', async () => {
    capiDrain.mockResolvedValue({
      due: 3, sent: 2, failed: 1, dead: 0, skipped: 0, deferred: 0, timedOut: false, dryRun: true,
    })
    const res = await capiGET(req('/api/cron/meta-capi-worker?org=org-1&test=1&dry_run=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, sent: 2, failed: 1, due: 3 })
    expect(capiDrain).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', test: true, dryRun: true, budgetMs: 60_000 }),
    )
  })

  it('skips when a run is already in progress and releases the lock afterwards', async () => {
    const held = await acquireRunLock('meta-capi-worker', 60_000, { redis: null })
    expect(held).not.toBeNull()
    const skipped = await capiGET(req('/api/cron/meta-capi-worker'))
    expect(await skipped.json()).toMatchObject({ ok: true, skipped: 'already_running' })
    expect(capiDrain).not.toHaveBeenCalled()
    await held!.release()

    capiDrain.mockResolvedValue({ due: 0, sent: 0, failed: 0, dead: 0, skipped: 0, deferred: 0, timedOut: false, dryRun: false })
    await capiGET(req('/api/cron/meta-capi-worker'))
    // Lock was released by the finally block: a second run is allowed.
    const again = await capiGET(req('/api/cron/meta-capi-worker'))
    // `skipped` is also the drain's count of skipped events (0 here), so only the
    // lock marker matters.
    expect((await again.json()).skipped).not.toBe('already_running')
    expect(capiDrain).toHaveBeenCalledTimes(2)
  })

  it('returns 500 with a generic message when the drain throws, and still releases the lock', async () => {
    capiDrain.mockRejectedValueOnce(new Error('db down: secret detail'))
    const res = await capiGET(req('/api/cron/meta-capi-worker'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
    capiDrain.mockResolvedValue({ due: 0, sent: 0, failed: 0, dead: 0, skipped: 0, deferred: 0, timedOut: false, dryRun: false })
    expect((await capiGET(req('/api/cron/meta-capi-worker'))).status).toBe(200)
  })
})

// ── Audience route (respond immediately, work in after(), lock) ──────────────

describe('meta-audience-sync route', () => {
  it('responds immediately, runs the job in after(), and never overlaps two runs', async () => {
    audienceRun.mockResolvedValue({ due: 2, succeeded: 2, failed: 0, skipped: 0 })

    const first = await audienceGET(req('/api/cron/meta-audience-sync?org=o1&audience=a1&dry_run=1'))
    expect(await first.json()).toMatchObject({ ok: true, started: true, dryRun: true })
    // Work has been scheduled but not run yet.
    expect(audienceRun).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)

    // A second tick while the first is still pending must not start another run.
    const second = await audienceGET(req('/api/cron/meta-audience-sync'))
    expect(await second.json()).toMatchObject({ ok: true, started: false, skipped: 'already_running' })
    expect(afterCallbacks).toHaveLength(1)

    await flushAfter()
    expect(audienceRun).toHaveBeenCalledTimes(1)
    expect(audienceRun).toHaveBeenCalledWith({ orgId: 'o1', audienceId: 'a1', dryRun: true })

    // After the run finished the lock is free again.
    const third = await audienceGET(req('/api/cron/meta-audience-sync'))
    expect(await third.json()).toMatchObject({ started: true })
  })

  it('releases the lock when the job throws', async () => {
    audienceRun.mockRejectedValueOnce(new Error('boom'))
    await audienceGET(req('/api/cron/meta-audience-sync'))
    await flushAfter()
    const next = await audienceGET(req('/api/cron/meta-audience-sync'))
    expect(await next.json()).toMatchObject({ started: true })
  })

  it('returns 500 and starts nothing when runtime configuration is missing', async () => {
    audienceRequire.mockImplementation(() => {
      throw new Error('Missing required configuration: ENCRYPTION_SECRET')
    })
    const res = await audienceGET(req('/api/cron/meta-audience-sync'))
    expect(res.status).toBe(500)
    expect(afterCallbacks).toHaveLength(0)
    // No lock was taken.
    audienceRequire.mockReset()
    expect(await (await audienceGET(req('/api/cron/meta-audience-sync'))).json()).toMatchObject({ started: true })
  })
})

// ── Eval route ───────────────────────────────────────────────────────────────

describe('eval-harness route', () => {
  it('skips cleanly (200) when the harness is not configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('EVAL_ORG_ID', '')
    vi.stubEnv('EVAL_AGENT_ID', '')
    const res = await evalGET(req('/api/cron/eval-harness'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ started: false, skipped: 'not_configured' })
    expect(body.missing).toEqual(['ANTHROPIC_API_KEY', 'EVAL_ORG_ID', 'EVAL_AGENT_ID'])
    expect(afterCallbacks).toHaveLength(0)
  })

  it('runs in after() behind the lock, with query overrides of the env ids', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'k')
    vi.stubEnv('EVAL_ORG_ID', 'env-org')
    vi.stubEnv('EVAL_AGENT_ID', 'env-agent')
    evalRun.mockResolvedValue({
      cases: 2, errored: 0, average: 4.5, belowCaseMinimum: 0, belowGate: 0, passed: true, scores: [],
    })

    const first = await evalGET(req('/api/cron/eval-harness?agent_id=other-agent'))
    expect(await first.json()).toMatchObject({ ok: true, started: true })
    const overlapping = await evalGET(req('/api/cron/eval-harness'))
    expect(await overlapping.json()).toMatchObject({ started: false, skipped: 'already_running' })

    await flushAfter()
    expect(evalRun).toHaveBeenCalledTimes(1)
    expect(evalRun).toHaveBeenCalledWith({ orgId: 'env-org', agentId: 'other-agent' })
  })
})

// ── Run lock ─────────────────────────────────────────────────────────────────

describe('acquireRunLock', () => {
  it('refuses a second holder until released', async () => {
    const a = await acquireRunLock('job', 1000, { redis: null })
    expect(a).not.toBeNull()
    expect(await acquireRunLock('job', 1000, { redis: null })).toBeNull()
    // Different names do not collide.
    expect(await acquireRunLock('other', 1000, { redis: null })).not.toBeNull()
    await a!.release()
    expect(await acquireRunLock('job', 1000, { redis: null })).not.toBeNull()
  })

  it('expires a stuck lease after its TTL', async () => {
    let t = 1_000
    const now = () => t
    expect(await acquireRunLock('job', 500, { redis: null, now })).not.toBeNull()
    t += 499
    expect(await acquireRunLock('job', 500, { redis: null, now })).toBeNull()
    t += 2
    expect(await acquireRunLock('job', 500, { redis: null, now })).not.toBeNull()
  })

  it('lets only one of two simultaneous acquirers win', async () => {
    const [a, b] = await Promise.all([
      acquireRunLock('job', 1000, { redis: null }),
      acquireRunLock('job', 1000, { redis: null }),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('a stale release does not free a newer holder', async () => {
    let t = 0
    const now = () => t
    const old = await acquireRunLock('job', 100, { redis: null, now })
    t = 1000
    const fresh = await acquireRunLock('job', 100, { redis: null, now })
    expect(fresh).not.toBeNull()
    await old!.release()
    expect(await acquireRunLock('job', 100, { redis: null, now })).toBeNull()
  })

  it('honours a Redis lease held by another container', async () => {
    const redis: RedisLeaseClient = {
      isReady: true,
      set: vi.fn().mockResolvedValue(null),
      get: vi.fn(),
      del: vi.fn(),
    }
    expect(await acquireRunLock('job', 1000, { redis })).toBeNull()
    // The in-process slot was given back, so a Redis-less retry works.
    expect(await acquireRunLock('job', 1000, { redis: null })).not.toBeNull()
  })

  it('takes and releases the Redis lease, and falls back when Redis throws', async () => {
    let stored: string | null = null
    const redis: RedisLeaseClient = {
      isReady: true,
      set: vi.fn(async (_k: string, v: string) => { stored = v; return 'OK' }),
      get: vi.fn(async () => stored),
      del: vi.fn(async () => { stored = null; return 1 }),
    }
    const lock = await acquireRunLock('job', 1000, { redis })
    expect(lock).not.toBeNull()
    expect(stored).not.toBeNull()
    await lock!.release()
    expect(redis.del).toHaveBeenCalledTimes(1)
    expect(stored).toBeNull()

    const broken: RedisLeaseClient = {
      isReady: true,
      set: vi.fn().mockRejectedValue(new Error('down')),
      get: vi.fn(),
      del: vi.fn(),
    }
    expect(await acquireRunLock('job2', 1000, { redis: broken })).not.toBeNull()
  })
})

// ── CAPI drain lib ───────────────────────────────────────────────────────────

type Row = {
  id: string; org_id: string; event_name: string; event_id: string; event_time: string
  action_source: string; payload: Record<string, unknown>; attempts: number | null
}

function capiRow(i: number, over: Partial<Row> = {}): Row {
  return {
    id: `row-${i}`, org_id: 'org-1', event_name: 'Lead', event_id: `ev-${i}`,
    event_time: '2026-11-05T10:00:00.000Z', action_source: 'website',
    payload: { user_data: { em: ['hash'] } }, attempts: 0, ...over,
  }
}

function fakeCapiDb(opts: {
  rows: Row[]
  config?: Record<string, unknown> | null
  conn?: Record<string, unknown> | null
  loadError?: { message: string }
}) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = []
  const queries: Array<{ col: string; val: unknown }> = []
  const config = opts.config === undefined
    ? { dataset_id: 'ds-1', encrypted_capi_token: 'enc', test_event_code: 'TEST1', enabled: true }
    : opts.config
  return {
    updates,
    queries,
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = { _patch: null as Record<string, unknown> | null }
      b.select = () => b
      b.in = () => b
      b.lte = () => b
      b.order = () => b
      b.limit = () => b
      b.update = (p: Record<string, unknown>) => { b._patch = p; return b }
      b.eq = (col: string, val: unknown) => {
        if (b._patch) {
          updates.push({ table, patch: b._patch, id: val })
          return Promise.resolve({ error: null })
        }
        queries.push({ col, val })
        return b
      }
      b.maybeSingle = () =>
        Promise.resolve({ data: table === 'meta_capi_config' ? config : (opts.conn ?? null) })
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(
          opts.loadError ? { data: null, error: opts.loadError } : { data: opts.rows, error: null },
        ).then(res, rej)
      return b
    },
  }
}

describe('runCapiDrain', () => {
  it('sends due events, marks them sent with the trace id, and counts them', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const db = fakeCapiDb({ rows: [capiRow(1), capiRow(2)] })
    const send = vi.fn().mockResolvedValue({ fbtrace_id: 'trace-1', events_received: 1 })
    const report = await runCapiDrain({
      supabase: db, send, decryptToken: async () => 'tok', log: () => {},
    })
    expect(report).toMatchObject({ due: 2, sent: 2, failed: 0, dead: 0, skipped: 0, deferred: 0, timedOut: false })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toBe('ds-1')
    expect(send.mock.calls[0][1]).toBe('tok')
    expect(send.mock.calls[0][3]).toEqual({ testEventCode: null }) // test flag off
    const sentUpdates = db.updates.filter((u) => u.table === 'meta_capi_events')
    expect(sentUpdates).toHaveLength(2)
    expect(sentUpdates[0].patch).toMatchObject({ status: 'sent', fb_trace_id: 'trace-1', last_error: null })
  })

  it('uses the org test_event_code only with test=true', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const send = vi.fn().mockResolvedValue({ fbtrace_id: 't' })
    await runCapiDrain({
      supabase: fakeCapiDb({ rows: [capiRow(1)] }), send, decryptToken: async () => 'tok', test: true, log: () => {},
    })
    expect(send.mock.calls[0][3]).toEqual({ testEventCode: 'TEST1' })
  })

  it('backs off a failed send, increments attempts, and dead-letters at the threshold', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const db = fakeCapiDb({ rows: [capiRow(1, { attempts: 0 }), capiRow(2, { attempts: 7 })] })
    const send = vi.fn().mockRejectedValue(new Error('graph 500'))
    const t0 = Date.parse('2026-11-05T12:00:00.000Z')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = await runCapiDrain({
      supabase: db, send, decryptToken: async () => 'tok', now: () => t0, log: () => {},
    })
    errSpy.mockRestore()
    expect(report).toMatchObject({ failed: 1, dead: 1, sent: 0 })
    const [first, second] = db.updates.filter((u) => u.table === 'meta_capi_events')
    expect(first.patch).toMatchObject({ status: 'failed', attempts: 1, last_error: 'graph 500' })
    // attempts=1 -> 60 * 2^1 = 120s
    expect(first.patch.next_attempt_at).toBe(new Date(t0 + 120_000).toISOString())
    expect(second.patch).toMatchObject({ status: 'dead', attempts: 8 })
  })

  it('leaves rows of a disabled or token-less org untouched (no attempt burned)', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const send = vi.fn()
    const disabled = fakeCapiDb({ rows: [capiRow(1)], config: { dataset_id: 'ds', enabled: false } })
    expect(await runCapiDrain({ supabase: disabled, send, log: () => {} })).toMatchObject({ skipped: 1, sent: 0 })

    vi.stubEnv('META_SYSTEM_USER_TOKEN', '')
    const noToken = fakeCapiDb({
      rows: [capiRow(2)],
      config: { dataset_id: 'ds', encrypted_capi_token: null, enabled: true },
      conn: null,
    })
    expect(await runCapiDrain({ supabase: noToken, send, log: () => {} })).toMatchObject({ skipped: 1 })
    expect(send).not.toHaveBeenCalled()
    expect(disabled.updates).toHaveLength(0)
    expect(noToken.updates).toHaveLength(0)
  })

  it('falls back to the org ads connection token, then META_SYSTEM_USER_TOKEN', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const send = vi.fn().mockResolvedValue({ fbtrace_id: 't' })
    const viaConn = fakeCapiDb({
      rows: [capiRow(1)],
      config: { dataset_id: 'ds', encrypted_capi_token: null, enabled: true },
      conn: { encrypted_access_token: 'conn-enc' },
    })
    await runCapiDrain({ supabase: viaConn, send, decryptToken: async (e) => `dec:${e}`, log: () => {} })
    expect(send.mock.calls[0][1]).toBe('dec:conn-enc')

    vi.stubEnv('META_SYSTEM_USER_TOKEN', 'system-token')
    const viaEnv = fakeCapiDb({
      rows: [capiRow(2)],
      config: { dataset_id: 'ds', encrypted_capi_token: null, enabled: true },
      conn: null,
    })
    await runCapiDrain({ supabase: viaEnv, send, decryptToken: async () => 'x', log: () => {} })
    expect(send.mock.calls[1][1]).toBe('system-token')
  })

  it('dry run logs and counts but neither sends nor writes', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const db = fakeCapiDb({ rows: [capiRow(1), capiRow(2)] })
    const send = vi.fn()
    const lines: string[] = []
    const report = await runCapiDrain({
      supabase: db, send, decryptToken: async () => 'tok', dryRun: true, log: (l) => lines.push(l),
    })
    expect(report).toMatchObject({ sent: 2, dryRun: true })
    expect(send).not.toHaveBeenCalled()
    expect(db.updates).toHaveLength(0)
    expect(lines.some((l) => l.includes('would send Lead'))).toBe(true)
  })

  it('constrains the query to one org when asked', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const db = fakeCapiDb({ rows: [] })
    const report = await runCapiDrain({ supabase: db, orgId: 'org-9', log: () => {} })
    expect(db.queries).toContainEqual({ col: 'org_id', val: 'org-9' })
    expect(report).toMatchObject({ due: 0, sent: 0 })
  })

  it('stops starting sends once the time budget is spent and reports the deferred rows', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    let clock = 1_000_000
    const send = vi.fn().mockImplementation(async () => { clock += 30_000; return { fbtrace_id: 't' } })
    const db = fakeCapiDb({ rows: [1, 2, 3, 4, 5].map((i) => capiRow(i)) })
    const report = await runCapiDrain({
      supabase: db, send, decryptToken: async () => 'tok', budgetMs: 60_000, now: () => clock, log: () => {},
    })
    expect(report).toMatchObject({ due: 5, sent: 2, deferred: 3, timedOut: true })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('throws a generic error when the outbox cannot be loaded', async () => {
    const { runCapiDrain } = await vi.importActual<typeof import('@/lib/meta/capi-worker')>('@/lib/meta/capi-worker')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      runCapiDrain({ supabase: fakeCapiDb({ rows: [], loadError: { message: 'pg detail' } }), log: () => {} }),
    ).rejects.toThrow('Could not load the Meta CAPI outbox')
    errSpy.mockRestore()
  })
})

// ── Audience job lib ─────────────────────────────────────────────────────────

describe('runAudienceJob', () => {
  const NOW = Date.parse('2026-11-05T12:00:00.000Z')
  const iso = (ms: number) => new Date(ms).toISOString()

  function fakeAudienceDb(rows: unknown[], error: { message: string } | null = null) {
    const eqs: Array<{ col: string; val: unknown }> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => { eqs.push({ col, val }); return b }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error }).then(res, rej)
    return { eqs, from: () => b, rpc: vi.fn() }
  }

  const rows = [
    { id: 'a-due', org_id: 'o1', dirty_at: null, last_synced_at: iso(NOW - 7200_000), next_sync_at: iso(NOW - 1000) },
    { id: 'a-future', org_id: 'o1', dirty_at: null, last_synced_at: iso(NOW - 1000), next_sync_at: iso(NOW + 3600_000) },
    { id: 'a-dirty', org_id: 'o2', dirty_at: iso(NOW - 10), last_synced_at: iso(NOW - 1000), next_sync_at: iso(NOW + 3600_000) },
    { id: 'a-never', org_id: 'o2', dirty_at: null, last_synced_at: null, next_sync_at: null },
  ]

  it('reconciles only due audiences and counts each outcome', async () => {
    const { runAudienceJob } = await vi.importActual<typeof import('@/lib/meta/audience-job')>('@/lib/meta/audience-job')
    const reconcile = vi.fn(async (input: { audienceConfigId: string }) => {
      if (input.audienceConfigId === 'a-due') return { status: 'succeeded', dryRun: false, addCount: 1, removeCount: 0, unchangedCount: 4 }
      if (input.audienceConfigId === 'a-dirty') return { status: 'skipped', reason: 'already_claimed' }
      return { status: 'failed', errorCode: 'CONNECTION_EXPIRED' }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = await runAudienceJob(
      { orgId: null, audienceId: null, dryRun: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { supabase: fakeAudienceDb(rows), reconcile: reconcile as any, now: () => NOW, log: () => {}, skipRuntimeCheck: true },
    )
    errSpy.mockRestore()
    expect(reconcile.mock.calls.map((c) => c[0].audienceConfigId)).toEqual(['a-due', 'a-dirty', 'a-never'])
    expect(reconcile.mock.calls[0][0]).toMatchObject({ trigger: 'scheduled', dryRun: false, orgId: 'o1' })
    expect(report).toEqual({ due: 3, succeeded: 1, failed: 1, skipped: 1 })
  })

  it('does not throw when audiences fail (the caller decides), and reports 0 due cleanly', async () => {
    const { runAudienceJob } = await vi.importActual<typeof import('@/lib/meta/audience-job')>('@/lib/meta/audience-job')
    const lines: string[] = []
    const report = await runAudienceJob(
      { orgId: null, audienceId: null, dryRun: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { supabase: fakeAudienceDb([rows[1]]), reconcile: vi.fn() as any, now: () => NOW, log: (l) => lines.push(l), skipRuntimeCheck: true },
    )
    expect(report).toEqual({ due: 0, succeeded: 0, failed: 0, skipped: 0 })
    expect(lines).toContain('[meta-audience-sync] 0 audiences due')
  })

  it('dry run and explicit constraints bypass the due filter; dry run uses the manual trigger', async () => {
    const { runAudienceJob } = await vi.importActual<typeof import('@/lib/meta/audience-job')>('@/lib/meta/audience-job')
    const reconcile = vi.fn(async (_input: Record<string, unknown>) => ({ status: 'succeeded', dryRun: true, addCount: 0, removeCount: 0, unchangedCount: 0 }))
    const db = fakeAudienceDb(rows)
    const report = await runAudienceJob(
      { orgId: 'o1', audienceId: 'a-future', dryRun: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { supabase: db, reconcile: reconcile as any, now: () => NOW, log: () => {}, skipRuntimeCheck: true },
    )
    expect(db.eqs).toEqual(expect.arrayContaining([
      { col: 'sync_enabled', val: true },
      { col: 'org_id', val: 'o1' },
      { col: 'id', val: 'a-future' },
    ]))
    expect(report.due).toBe(rows.length) // fake returns every row; filter is bypassed
    expect(reconcile.mock.calls[0][0]).toMatchObject({ trigger: 'manual', dryRun: true })
  })

  it('throws a generic error when configs cannot be loaded', async () => {
    const { runAudienceJob } = await vi.importActual<typeof import('@/lib/meta/audience-job')>('@/lib/meta/audience-job')
    await expect(
      runAudienceJob(
        { orgId: null, audienceId: null, dryRun: false },
        { supabase: fakeAudienceDb([], { message: 'pg detail' }), skipRuntimeCheck: true, log: () => {} },
      ),
    ).rejects.toThrow('Could not load due Meta audience configurations')
  })

  it('requireRuntime demands a 64-hex ENCRYPTION_SECRET', async () => {
    const { requireRuntime, parseOptions } = await vi.importActual<typeof import('@/lib/meta/audience-job')>('@/lib/meta/audience-job')
    expect(() => requireRuntime({} as NodeJS.ProcessEnv)).toThrow(/ENCRYPTION_SECRET/)
    expect(() => requireRuntime({ ENCRYPTION_SECRET: 'abc' } as NodeJS.ProcessEnv)).toThrow(/64 hex/)
    expect(() => requireRuntime({ ENCRYPTION_SECRET: 'a'.repeat(64) } as NodeJS.ProcessEnv)).not.toThrow()
    expect(parseOptions(['--org', 'o', '--audience', 'a', '--dry-run'])).toEqual({ orgId: 'o', audienceId: 'a', dryRun: true })
    expect(() => parseOptions(['--org'])).toThrow('--org requires a value')
  })
})

// ── Eval suite lib ───────────────────────────────────────────────────────────

describe('runEvalSuite', () => {
  const cases = [
    { id: 'c1', description: 'd1', channel: 'web_widget', intent: 'greeting', userMessage: 'hi', criteria: ['x'], minScore: 3 },
    { id: 'c2', description: 'd2', channel: 'sms', intent: 'booking', userMessage: 'book', criteria: ['y'], minScore: 3 },
  ] as unknown as import('@/lib/evals/golden-set').EvalCase[]

  const judged = (score: number) => ({ score, rationale: 'r', criteriaHits: [], criteriaMisses: [], violations: [] })

  it('runs each case once and passes when the gates are met', async () => {
    const { runEvalSuite } = await vi.importActual<typeof import('@/lib/evals/run-eval')>('@/lib/evals/run-eval')
    const run = vi.fn().mockResolvedValue({ text: 'answer' })
    const judge = vi.fn().mockResolvedValueOnce(judged(5)).mockResolvedValueOnce(judged(4))
    const report = await runEvalSuite({ orgId: 'o', agentId: 'a', cases, run, judge, log: () => {} })
    expect(run).toHaveBeenCalledTimes(2) // once per case, not twice like the vitest runner
    expect(run.mock.calls[0][0]).toMatchObject({ orgId: 'o', agentId: 'a', mode: 'production', maxSteps: 3, channel: 'web_widget' })
    expect(report).toMatchObject({ cases: 2, errored: 0, average: 4.5, passed: true, belowCaseMinimum: 0, belowGate: 0 })
  })

  it('fails the gate on a low average, a case under its minimum, or an erroring case', async () => {
    const { runEvalSuite } = await vi.importActual<typeof import('@/lib/evals/run-eval')>('@/lib/evals/run-eval')
    const run = vi.fn().mockResolvedValue({ text: 'answer' })

    const low = await runEvalSuite({
      orgId: 'o', agentId: 'a', cases, run, log: () => {},
      judge: vi.fn().mockResolvedValueOnce(judged(3)).mockResolvedValueOnce(judged(3)),
    })
    expect(low).toMatchObject({ average: 3, passed: false, belowCaseMinimum: 0 })

    const bad = await runEvalSuite({
      orgId: 'o', agentId: 'a', cases, run, log: () => {},
      judge: vi.fn().mockResolvedValueOnce(judged(5)).mockResolvedValueOnce(judged(1)),
    })
    expect(bad).toMatchObject({ belowCaseMinimum: 1, belowGate: 1, passed: false })

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errored = await runEvalSuite({
      orgId: 'o', agentId: 'a', cases, log: () => {},
      run: vi.fn().mockRejectedValueOnce(new Error('agent down')).mockResolvedValue({ text: 'ok' }),
      judge: vi.fn().mockResolvedValue(judged(5)),
    })
    errSpy.mockRestore()
    expect(errored).toMatchObject({ errored: 1, passed: false })
    expect(errored.scores).toEqual([{ id: 'c1', score: null }, { id: 'c2', score: 5 }])
  })

  it('requireEvalConfig lists what is missing', async () => {
    const { requireEvalConfig } = await vi.importActual<typeof import('@/lib/evals/run-eval')>('@/lib/evals/run-eval')
    expect(requireEvalConfig({} as NodeJS.ProcessEnv, null, null)).toEqual(['ANTHROPIC_API_KEY', 'EVAL_ORG_ID', 'EVAL_AGENT_ID'])
    expect(requireEvalConfig({ ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv, 'o', 'a')).toEqual([])
  })
})
