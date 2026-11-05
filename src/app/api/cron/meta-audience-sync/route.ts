// Cron: meta-audience-sync
// Recovery reconciliation for enabled, due tenant-owned Meta Custom Audiences.
// Logic: src/lib/meta/audience-job.ts (per-audience claim and ledger live in
// audience-reconcile / claim_meta_audience_sync).
//
// A run can take minutes, and the Cloudflare proxy cuts responses at 100s, so
// this responds immediately and does the work in after(). A run lock
// (src/lib/cron/run-lock.ts) stops two runs from overlapping; a tick that finds
// the lock held returns { started: false, skipped: 'already_running' }.
// The outcome (counts) is written to the server log and, on failures, Sentry.
//
// Schedule: hourly from skale-cron.
// Auth: Authorization: Bearer $CRON_SECRET (fails closed).
// Query (all optional, for manual runs): org=<org-id>  audience=<config-id>  dry_run=1
// Env: CRON_SECRET, ENCRYPTION_SECRET (64 hex), plus the app's database env.
// maxDuration is advisory on this self-hosted Node server (not enforced).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 1800

import { after } from 'next/server'
import { captureApiError } from '@/lib/api-error'
import { authorizeCron, boolParam, strParam } from '@/lib/cron/auth'
import { acquireRunLock } from '@/lib/cron/run-lock'
import { runAudienceJob, requireRuntime } from '@/lib/meta/audience-job'

const LOCK_NAME = 'meta-audience-sync'
const LOCK_TTL_MS = 35 * 60_000

export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCron(request)
  if (denied) return denied

  try {
    requireRuntime(process.env)
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'misconfigured' },
      { status: 500 },
    )
  }

  const url = new URL(request.url)
  const options = {
    orgId: strParam(url, 'org'),
    audienceId: strParam(url, 'audience'),
    dryRun: boolParam(url, 'dry_run'),
  }

  const lock = await acquireRunLock(LOCK_NAME, LOCK_TTL_MS)
  if (!lock) {
    return Response.json({ ok: true, started: false, skipped: 'already_running' })
  }

  try {
    after(async () => {
      const startedAt = Date.now()
      try {
        const report = await runAudienceJob(options)
        console.log(`[cron/meta-audience-sync] ${JSON.stringify({ ...report, dryRun: options.dryRun, durationMs: Date.now() - startedAt })}`)
        if (report.failed > 0) {
          captureApiError(new Error(`${report.failed} Meta audience reconciliation(s) failed`), {
            route: 'api/cron/meta-audience-sync',
            ...report,
          })
        }
      } catch (err) {
        console.error('[cron/meta-audience-sync] run failed:', err instanceof Error ? err.message : 'unknown error')
        captureApiError(err, { route: 'api/cron/meta-audience-sync' })
      } finally {
        await lock.release()
      }
    })
  } catch (err) {
    await lock.release()
    captureApiError(err, { route: 'api/cron/meta-audience-sync' })
    return Response.json({ ok: false, error: 'could not schedule run' }, { status: 500 })
  }

  return Response.json({ ok: true, started: true, dryRun: options.dryRun })
}
