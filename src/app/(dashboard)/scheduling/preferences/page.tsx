import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getSchedulingProfile } from '../_actions/scheduling-profile'
import { MeetingPreferences } from '@/components/scheduling/meeting-preferences'

export default async function SchedulingPreferencesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const profileResult = await getSchedulingProfile()
  const profile = profileResult.ok ? profileResult.data : null

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-8">
      <MeetingPreferences
        defaultLocationType={profile?.default_location_type ?? 'google_meet'}
      />
    </div>
  )
}
