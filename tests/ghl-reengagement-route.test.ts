// tests/ghl-reengagement-route.test.ts
// Phase 32 — REENG-05, REENG-06, REENG-07, REENG-15, REENG-16.
// RED until Plan 04 ships src/app/api/automations/ghl-reengagement/run/route.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Will be imported once Plan 04 ships:
// import { POST } from '@/app/api/automations/ghl-reengagement/run/route'

const REQUIRED_ENV = [
  'GHL_REENGAGEMENT_LOCATION_ID',
  'GHL_REENGAGEMENT_INTEGRATION_ID',
  'GHL_REENGAGEMENT_MESSAGE',
  'GHL_REENGAGEMENT_TRIGGER_SECRET',
] as const  // REVISED 2026-05-15: removed GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID — SMS now via GHL

describe('POST /api/automations/ghl-reengagement/run (REENG-05, REENG-06, REENG-07, REENG-15, REENG-16, REENG-18)', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  // ---- REENG-06: bearer auth ----
  it('missing Authorization header → 401', async () => {
    expect.fail('Plan 04 must enforce bearer auth — test stub from Plan 01 Wave 0')
  })

  it('wrong secret value → 401 (constant-time compare with crypto.timingSafeEqual)', async () => {
    expect.fail('Plan 04 must use timingSafeEqual — test stub from Plan 01 Wave 0')
  })

  it('correct secret → does NOT return 401', async () => {
    expect.fail('Plan 04 must accept valid bearer — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-07: response shape ----
  it('successful run returns 200 with { processed, sent, skipped, failed, errors[] }', async () => {
    // Assert response.status === 200
    // const body = await response.json()
    // expect(body).toHaveProperty('processed')
    // expect(body).toHaveProperty('sent')
    // expect(body).toHaveProperty('skipped')
    // expect(body).toHaveProperty('failed')
    // expect(Array.isArray(body.errors)).toBe(true)
    expect.fail('Plan 04 must return required JSON shape — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-15: missing env vars ----
  it.each(REQUIRED_ENV)('missing %s env var → 500 with actionable error naming the var', async (varName) => {
    expect.fail(`Plan 04 must 500 on missing ${varName} — test stub from Plan 01 Wave 0`)
  })

  it('500 error body includes "missing" and the env var name (actionable)', async () => {
    expect.fail('Plan 04 must produce actionable error — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-16: optional env defaults ----
  it('GHL_REENGAGEMENT_THRESHOLD_DAYS absent → runner receives 180', async () => {
    expect.fail('Plan 04 must default threshold to 180 — test stub from Plan 01 Wave 0')
  })

  it('GHL_REENGAGEMENT_BATCH_LIMIT absent → runner receives 20 (Vercel Hobby safe default per planning decision)', async () => {
    // NOTE: STATE.md mentions 100 as the ceiling; planner locked default = 20 for Hobby safety.
    // Plan 04 must wire the constant 20 as the fallback.
    expect.fail('Plan 04 must default batch limit to 20 — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-05: full pass integration ----
  it('correct bearer + all env vars set → invokes runReengagement once and returns its result', async () => {
    expect.fail('Plan 04 must orchestrate full pass — test stub from Plan 01 Wave 0')
  })

  // ---- Sensitive path checks (security) ----
  it('runtime export equals "nodejs" (required for crypto.timingSafeEqual)', async () => {
    // const route = await import('@/app/api/automations/ghl-reengagement/run/route')
    // expect(route.runtime).toBe('nodejs')
    expect.fail('Plan 04 must declare runtime=nodejs — test stub from Plan 01 Wave 0')
  })

  it('does NOT echo the Authorization header value in any response body or thrown error', async () => {
    // Send a request with Authorization: Bearer SECRET_PROBE_VALUE_xyz123
    // Capture response body + any thrown stack
    // Assert neither contains 'SECRET_PROBE_VALUE_xyz123'
    expect.fail('Plan 04 must never leak bearer in responses (T-32-02) — test stub from Plan 01 Wave 0')
  })

  // ---- REENG-18: DB-backed schedule check (added 2026-05-15 per D-32-06..09) ----
  // The route handler reads the automation_schedules row keyed by 'ghl_reengagement_sms'
  // at the top of every request and decides whether to actually run.

  it('missing automation_schedules row → 500 with actionable error mentioning automation_schedules', async () => {
    // Plan 04: mock supabase.from('automation_schedules').select(...).single() → { data: null, error: null }
    // Assert response.status === 500
    // Assert body.error includes 'automation_schedules'
    expect.fail('Plan 04 must 500 on missing schedule row — test stub from Plan 01 Wave 0')
  })

  it('schedule row is_active=false → 200 with { skipped: "inactive" }; runReengagement NOT called', async () => {
    // Plan 04: mock schedule row { is_active: false, next_run_at: past }
    // Spy on runReengagement — assert NOT called
    // Assert response body.skipped === 'inactive'
    expect.fail('Plan 04 must skip when inactive — test stub from Plan 01 Wave 0')
  })

  it('next_run_at > now() and no ?force=1 → 200 with { skipped: "not_due_yet", next_run_at }; runReengagement NOT called', async () => {
    // Plan 04: mock schedule row { is_active: true, next_run_at: future, interval_minutes: 1440 }
    // Spy on runReengagement — assert NOT called
    // Assert response body.skipped === 'not_due_yet'
    // Assert response body.next_run_at matches the mocked value
    expect.fail('Plan 04 must skip when not due — test stub from Plan 01 Wave 0')
  })

  it('?force=1 query param + future next_run_at → runReengagement IS called and run proceeds (D-32-09)', async () => {
    // Plan 04: mock schedule row with future next_run_at
    // Send POST with URL ?force=1
    // Spy on runReengagement — assert called exactly once
    // Assert response.status === 200 and body has { processed, sent, skipped, failed, errors[] } shape
    expect.fail('Plan 04 must bypass schedule with ?force=1 — test stub from Plan 01 Wave 0')
  })

  it('successful run UPDATEs schedule row: last_run_at=now, next_run_at=now+interval_minutes, last_run_status, last_run_result', async () => {
    // Plan 04: mock schedule { interval_minutes: 60, next_run_at: past }, mock runReengagement → result
    // Spy on supabase.from('automation_schedules').update(...) call
    // Assert update payload contains last_run_at (ISO string near now), last_run_status ('success'),
    //   last_run_result deep-equals the runReengagement result, and next_run_at is now+60min (±a few seconds)
    expect.fail('Plan 04 must reschedule after success — test stub from Plan 01 Wave 0')
  })

  it('runReengagement throws → schedule row updated with last_run_status="error" (claim not rolled forward)', async () => {
    // Plan 04: mock schedule due, mock runReengagement → throws Error('GHL 401')
    // Assert update call has last_run_status === 'error' AND last_run_result captures the error message
    // Assert response.status is 500 with error_detail
    expect.fail('Plan 04 must record error status — test stub from Plan 01 Wave 0')
  })
})
