export const runtime = 'nodejs'

import { processIngest } from '@/lib/traffic/ingest'
import type { IngestPayload } from '@/lib/traffic/types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as IngestPayload

    if (!body.token || !body.visitor_id || !body.session_key || !body.type) {
      return Response.json({ ok: true }, { headers: CORS_HEADERS })
    }

    // Extract geo from Vercel headers (available on both edge and node runtimes)
    const countryCode = request.headers.get('x-vercel-ip-country') ?? null
    const cityEncoded = request.headers.get('x-vercel-ip-city') ?? null
    const city = cityEncoded ? decodeURIComponent(cityEncoded) : null
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

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
