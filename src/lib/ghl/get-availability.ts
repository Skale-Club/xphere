// src/lib/ghl/get-availability.ts
import { ghlFetchJson, type GhlCredentials } from './client'

interface GetAvailabilityParams {
  calendarId: string
  startDate: string    // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD
  timezone?: string
  [key: string]: unknown
}

type GhlAvailabilityResponse = Record<string, { slots: string[] }>

export async function getAvailability(
  params: Record<string, unknown>,
  credentials: GhlCredentials
): Promise<string> {
  const { calendarId, startDate, endDate, timezone } = params as GetAvailabilityParams

  if (!calendarId) throw new Error('calendarId is required for get_availability')
  if (!startDate || !endDate) throw new Error('startDate and endDate are required for get_availability')

  const queryParams: Record<string, string> = { startDate, endDate }
  if (timezone) queryParams.timezone = timezone

  const data = await ghlFetchJson<GhlAvailabilityResponse>(
    `/calendars/${calendarId}/free-slots`,
    'GET',
    null,
    credentials,
    queryParams
  )

  // Flatten to single line | Vapi parser breaks on newlines
  const allSlots: string[] = []
  for (const dateKey of Object.keys(data).sort()) {
    allSlots.push(...(data[dateKey]?.slots ?? []))
    if (allSlots.length >= 3) break  // limit to first 3 slots for brevity
  }

  if (allSlots.length === 0) {
    return `No availability found for the requested dates.`
  }
  return `Available slots: ${allSlots.slice(0, 3).join(', ')}`
}
