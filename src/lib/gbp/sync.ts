import 'server-only'

// Reads from Google Business Profile into Xphere, run by the GBP tick:
//
//   reviews      every tick for the least recently synced locations; new
//                reviews fire gbp.review_received (and gbp.review_negative for
//                <= 3 stars) and, when the org enabled it, get an automatic
//                AI reply for 4-5 stars
//   profile      daily snapshot; a change against the previous one, or
//                Google's own hasGoogleUpdated flag, raises "Google updated
//                your profile" (event + notification + annotation)
//   performance  daily metrics (90 days back the first time) and monthly
//                search keywords
//   posts        scheduled posts whose time has come are published through
//                the ledger; recurring ones schedule their next copy

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { createLogger } from '@/lib/obs/logger'
import { insertNotification } from '@/lib/notifications/insert'
import { dispatchLocalSeoWorkflowEvent } from '@/lib/local-seo/workflow-events'

import { GbpClient, PERFORMANCE_METRICS, STAR_TO_NUMBER, type GbpReview } from './client'
import { proposeChange } from './commands'
import { diffProfiles, flattenProfile, FIELD_LABEL } from './profile'
import { generateReplyDraft, getReplySettings } from './replies'

type Admin = SupabaseClient<Database>
type LocationRow = Database['public']['Tables']['local_seo_locations']['Row']

const log = createLogger({ module: 'gbp/sync' })
const DAY_MS = 86_400_000

function reviewRow(orgId: string, locationId: string, r: GbpReview) {
  const reply = r.reviewReply?.comment ?? null
  return {
    org_id: orgId,
    location_id: locationId,
    review_name: r.name,
    reviewer_name: r.reviewer?.isAnonymous ? null : (r.reviewer?.displayName ?? null),
    reviewer_photo_url: r.reviewer?.profilePhotoUrl ?? null,
    rating: r.starRating ? (STAR_TO_NUMBER[r.starRating] ?? null) : null,
    comment: r.comment ?? null,
    create_time: r.createTime ?? null,
    update_time: r.updateTime ?? null,
    reply_comment: reply,
    reply_update_time: r.reviewReply?.updateTime ?? null,
    reply_state: (reply ? 'replied' : 'none') as 'replied' | 'none',
    raw: r as unknown as Json,
    updated_at: new Date().toISOString(),
  }
}

export async function syncReviews(admin: Admin, location: LocationRow): Promise<{ fetched: number; created: number }> {
  const conn = await GbpClient.forLocation(admin, location.id)
  if (!conn) return { fetched: 0, created: 0 }
  const firstSync = !location.gbp_reviews_synced_at
  // First sync pulls more history; later ones only the most recent pages.
  const { reviews, averageRating, totalReviewCount } = await conn.client.listReviews(conn.accountName, conn.locationName, firstSync ? 20 : 2)

  const names = reviews.map((r) => r.name)
  const { data: known } = names.length
    ? await admin.from('gbp_reviews').select('review_name, reply_state').in('review_name', names)
    : { data: [] }
  const knownState = new Map((known ?? []).map((k) => [k.review_name, k.reply_state]))

  const rows = reviews.map((r) => {
    const row = reviewRow(location.org_id, location.id, r)
    // A reply still going through the ledger stays "pending" until Google has it.
    if (!row.reply_comment && knownState.get(r.name) === 'pending') return { ...row, reply_state: 'pending' as const }
    return row
  })
  if (rows.length) {
    const { error } = await admin.from('gbp_reviews').upsert(rows as never, { onConflict: 'review_name' })
    if (error) throw new Error(`review upsert failed: ${error.message}`)
  }

  await admin
    .from('local_seo_locations')
    .update({
      gbp_reviews_synced_at: new Date().toISOString(),
      gbp_sync_error: null,
      ...(averageRating != null ? { rating: Math.round(averageRating * 10) / 10 } : {}),
      ...(totalReviewCount != null ? { reviews_count: totalReviewCount } : {}),
    })
    .eq('id', location.id)

  // New reviews: only after the first sync, otherwise the whole history would
  // fire events.
  const fresh = firstSync ? [] : reviews.filter((r) => !knownState.has(r.name))
  if (fresh.length) await onNewReviews(admin, location, fresh)
  return { fetched: reviews.length, created: fresh.length }
}

