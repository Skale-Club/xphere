// tests/ghl-reengagement-route.test.ts
// Phase 32 — REENG-05, REENG-06, REENG-07, REENG-15, REENG-16, REENG-18.
// GREEN as of Plan 04 (src/app/api/automations/ghl-reengagement/run/route.ts shipped).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const REQUIRED_ENV = [
  'GHL_REENGAGEMENT_LOCATION_ID',
  'GHL_REENGAGEMENT_INTEGRATION_ID',
  'GHL_REENGAGEMENT_MESSAGE',
  'GHL_REENGAGEMENT_TRIGGER_SECRET',
] as const  // REVISED 2026-05-15: removed GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID — SMS now via GHL

// ---- Hoisted mocks ----
vi.mock('@/lib/automations/ghl-reengagement/runner', () => ({
  runReengagement: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { POST } from '@/app/api/automations/ghl-reengagement/run/route'
import { runReengagement } from '@/lib/automations/ghl-reengagement/runner'
import { createServiceRoleClient } from '@/lib/supabase/admin'

// ---- Helpers ----
const VALID_SECRET = 'test_secret_value_abcdef0123456789'
const FUTURE_ISO = '2099-01-01T00:00:00.000Z'
const PAST_ISO = '2020-01-01T00:00:00.000Z'

const RUNNER_RESULT = {
  processed: 3,
  sent: 2,
  skipped: 1,
  failed: 0,
  errors: [],
}

interface ScheduleMockOptions {
  scheduleRow?: Record<string, unknown> | null
  scheduleError?: { message: string } | null
}

const updateCalls: Array<{ payload: Record<string, unknown>; id: string }> = []

function buildSupabaseMock(opts: ScheduleMockOptions = {}) {
  const {
    scheduleRow = {
      id: 'sched_1',
      is_active: true,
      next_run_at: PAST_ISO,
      interval_minutes: 60,
    },
    scheduleError = null,
  } = opts

  const fromMock = vi.fn((table: string) => {
    if (table === 'automation_schedules') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: scheduleRow, error: scheduleError }),
          }),
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
          eq: vi.fn().mockImplementation((_col: string, id: string) => {
            updateCalls.push({ payload, id })
            return Promise.resolve({ data: null, error: null })
          }),
        })),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return { from: fromMock } as never
}

function setAllEnv() {
  process.env.GHL_REENGAGEMENT_LOCATION_ID = 'loc_x'
  process.env.GHL_REENGAGEMENT_INTEGRATION_ID = 'int_x'
  process.env.GHL_REENGAGEMENT_MESSAGE = 'Olá {{first_name}}'
  process.env.GHL_REENGAGEMENT_TRIGGER_SECRET = VALID_SECRET
}

function clearAllEnv() {
  delete process.env.GHL_REENGAGEMENT_LOCATION_ID
  delete process.env.GHL_REENGAGEMENT_INTEGRATION_ID
  delete process.env.GHL_REENGAGEMENT_MESSAGE
  delete process.env.GHL_REENGAGEMENT_TRIGGER_SECRET
  delete process.env.GHL_REENGAGEMENT_THRESHOLD_DAYS
  delete process.env.GHL_REENGAGEMENT_BATCH_LIMIT
  delete process.env.GHL_REENGAGEMENT_FROM_NUMBER
  delete process.env.GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID
}

function makeRequest(opts: { auth?: string; force?: boolean } = {}): Request {
  const url = opts.force
    ? 'http://localhost/api/automations/ghl-reengagement/run?force=1'
    : 'http://localhost/api/automations/ghl-reengagement/run'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== undefined) headers['Authorization'] = opts.auth
  return new Request(url, { method: 'POST', headers })
}

