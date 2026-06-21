// POST /api/xtimator/webhook  — DEPRECATED ALIAS
//
// Back-compat shim for the live Xtimator integration. The CRM-mirror logic now
// lives in src/lib/crm-mirror and is exposed generically at POST /api/v1/sync;
// this route just injects source='xtimator' + the legacy pipeline name and calls
// the same engine, preserving the original webhook contract (always HTTP 200).
//
// Remove once Xtimator is repointed to /api/v1/sync (source:'xtimator',
// opportunity.pipeline:'Xtimator Lifecycle').

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runCrmMirror } from '@/lib/crm-mirror/mirror'

export const runtime = 'nodejs'

const EXTERNAL_SOURCE = 'xtimator'
const PIPELINE_NAME = 'Xtimator Lifecycle'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Legacy payload: the original Xtimator shape (no `source` field — it was the
// hardcoded constant). Validated here, then mapped onto the generic engine.
const legacySchema = z.object({
  event: z.string(),
  delivery_id: z.string().optional(),
  occurred_at: z.string(),
  company: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().min(1),
    owner_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  }),
  opportunity: z
    .object({
      stage: z.string().min(1),
      status: z.enum(['open', 'won', 'lost']).optional(),
      value: z.number().nonnegative().optional(),
      title: z.string().optional(),
    })
    .optional(),
  note: z
    .object({
      title: z.string().optional(),
      content: z.string().min(1),
    })
    .optional(),
})

export async function POST(request: Request): Promise<Response> {
  const ok = (extra?: Record<string, unknown>) => Response.json({ ok: true, ...extra })
  try {
    // 1. Auth
    const auth = request.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return ok()
    const token = auth.slice(7).trim()
    if (!token) return ok()

    const supabase = createServiceRoleClient()
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('id, org_id')
      .eq('key_hash', hashToken(token))
      .is('revoked_at', null)
      .maybeSingle()
    if (!apiKey) return ok()

    // 2. Parse legacy payload
    let payload: z.infer<typeof legacySchema>
    try {
      payload = legacySchema.parse(await request.json())
    } catch {
      return ok({ skipped: 'bad_payload' })
    }

    // 3. Mirror via the shared engine (source + pipeline injected here)
    const result = await runCrmMirror(supabase, apiKey.org_id, {
      source: EXTERNAL_SOURCE,
      pipelineName: PIPELINE_NAME,
      company: payload.company,
      opportunity: payload.opportunity,
      note: payload.note,
      occurredAt: payload.occurred_at,
    })

    // 4. Touch last_used_at (fire-and-forget)
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKey.id)
      .then(() => {})

    if (result.stale) return ok({ skipped: 'stale' })
    return ok({
      account_id: result.account_id,
      contact_id: result.contact_id,
      opportunity_id: result.opportunity_id,
      ...(result.opportunity_skipped ? { opportunity_skipped: result.opportunity_skipped } : {}),
    })
  } catch (err) {
    console.error('[xtimator/webhook] error:', err)
    return Response.json({ ok: true })
  }
}