async function onNewReviews(admin: Admin, location: LocationRow, fresh: GbpReview[]) {
  const settings = await getReplySettings(admin, location.org_id)
  const { data: stored } = await admin
    .from('gbp_reviews')
    .select('id, review_name, rating, comment, reviewer_name, reply_state')
    .in('review_name', fresh.map((r) => r.name))
  for (const review of stored ?? []) {
    const payload = {
      review: { id: review.id, rating: review.rating, comment: review.comment, reviewer_name: review.reviewer_name },
      location: { id: location.id, name: location.name, business_name: location.business_name },
      url: `/local-seo/${location.id}/reviews`,
    }
    await dispatchLocalSeoWorkflowEvent(admin, location.org_id, 'gbp.review_received', review.id, payload, 'gbp_reviews')
    if ((review.rating ?? 5) <= 3) {
      await dispatchLocalSeoWorkflowEvent(admin, location.org_id, 'gbp.review_negative', review.id, payload, 'gbp_reviews')
    }

    if (review.reply_state !== 'none') continue
    const positive = (review.rating ?? 0) >= settings.autoReplyMinRating
    if (settings.autoReplyPositive && positive) {
      const draft = await generateReplyDraft(admin, { orgId: location.org_id, reviewId: review.id })
      if (draft.ok) {
        await proposeChange(admin, {
          orgId: location.org_id,
          locationId: location.id,
          command: { type: 'review.reply', reviewId: review.id, comment: draft.text, draftId: draft.draftId },
          actor: { type: 'ai', label: 'Auto-reply (4-5★)', autoApproved: true },
          idempotencyKey: `auto-reply:${review.id}`,
        })
      }
    } else if ((review.rating ?? 5) <= 3) {
      // Negative reviews get a draft ready for a person, never a reply.
      await generateReplyDraft(admin, { orgId: location.org_id, reviewId: review.id })
    }
  }
}

export async function syncProfile(admin: Admin, location: LocationRow): Promise<{ changed: boolean; googleUpdated: boolean }> {
  const conn = await GbpClient.forLocation(admin, location.id)
  if (!conn) return { changed: false, googleUpdated: false }
  const loc = await conn.client.getLocation(conn.locationName)
  const flat = flattenProfile(loc)
  const hash = createHash('sha256').update(JSON.stringify(flat)).digest('hex')

  let googleFields: string[] = []
  if (loc.metadata?.hasGoogleUpdated) {
    try {
      const gu = await conn.client.getGoogleUpdated(conn.locationName)
      googleFields = (gu.diffMask ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    } catch (err) {
      log.warn('gbp_google_updated_failed', { locationId: location.id, error: (err as Error).message })
      googleFields = ['(unknown fields)']
    }
  }

  const { data: last } = await admin
    .from('gbp_profile_snapshots')
    .select('data, data_hash, google_updated')
    .eq('location_id', location.id)
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const changed = !!last && last.data_hash !== hash
  const diff = last && changed ? diffProfiles(last.data as Record<string, unknown>, flat) : []
  const newlyGoogleUpdated = googleFields.length > 0 && JSON.stringify(last?.google_updated ?? null) !== JSON.stringify(googleFields)

  if (!last || changed || newlyGoogleUpdated) {
    await admin.from('gbp_profile_snapshots').insert({
      org_id: location.org_id,
      location_id: location.id,
      data: flat as unknown as Json,
      data_hash: hash,
      google_updated: googleFields.length ? (googleFields as unknown as Json) : null,
      diff: diff as unknown as Json,
    })
  }

  // Edits we made ourselves are already annotated by the ledger; only an
  // unexplained change (or Google's flag) is worth an alert.
  if (last && (newlyGoogleUpdated || (changed && !(await recentLedgerEdit(admin, location.id))))) {
    const fields = newlyGoogleUpdated ? googleFields : diff.map((d) => FIELD_LABEL[d.field] ?? d.field)
    const title = newlyGoogleUpdated ? 'Google updated the profile' : 'The profile changed outside Xphere'
    await admin.from('local_seo_annotations').insert({
      org_id: location.org_id,
      location_id: location.id,
      occurred_at: new Date().toISOString(),
      kind: 'profile_change',
      title: `${title}: ${fields.join(', ').slice(0, 150)}`,
    })
    await dispatchLocalSeoWorkflowEvent(
      admin,
      location.org_id,
      'gbp.google_update_detected',
      location.id,
      { location: { id: location.id, name: location.name }, fields, by_google: newlyGoogleUpdated, url: `/local-seo/${location.id}/profile` },
      'local_seo_locations',
    )
    await insertNotification(location.org_id, 'local_seo_alert', {
      location_id: location.id,
      location_name: location.name,
      keyword: 'Business Profile',
      metric_label: title,
      previous_value: null,
      current_value: fields.join(', '),
      is_worse: true,
      target: 'profile',
    })
  }

  await admin
    .from('local_seo_locations')
    .update({
      gbp_profile_synced_at: new Date().toISOString(),
      primary_category: flat.primaryCategory ?? location.primary_category,
      website_url: flat.websiteUri ?? location.website_url,
      phone: flat.primaryPhone ?? location.phone,
    })
    .eq('id', location.id)
  return { changed, googleUpdated: newlyGoogleUpdated }
}

async function recentLedgerEdit(admin: Admin, locationId: string): Promise<boolean> {
  const since = new Date(Date.now() - 2 * DAY_MS).toISOString()
  const { data } = await admin
    .from('gbp_change_requests')
    .select('id')
    .eq('location_id', locationId)
    .eq('command_type', 'profile.update')
    .eq('status', 'succeeded')
    .gte('completed_at', since)
    .limit(1)
  return !!data?.length
}

export async function syncPerformance(admin: Admin, location: LocationRow): Promise<{ rows: number; keywords: number }> {
  const conn = await GbpClient.forLocation(admin, location.id)
  if (!conn) return { rows: 0, keywords: 0 }
  // Performance data lags ~3 days; re-read the last 10 to catch revisions.
  const end = new Date(Date.now() - DAY_MS)
  const start = new Date(end.getTime() - (location.gbp_perf_synced_at ? 10 : 90) * DAY_MS)
  const series = await conn.client.fetchDailyMetrics(conn.locationName, [...PERFORMANCE_METRICS], start, end)
  if (series.length) {
    const { error } = await admin.from('gbp_performance_daily').upsert(
      series.map((s) => ({ org_id: location.org_id, location_id: location.id, date: s.date, metric: s.metric, value: s.value })),
      { onConflict: 'location_id,date,metric' },
    )
    if (error) throw new Error(`performance upsert failed: ${error.message}`)
  }

  // Monthly keywords: the last 3 complete months.
  let keywords = 0
  const now = new Date()
  for (let back = 1; back <= 3; back++) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    try {
      const rows = await conn.client.fetchSearchKeywords(conn.locationName, month, month)
      if (rows.length) {
        await admin.from('gbp_search_keywords_monthly').upsert(
          rows.map((r) => ({
            org_id: location.org_id,
            location_id: location.id,
            month: month.toISOString().slice(0, 10),
            keyword: r.keyword.slice(0, 300),
            impressions: r.impressions,
            threshold: r.threshold,
          })),
          { onConflict: 'location_id,month,keyword' },
        )
        keywords += rows.length
      }
    } catch (err) {
      log.warn('gbp_keywords_failed', { locationId: location.id, error: (err as Error).message })
    }
  }

  await admin.from('local_seo_locations').update({ gbp_perf_synced_at: new Date().toISOString() }).eq('id', location.id)
  return { rows: series.length, keywords }
}

