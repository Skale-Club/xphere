// POST /api/v1/accounts/:id/notes
// Adds a note, observation, or recommendation to an account written by an
// external agent (e.g. the Hermes AI).
//
// Auth: Authorization: Bearer <token>
//   Token is SHA-256 hashed and looked up in api_keys.key_hash.
//   The key must hold the `prospects:enrich` scope.
//
// Params: id — account UUID (path segment)
//
// Body:
//   { note: string, type: "recommendation" | "observation" | "action" }
//
// Creates a prospect_engagement_event with:
//   event_type = "note"
//   entity_type = "account"
//   payload    = { note, type, author: "hermes" }
//
// Returns: { event_id, account_id, created_at }

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { hasScope } from '@/lib/api-keys/scopes'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const bodySchema = z.object({
  note: z.string().min(1).max(10_000),
  type: z.enum(['recommendation', 'observation', 'action']),
})

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: accountId } = await params

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
    .select('id, org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!apiKey) {
    return Response.json({ error: 'Invalid or revoked API key' }, { status: 401, headers: CORS_HEADERS })
  }
  if (!hasScope(apiKey.scopes, 'prospects:enrich')) {
    return Response.json(
      { error: 'API key is missing the prospects:enrich scope' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 422, headers: CORS_HEADERS })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(raw)
  } catch (err) {
    return Response.json(
      { error: 'Invalid request body', details: (err as z.ZodError).errors },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  // ── 3. Verify account exists + belongs to org ─────────────────────────────
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .eq('org_id', apiKey.org_id)
    .maybeSingle()

  if (!account) {
    return Response.json({ error: 'Account not found' }, { status: 404, headers: CORS_HEADERS })
  }

  // ── 4. Insert engagement event ────────────────────────────────────────────
  const { data: event, error: insertError } = await supabase
    .from('prospect_engagement_events')
    .insert({
      org_id: apiKey.org_id,
      entity_type: 'account',
      entity_id: accountId,
      event_type: 'note',
      source_platform: 'hermes',
      payload: { note: body.note, type: body.type, author: 'hermes' } as Json,
    })
    .select('id, created_at')
    .single()

  if (insertError || !event) {
    console.error('[api/v1/accounts/notes] insert error:', insertError)
    return Response.json({ error: 'Failed to create note' }, { status: 500, headers: CORS_HEADERS })
  }

  // Touch last_used_at (fire-and-forget)
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {})

  return Response.json(
    { event_id: event.id, account_id: accountId, created_at: event.created_at },
    { status: 201, headers: CORS_HEADERS },
  )
}
