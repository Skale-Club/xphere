import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
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
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/scheduling"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
      </Button>

      <AvailabilityEditor initialAvailability={availability} />
    </div>
  )
}
