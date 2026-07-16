// Pure mapper: turns a raw Supabase `bookings` join row (selected via
// `event_types(name:title)` — see contacts/actions.ts::getContact) into
// the flat shape ContactDetail.bookings expects. Extracted out of
// getContact so the join-alias fix is unit-testable without mocking that
// function's full Promise.all dependency chain — contacts/actions.ts has
// 'use server' and can only export async functions, so this pure helper
// cannot live there.

export interface RawContactBookingRow {
  id: string
  booker_name: string
  start_at: string
  end_at: string
  status: string
  event_types: { name?: string | null } | { name?: string | null }[] | null
}

export interface ContactBookingSummary {
  id: string
  booker_name: string
  start_at: string
  end_at: string
  status: string
  event_type_name: string | null
}

export function mapContactBookingRow(b: RawContactBookingRow): ContactBookingSummary {
  const et = b.event_types
  const eventName = Array.isArray(et) ? (et[0]?.name ?? null) : (et?.name ?? null)
  return {
    id: b.id,
    booker_name: b.booker_name,
    start_at: b.start_at,
    end_at: b.end_at,
    status: b.status,
    event_type_name: eventName,
  }
}
