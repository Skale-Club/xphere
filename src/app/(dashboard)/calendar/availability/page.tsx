import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getUserAvailability } from '../_actions/availability'
import { AvailabilityEditor } from '@/components/calendar/availability-editor'

export default async function AvailabilityPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const result = await getUserAvailability()
  const availability = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <AvailabilityEditor initialAvailability={availability} />
    </div>
  )
}
