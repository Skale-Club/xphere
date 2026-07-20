// POST /api/v1/contacts
// Public REST endpoint — creates or updates a contact in the caller's org.
//
// Auth: Authorization: Bearer <token>
//   Token is SHA-256 hashed and looked up in api_keys.key_hash.
//   Revoked keys and unknown tokens both return 401.
//
// Dedup: phone (E.164) → email (normalized) → create new
// Always returns: { id, action: 'created' | 'updated' }

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { normaliseEmail } from '@/lib/contacts/zod-schemas'
import { canonicalizeContactPhone } from '@/lib/phone-numbers/normalize'
import { linkVisitorToContact } from '@/lib/analytics/identify'

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
  name: z.string().min(1).max(200).optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  tags: z.array(z.string()).optional(),
  source_label: z.string().max(100).optional().nullable(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  // Optional Meta attribution: when the lead came through a page running the
  // Xphere analytics script, pass the _xvid cookie so the contact is linked to
  // its tracked visitor (carrying fbc/fbp/ip/ua for CAPI matching).
  visitor_id: z.string().max(100).optional().nullable(),
})

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = createServiceRoleClient()
  const auth = await verifyApiKey(request, supabase, 'contacts:write')
  if (!auth.ok) {
    return Response.json(
      { error: auth.error, code: auth.code },
      { status: auth.status, headers: CORS_HEADERS },
    )
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch (err) {
    return Response.json(
      { error: 'Invalid request body', details: (err as z.ZodError).errors },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  const { name, email, phone, company, tags, source_label, custom_fields, visitor_id } = body
  // MIR-02: no country/timezone hint travels on this body today (Xkedule's
  // contact-sync payload doesn't carry one) -- canonicalizeContactPhone still
  // upgrades a `+`-prefixed caller-id-style number to real E.164 without a
  // hint, and its matchCandidates reconcile a bare-digit legacy row either
  // way. A bare national number with no hint falls back to the pre-existing
  // loose form, unchanged from before this fix.
  const { value: phoneNorm, matchCandidates: phoneCandidates } = canonicalizeContactPhone(phone)
  const emailNorm = normaliseEmail(email)

  if (!phoneNorm && !emailNorm && !name) {
    return Response.json(
      { error: 'Provide at least one of: phone, email, name' },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  // ── 3. Dedup ───────────────────────────────────────────────────────────────
  const orgId = auth.key.orgId
  let existingId: string | null = null

  if (phoneCandidates.length > 0) {
    // .limit(1) instead of .maybeSingle(): MIR-02's multi-candidate match can
    // hit two DISTINCT existing contacts (a legacy loose-form row and a
    // separately-created E.164-form row for the same real number) --
    // .maybeSingle() would error on more than one match. Deterministically
    // prefer the oldest (first-created) contact.
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .in('phone_e164', phoneCandidates)
      .neq('identity_status', 'archived_duplicate')
      .order('created_at', { ascending: true })
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id
  }

  if (!existingId && emailNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', emailNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existingId = data.id
  }

  // ── 4. Upsert ──────────────────────────────────────────────────────────────
  let contactId: string
  let action: 'created' | 'updated'

  if (existingId) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name) patch.name = name
    if (phoneNorm) patch.phone = phoneNorm
    if (emailNorm) patch.email = emailNorm
    if (company) patch.company = company
    if (tags?.length) patch.tags = tags
    if (custom_fields) {
      // Merge into existing custom_fields rather than replace
      const { data: cur } = await supabase
        .from('contacts')
        .select('custom_fields')
        .eq('id', existingId)
        .single()
      patch.custom_fields = { ...(cur?.custom_fields as object ?? {}), ...custom_fields }
    }

    const { error } = await supabase
      .from('contacts')
      .update(patch)
      .eq('id', existingId)

    if (error) {
      console.error('[api/v1/contacts] update error:', error)
      return Response.json(
        { error: 'Failed to update contact' },
        { status: 500, headers: CORS_HEADERS },
      )
    }
    contactId = existingId
    action = 'updated'
  } else {
    const fields: Record<string, unknown> = { ...custom_fields }
    if (source_label) fields._api_source = source_label

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        name: name ?? null,
        phone: phoneNorm,
        email: emailNorm,
        company: company ?? null,
        tags: tags ?? [],
        source: 'api',
        custom_fields: fields,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('[api/v1/contacts] insert error:', error)
      return Response.json(
        { error: 'Failed to create contact' },
        { status: 500, headers: CORS_HEADERS },
      )
    }
    contactId = data.id
    action = 'created'
  }

  // ── 5. Link the tracked visitor to this contact (Meta attribution) ──────────
  if (visitor_id) {
    try {
      await linkVisitorToContact(orgId, visitor_id, contactId, { supabase })
    } catch (err) {
      console.error('[api/v1/contacts] visitor link error:', err)
    }
  }

  // ── 6. Touch last_used_at (fire-and-forget) ────────────────────────────────
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', auth.key.keyId)
    .then(() => {})

  return Response.json(
    { id: contactId, action },
    { status: action === 'created' ? 201 : 200, headers: CORS_HEADERS },
  )
}
