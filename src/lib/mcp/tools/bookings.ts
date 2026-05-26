// MCP tools for calendar bookings.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

const BookingStatus = z.enum(['confirmed', 'cancelled', 'no_show'])

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
      end_at: z.string().datetime(),
      booker_name: z.string().min(1),
      booker_email: z.string().email(),
      booker_phone: z.string().optional(),
      booker_timezone: z.string().optional(),
      notes: z.string().optional(),
      contact_id: z.string().uuid().optional(),
    }).strict(),
    handler: async (input, { auth }) => {
      const supabase = db()
      // Verify the event_type belongs to this org before allowing the booking.
      const { data: et } = await supabase
        .from('event_types')
        .select('id')
        .eq('id', input.event_type_id)
        .eq('org_id', auth.orgId)
        .maybeSingle()
      if (!et) return { error: 'not_found', detail: 'event_type not found in this org', status: 404 }

      const { data, error } = await supabase
        .from('bookings')
        .insert({
          org_id: auth.orgId,
          event_type_id: input.event_type_id,
          booker_name: input.booker_name,
          booker_email: input.booker_email,
          booker_phone: input.booker_phone ?? null,
          booker_timezone: input.booker_timezone ?? 'UTC',
          start_at: input.start_at,
          end_at: input.end_at,
          notes: input.notes ?? null,
          status: 'confirmed',
          linked_contact_id: input.contact_id ?? null,
        })
        .select()
        .single()
      if (error) return { error: 'insert_failed', detail: error.message }
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
      const patch: Record<string, unknown> = { status: 'cancelled' }
      if (reason) {
        // append reason to existing notes
        const { data: current } = await supabase
          .from('bookings')
          .select('notes')
          .eq('id', booking_id)
          .eq('org_id', auth.orgId)
          .maybeSingle()
        if (!current) return { error: 'not_found', status: 404 }
        const prev = (current.notes as string | null) ?? ''
        patch.notes = prev
          ? `${prev}\n\n[Cancelled via MCP] ${reason}`
          : `[Cancelled via MCP] ${reason}`
      }
      const { error } = await supabase
        .from('bookings')
        .update(patch)
        .eq('id', booking_id)
        .eq('org_id', auth.orgId)
      if (error) return { error: 'update_failed', detail: error.message }
      return { cancelled: true }
    },
  },
]
