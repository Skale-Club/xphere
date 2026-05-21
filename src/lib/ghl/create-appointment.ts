// src/lib/ghl/create-appointment.ts
import { ghlFetchJson, type GhlCredentials } from './client'

interface CreateAppointmentParams {
  calendarId: string
  contactId: string
  startTime: string   // ISO 8601
  endTime: string     // ISO 8601
  title?: string
  [key: string]: unknown
}

interface GhlAppointmentResponse {
  id: string
  [key: string]: unknown
}

export async function createAppointment(
  params: Record<string, unknown>,
  credentials: GhlCredentials
): Promise<string> {
  const { calendarId, contactId, startTime, endTime, title } = params as CreateAppointmentParams

  if (!calendarId || !contactId || !startTime || !endTime) {
    throw new Error('calendarId, contactId, startTime, and endTime are required for create_appointment')
  }

  const body = {
    calendarId,
    contactId,
    startTime,
    endTime,
    title: title ?? 'Appointment',
    appointmentStatus: 'confirmed',
  }

  const data = await ghlFetchJson<GhlAppointmentResponse>(
    '/calendars/events/appointments',
    'POST',
    body,
    credentials
  )

  // Single-line result | no newlines
  return `Appointment confirmed. ID: ${data.id}`
}
