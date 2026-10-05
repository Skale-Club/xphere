import Link from 'next/link'

import { GbpChangeList } from '@/components/local-seo/gbp-changes'
import { ReviewsInbox, type InboxReview } from '@/components/local-seo/reviews-inbox'
import { CHANGE_FIELDS, toChangeView } from '@/lib/gbp/views'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ filter?: string; rating?: string }>
}) {
  const { locationId } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const [{ data: location }, canManage, canApprove] = await Promise.all([
    supabase
      .from('local_seo_locations')
      .select('id, gbp_location_name, google_business_profile_id, rating, reviews_count')
      .eq('id', locationId)
      .maybeSingle(),
    can('local_seo.manage'),
    can('local_seo.approve'),
  ])
  if (!location) return null

  if (!location.gbp_location_name) {
    // Not connected: show the scraped reviews read-only, when linked.
    const { data: scraped } = location.google_business_profile_id
      ? await supabase
          .from('google_reviews')
          .select('id, reviewer_name, rating, text, date_iso, owner_response')
          .eq('profile_id', location.google_business_profile_id)
          .eq('is_removed', false)
          .order('date_iso', { ascending: false, nullsFirst: false })
          .limit(50)
      : { data: [] }
    return (
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">
          Connect this location to Google Business Profile in{' '}
          <Link href={`/local-seo/${locationId}/settings`} className="text-accent underline-offset-4 hover:underline">
            Settings
          </Link>{' '}
          to reply to reviews from here.{scraped?.length ? ' Meanwhile, these are the reviews scraped for the widget.' : ''}
        </div>
        <ReviewsInbox
          locationId={locationId}
          readOnly
          canManage={false}
          canApprove={false}
          reviews={(scraped ?? []).map((r) => ({
            id: r.id,
            reviewer: r.reviewer_name,
            rating: r.rating,
            comment: r.text,
            createdAt: r.date_iso,
            reply: r.owner_response,
            replyState: r.owner_response ? 'replied' : 'none',
            draft: null,
          }))}
        />
      </div>
    )
  }

  let q = supabase
    .from('gbp_reviews')
    .select('id, reviewer_name, rating, comment, create_time, reply_comment, reply_state')
    .eq('location_id', locationId)
    .order('create_time', { ascending: false, nullsFirst: false })
    .limit(100)
  if (sp.filter === 'unreplied') q = q.eq('reply_state', 'none')
  if (sp.filter === 'negative') q = q.lte('rating', 3)
  const [{ data: reviews }, { data: changes }] = await Promise.all([
    q,
    supabase
      .from('gbp_change_requests')
      .select(CHANGE_FIELDS)
      .eq('location_id', locationId)
      .in('command_type', ['review.reply', 'review.delete_reply'])
      .in('status', ['awaiting_approval', 'queued', 'failed', 'drifted'])
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  const ids = (reviews ?? []).map((r) => r.id)
  const { data: drafts } = ids.length
    ? await supabase
        .from('gbp_reply_drafts')
        .select('id, review_id, draft, status, created_at')
        .in('review_id', ids)
        .in('status', ['draft', 'approved', 'failed'])
        .order('created_at', { ascending: false })
    : { data: [] }
  const latestDraft = new Map<string, { id: string; text: string }>()
  for (const d of drafts ?? []) if (!latestDraft.has(d.review_id)) latestDraft.set(d.review_id, { id: d.id, text: d.draft })

  const inbox: InboxReview[] = (reviews ?? []).map((r) => ({
    id: r.id,
    reviewer: r.reviewer_name,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.create_time,
    reply: r.reply_comment,
    replyState: r.reply_state,
    draft: latestDraft.get(r.id) ?? null,
  }))

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      {(changes ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-primary">Replies waiting</h2>
          <GbpChangeList locationId={locationId} canApprove={canApprove} changes={(changes ?? []).map(toChangeView)} />
        </section>
      )}
      <ReviewsInbox locationId={locationId} reviews={inbox} canManage={canManage} canApprove={canApprove} filter={sp.filter ?? 'all'} />
    </div>
  )
}
