// src/app/api/cron/ads-changes-tick/route.ts
//
// Worker for the Ads Command Engine, meant to run every minute or two:
//   - executes queued changes whose retry time has come (transient provider
//     errors back off 1, 2, 4, 8 min; after 5 attempts → failed/retries_exhausted)
//   - expires approvals past their deadline
//   - reports changes stuck in executing/verifying (never auto-retried: whether
//     the provider write landed is unknown — an operator decides)
//
// Auth: Authorization: Bearer <CRON_SECRET>, fail-closed (same as ads-tick).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { captureApiError } from '@/lib/api-error'
import { processChangeQueue } from '@/lib/ads/commands/engine'
import { createLogger } from '@/lib/obs/logger'

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request): Promise<Response> {
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const log = createLogger({ route: 'api/cron/ads-changes-tick' })
  try {
    const result = await processChangeQueue({ limit: 25 })
    if (result.stuck.length > 0) {
      log.warn('ads changes stuck mid-flight', { count: result.stuck.length, ids: result.stuck.map((s) => s.id) })
    }
    return Response.json({ ok: true, ...result, stuck: result.stuck.length })
  } catch (error) {
    captureApiError(error, { route: 'api/cron/ads-changes-tick' })
    return Response.json({ ok: false, error: 'tick failed' }, { status: 500 })
  }
}
