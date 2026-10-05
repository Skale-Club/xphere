import Link from 'next/link'

import { GbpChangeList } from '@/components/local-seo/gbp-changes'
import { ProfileEditor } from '@/components/local-seo/profile-editor'
import type { FlatProfile } from '@/lib/gbp/profile'
import { CHANGE_FIELDS, toChangeView } from '@/lib/gbp/views'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationProfilePage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: location }, canManage, canApprove] = await Promise.all([
    supabase.from('local_seo_locations').select('id, gbp_location_name, gbp_profile_synced_at').eq('id', locationId).maybeSingle(),
    can('local_seo.manage'),
    can('local_seo.approve'),
  ])
  if (!location) return null
  if (!location.gbp_location_name) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          Connect this location to Google Business Profile in{' '}
          <Link href={`/local-seo/${locationId}/settings`} className="text-accent underline-offset-4 hover:underline">
            Settings
          </Link>{' '}
          to see and edit its profile.
        </div>
      </div>
    )
  }

  const [{ data: snapshots }, { data: pending }, { data: history }] = await Promise.all([
    supabase
      .from('gbp_profile_snapshots')
      .select('id, taken_at, data, google_updated, diff, acknowledged_at')
      .eq('location_id', locationId)
      .order('taken_at', { ascending: false })
      .limit(10),
    supabase
      .from('gbp_change_requests')
      .select(CHANGE_FIELDS)
      .eq('location_id', locationId)
      .eq('command_type', 'profile.update')
      .in('status', ['awaiting_approval', 'queued', 'executing'])
      .order('created_at', { ascending: false }),
    supabase
      .from('gbp_change_requests')
      .select(CHANGE_FIELDS)
      .eq('location_id', locationId)
      .eq('command_type', 'profile.update')
      .in('status', ['succeeded', 'failed', 'drifted', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const latest = snapshots?.[0] ?? null
  // Unacknowledged outside changes (by Google or someone else) since our last look.
  const alerts = (snapshots ?? [])
    .filter((s) => !s.acknowledged_at && ((Array.isArray(s.google_updated) && s.google_updated.length > 0) || (Array.isArray(s.diff) && s.diff.length > 0)))
    .map((s) => ({
      id: s.id,
      takenAt: s.taken_at,
      byGoogle: Array.isArray(s.google_updated) && s.google_updated.length > 0,
      fields: (Array.isArray(s.google_updated) && s.google_updated.length ? s.google_updated : (s.diff as { field: string }[]).map((d) => d.field)) as string[],
    }))

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      {latest ? (
        <ProfileEditor
          locationId={locationId}
          profile={latest.data as unknown as FlatProfile}
          syncedAt={location.gbp_profile_synced_at}
          canManage={canManage}
          canApprove={canApprove}
          alerts={alerts.slice(0, 3)}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">
          The profile appears after the first sync. Use Sync now in Settings.
        </div>
      )}
      {(pending ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-primary">Waiting for approval</h2>
          <GbpChangeList locationId={locationId} canApprove={canApprove} changes={(pending ?? []).map(toChangeView)} />
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text-primary">History</h2>
        <GbpChangeList locationId={locationId} canApprove={canApprove} changes={(history ?? []).map(toChangeView)} emptyText="No profile edits made through Xphere yet." />
      </section>
    </div>
  )
}
