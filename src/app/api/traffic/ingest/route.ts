export const runtime = 'nodejs'

import { processIngest } from '@/lib/traffic/ingest'
import type { IngestPayload } from '@/lib/traffic/types'
import { rateLimit } from '@/lib/rate-limit'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// S11 — rate-limit public analytics ingest: 120 events/min per IP (fail-open)
const RL_LIMIT = 120
const RL_WINDOW = 60

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rl = await rateLimit(`traffic:ingest:${ip}`, RL_LIMIT, RL_WINDOW)
    if (!rl.allowed) {
      return Response.json({ ok: true }, { headers: CORS_HEADERS })
    }

    const body = await request.json() as IngestPayload

    if (!body.token || !body.visitor_id || !body.session_key || !body.type) {
      return Response.json({ ok: true }, { headers: CORS_HEADERS })
    }

    // Extract geo from Vercel headers (available on both edge and node runtimes)
    const countryCode = request.headers.get('x-vercel-ip-country') ?? null
    const cityEncoded = request.headers.get('x-vercel-ip-city') ?? null
    const city = cityEncoded ? decodeURIComponent(cityEncoded) : null

    const countryName = countryCode ? countryCodeToName(countryCode) : null

    await processIngest(body, ip, countryCode, countryName, city)
  } catch {
    // Ingest must never return an error to the client
  }

  return Response.json({ ok: true }, { headers: CORS_HEADERS })
}

function countryCodeToName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
