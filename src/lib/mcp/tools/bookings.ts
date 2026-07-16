// MCP tools for calendar bookings.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import { cancelBooking } from '@/lib/calendar/transition'
import { resolveAndValidateSlot, type SlotValidationError } from '@/lib/calendar/booking-validation'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

// Match by phone (E.164) → email (normalized) → create. Mirrors the xkedule
// webhook's matchOrCreateContact and createBookingInternal's inline version,
// so a booking made via MCP links/creates a contact the same way any other
// booking source does (calendar workflows key off attendee_contact).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchOrCreateContact(
  supabase: any,
  orgId: string,
  input: { name: string; phone: string | null; email: string },
): Promise<string | null> {
  const phoneNorm = normalisePhone(input.phone)
  const emailNorm = normaliseEmail(input.email)

  let existingId: string | null = null
  if (phoneNorm) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone_e164', phoneNorm)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (data) existingId = data.id
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
  if (existingId) return existingId

  const { data, error } = await supabase
    .from('contacts')
    .insert({ org_id: orgId, name: input.name, phone: input.phone, email: input.email, source: 'api' })
    .select('id')
    .single()
  if (error || !data) return null
  return data.id
}

const BookingStatus = z.enum(['confirmed', 'cancelled', 'no_show', 'showed'])

export const bookingsTools: McpToolDef[] = [
  {
    name: 'bookings_list',
    title: 'List bookings',
    description: 'List recent calendar bookings, newest first. Optional filters by status or linked contact.',
    area: 'general_xphere',
    inputSchema: z.object({
      status: BookingStatus.optional(),
      contact_id: z.string().uuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).strict(),
    handler: async ({ status, contact_id, from, to, limit = 30 }, { auth }) => {
      let q = db()
        .from('bookings')
        .select('id, event_type_id, booker_name, booker_email, booker_phone, start_at, end_at, status, linked_contact_id, notes, created_at')
        .eq('org_id', auth.orgId)
        .order('start_at', { ascending: false })
        .limit(limit)
      if (status) q = q.eq('status', status)
      if (contact_id) q = q.eq('linked_contact_id', contact_id)
      if (from) q = q.gte('start_at', from)
      if (to) q = q.lte('start_at', to)
      const { data } = await q
      return { bookings: data ?? [] }
    },
  },
  {
    name: 'bookings_get',
    title: 'Get booking',
    description: 'Fetch a single booking by id with full fields.',
    area: 'general_xphere',
    inputSchema: z.object({ booking_id: z.string().uuid() }).strict(),
    handler: async ({ booking_id }, { auth }) => {
      const { data } = await db()
        .from('bookings')
        .select('*')
        .eq('id', booking_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!data) return { error: 'not_found', status: 404 }
      return data
    },
  },
  {
    name: 'bookings_create',
    title: 'Create a booking',
    description: 'Create a confirmed booking for an event type at the given start/end time. Optionally links to an existing contact.',
    area: 'general_xphere',
    inputSchema: z.object({
      event_type_id: z.string().uuid(),
      start_at: z.string().datetime(),
      // Deprecated: ignored. Server always derives end_at from
      // event_types.duration_minutes (CAL-01). Kept optional so existing
      // callers that still send it are not rejected by .strict().
      end_at: z.string().datetime().optional(),
      booker_name: z.string().min(1),
      booker_email: z.string().email(),
      booker_phone: z.string().optional(),
      booker_timezone: z.string().optional(),
      notes: z.string().optional(),
      contact_id: z.string().uuid().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const supabase = db()

      const resolved = await resolveAndValidateSlot(supabase, {
        eventTypeId: input.event_type_id,
        startAtIso: input.start_at,
        orgId: auth.orgId,
      })
      if (!resolved.ok) {
        const statusByError: Record<SlotValidationError, number> = {
          event_type_not_found: 404,
          invalid_start_at: 422,
          outside_availability: 409,
          slot_taken: 409,
        }
        return { error: resolved.error, status: statusByError[resolved.error] }
      }
      const { eventType: et, startAt, endAt } = resolved.data

      // Resolve the contact link: honor an explicit contact_id, else match-or-create
      // by phone/email so the booking behaves like every other booking source.
      const linkedContactId =
        input.contact_id ??
        (await matchOrCreateContact(supabase, auth.orgId, {
          name: input.booker_name,
          phone: input.booker_phone ?? null,
          email: input.booker_email,
        }))

      const { data, error } = await supabase
        .from('bookings')
        .insert({
          org_id: auth.orgId,
          event_type_id: et.id,
          booker_name: input.booker_name,
          booker_email: input.booker_email,
          booker_phone: input.booker_phone ?? null,
          booker_timezone: input.booker_timezone ?? 'UTC',
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          notes: input.notes ?? null,
          status: 'confirmed',
          linked_contact_id: linkedContactId,
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }

      // MCP bookings are always created pre-confirmed (no separate pending
      // step), so fire meeting.confirmed immediately — same event the
      // Xkedule webhook fires for externally-confirmed bookings. This is
      // what actually drives the "on booking confirmed" workflows (SMS
      // confirmations, opportunity creation, reminders).
      await emitCalendarEvent(
        { supabase, depth: 0 },
        { event: 'meeting.confirmed', booking_id: data.id, org_id: auth.orgId },
      ).catch((err) => {
        console.error('[mcp/bookings] emitCalendarEvent error:', err)
      })

      return data
    },
  },
  {
    name: 'bookings_cancel',
    title: 'Cancel a booking',
    description: 'Mark a booking as cancelled. Optionally store a cancellation reason in notes.',
    area: 'general_xphere',
    inputSchema: z.object({
      booking_id: z.string().uuid(),
      reason: z.string().optional(),
    }).strict(),
    handler: async ({ booking_id, reason }, { auth }) => {
      const supabase = db()

      if (reason) {
        const { data: current } = await supabase
          .from('bookings')
          .select('notes')
          .eq('id', booking_id)
          .eq('org_id', auth.orgId)
          .maybeSingle()
        if (!current) return { error: 'not_found', status: 404 }
        const prev = (current.notes as string | null) ?? ''
        const notes = prev
          ? `${prev}\n\n[Cancelled via MCP] ${reason}`
          : `[Cancelled via MCP] ${reason}`
        await supabase.from('bookings').update({ notes }).eq('id', booking_id).eq('org_id', auth.orgId)
      }

      const result = await cancelBooking({ supabase, depth: 0 }, booking_id, auth.orgId)
      if (!result.ok) {
        // 'not_found' matches this file's existing convention (bookings_get,
        // and the reason-branch's own early return above) for a missing/
        // cross-org booking, rather than leaking the transition service's
        // internal 'booking_not_found' error string.
        if (result.error === 'booking_not_found') return { error: 'not_found', status: 404 }
        if (result.error === 'illegal_transition') return { error: 'illegal_transition', status: 409 }
        return { error: result.error ?? 'cancel_failed', status: 500 }
      }

      return { cancelled: true }
    },
  },
]
