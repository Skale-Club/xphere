import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { getSchedulingProfile } from '../_actions/scheduling-profile'
import { CalendarConnections } from '@/components/scheduling/calendar-connections'

export default async function SchedulingConnectionsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  // Fetch the org's Google Calendar integration
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  const { data: gcalRow } = orgId
    ? await (supabase as any)
        .from('integrations')
        .select('id, key_hint, config, is_active, health_status')
        .eq('organization_id', orgId)
        .eq('provider', 'google_calendar')
        .maybeSingle()
    : { data: null }

  const profileResult = await getSchedulingProfile()
  const profile = profileResult.ok ? profileResult.data : null

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-8">
      <CalendarConnections
        integration={gcalRow ?? null}
        syncMode={profile?.sync_mode ?? 'one_way'}
        conflictCalendarIds={profile?.conflict_calendar_ids ?? []}
      />
    </div>
  )
}