describe('POST /api/automations/ghl-reengagement/run (REENG-05, REENG-06, REENG-07, REENG-15, REENG-16, REENG-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls.length = 0
    clearAllEnv()
    setAllEnv()
    vi.mocked(runReengagement).mockResolvedValue(RUNNER_RESULT)
    vi.mocked(createServiceRoleClient).mockReturnValue(buildSupabaseMock())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    clearAllEnv()
  })

  // ---- REENG-06: bearer auth ----
  it('missing Authorization header → 401', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
    expect(vi.mocked(runReengagement)).not.toHaveBeenCalled()
  })

  it('wrong secret value → 401 (constant-time compare with crypto.timingSafeEqual)', async () => {
    const response = await POST(makeRequest({ auth: 'Bearer wrong_secret_value_zzzzz' }))
    expect(response.status).toBe(401)
    expect(vi.mocked(runReengagement)).not.toHaveBeenCalled()
  })

  it('correct secret → does NOT return 401', async () => {
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).not.toBe(401)
  })

  // ---- REENG-07: response shape ----
  it('successful run returns 200 with { processed, sent, skipped, failed, errors[] }', async () => {
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('processed')
    expect(body).toHaveProperty('sent')
    expect(body).toHaveProperty('skipped')
    expect(body).toHaveProperty('failed')
    expect(Array.isArray(body.errors)).toBe(true)
  })

  // ---- REENG-15: missing env vars ----
  it.each(REQUIRED_ENV)('missing %s env var → 500 with actionable error naming the var', async (varName) => {
    // Re-set auth: even when we strip the secret env, the request still needs SOMETHING in Authorization.
    // For the secret env case, the auth must fail FIRST (401), not 500.
    if (varName === 'GHL_REENGAGEMENT_TRIGGER_SECRET') {
      // Use a valid-looking bearer; with the env unset, isAuthorized returns false → 401.
      delete process.env[varName]
      const r = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
      expect(r.status).toBe(401)
      return
    }
    delete process.env[varName]
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(JSON.stringify(body)).toContain(varName)
  })

  it('500 error body includes "missing" and the env var name (actionable)', async () => {
    delete process.env.GHL_REENGAGEMENT_LOCATION_ID
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain('missing')
    expect(body.error).toContain('GHL_REENGAGEMENT_LOCATION_ID')
  })

  // ---- D-32-14: TWILIO env NOT required ----
  it('GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID unset → still succeeds (Twilio env NOT required, D-32-14)', async () => {
    delete process.env.GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(200)
  })

  // ---- REENG-16: optional env defaults ----
  it('GHL_REENGAGEMENT_THRESHOLD_DAYS absent → runner receives 180', async () => {
    delete process.env.GHL_REENGAGEMENT_THRESHOLD_DAYS
    await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(vi.mocked(runReengagement)).toHaveBeenCalledTimes(1)
    const cfg = vi.mocked(runReengagement).mock.calls[0][0]
    expect(cfg.thresholdDays).toBe(180)
  })

  it('GHL_REENGAGEMENT_BATCH_LIMIT absent → runner receives 20 (Vercel Hobby safe default per planning decision)', async () => {
    delete process.env.GHL_REENGAGEMENT_BATCH_LIMIT
    await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(vi.mocked(runReengagement)).toHaveBeenCalledTimes(1)
    const cfg = vi.mocked(runReengagement).mock.calls[0][0]
    expect(cfg.batchLimit).toBe(20)
  })

  // ---- REENG-05: full pass integration ----
  it('correct bearer + all env vars set → invokes runReengagement once and returns its result', async () => {
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(200)
    expect(vi.mocked(runReengagement)).toHaveBeenCalledTimes(1)
    const body = await response.json()
    expect(body).toEqual(RUNNER_RESULT)
  })

  // ---- Sensitive path checks (security) ----
  it('runtime export equals "nodejs" (required for crypto.timingSafeEqual)', async () => {
    const route = await import('@/app/api/automations/ghl-reengagement/run/route')
    expect(route.runtime).toBe('nodejs')
  })

  it('does NOT echo the Authorization header value in any response body or thrown error', async () => {
    const probe = 'SECRET_PROBE_VALUE_xyz123'
    // 401 path: response body should not contain the probe value
    const r1 = await POST(makeRequest({ auth: `Bearer ${probe}` }))
    const t1 = await r1.text()
    expect(t1).not.toContain(probe)

    // 500 path on missing env: also must not echo the probe
    delete process.env.GHL_REENGAGEMENT_LOCATION_ID
    const r2 = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    const t2 = await r2.text()
    expect(t2).not.toContain(probe)
  })

  // ---- REENG-18: DB-backed schedule check ----

  it('missing automation_schedules row → 500 with actionable error mentioning automation_schedules', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabaseMock({ scheduleRow: null }),
    )
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain('automation_schedules')
    expect(vi.mocked(runReengagement)).not.toHaveBeenCalled()
  })

  it('schedule row is_active=false → 200 with { skipped: "inactive" }; runReengagement NOT called', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabaseMock({
        scheduleRow: {
          id: 'sched_1',
          is_active: false,
          next_run_at: PAST_ISO,
          interval_minutes: 60,
        },
      }),
    )
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.skipped).toBe('inactive')
    expect(vi.mocked(runReengagement)).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })

  it('next_run_at > now() and no ?force=1 → 200 with { skipped: "not_due_yet", next_run_at }; runReengagement NOT called', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabaseMock({
        scheduleRow: {
          id: 'sched_1',
          is_active: true,
          next_run_at: FUTURE_ISO,
          interval_minutes: 60,
        },
      }),
    )
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.skipped).toBe('not_due_yet')
    expect(body.next_run_at).toBe(FUTURE_ISO)
    expect(vi.mocked(runReengagement)).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })

  it('?force=1 query param + future next_run_at → runReengagement IS called and run proceeds (D-32-09)', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabaseMock({
        scheduleRow: {
          id: 'sched_1',
          is_active: true,
          next_run_at: FUTURE_ISO,
          interval_minutes: 60,
        },
      }),
    )
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}`, force: true }))
    expect(response.status).toBe(200)
    expect(vi.mocked(runReengagement)).toHaveBeenCalledTimes(1)
    const body = await response.json()
    expect(body).toHaveProperty('processed')
    expect(body).toHaveProperty('sent')
    expect(body).toHaveProperty('skipped')
    expect(body).toHaveProperty('failed')
    expect(Array.isArray(body.errors)).toBe(true)
  })

  it('successful run UPDATEs schedule row: last_run_at=now, next_run_at=now+interval_minutes, last_run_status, last_run_result', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabaseMock({
        scheduleRow: {
          id: 'sched_xyz',
          is_active: true,
          next_run_at: PAST_ISO,
          interval_minutes: 60,
        },
      }),
    )
    const beforeMs = Date.now()
    await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    const afterMs = Date.now()

    expect(updateCalls).toHaveLength(1)
    const { payload, id } = updateCalls[0]
    expect(id).toBe('sched_xyz')
    expect(payload.last_run_status).toBe('success')
    expect(payload.last_run_result).toEqual(RUNNER_RESULT)
    expect(typeof payload.last_run_at).toBe('string')
    expect(typeof payload.next_run_at).toBe('string')

    const lastRunMs = new Date(payload.last_run_at as string).getTime()
    expect(lastRunMs).toBeGreaterThanOrEqual(beforeMs)
    expect(lastRunMs).toBeLessThanOrEqual(afterMs + 5000)

    const nextRunMs = new Date(payload.next_run_at as string).getTime()
    // interval_minutes=60 → next_run = last_run + 60min (±5s tolerance)
    expect(Math.abs(nextRunMs - lastRunMs - 60 * 60_000)).toBeLessThan(5000)
  })

  it('runner returns failed > 0 → schedule row updated with last_run_status="error"', async () => {
    vi.mocked(runReengagement).mockResolvedValue({
      processed: 2,
      sent: 1,
      skipped: 0,
      failed: 1,
      errors: [{ ghl_contact_id: 'ct_x', message: 'GHL 422 bad phone' }],
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabaseMock({
        scheduleRow: {
          id: 'sched_1',
          is_active: true,
          next_run_at: PAST_ISO,
          interval_minutes: 60,
        },
      }),
    )
    const response = await POST(makeRequest({ auth: `Bearer ${VALID_SECRET}` }))
    expect(response.status).toBe(200)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].payload.last_run_status).toBe('error')
  })
})
