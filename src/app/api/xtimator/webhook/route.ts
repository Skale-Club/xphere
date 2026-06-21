// POST /api/xtimator/webhook
//
// Receives lifecycle events from Xtimator and mirrors each Xtimator company into
// this org's CRM as an Account (the business) + Contact (the owner) +
// Opportunity (the subscription deal), optionally appending a timeline Note.
//
// Auth: Authorization: Bearer <token> — same api_keys lookup as /api/v1 and the
//   Xkedule receiver. The key's org_id pins every mirrored row to one org
//   (Xtimator never sends an org_id). Any non-revoked key for the org authorizes
//   the mirror (no scope gate — matches the Xkedule sibling-integration pattern).
// Idempotency + ordering: dedup by (org, external_source='xtimator', external_id)
//   with last-write-wins on external_updated_at vs the event's occurred_at.
// Webhook convention: always returns HTTP 200.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'

export const runtime = 'nodejs'

const EXTERNAL_SOURCE = 'xtimator'
// The org must contain a pipeline with this exact name (stages matched by name).
const PIPELINE_NAME = 'Xtimator Lifecycle'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Untyped service-role client: the mirror columns (external_source on
// contacts/accounts, external_* on opportunities) land via migration 1213 and
// aren't in the generated Database types yet — same pattern the MCP tools use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

// Alias so helper signatures avoid a bare `any` token (lint) while still
// accepting the untyped mirror columns.
type Db = ReturnType<typeof db>

const payloadSchema = z.object({
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
  // Pre-mapped by Xtimator: stage is the target stage name in the
  // "Xtimator Lifecycle" pipeline. Xphere stays decoupled from Xtimator's event
  // vocabulary — it only resolves the stage by name.
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

type Payload = z.infer<typeof payloadSchema>
type Company = Payload['company']

async function upsertAccount(
  supabase: Db,
  orgId: string,
  companyId: string,
  c: Company,
  occurredAt: string,
): Promise<{ id: string | null; stale: boolean }> {
  const { data: existing } = await supabase
    .from('accounts')
    .select('id, external_updated_at')
    .eq('org_id', orgId)
    .eq('external_source', EXTERNAL_SOURCE)
    .eq('external_id', companyId)
    .maybeSingle()

  const fields = {
    name: c.name,
    industry: c.industry ?? null,
    website: c.website ?? null,
    phone: normalisePhone(c.phone ?? null),
    address: c.address ?? null,
    external_source: EXTERNAL_SOURCE,
    external_id: companyId,
    external_updated_at: occurredAt,
  }

  if (existing) {
    // Account is the ordering anchor: a newer mirror state means a stale event.
    if (existing.external_updated_at && new Date(existing.external_updated_at) >= new Date(occurredAt)) {
      return { id: existing.id, stale: true }
    }
    await supabase.from('accounts').update(fields).eq('id', existing.id)
    return { id: existing.id, stale: false }
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({ ...fields, org_id: orgId, source: 'manual' })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[xtimator/webhook] account insert error:', error)
    return { id: null, stale: false }
  }
  return { id: data.id, stale: false }
}

async function upsertContact(
  supabase: Db,
  orgId: string,
  companyId: string,
  c: Company,
  accountId: string | null,
  occurredAt: string,
): Promise<string | null> {
  const phoneNorm = normalisePhone(c.phone ?? null)
  const emailNorm = normaliseEmail(c.email ?? null)
  const name = c.owner_name || c.name

  // Match by mirror key first; fall back to phone/email so we adopt an existing
  // person rather than create a duplicate, then claim it for the mirror.
  let existingId: string | null = null
  let existingCustom: Record<string, unknown> = {}

  const claim = async (q: Promise<{ data: { id: string; custom_fields: Record<string, unknown> | null } | null }>) => {
    if (existingId) return
    const { data } = await q
    if (data) {
      existingId = data.id
      existingCustom = data.custom_fields ?? {}
    }
  }

  await claim(
    supabase
      .from('contacts')
      .select('id, custom_fields')
      .eq('org_id', orgId)
      .eq('external_source', EXTERNAL_SOURCE)
      .eq('external_id', companyId)
      .maybeSingle(),
  )
  if (!existingId && phoneNorm) {
    await claim(
      supabase
        .from('contacts')
        .select('id, custom_fields')
        .eq('org_id', orgId)
        .eq('phone_e164', phoneNorm)
        .neq('identity_status', 'archived_duplicate')
        .maybeSingle(),
    )
  }
  if (!existingId && emailNorm) {
    await claim(
      supabase
        .from('contacts')
        .select('id, custom_fields')
        .eq('org_id', orgId)
        .eq('email_normalized', emailNorm)
        .neq('identity_status', 'archived_duplicate')
        .maybeSingle(),
    )
  }

  const mergedCustom = { ...existingCustom, ...(c.custom_fields ?? {}) }

  if (existingId) {
    const patch: Record<string, unknown> = {
      name,
      company: c.name,
      account_id: accountId,
      custom_fields: mergedCustom,
      external_source: EXTERNAL_SOURCE,
      external_id: companyId,
      external_updated_at: occurredAt,
      updated_at: new Date().toISOString(),
    }
    if (phoneNorm) patch.phone = phoneNorm
    if (emailNorm) patch.email = emailNorm
    if (c.tags?.length) patch.tags = c.tags
    await supabase.from('contacts').update(patch).eq('id', existingId)
    return existingId
  }

  // Insert — the DB identity invariant (migration 1061) requires phone OR email.
  if (!phoneNorm && !emailNorm) {
    console.warn('[xtimator/webhook] contact skipped: no phone/email for company', companyId)
    return null
  }
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      name,
      phone: phoneNorm,
      email: emailNorm,
      company: c.name,
      account_id: accountId,
      tags: c.tags ?? [],
      source: 'api',
      custom_fields: c.custom_fields ?? {},
      external_source: EXTERNAL_SOURCE,
      external_id: companyId,
      external_updated_at: occurredAt,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[xtimator/webhook] contact insert error:', error)
    return null
  }
  return data.id
}

async function upsertOpportunity(
  supabase: Db,
  orgId: string,
  companyId: string,
  opp: NonNullable<Payload['opportunity']>,
  contactId: string | null,
  accountId: string | null,
  companyName: string,
  occurredAt: string,
): Promise<{ id?: string; skipped?: string }> {
  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('id')
    .eq('org_id', orgId)
    .eq('name', PIPELINE_NAME)
    .maybeSingle()
  if (!pipeline) return { skipped: 'no_pipeline' }

  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('id, is_won, is_lost')
    .eq('org_id', orgId)
    .eq('pipeline_id', pipeline.id)
    .eq('name', opp.stage)
    .maybeSingle()
  if (!stage) return { skipped: 'no_stage' }

  const status = opp.status ?? (stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'open')
  const title = opp.title || `${companyName} — Subscription`

  const { data: existing } = await supabase
    .from('opportunities')
    .select('id')
    .eq('org_id', orgId)
    .eq('external_source', EXTERNAL_SOURCE)
    .eq('external_id', companyId)
    .maybeSingle()

  if (existing) {
    const patch: Record<string, unknown> = {
      stage_id: stage.id,
      status,
      title,
      external_updated_at: occurredAt,
    }
    if (opp.value != null) patch.value = opp.value
    await supabase.from('opportunities').update(patch).eq('id', existing.id)
    return { id: existing.id }
  }

  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      org_id: orgId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      title,
      contact_id: contactId,
      account_id: accountId,
      value: opp.value ?? 0,
      currency: 'USD',
      status,
      external_source: EXTERNAL_SOURCE,
      external_id: companyId,
      external_updated_at: occurredAt,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[xtimator/webhook] opportunity insert error:', error)
    return { skipped: 'insert_failed' }
  }
  return { id: data.id }
}

export async function POST(request: Request): Promise<Response> {
  const ok = (extra?: Record<string, unknown>) => Response.json({ ok: true, ...extra })
  try {
    // 1. Auth
    const auth = request.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return ok()
    const token = auth.slice(7).trim()
    if (!token) return ok()

    const supabase = db()
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('id, org_id')
      .eq('key_hash', hashToken(token))
      .is('revoked_at', null)
      .maybeSingle()
    if (!apiKey) return ok()
    const orgId: string = apiKey.org_id

    // 2. Parse
    let payload: Payload
    try {
      payload = payloadSchema.parse(await request.json())
    } catch {
      return ok({ skipped: 'bad_payload' })
    }

    const companyId = String(payload.company.id)
    const occurredAt = payload.occurred_at

    // 3. Account (the ordering anchor for last-write-wins)
    const acc = await upsertAccount(supabase, orgId, companyId, payload.company, occurredAt)
    if (acc.stale) return ok({ skipped: 'stale' })
    const accountId = acc.id

    // 4. Contact (the owner) — linked to the account
    const contactId = await upsertContact(supabase, orgId, companyId, payload.company, accountId, occurredAt)

    // 5. Opportunity (the subscription deal) — needs at least one party
    let opportunity: { id?: string; skipped?: string } = {}
    if (payload.opportunity && (contactId || accountId)) {
      opportunity = await upsertOpportunity(
        supabase,
        orgId,
        companyId,
        payload.opportunity,
        contactId,
        accountId,
        payload.company.name,
        occurredAt,
      )
    }

    // 6. Note on the contact timeline (non-idempotent by design — one per event)
    if (payload.note && contactId) {
      const { error } = await supabase.from('notes').insert({
        org_id: orgId,
        title: payload.note.title ?? null,
        content: payload.note.content,
        entity_type: 'contact',
        entity_id: contactId,
      })
      if (error) console.error('[xtimator/webhook] note insert error:', error)
    }

    // 7. Touch last_used_at (fire-and-forget)
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKey.id)
      .then(() => {})

    return ok({
      account_id: accountId,
      contact_id: contactId,
      opportunity_id: opportunity.id ?? null,
      ...(opportunity.skipped ? { opportunity_skipped: opportunity.skipped } : {}),
    })
  } catch (err) {
    console.error('[xtimator/webhook] error:', err)
    return Response.json({ ok: true })
  }
}
