// Google Calendar FreeBusy API | fetch busy intervals for slot generation.
// Uses the existing `integrations` table with provider = 'google_calendar'.
// Tokens stored encrypted with AES-256-GCM via src/lib/crypto.ts.

import { decrypt, encrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar'
export const GOOGLE_CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'

export interface BusyInterval {
  start: string // ISO 8601
  end: string
}

interface StoredTokens {
  access_token: string
  refresh_token: string | null
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Google token refresh failed: ${text}`)
  }

  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

// Fetch and auto-refresh tokens for a user's Google Calendar connection.
// Returns null if the user hasn't connected Google Calendar.
export async function getCalendarTokens(
  userId: string,
  orgId: string,
): Promise<{ access_token: string; integration_id: string } | null> {
  const supabase = createServiceRoleClient()

  const { data: row } = await supabase
    .from('integrations')
    .select('id, encrypted_api_key, config')
    .eq('organization_id', orgId)
    .eq('provider', GOOGLE_CALENDAR_PROVIDER)
    .maybeSingle()

  if (!row) return null

  const stored = JSON.parse(await decrypt(row.encrypted_api_key)) as StoredTokens
  const config = row.config as Record<string, unknown>
  const expiry = config?.token_expiry as number | undefined

  // If token is fresh (>60s left), return as-is
  if (expiry && Date.now() < (expiry as number) - 60_000) {
    return { access_token: stored.access_token, integration_id: row.id }
  }

  // Refresh if we have a refresh token
  if (!stored.refresh_token) return null

  const refreshed = await refreshAccessToken(stored.refresh_token)
  const newBlob: StoredTokens = {
    access_token: refreshed.access_token,
    refresh_token: stored.refresh_token,
  }
  const newExpiry = Date.now() + refreshed.expires_in * 1000

  await supabase
    .from('integrations')
    .update({
      encrypted_api_key: await encrypt(JSON.stringify(newBlob)),
      config: { ...config, token_expiry: newExpiry } as unknown as Json,
    })
    .eq('id', row.id)

  return { access_token: refreshed.access_token, integration_id: row.id }
}

// Fetch busy times from Google Calendar for a given date range.
// Returns an empty array if Google Calendar is not connected.
export async function fetchBusyTimes(
  userId: string,
  orgId: string,
  timeMin: string, // ISO 8601
  timeMax: string, // ISO 8601
  calendarId = 'primary',
): Promise<BusyInterval[]> {
  const tokens = await getCalendarTokens(userId, orgId)
  if (!tokens) return []

  const body = {
    timeMin,
    timeMax,
    items: [{ id: calendarId }],
  }

  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    console.error('[google-calendar] freeBusy error:', res.status)
    return []
  }

  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: BusyInterval[] }>
  }

  return data.calendars?.[calendarId]?.busy ?? []
}

// Create a Google Calendar event with a Meet link for google_meet bookings.
// Returns { meeting_url, google_event_id } or null on any failure.
export async function createMeetingLink(
  orgId: string,
  bookingDetails: {
    title: string
    startAt: string // ISO 8601
    endAt: string   // ISO 8601
    attendeeEmail?: string
  },
): Promise<{ meeting_url: string; google_event_id: string } | null> {
  try {
    const supabase = createServiceRoleClient()

    const { data: row } = await supabase
      .from('integrations')
      .select('id, encrypted_api_key, config')
      .eq('organization_id', orgId)
      .eq('provider', GOOGLE_CALENDAR_PROVIDER)
      .maybeSingle()

    if (!row) return null

    const stored = JSON.parse(await decrypt(row.encrypted_api_key)) as StoredTokens
    const config = row.config as Record<string, unknown>
    const expiry = config?.token_expiry as number | undefined

    let accessToken = stored.access_token

    // Refresh if token is stale (less than 60s remaining)
    if (!expiry || Date.now() >= (expiry as number) - 60_000) {
      if (!stored.refresh_token) return null
      const refreshed = await refreshAccessToken(stored.refresh_token)
      const newBlob: StoredTokens = {
        access_token: refreshed.access_token,
        refresh_token: stored.refresh_token,
      }
      const newExpiry = Date.now() + refreshed.expires_in * 1000
      await supabase
        .from('integrations')
        .update({
          encrypted_api_key: await encrypt(JSON.stringify(newBlob)),
          config: { ...config, token_expiry: newExpiry } as unknown as Json,
        })
        .eq('id', row.id)
      accessToken = refreshed.access_token
    }

    const requestId = `xphere-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const body: Record<string, unknown> = {
      summary: bookingDetails.title,
      start: { dateTime: bookingDetails.startAt },
      end: { dateTime: bookingDetails.endAt },
      conferenceData: {
        createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    }

    if (bookingDetails.attendeeEmail) {
      body.attendees = [{ email: bookingDetails.attendeeEmail }]
    }

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      console.error('[google-calendar] createMeetingLink error:', res.status)
      return null
    }

    const data = (await res.json()) as { id: string; hangoutLink?: string }
    if (!data.hangoutLink) {
      console.warn('[google-calendar] createMeetingLink: no hangoutLink in response')
      return null
    }

    return { meeting_url: data.hangoutLink, google_event_id: data.id }
  } catch (err) {
    console.error(
      '[google-calendar] createMeetingLink threw:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

// Create a Google Calendar event for a confirmed booking.
// Returns the created event ID or null on failure.
export async function createCalendarEvent(
  userId: string,
  orgId: string,
  event: {
    summary: string
    description?: string
    start: string // ISO 8601
    end: string // ISO 8601
    attendeeEmail: string
    attendeeName: string
    location?: string
    timezone: string
  },
): Promise<string | null> {
  const tokens = await getCalendarTokens(userId, orgId)
  if (!tokens) return null

  const body = {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: { dateTime: event.start, timeZone: event.timezone },
    end: { dateTime: event.end, timeZone: event.timezone },
    attendees: [{ email: event.attendeeEmail, displayName: event.attendeeName }],
    reminders: { useDefault: true },
  }

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  )

  if (!res.ok) {
    console.error('[google-calendar] create event error:', res.status)
    return null
  }

  const data = (await res.json()) as { id: string }
  return data.id
}

export interface GoogleCalendarEntry {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
  accessRole: string
}

// List all calendars in the user's Google Calendar account.
// Used to populate the conflict-calendars picker.
export async function listGoogleCalendars(
  userId: string,
  orgId: string,
): Promise<GoogleCalendarEntry[]> {
  const tokens = await getCalendarTokens(userId, orgId)
  if (!tokens) return []

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: 'no-store',
    },
  )

  if (!res.ok) {
    console.error('[google-calendar] calendarList error:', res.status)
    return []
  }

  const data = (await res.json()) as { items?: GoogleCalendarEntry[] }
  return data.items ?? []
}
