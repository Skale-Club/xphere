import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { BOOKING_STATUSES, isBookingStatus } from '@/lib/calendar/booking-status'
import { confirmBooking, cancelBooking, markNoShow, markShowed } from '@/lib/calendar/transition'

// Phase 127 (LIFE-01/LIFE-03): previously this executor allowed ANY listed
// status to transition to ANY other listed status directly via .update(),
// with zero current-state guard and zero calendar event emission -- the one
// registered booking-mutating action type in execute-action.ts that worked
// end-to-end but bypassed the canonical lifecycle contract entirely. Now
// dispatches by target status to the matching guarded, event-emitting
// transition.ts function.
export async function executeUpdateBookingStatus(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const bookingId = typeof params.booking_id === 'string' ? params.booking_id : null
  const status = typeof params.status === 'string' ? params.status : null

  if (!bookingId) throw new Error('update_booking_status: booking_id is required')
  if (!status || !isBookingStatus(status)) {
    throw new Error(`update_booking_status: status must be one of ${BOOKING_STATUSES.join(', ')}`)
  }

  const ctx = { supabase, depth: 0 }
  const result =
    status === 'confirmed' ? await confirmBooking(ctx, bookingId, orgId)
    : status === 'cancelled' ? await cancelBooking(ctx, bookingId, orgId)
    : status === 'no_show' ? await markNoShow(ctx, bookingId, orgId)
    : await markShowed(ctx, bookingId, orgId) // status === 'showed'

  if (!result.ok) throw new Error(`update_booking_status: ${result.error}`)

  return JSON.stringify({ ok: true, booking_id: bookingId, status })
}