/** Publish scheduled posts that are due; recurring posts queue their next run. */
export async function publishDuePosts(admin: Admin, now = new Date()): Promise<number> {
  const { data: due } = await admin
    .from('gbp_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(20)
  let published = 0
  for (const post of due ?? []) {
    // Claim the post so two ticks never publish it twice.
    const { data: claimed } = await admin
      .from('gbp_posts')
      .update({ status: 'publishing' })
      .eq('id', post.id)
      .eq('status', 'scheduled')
      .select('id')
    if (!claimed?.length) continue
    const res = await proposeChange(admin, {
      orgId: post.org_id,
      locationId: post.location_id,
      command: { type: 'post.create', postId: post.id },
      // Scheduling requires local_seo.approve, so the schedule is the approval.
      actor: { type: 'system', label: 'Scheduled post', canApprove: true, autoApproved: true },
      idempotencyKey: `post:${post.id}:${post.scheduled_for}`,
    })
    if (!res.ok || res.change.status === 'failed') {
      const reason = res.ok ? (res.change.error_message ?? 'Publishing failed.') : res.message
      await admin.from('gbp_posts').update({ status: 'failed', error: reason.slice(0, 500) }).eq('id', post.id)
      continue
    }
    published++
    if (post.recurrence !== 'none' && post.scheduled_for) {
      const next = new Date(post.scheduled_for)
      if (post.recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
      else next.setUTCMonth(next.getUTCMonth() + 1)
      await admin.from('gbp_posts').insert({
        org_id: post.org_id,
        location_id: post.location_id,
        topic_type: post.topic_type,
        summary: post.summary,
        media_url: post.media_url,
        cta_type: post.cta_type,
        cta_url: post.cta_url,
        event: post.event,
        offer: post.offer,
        recurrence: post.recurrence,
        status: 'scheduled',
        scheduled_for: next.toISOString(),
        created_by: post.created_by,
      })
    }
  }
  return published
}
