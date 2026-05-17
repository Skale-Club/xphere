// src/lib/serpapi/download-photos.ts
// TODO(SEED-009 follow-up): Upload images to Hetzner Object Storage.
// For now we persist Google CDN URLs directly in reviewer_photo_url + original_url.
// Hetzner credentials and bucket configuration are not yet provisioned (out of scope
// for this phase). When credentials land, replace `null` with the uploaded URL and
// surface a graceful fallback for legacy rows.

import type { SerpApiReviewImage, SerpApiReviewUser } from './client'

export type ReviewerPhotoResult = {
  reviewerPhotoUrl: string | null
}

export type ReviewPhotoResult = {
  position: number
  originalUrl: string
  hetznerUrl: string | null
  width: number | null
  height: number | null
}

/**
 * Resolve reviewer profile photo URL.
 * TODO: Download to Hetzner Object Storage once credentials are configured.
 */
export function resolveReviewerPhoto(user: SerpApiReviewUser | undefined): ReviewerPhotoResult {
  if (!user?.thumbnail) return { reviewerPhotoUrl: null }
  return { reviewerPhotoUrl: user.thumbnail }
}

/**
 * Resolve review images (the photos the reviewer attached).
 * TODO: Download to Hetzner Object Storage once credentials are configured.
 */
export function resolveReviewPhotos(images: SerpApiReviewImage[] | undefined): ReviewPhotoResult[] {
  if (!images || images.length === 0) return []
  return images.map((img, idx) => ({
    position: idx,
    originalUrl: img.original ?? img.thumbnail ?? '',
    hetznerUrl: null,
    width: img.width ?? null,
    height: img.height ?? null,
  })).filter((p) => p.originalUrl)
}
