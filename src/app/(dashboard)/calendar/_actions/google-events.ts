'use server'

import { getUser, createClient } from '@/lib/supabase/server'
import { fetchCalendarEvents } from '@/lib/calendar/google-calendar'

export interface ExternalCalendarEvent {
  id: string
  title: string
  start: string // ISO 8601
  end: string   // ISO 8601
  allDay: boolean
}

// Fetch Google Calendar events for the given range.
// Returns [] if Google Calendar is not connected or not active.
export async function getGoogleCalendarEvents(
  timeMin: string,
  timeMax: string,
): Promise<ExternalCalendarEvent[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return []

  const { data: integration } = await (supabase as any)
    .from('integrations')
    .select('is_active, config')
    .eq('organization_id', orgId)
    .eq('provider', 'google_calendar')
    .maybeSingle()

  if (!integration?.is_active) return []

  const events = await fetchCalendarEvents(user.id, orgId, timeMin, timeMax)

  return events.map((e) => ({
    id: e.id,
    title: e.summary ?? '(sem título)',
    start: e.start.dateTime ?? `${e.start.date}T00:00:00`,
    end: e.end.dateTime ?? `${e.end.date}T23:59:59`,
    allDay: !e.start.dateTime,
  }))
}
