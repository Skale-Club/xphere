import { redirect } from 'next/navigation'
import { MapPin } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listTenantLocations } from './_actions/tenant-locations'
import { LocationsList } from './_components/locations-list'

export default async function LocationsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const result = await listTenantLocations()
  const locations = result.ok ? result.data : []

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Workspace"
        eyebrowIcon={MapPin}
        title="Locations"
        description="Physical addresses bookings can pin to | stores, offices, clinics."
      />
      <LocationsList initial={locations} />
    </PageContainer>
  )
}
