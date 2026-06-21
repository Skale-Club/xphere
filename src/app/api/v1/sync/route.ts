// POST /api/v1/sync
//
// The single, generic CRM-mirror endpoint shared by every sibling platform app
// (Xtimator, XmartMenu, Xkedule, …). Each app POSTs the same envelope with its
// own `source`, mirroring one of its tenants into the caller-org's CRM as an
// Account + Contact + Opportunity (+ optional Note). This replaces the per-app
// receivers (e.g. /api/xtimator/webhook) — one contract instead of one tentacle
// per app.
//
// Auth: Authorization: Bearer <token> — api_keys lookup, org pinned by the key
//   (apps never send an org_id). Any non-revoked key for the org authorizes the
//   mirror (no scope gate — matches the sibling-integration pattern).
// Idempotency + ordering: dedup by (org, external_source=source, external_id)
//   with last-write-wins on external_updated_at vs the event's occurred_at.
//
// Unlike a webhook receiver, this returns REAL status codes so callers can drive
// retry/DLQ logic: 200 ok · 401 bad auth · 422 bad payload · 500 server error.
// 5xx/429 → caller retries; 4xx → caller treats as permanent.

import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  mirrorPayloadSchema,
  runCrmMirror,
  defaultPipelineName,
} from '@/lib/crm-mirror/mirror'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return Response.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!apiKey) {
    return Response.json({ error: 'Invalid or revoked API key' }, { status: 401, headers: CORS_HEADERS })
  }

  // ── 2. Parse ───────────────────────────────────────────────────────────────
  let payload: import('@/lib/crm-mirror/mirror').MirrorPayload
  try {
    payload = mirrorPayloadSchema.parse(await request.json())
  } catch (err) {
    return Response.json(
      { error: 'Invalid request body', details: (err as { errors?: unknown }).errors },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  // ── 3. Mirror ──────────────────────────────────────────────────────────────
  try {
    const pipelineName = payload.opportunity?.pipeline ?? defaultPipelineName(payload.source)
    const result = await runCrmMirror(supabase, apiKey.org_id, {
      source: payload.source,
      pipelineName,
      company: payload.company,
      opportunity: payload.opportunity,
      note: payload.note,
      occurredAt: payload.occurred_at,
    })

    // ── 4. Touch last_used_at (fire-and-forget) ────────────────────────────────
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKey.id)
      .then(() => {})

    return Response.json({ ok: true, ...result }, { status: 200, headers: CORS_HEADERS })
  } catch (err) {
    console.error('[api/v1/sync] mirror error:', err)
    return Response.json({ error: 'Mirror failed' }, { status: 500, headers: CORS_HEADERS })
  }
}
