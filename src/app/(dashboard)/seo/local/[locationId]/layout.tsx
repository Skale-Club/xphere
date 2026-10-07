import { notFound, redirect } from 'next/navigation'
import { MapPin } from 'lucide-react'

import { LocationTabs } from '@/components/local-seo/location-tabs'
import { createClient, getUser } from '@/lib/supabase/server'

export default async function LocationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locationId: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')
  const { locationId } = await params
  const supabase = await createClient()
  const { data: location } = await supabase
    .from('local_seo_locations')
    .select('id, name, business_name, address, is_active')
    .eq('id', locationId)
    .maybeSingle()
  if (!location) notFound()

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-bg-secondary px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-text-primary">{location.name}</h1>
          {location.address && (
            <p className="flex items-center gap-1 truncate text-[12px] text-text-tertiary">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{location.address}</span>
            </p>
          )}
        </div>
        <LocationTabs locationId={location.id} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
