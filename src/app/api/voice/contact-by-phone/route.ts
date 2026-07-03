// src/app/api/voice/contact-by-phone/route.ts
// Tiny endpoint used by IncomingCallBanner (and the flow builder's SMS test
// button) to resolve a caller's name from the active org's contacts.
// Auth gated via getUser(); RLS scopes the lookup.

import { createClient, getUser } from '@/lib/supabase/server'
import { normalisePhone } from '@/lib/contacts/zod-schemas'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const phone = url.searchParams.get('phone')
  if (!phone) return Response.json({ name: null })

  // Match on `phone_e164` (the generated, normalized column) rather than the
  // raw `phone` field — an exact string match on `phone` misses whenever the
  // input has different spacing/punctuation than what's stored.
  const normalized = normalisePhone(phone)
  if (!normalized) return Response.json({ name: null, contact: null })

  const supabase = await createClient()
  const { data } = await supabase
    .from('contacts')
    .select('id, name, first_name, last_name, email, phone, company, notes, source')
    .eq('phone_e164', normalized)
    .neq('identity_status', 'archived_duplicate')
    .limit(1)
    .maybeSingle()

  return Response.json({ name: data?.name ?? null, contact: data ?? null })
}
