// src/app/api/automations/ghl-reengagement/run/route.ts
// Phase 32 (v1.9): Protected internal endpoint that runs one pass of the
// GHL Lost-Lead Reengagement SMS automation. Triggered by a GitHub Actions
// 15-minute pulse cron OR manual workflow_dispatch (?force=1 to bypass the
// DB schedule). NOT a public webhook — bearer-secret protected.
//
// Pattern source: 32-RESEARCH.md Pattern 7 (bearer auth) + Pattern 3
// (service-role client) + Pattern 9 (DB-backed schedule check).
//
// Unlike webhook routes (always 200), this endpoint returns 401 on auth
// failure and 500 on env/runtime errors so the GitHub Action surfaces them
// as failed workflow runs.

import { timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runReengagement, type RunnerConfig, type RunnerResult } from '@/lib/automations/ghl-reengagement/runner'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'

const DEFAULT_THRESHOLD_DAYS = 180
const DEFAULT_BATCH_LIMIT = 20
const AUTOMATION_KEY = 'ghl_reengagement_sms'

const REQUIRED_ENV = [
  'GHL_REENGAGEMENT_LOCATION_ID',
  'GHL_REENGAGEMENT_INTEGRATION_ID',
  'GHL_REENGAGEMENT_MESSAGE',
  'GHL_REENGAGEMENT_TRIGGER_SECRET',
] as const

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(.+)$/)
  if (!m) return false
  const expected = process.env.GHL_REENGAGEMENT_TRIGGER_SECRET ?? ''
  if (!expected) return false
  const providedBuf = Buffer.from(m[1])
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export async function POST(request: Request): Promise<Response> {
  // ---- 1. Auth (constant-time bearer compare) ----
  if (!isAuthorized(request)) {
    return jsonError('unauthorized', 401)
  }

  // ---- 2. Required env vars (D-32-15) ----
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) {
      return jsonError(`missing required env var: ${name}`, 500)
    }
  }

  // ---- 3. Optional env defaults (D-32-16) ----
  const thresholdDays = parsePositiveInt(
    process.env.GHL_REENGAGEMENT_THRESHOLD_DAYS,
    DEFAULT_THRESHOLD_DAYS,
  )
  const batchLimit = parsePositiveInt(
    process.env.GHL_REENGAGEMENT_BATCH_LIMIT,
    DEFAULT_BATCH_LIMIT,
  )
  const fromNumberOverride = process.env.GHL_REENGAGEMENT_FROM_NUMBER || undefined

  // ---- 4. Force flag ----
  const force = (() => {
    try {
      return new URL(request.url).searchParams.get('force') === '1'
    } catch {
      return false
    }
  })()

  try {
    const supabase = createServiceRoleClient()

    // ---- 5. Schedule check (D-32-08) ----
    const { data: sched, error: schedErr } = await supabase
      .from('automation_schedules')
      .select('id, is_active, next_run_at, interval_minutes')
      .eq('automation_key', AUTOMATION_KEY)
      .single()

    if (schedErr || !sched) {
      return jsonError(
        `automation_schedules row missing for ${AUTOMATION_KEY}`,
        500,
      )
    }
    if (sched.is_active !== true) {
      return Response.json({ skipped: 'inactive' }, { status: 200 })
    }
    if (!force && new Date(sched.next_run_at).getTime() > Date.now()) {
      return Response.json(
        { skipped: 'not_due_yet', next_run_at: sched.next_run_at },
        { status: 200 },
      )
    }

    // ---- 6. Run one pass ----
    const runStartedAtIso = new Date().toISOString()
    const cfg: RunnerConfig = {
      integrationId: process.env.GHL_REENGAGEMENT_INTEGRATION_ID!,
      locationId: process.env.GHL_REENGAGEMENT_LOCATION_ID!,
      messageTemplate: process.env.GHL_REENGAGEMENT_MESSAGE!,
      thresholdDays,
      batchLimit,
      fromNumberOverride,
      runStartedAtIso,
    }
    const result: RunnerResult = await runReengagement(cfg, supabase)

    // ---- 7. Reschedule (D-32-08) ----
    const nowMs = Date.now()
    const nextRunAt = new Date(
      nowMs + sched.interval_minutes * 60_000,
    ).toISOString()
    const lastRunStatus: 'success' | 'error' = result.failed > 0 ? 'error' : 'success'
    await supabase
      .from('automation_schedules')
      .update({
        last_run_at: new Date(nowMs).toISOString(),
        next_run_at: nextRunAt,
        last_run_status: lastRunStatus,
        last_run_result: result as unknown as Json,
        updated_at: new Date(nowMs).toISOString(),
      })
      .eq('id', sched.id)

    return Response.json(result, { status: 200 })
  } catch (err) {
    // Sanitized — never echoes the Authorization header value (we never read it
    // into a variable that's part of the error chain). Messages come from
    // runReengagement / supabase / ghlFetchJson which are pre-sanitized.
    const message = err instanceof Error ? err.message : String(err)
    return jsonError(message, 500)
  }
}
