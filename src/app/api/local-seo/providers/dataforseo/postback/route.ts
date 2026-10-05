// DataForSEO postback receiver for geogrid tasks.
//
// DataForSEO POSTs each finished task (gzip-compressed JSON) to the
// postback_url set at task_post time. Like every inbound webhook here it
// always answers 200 — a non-2xx makes the provider retry, and the worker's
// polling fallback picks up anything this endpoint misses. Idempotent: a task
// is applied only while its point is still in flight.
//
// Auth: the shared secret embedded in the URL (LOCAL_SEO_POSTBACK_SECRET).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { captureApiError } from '@/lib/api-error'
import { postbackSecret } from '@/lib/local-seo/credentials'
import { parseDataForSeoPostback } from '@/lib/local-seo/providers/dataforseo'
import { applyTaskOutcome } from '@/lib/local-seo/worker'

function secretMatches(given: string | null): boolean {
  const expected = postbackSecret()
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (!secretMatches(url.searchParams.get('secret'))) return Response.json({ ok: true })

    const raw = Buffer.from(await request.arrayBuffer())
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
    const body = JSON.parse(text) as unknown

    const admin = createServiceRoleClient()
    let applied = 0
    for (const { taskId, outcome } of parseDataForSeoPostback(body)) {
      if ((await applyTaskOutcome(admin, taskId, outcome)) === 'applied') applied++
    }
    return Response.json({ ok: true, applied })
  } catch (err) {
    captureApiError(err, { route: 'api/local-seo/providers/dataforseo/postback' })
    return Response.json({ ok: true })
  }
}
