// Cron: storage-retention
// Removes expired screenshots and chat media from Supabase Storage and/or R2
// (each object through the backend its stored URL points at). Each sweep is
// a SIMULATION unless its env is exactly 'true' (see src/lib/storage/retention.ts):
//   STORAGE_RETENTION_SCREENSHOTS_ENABLED, STORAGE_RETENTION_CHAT_ENABLED
// Returns a JSON report either way.
//
// Auth: Authorization: Bearer $CRON_SECRET
// Meant to run HOURLY until the backlog drains, and is cheap after that (one empty
// page per sweep). Each run is capped by row counts and by a 60s wall-clock budget
// (RUN_BUDGET_MS) because the endpoint sits behind Cloudflare, which kills a
// response at 100s; a capped run reports `truncated: true` and the next run
// continues. Manual dispatch: .github/workflows/storage-retention.yml
// (the schedule itself lives in skale-cron).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Headroom over the 60s budget for the last in-flight call.
export const maxDuration = 90

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { captureApiError } from '@/lib/api-error'
import * as storage from '@/lib/storage'
import { createSupabaseRetentionStore, runStorageRetention, type R2Ops } from '@/lib/storage/retention'

// R2 side of the sweeps. The store removes through it only for URLs that point at
// R2 (and fails, never falls back to Supabase, when the bucket is not on R2).
const r2Ops: R2Ops = {
  isEnabled: (bucket) => storage.isR2Enabled(bucket as storage.StorageBucket),
  remove: (bucket, paths) => storage.remove(bucket as storage.StorageBucket, paths),
  list: (bucket, dir, limit) => storage.list(bucket as storage.StorageBucket, dir, { limit }),
}

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  try {
    const store = createSupabaseRetentionStore(createServiceRoleClient(), { r2: r2Ops })
    const report = await runStorageRetention({ store })
    return Response.json({ ok: true, ...report })
  } catch (err) {
    console.error('[cron/storage-retention] unexpected error:', err)
    captureApiError(err)
    return Response.json({ ok: false, error: 'Retention run failed' }, { status: 500 })
  }
}
