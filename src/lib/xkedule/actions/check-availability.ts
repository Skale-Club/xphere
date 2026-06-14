// src/lib/xkedule/actions/check-availability.ts
// GET /api/v1/availability — open slots for a date. Duration is derived by
// Xkedule from the serviceIds, so the AI only needs date + service(s).
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface AvailabilityParams {
  date?: string
  serviceId?: number | string
  serviceIds?: Array<number | string> | string
  staffId?: number | string
  staffMemberId?: number | string
}

interface SlotsResponse {
  slots: { time: string; available: boolean }[]
}

export async function checkXkeduleAvailability(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const p = params as AvailabilityParams
  const date = p.date
  if (!date) {
    return 'Please provide a date (YYYY-MM-DD) to check availability.'
  }

  // Accept serviceId or serviceIds (the AI may pass either form).
  const ids = p.serviceIds
    ? Array.isArray(p.serviceIds)
      ? p.serviceIds
      : String(p.serviceIds).split(',')
    : p.serviceId != null
      ? [p.serviceId]
      : []
  if (ids.length === 0) {
    return 'Please provide a serviceId to check availability.'
  }

  const staffId = p.staffId ?? p.staffMemberId
  const query = new URLSearchParams({
    date,
    serviceIds: ids.map((x) => Number(x)).filter(Boolean).join(','),
  })
  if (staffId) query.set('staffId', String(Number(staffId)))

  const data = await xkeduleFetchJson<SlotsResponse>(
    `/api/v1/availability?${query.toString()}`,
    'GET',
    null,
    credentials,
  )

  const available = (data.slots ?? []).filter((s) => s.available)
  if (available.length === 0) {
    return `No available time slots on ${date}.`
  }
  return `Available slots on ${date}: ${available.map((s) => s.time).join(', ')}`
}
