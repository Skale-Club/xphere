import { notFound } from 'next/navigation'

import { LocationSettings } from '@/components/local-seo/location-settings'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationSettingsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: location }, { data: keywords }, { data: profiles }, canManage] = await Promise.all([
    supabase
      .from('local_seo_locations')
      .select(
        'id, name, business_name, place_id, address, language, country, default_grid_size, default_spacing_m, default_shape, google_business_profile_id, is_active',
      )
      .eq('id', locationId)
      .maybeSingle(),
    supabase
      .from('local_seo_keywords')
      .select('id, keyword')
      .eq('location_id', locationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('google_business_profiles')
      .select('id, business_name, place_id')
      .neq('place_id', '__pending__')
      .order('created_at', { ascending: true }),
    can('local_seo.manage'),
  ])
  if (!location) notFound()

  return (
    <div className="px-4 py-6 sm:px-6">
      <LocationSettings
        canManage={canManage}
        location={{
          id: location.id,
          name: location.name,
          businessName: location.business_name,
          placeId: location.place_id,
          language: location.language,
          country: location.country,
          defaultGridSize: location.default_grid_size,
          defaultSpacingM: location.default_spacing_m,
          defaultShape: location.default_shape,
          googleBusinessProfileId: location.google_business_profile_id,
          isActive: location.is_active,
        }}
        keywords={keywords ?? []}
        reviewProfiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.business_name ?? p.place_id }))}
      />
    </div>
  )
}
