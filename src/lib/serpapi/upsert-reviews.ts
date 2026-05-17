// src/lib/serpapi/upsert-reviews.ts
// Pure mapping + DB upsert logic so it can be unit-tested with a mocked Supabase
// service-role client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SerpApiReview } from './client'
import { resolveReviewerPhoto, resolveReviewPhotos } from './download-photos'

type SupabaseAdmin = SupabaseClient<Database>

export type UpsertSummary = {
  upserted: number
  removed: number
  newReviews: number
  photos: number
  averageRating: number | null
  totalReviewsCount: number
}

type GoogleReviewInsert = Database['public']['Tables']['google_reviews']['Insert']
type GoogleReviewPhotoInsert = Database['public']['Tables']['google_review_photos']['Insert']

/**
 * Map a SerpAPI review payload into a `google_reviews` insert row.
 * Returns `null` if the review can't be mapped (missing review_id or invalid rating).
 */
export function mapSerpReviewToRow(
  review: SerpApiReview,
  orgId: string,
  profileId: string,
  now: string
): GoogleReviewInsert | null {
  if (!review.review_id) return null
  const rating = Math.round(review.rating ?? 0)
  if (rating < 1 || rating > 5) return null

  const owner = review.response ?? review.owner_answer
  const photo = resolveReviewerPhoto(review.user)

  return {
    org_id: orgId,
    profile_id: profileId,
    review_id: review.review_id,
    reviewer_name: review.user?.name ?? null,
    reviewer_photo_url: photo.reviewerPhotoUrl,
    reviewer_profile_url: review.user?.link ?? null,
    rating,
    text: review.snippet ?? null,
    date_text: review.date ?? null,
    date_iso: review.iso_date ?? null,
    is_local_guide: Boolean(review.user?.local_guide),
    local_guide_reviews_count: review.user?.reviews ?? null,
    helpful_count: review.likes ?? 0,
    owner_response: owner?.snippet ?? null,
    owner_response_date: owner?.date ?? null,
    is_removed: false,
    last_seen_at: now,
    updated_at: now,
  }
}

/**
 * Upserts reviews + photos and soft-removes reviews that were not seen in this scrape.
 * Recomputes average_rating + total_reviews_count from the resulting active set.
 */
export async function upsertReviews(
  supabase: SupabaseAdmin,
  params: {
    orgId: string
    profileId: string
    scrapeStartedAt: string
    reviews: SerpApiReview[]
  }
): Promise<UpsertSummary> {
  const { orgId, profileId, scrapeStartedAt, reviews } = params
  const now = new Date().toISOString()

  const rows: GoogleReviewInsert[] = []
  for (const r of reviews) {
    const row = mapSerpReviewToRow(r, orgId, profileId, now)
    if (row) rows.push(row)
  }

  // Track new vs returning before upsert
  const reviewIds = rows.map((r) => r.review_id)
  const { data: existing } = await supabase
    .from('google_reviews')
    .select('review_id')
    .eq('profile_id', profileId)
    .in('review_id', reviewIds.length > 0 ? reviewIds : ['__noop__'])
  const existingSet = new Set((existing ?? []).map((r) => r.review_id))
  const newCount = rows.filter((r) => !existingSet.has(r.review_id)).length

  // Upsert in batches of 100
  let upserted = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const { error } = await supabase
      .from('google_reviews')
      .upsert(batch, { onConflict: 'profile_id,review_id' })
    if (error) throw new Error(`Upsert failed: ${error.message}`)
    upserted += batch.length
  }

  // Insert photos for all reviews that have them. We delete the prior photo
  // set for this review first so positions stay consistent if the reviewer
  // reordered or removed photos.
  let photos = 0
  if (rows.length > 0) {
    // Fetch IDs back (we don't have them from upsert without a returning select)
    const { data: refreshed } = await supabase
      .from('google_reviews')
      .select('id, review_id')
      .eq('profile_id', profileId)
      .in('review_id', reviewIds)
    const idByReviewId = new Map((refreshed ?? []).map((r) => [r.review_id, r.id]))

    for (const original of reviews) {
      if (!original.review_id) continue
      const dbId = idByReviewId.get(original.review_id)
      if (!dbId) continue
      const photoRows = resolveReviewPhotos(original.images)
      // Clear + reinsert photos for this review
      await supabase.from('google_review_photos').delete().eq('review_id', dbId)
      if (photoRows.length === 0) continue
      const inserts: GoogleReviewPhotoInsert[] = photoRows.map((p) => ({
        org_id: orgId,
        review_id: dbId,
        position: p.position,
        original_url: p.originalUrl,
        hetzner_url: p.hetznerUrl,
        width: p.width,
        height: p.height,
      }))
      const { error } = await supabase.from('google_review_photos').insert(inserts)
      if (!error) photos += inserts.length
    }
  }

  // Soft-remove reviews that weren't seen this scrape
  const { count: removed } = await supabase
    .from('google_reviews')
    .update({ is_removed: true, updated_at: now }, { count: 'exact' })
    .eq('profile_id', profileId)
    .eq('is_removed', false)
    .lt('last_seen_at', scrapeStartedAt)

  // Recompute average + total from active reviews
  const { data: activeReviews } = await supabase
    .from('google_reviews')
    .select('rating')
    .eq('profile_id', profileId)
    .eq('is_removed', false)

  const total = activeReviews?.length ?? 0
  const avg =
    total > 0
      ? Number((activeReviews!.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(1))
      : null

  return {
    upserted,
    removed: removed ?? 0,
    newReviews: newCount,
    photos,
    averageRating: avg,
    totalReviewsCount: total,
  }
}
