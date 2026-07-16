// Wait-free engine (execute-action.ts) mirror of flows/engine.ts's booking_*
// action handlers (Pattern 3, Phase 127 LIFE-03). Both dispatchers route
// booking mutations through the same canonical service
// (src/lib/calendar/transition.ts) so a workflow's behavior does not depend
// on which engine runs it. This file is the wait-free engine's thin adapter
// -- it returns JSON strings (execute-action.ts's return convention), not
// Record<string, unknown> (flows/engine.ts's convention) -- so the two
// engines each keep their own adapter rather than sharing one with a
// mismatched return type.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  confirmBooking,
  cancelBooking,
  markNoShow,
  markShowed,
  rescheduleBooking,
} from '@/lib/calendar/transition'

type TransitionFn = (
  ctx: { supabase: SupabaseClient<Database>; depth?: number },
  bookingId: string,
  orgId: string,
) => Promise<{ ok: boolean; error?: string }>

async function runBookingAction(
  fn: TransitionFn,
  actionName: string,
  newStatus: string,
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const bookingId = typeof params.booking_id === 'string' ? params.booking_id : ''
  if (!bookingId) throw new Error(`${actionName} requires booking_id`)

  const result = await fn({ supabase, depth: 0 }, bookingId, orgId)
  if (!result.ok) throw new Error(`${actionName}: ${result.error}`)

  return JSON.stringify({ ok: true, booking_id: bookingId, status: newStatus })
}

export async function executeBookingConfirmAction(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  return runBookingAction(confirmBooking, 'booking_confirm', 'confirmed', params, orgId, supabase)
}

export async function executeBookingCancelAction(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  return runBookingAction(cancelBooking, 'booking_cancel', 'cancelled', params, orgId, supabase)
}

export async function executeBookingMarkNoShowAction(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  return runBookingAction(markNoShow, 'booking_mark_no_show', 'no_show', params, orgId, supabase)
}

// LIFE-02: writes 'showed' (the DB's only completion value), NOT 'completed'
// -- action TYPE stays 'booking_mark_complete' (external workflow contract).
export async function executeBookingMarkCompleteAction(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  return runBookingAction(markShowed, 'booking_mark_complete', 'showed', params, orgId, supabase)
}

export async function executeBookingRescheduleAction(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const bookingId = typeof params.booking_id === 'string' ? params.booking_id : ''
  const startAt = typeof params.start_at === 'string' ? params.start_at : ''
  const endAt = typeof params.end_at === 'string' ? params.end_at : ''
  if (!bookingId) throw new Error('booking_reschedule requires booking_id')
  if (!startAt) throw new Error('booking_reschedule requires start_at')
  if (!endAt) throw new Error('booking_reschedule requires end_at')

  const result = await rescheduleBooking({ supabase, depth: 0 }, bookingId, orgId, startAt, endAt)
  if (!result.ok) throw new Error(`booking_reschedule: ${result.error}`)

  return JSON.stringify({ ok: true, booking_id: bookingId, start_at: startAt, end_at: endAt })
}
