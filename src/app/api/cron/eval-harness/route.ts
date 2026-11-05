// Cron: eval-harness
// Weekly LLM-judge eval of one real agent against the golden set
// (src/lib/evals). Gates: average >= 3.5/5 and no case below 2/5.
//
// The suite takes many minutes, so this responds immediately and runs it in
// after() behind a run lock (src/lib/cron/run-lock.ts). The report (counts and
// scores only) goes to the server log; a failed gate or a crashed run is sent
// to Sentry. NOTE: the eval talks to the agent in production mode, exactly like
// the old GitHub job did, so it uses real provider credit and agent tools.
//
// Schedule: Mondays 08:00 UTC from skale-cron.
// Auth: Authorization: Bearer $CRON_SECRET (fails closed).
// Query (optional): org_id=<id>  agent_id=<id> (override EVAL_ORG_ID / EVAL_AGENT_ID)
// Env: CRON_SECRET, ANTHROPIC_API_KEY, EVAL_ORG_ID, EVAL_AGENT_ID,
//      ENCRYPTION_SECRET (agent runtime decrypts provider keys), plus database env.
// maxDuration is advisory on this self-hosted Node server (not enforced).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 1200

import { after } from 'next/server'
import { captureApiError } from '@/lib/api-error'
import { authorizeCron, strParam } from '@/lib/cron/auth'
import { acquireRunLock } from '@/lib/cron/run-lock'
import { requireEvalConfig, runEvalSuite } from '@/lib/evals/run-eval'

const LOCK_NAME = 'eval-harness'
const LOCK_TTL_MS = 25 * 60_000

export async function GET(request: Request): Promise<Response> {
  const denied = authorizeCron(request)
  if (denied) return denied

  const url = new URL(request.url)
  const orgId = (strParam(url, 'org_id') ?? process.env.EVAL_ORG_ID?.trim()) || null
  const agentId = (strParam(url, 'agent_id') ?? process.env.EVAL_AGENT_ID?.trim()) || null

  const missing = requireEvalConfig(process.env, orgId, agentId)
  if (missing.length > 0) {
    // Not an error for a scheduled run: the harness is simply not configured.
    return Response.json({ ok: true, started: false, skipped: 'not_configured', missing })
  }

  const lock = await acquireRunLock(LOCK_NAME, LOCK_TTL_MS)
  if (!lock) {
    return Response.json({ ok: true, started: false, skipped: 'already_running' })
  }

  try {
    after(async () => {
      const startedAt = Date.now()
      try {
        const report = await runEvalSuite({ orgId: orgId!, agentId: agentId! })
        const counts = {
          cases: report.cases,
          errored: report.errored,
          average: report.average,
          belowCaseMinimum: report.belowCaseMinimum,
          belowGate: report.belowGate,
          passed: report.passed,
        }
        console.log(`[cron/eval-harness] ${JSON.stringify({ ...counts, durationMs: Date.now() - startedAt })}`)
        if (!report.passed) {
          captureApiError(new Error('Agent eval gate failed'), { route: 'api/cron/eval-harness', ...counts })
        }
      } catch (err) {
        console.error('[cron/eval-harness] run failed:', err instanceof Error ? err.message : 'unknown error')
        captureApiError(err, { route: 'api/cron/eval-harness' })
      } finally {
        await lock.release()
      }
    })
  } catch (err) {
    await lock.release()
    captureApiError(err, { route: 'api/cron/eval-harness' })
    return Response.json({ ok: false, error: 'could not schedule run' }, { status: 500 })
  }

  return Response.json({ ok: true, started: true })
}
