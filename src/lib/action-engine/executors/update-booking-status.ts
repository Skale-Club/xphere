import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'showed'

const VALID_STATUSES: BookingStatus[] = ['confirmed', 'cancelled', 'no_show', 'showed']

export async function executeUpdateBookingStatus(
  params: Record<string, unknown>,
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const bookingId = typeof params.booking_id === 'string' ? params.booking_id : null
  const status = typeof params.status === 'string' ? params.status : null

  if (!bookingId) throw new Error('update_booking_status: booking_id is required')
  if (!status || !(VALID_STATUSES as string[]).includes(status)) {
    throw new Error(
      `update_booking_status: status must be one of ${VALID_STATUSES.join(', ')}`,
    )
  }

  const { error } = await supabase
    .from('bookings')
    .update({ status: status as BookingStatus, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('org_id', orgId)

  if (error) throw new Error(`update_booking_status: ${error.message}`)

  return JSON.stringify({ ok: true, booking_id: bookingId, status })
}
