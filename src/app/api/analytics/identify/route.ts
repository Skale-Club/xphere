export const runtime = 'nodejs'

// POST /api/analytics/identify
// Links a tracked visitor (_xvid) to a CRM contact so later conversion events
// can be attributed with the visitor's click signals. Public + always-200
// (mirrors the ingest endpoint). Resolves the contact by explicit id, or by
// normalized email / phone within the org that owns the script token.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { linkVisitorToContact } from '@/lib/analytics/identify'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

interface IdentifyBody {
  token?: string
  visitor_id?: string
  contact_id?: string
  email?: string
  phone?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IdentifyBody
    if (!body.token || !body.visitor_id) {
      return Response.json({ ok: true }, { headers: CORS_HEADERS })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceRoleClient() as any
    const { data: setup } = await supabase
      .from('analytics_setups')
      .select('organization_id')
      .eq('script_token', body.token)
      .maybeSingle()
    if (!setup) return Response.json({ ok: true }, { headers: CORS_HEADERS })

    const orgId: string = setup.organization_id
    let contactId = body.contact_id ?? null

    if (!contactId) {
      const emailNorm = normaliseEmail(body.email)
      const phoneNorm = normalisePhone(body.phone)
      if (phoneNorm) {
        const { data } = await supabase
          .from('contacts').select('id')
          .eq('org_id', orgId).eq('phone_e164', phoneNorm)
          .neq('identity_status', 'archived_duplicate').maybeSingle()
        if (data) contactId = data.id
      }
      if (!contactId && emailNorm) {
        const { data } = await supabase
          .from('contacts').select('id')
          .eq('org_id', orgId).eq('email_normalized', emailNorm)
          .neq('identity_status', 'archived_duplicate').maybeSingle()
        if (data) contactId = data.id
      }
    }

    if (contactId) {
      await linkVisitorToContact(orgId, body.visitor_id, contactId, { supabase })
    }
  } catch {
    // never error to the client
  }
  return Response.json({ ok: true }, { headers: CORS_HEADERS })
}
