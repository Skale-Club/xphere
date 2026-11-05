// Cron: meta-capi-worker
// Drains the Meta Conversions API outbox (meta_capi_events): sends queued
// Lead / QualifiedLead / Purchase events to each org's dataset with
// retry/backoff and dead-lettering. Logic: src/lib/meta/capi-worker.ts.
//
// Runs inline (no after()): the drain caps its own wall-clock at 60s so the
// response always lands before Cloudflare's 100s cut. Rows it did not reach
// stay due and are picked up by the next tick, oldest first.
//
// Schedule: every 5 minutes from skale-cron.
// Auth: Authorization: Bearer $CRON_SECRET (fails closed).
// Query (all optional, for manual runs): org=<org-id>  test=1  dry_run=1
// Env: CRON_SECRET, ENCRYPTION_SECRET, META_SYSTEM_USER_TOKEN (fallback token),
//      plus the app's database env.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

import { captureApiError } from '@/lib/api-error'
import { authorizeCron, boolParam, strParam } from '@/lib/cron/auth'
import { acquireRunLock } from '@/lib/cron/run-lock'
import { runCapiDrain, CAPI_DEFAULT_BUDGET_MS } from '@/lib/meta/capi-worker'

const LOCK_NAME = 'meta-capi-worker'
const LOCK_TTL_MS = 3 * 60_000

export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCron(request)
  if (denied) return denied

  const url = new URL(request.url)
  const lock = await acquireRunLock(LOCK_NAME, LOCK_TTL_MS)
  if (!lock) {
    return Response.json({ ok: true, skipped: 'already_running' })
  }

  const startedAt = Date.now()
  try {
    const report = await runCapiDrain({
      orgId: strParam(url, 'org'),
      test: boolParam(url, 'test'),
      dryRun: boolParam(url, 'dry_run'),
      budgetMs: CAPI_DEFAULT_BUDGET_MS,
    })
    return Response.json({ ok: true, ...report, durationMs: Date.now() - startedAt })
  } catch (err) {
    captureApiError(err, { route: 'api/cron/meta-capi-worker' })
    return Response.json({ ok: false, error: 'drain failed' }, { status: 500 })
  } finally {
    await lock.release()
  }
}
