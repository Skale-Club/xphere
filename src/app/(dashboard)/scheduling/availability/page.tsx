import { redirect } from 'next/navigation'
import { ArrowLeft, Clock } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { getUserAvailability } from '../_actions/availability'
import { AvailabilityEditor } from '@/components/scheduling/availability-editor'

export default async function AvailabilityPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const result = await getUserAvailability()
  const availability = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/scheduling"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
      </Button>

      <div>
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground mb-1">
          <Clock className="h-3.5 w-3.5" /> Scheduling
        </div>
        <h1 className="text-2xl font-semibold">Weekly Availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the days and hours you're available for meetings. Bookings will only be offered during these windows.
        </p>
      </div>

      <AvailabilityEditor initialAvailability={availability} />
    </div>
  )
}
