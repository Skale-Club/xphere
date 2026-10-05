// Cron: seo-tick
//
// Advances SEO site audits in resumable slices (see src/lib/seo/audit-engine.ts):
// enqueue scheduled audits, lease up to 3 runnable ones, crawl/finalise within
// a ~50s budget, prune old audit detail. Meant to fire every minute from the
// skale-cron container; .github/workflows/seo-tick.yml is the manual fallback.
//
// The budget stays well under Cloudflare's 100s origin timeout. Work cut off
// by the budget, a deploy or a crash is picked up by the next tick once the
// audit's lease expires.
//
// Auth: Authorization: Bearer <CRON_SECRET>, mandatory. This endpoint makes
// outbound requests on the platform's behalf and writes, so it fails closed
// when the secret is unset (same posture as /api/cron/ads-tick).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { captureApiError } from '@/lib/api-error'
import { runSeoTick } from '@/lib/seo/audit-engine'

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const TICK_BUDGET_MS = 50_000

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
  const started = Date.now()
  try {
    const result = await runSeoTick(supabase, TICK_BUDGET_MS)
    return Response.json({ ok: true, duration_ms: Date.now() - started, ...result })
  } catch (err) {
    captureApiError(err, { route: 'api/cron/seo-tick' })
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - started },
      { status: 500 },
    )
  }
}
