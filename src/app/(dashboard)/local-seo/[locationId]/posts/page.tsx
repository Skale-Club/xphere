import Link from 'next/link'

import { GbpChangeList } from '@/components/local-seo/gbp-changes'
import { PostsBoard, type PostView } from '@/components/local-seo/posts-board'
import { CHANGE_FIELDS, gbpTarget, POST_COMMANDS, toChangeView } from '@/lib/gbp/views'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationPostsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: location }, canManage, canApprove] = await Promise.all([
    supabase.from('local_seo_locations').select('id, gbp_account_name, gbp_location_name').eq('id', locationId).maybeSingle(),
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
          to publish posts.
        </div>
      </div>
    )
  }
  const [{ data: posts }, { data: pending }] = await Promise.all([
    supabase.from('gbp_posts').select('*').eq('location_id', locationId).neq('status', 'deleted').order('created_at', { ascending: false }).limit(100),
    supabase
      .from('ads_change_requests')
      .select(CHANGE_FIELDS)
      .eq('platform', 'google_business')
      .eq('ad_account_id', gbpTarget(location) ?? '')
      .in('command_type', POST_COMMANDS)
      .eq('status', 'awaiting_approval')
      .order('created_at', { ascending: false }),
  ])
  const views: PostView[] = (posts ?? []).map((p) => ({
    id: p.id,
    topicType: p.topic_type,
    summary: p.summary,
    mediaUrl: p.media_url,
    ctaType: p.cta_type,
    ctaUrl: p.cta_url,
    event: p.event as PostView['event'],
    offer: p.offer as PostView['offer'],
    recurrence: p.recurrence,
    status: p.status,
    scheduledFor: p.scheduled_for,
    publishedAt: p.published_at,
    searchUrl: p.search_url,
    error: p.error,
  }))
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      {(pending ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-primary">Waiting for approval</h2>
          <GbpChangeList locationId={locationId} canApprove={canApprove} changes={(pending ?? []).map(toChangeView)} />
        </section>
      )}
      <PostsBoard locationId={locationId} posts={views} canManage={canManage} canApprove={canApprove} />
    </div>
  )
}
