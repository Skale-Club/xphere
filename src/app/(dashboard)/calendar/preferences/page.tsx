import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { MeetingPreferences } from '@/components/calendar/meeting-preferences'

export default async function SchedulingPreferencesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8">
      <MeetingPreferences />
    </div>
  )
}
