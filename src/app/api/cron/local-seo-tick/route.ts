// src/app/api/cron/local-seo-tick/route.ts
//
// Drives the Local SEO geogrid queue: starts due scheduled scans, fetches due
// scan points, polls async provider tasks that never posted back, and
// finalizes finished scans. See src/lib/local-seo/worker.ts for the state
// machine and src/lib/local-seo/schedules.ts for schedules.
//
// Schedule: every minute from skale-cron, against origin.xphere.app (the
// Cloudflare proxy cuts requests at 100 s; the tick budget is ~55 s).
//
// Auth: Authorization: Bearer <CRON_SECRET>, mandatory. The tick spends real
// provider money, so it fails closed when the secret is unset.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { captureApiError } from '@/lib/api-error'
import { runDueSchedules } from '@/lib/local-seo/schedules'
import { runLocalSeoTick } from '@/lib/local-seo/worker'

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function GET(request: Request): Promise<Response> {
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  try {
    // Schedules first: the scans they create are picked up by this same tick.
    const schedules = await runDueSchedules(supabase)
    const tick = await runLocalSeoTick(supabase, { budgetMs: 45_000 })
    return Response.json({ ok: true, schedules, tick })
  } catch (err) {
    captureApiError(err, { route: 'api/cron/local-seo-tick' })
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'tick failed' }, { status: 500 })
  }
}
