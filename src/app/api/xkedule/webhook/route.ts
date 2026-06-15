// POST /api/xkedule/webhook
//
// Receives booking.* events from Xkedule and mirrors them into the native
// bookings table (a read-only mirror), then emits the matching meeting.* event
// so the existing calendar workflows fire (reminders, follow-ups, opportunities).
//
// Auth: Authorization: Bearer <token> — same api_keys lookup as /api/v1.
// Idempotency + ordering: dedup by (org, external_source, external_id) with
// last-write-wins on external_updated_at vs the event's occurred_at.
// Webhook convention: always returns HTTP 200.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import type { CalendarEvent } from '@/lib/calendar/events'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'

export const runtime = 'nodejs'

type ServiceClient = SupabaseClient<Database>

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const payloadSchema = z.object({
  event: z.string(),
  delivery_id: z.string().optional(),
  occurred_at: z.string(),
  booking: z.object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
    bookingDate: z.string(), // YYYY-MM-DD, tenant-local
    startTime: z.string(),   // HH:MM
    endTime: z.string(),     // HH:MM
    timeZone: z.string().optional(),
    staffMemberId: z.number().nullable().optional(),
    services: z.array(z.object({ id: z.number(), name: z.string().nullable() })).optional(),
    customer: z.object({
      name: z.string(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
    }),
  }),
})

// Xkedule status (pending|awaiting_approval|confirmed|completed|cancelled|no_show)
// → native enum (confirmed|cancelled|no_show). Active states mirror as confirmed.
function mapStatus(s: string): 'confirmed' | 'cancelled' | 'no_show' {
  if (s === 'cancelled') return 'cancelled'
  if (s === 'no_show') return 'no_show'
  return 'confirmed'
}

function calendarEventFor(event: string, status: 'confirmed' | 'cancelled' | 'no_show'): CalendarEvent {
  if (event === 'booking.cancelled' || status === 'cancelled') return 'meeting.cancelled'
  if (status === 'no_show') return 'meeting.no_show'
  if (event === 'booking.created') return 'meeting.scheduled'
  return 'meeting.rescheduled'
}

// Lazily get-or-create a synthetic "Xkedule" event type for the org. bookings
// requires event_type_id (NOT NULL); event_types requires a user_id (any member).
async function getOrCreateEventType(supabase: ServiceClient, orgId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('event_types')
    .select('id')
    .eq('org_id', orgId)
    .eq('slug', 'xkedule')
    .maybeSingle()
  if (existing) return existing.id

  const { data: member } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle()
  if (!member) return null

  const { data: created, error } = await supabase
    .from('event_types')
    .insert({
      org_id: orgId,
      user_id: member.user_id,
      title: 'Xkedule',
      slug: 'xkedule',
      description: 'Bookings mirrored from Xkedule',
      location_type: 'in_person',
    })
    .select('id')
    .single()
  if (error || !created) {
    console.error('[xkedule/webhook] event_type create error:', error)
    return null
  }
  return created.id
}

// Match by phone (E.164) → email (normalized) → create. Mirrors /api/v1/contacts.
async function matchOrCreateContact(
  supabase: ServiceClient,
  orgId: string,
  c: { name: string; phoneNorm: string | null; emailNorm: string | null },
): Promise<string | null> {
  let existingId: string | null = null
  if (c.phoneNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone_e164', c.phoneNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existingId = data.id
  }
  if (!existingId && c.emailNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('email_normalized', c.emailNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existingId = data.id
  }
  if (existingId) return existingId

  const { data, error } = await supabase
    .from('contacts')
    .insert({ org_id: orgId, name: c.name, phone: c.phoneNorm, email: c.emailNorm, source: 'api' })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[xkedule/webhook] contact create error:', error)
    return null
  }
  return data.id
}

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
    const orgId = apiKey.org_id

    // 2. Parse
    let payload: z.infer<typeof payloadSchema>
    try {
      payload = payloadSchema.parse(await request.json())
    } catch {
      return ok({ skipped: 'bad_payload' })
    }

    const b = payload.booking
    const externalId = String(b.id)
    const occurredAt = payload.occurred_at
    const timeZone = b.timeZone || 'America/New_York'
    const status = mapStatus(b.status)

    // 3. Tenant-local date+time → UTC
    const startAt = fromZonedTime(`${b.bookingDate} ${b.startTime}`, timeZone).toISOString()
    const endAt = fromZonedTime(`${b.bookingDate} ${b.endTime}`, timeZone).toISOString()

    // 4. Idempotency + last-write-wins ordering
    const { data: existing } = await supabase
      .from('bookings')
      .select('id, external_updated_at')
      .eq('org_id', orgId)
      .eq('external_source', 'xkedule')
      .eq('external_id', externalId)
      .maybeSingle()

    if (existing?.external_updated_at && new Date(existing.external_updated_at) >= new Date(occurredAt)) {
      return ok({ skipped: 'stale' })
    }

    // 5. Synthetic event type (required FK)
    const eventTypeId = await getOrCreateEventType(supabase, orgId)
    if (!eventTypeId) return ok({ skipped: 'no_org_member' })

    // 6. Contact match/create
    const phoneNorm = normalisePhone(b.customer.phone ?? null)
    const emailNorm = normaliseEmail(b.customer.email ?? null)
    const contactId = await matchOrCreateContact(supabase, orgId, { name: b.customer.name, phoneNorm, emailNorm })

    // 7. Upsert the mirror row
    const serviceNames = (b.services ?? []).map((s) => s.name).filter(Boolean).join(', ')
    const bookerEmail =
      emailNorm ?? (phoneNorm ? `${phoneNorm.replace(/\D/g, '')}@xkedule.local` : `xk-${externalId}@xkedule.local`)

    // Fields valid for both insert and update (Update type excludes org_id / event_type_id).
    const mutable = {
      booker_name: b.customer.name,
      booker_email: bookerEmail,
      booker_phone: phoneNorm,
      booker_timezone: timeZone,
      start_at: startAt,
      end_at: endAt,
      status,
      notes: serviceNames ? `Xkedule: ${serviceNames}` : null,
      linked_contact_id: contactId,
      external_source: 'xkedule',
      external_id: externalId,
      external_updated_at: occurredAt,
    }

    let bookingId: string
    if (existing) {
      await supabase.from('bookings').update(mutable).eq('id', existing.id)
      bookingId = existing.id
    } else {
      const { data: inserted, error } = await supabase
        .from('bookings')
        .insert({ ...mutable, org_id: orgId, event_type_id: eventTypeId })
        .select('id')
        .single()
      if (error || !inserted) {
        console.error('[xkedule/webhook] booking insert error:', error)
        return ok({ skipped: 'insert_failed' })
      }
      bookingId = inserted.id
    }

    // 8. Emit the calendar event → drives meeting.* workflows
    await emitCalendarEvent(
      { supabase },
      { event: calendarEventFor(payload.event, status), booking_id: bookingId, org_id: orgId },
    )

    return ok()
  } catch (err) {
    console.error('[xkedule/webhook] error:', err)
    return Response.json({ ok: true })
  }
}
