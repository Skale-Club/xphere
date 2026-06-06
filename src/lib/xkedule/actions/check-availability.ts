// src/lib/xkedule/actions/check-availability.ts
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface AvailabilityParams {
  date?: string         // YYYY-MM-DD
  serviceId?: number | string
  staffMemberId?: number | string
}

interface TimeSlot {
  time: string
  available: boolean
  [key: string]: unknown
}

export async function checkXkeduleAvailability(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials
): Promise<string> {
  const { date, serviceId, staffMemberId } = params as AvailabilityParams

  if (!date) {
    return 'Please provide a date (YYYY-MM-DD) to check availability.'
  }

  const body: Record<string, unknown> = { date }
  if (serviceId) body.serviceId = Number(serviceId)
  if (staffMemberId) body.staffMemberId = Number(staffMemberId)

  const slots = await xkeduleFetchJson<TimeSlot[]>(
    '/api/availability',
    'POST',
    body,
    credentials
  )

  if (!slots || slots.length === 0) {
    return `No available slots on ${date}.`
  }

  const available = slots.filter(s => s.available)
  if (available.length === 0) {
    return `No available time slots on ${date}. All slots are booked.`
  }

  const times = available.map(s => s.time).join(', ')
  return `Available slots on ${date}: ${times}`
}
