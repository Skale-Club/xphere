// src/lib/xkedule/propagate.ts
// AGT-08: when a NATIVE Xphere action (agent tool call or workflow) cancels
// or reschedules a booking that was mirrored FROM Xkedule
// (bookings.external_source = 'xkedule'), push the change back to Xkedule's
// /api/v1 surface so the real booking (and its calendar sync / customer
// notifications) doesn't go stale. Without this the mirror and the source of
// truth diverge one-way (2026-07 integration audit: "Cancel/reschedule
// nativos do Xphere não propagam para o Xkedule (operam só no espelho
// local)").
//
// MUST NOT be called from /api/xkedule/webhook — that route is the
// Xkedule -> Xphere mirror-sync direction; calling back into Xkedule from
// inside it would echo the same event forever. Only the two native action
// adapters (booking-lifecycle-actions.ts for the wait-free engine,
// flows/engine.ts for the persistent flow engine) call this, AFTER their own
// cancelBooking/rescheduleBooking transition already succeeded.
//
// Best-effort by design: propagation failure never rolls back the
// already-committed Xphere-side transition, and never throws.

import { formatInTimeZone } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getXkeduleCredentialsForOrg } from './credentials'
import { xkeduleFetchJson } from './client'

interface MirroredXkeduleBooking {
  external_id: string
  booker_timezone: string
}

async function loadMirroredXkeduleBooking(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<MirroredXkeduleBooking | null> {
  const { data } = await supabase
    .from('bookings')
    .select('external_source, external_id, booker_timezone')
    .eq('id', bookingId)
    .maybeSingle()
  if (!data || data.external_source !== 'xkedule' || !data.external_id) return null
  return { external_id: data.external_id, booker_timezone: data.booker_timezone }
}

/** AGT-08: propagate a native cancel to the real Xkedule booking, if mirrored. */
export async function propagateCancelToXkedule(
  supabase: SupabaseClient<Database>,
  orgId: string,
  bookingId: string,
): Promise<void> {
  try {
    const mirrored = await loadMirroredXkeduleBooking(supabase, bookingId)
    if (!mirrored) return

    const creds = await getXkeduleCredentialsForOrg(orgId, supabase)
    if (!creds) return // no Xkedule integration configured on this org -- nothing to propagate

    await xkeduleFetchJson(`/api/v1/bookings/${mirrored.external_id}/cancel`, 'POST', {}, creds)
  } catch (err) {
    console.error('[xkedule/propagate] cancel propagation failed:', err)
  }
}

/** AGT-08: propagate a native reschedule to the real Xkedule booking, if mirrored. */
export async function propagateRescheduleToXkedule(
  supabase: SupabaseClient<Database>,
  orgId: string,
  bookingId: string,
  newStartAt: string,
): Promise<void> {
  try {
    const mirrored = await loadMirroredXkeduleBooking(supabase, bookingId)
    if (!mirrored) return

    const creds = await getXkeduleCredentialsForOrg(orgId, supabase)
    if (!creds) return

    // Xkedule interprets bookingDate/startTime as tenant-local wall-clock,
    // not UTC -- convert using the mirror row's own booker_timezone (set
    // from the webhook's booking.timeZone at mirror time).
    const timeZone = mirrored.booker_timezone || 'America/New_York'
    const start = new Date(newStartAt)
    const bookingDate = formatInTimeZone(start, timeZone, 'yyyy-MM-dd')
    const startTime = formatInTimeZone(start, timeZone, 'HH:mm')

    await xkeduleFetchJson(
      `/api/v1/bookings/${mirrored.external_id}/reschedule`,
      'POST',
      { bookingDate, startTime },
      creds,
    )
  } catch (err) {
    console.error('[xkedule/propagate] reschedule propagation failed:', err)
  }
}
