import { notFound } from 'next/navigation'

import { LocationSettings } from '@/components/local-seo/location-settings'
import { GbpConnectionCard } from '@/components/local-seo/gbp-connection-card'
import { TrackingSettings } from '@/components/local-seo/tracking-settings'
import { gridPointCount } from '@/lib/local-seo/grid'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationSettingsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: location }, { data: keywords }, { data: profiles }, { data: schedules }, { data: rules }, canManage, canAdmin, canApprove, { data: connections }, { data: replySettings }, { data: gbpLink }] = await Promise.all([
    supabase
      .from('local_seo_locations')
      .select(
        'id, name, business_name, place_id, address, lat, lng, language, country, default_grid_size, default_spacing_m, default_shape, google_business_profile_id, is_active',
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
    can('local_seo.admin'),
    can('local_seo.approve'),
    supabase.from('gbp_connections').select('id, google_email, status, connection_error').order('created_at', { ascending: true }),
    supabase.from('gbp_reply_settings').select('*').maybeSingle(),
    supabase
      .from('local_seo_locations')
      .select('gbp_connection_id, gbp_location_name, gbp_reviews_synced_at, gbp_sync_error')
      .eq('id', locationId)
      .maybeSingle(),
  ])
  const { data: lastSnapshot } = gbpLink?.gbp_location_name
    ? await supabase.from('gbp_profile_snapshots').select('data').eq('location_id', locationId).order('taken_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }
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
          address: location.address,
          centerLat: location.lat,
          centerLng: location.lng,
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
        <GbpConnectionCard
          locationId={location.id}
          connections={(connections ?? []).map((c) => ({ id: c.id, email: c.google_email, status: c.status, error: c.connection_error }))}
          linked={
            gbpLink?.gbp_connection_id && gbpLink.gbp_location_name
              ? {
                  connectionId: gbpLink.gbp_connection_id,
                  locationName: gbpLink.gbp_location_name,
                  title: ((lastSnapshot?.data ?? null) as { title?: string } | null)?.title ?? null,
                }
              : null
          }
          syncError={gbpLink?.gbp_sync_error ?? null}
          lastSyncedAt={gbpLink?.gbp_reviews_synced_at ?? null}
          canAdmin={canAdmin}
          canManage={canManage}
          canApprove={canApprove}
          replySettings={{
            tone: replySettings?.tone ?? 'warm and professional',
            signature: replySettings?.signature ?? null,
            instructions: replySettings?.instructions ?? null,
            autoReplyPositive: replySettings?.auto_reply_positive ?? false,
            autoReplyMinRating: replySettings?.auto_reply_min_rating ?? 5,
          }}
        />
      </div>
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
