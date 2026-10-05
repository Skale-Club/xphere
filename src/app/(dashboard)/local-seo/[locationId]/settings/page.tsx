import { notFound } from 'next/navigation'

import { LocationSettings } from '@/components/local-seo/location-settings'
import { TrackingSettings } from '@/components/local-seo/tracking-settings'
import { gridPointCount } from '@/lib/local-seo/grid'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationSettingsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: location }, { data: keywords }, { data: profiles }, { data: schedules }, { data: rules }, canManage] = await Promise.all([
    supabase
      .from('local_seo_locations')
      .select(
        'id, name, business_name, place_id, address, language, country, default_grid_size, default_spacing_m, default_shape, google_business_profile_id, is_active',
      )
      .eq('id', locationId)
      .maybeSingle(),
    supabase
      .from('local_seo_keywords')
      .select('id, keyword, is_active')
      .eq('location_id', locationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('google_business_profiles')
      .select('id, business_name, place_id')
      .neq('place_id', '__pending__')
      .order('created_at', { ascending: true }),
    supabase.from('local_seo_schedules').select('*').eq('location_id', locationId).order('created_at', { ascending: true }),
    supabase
      .from('local_seo_alert_rules')
      .select('id, location_id, metric, direction, threshold')
      .or(`location_id.eq.${locationId},location_id.is.null`)
      .order('created_at', { ascending: true }),
    can('local_seo.manage'),
  ])
  if (!location) notFound()
  const activeKeywords = (keywords ?? []).filter((k) => k.is_active).length

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
        keywords={(keywords ?? []).map((k) => ({ id: k.id, keyword: k.keyword }))}
        reviewProfiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.business_name ?? p.place_id }))}
      />
      <div className="mt-4">
        <TrackingSettings
          locationId={location.id}
          canManage={canManage}
          pointsPerRun={gridPointCount(location.default_grid_size, location.default_shape) * activeKeywords}
          schedules={(schedules ?? []).map((s) => ({
            id: s.id,
            frequency: s.frequency,
            weekday: s.weekday,
            dayOfMonth: s.day_of_month,
            hourUtc: s.hour_utc,
            keywordCount: s.keyword_ids.length,
            nextRunAt: s.next_run_at,
            lastRunAt: s.last_run_at,
            lastError: s.last_error,
            isActive: s.is_active,
          }))}
          rules={(rules ?? []).map((r) => ({
            id: r.id,
            metric: r.metric,
            direction: r.direction,
            threshold: Number(r.threshold),
            allLocations: r.location_id === null,
          }))}
        />
      </div>
    </div>
  )
}
