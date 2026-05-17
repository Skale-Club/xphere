import { describe, it, expect } from 'vitest'

import { mapSerpReviewToRow } from '@/lib/serpapi/upsert-reviews'
import type { SerpApiReview } from '@/lib/serpapi/client'
import { resolveReviewPhotos, resolveReviewerPhoto } from '@/lib/serpapi/download-photos'

const NOW = '2026-05-17T12:00:00.000Z'

function makeReview(overrides: Partial<SerpApiReview> = {}): SerpApiReview {
  return {
    review_id: 'ChZDSUhNMG9nS0VJQ0FnSUR0NXFheVZREAE',
    rating: 5,
    date: '2 weeks ago',
    iso_date: '2026-05-03T10:00:00.000Z',
    snippet: 'Excellent service — highly recommend!',
    likes: 2,
    user: {
      name: 'Jane Doe',
      link: 'https://www.google.com/maps/contrib/123',
      thumbnail: 'https://lh3.googleusercontent.com/a/jane.jpg',
      local_guide: true,
      reviews: 47,
    },
    images: [
      { original: 'https://lh5.googleusercontent.com/photo1.jpg', width: 1024, height: 768 },
      { original: 'https://lh5.googleusercontent.com/photo2.jpg', width: 800, height: 600 },
    ],
    response: { date: '1 week ago', snippet: 'Thanks for the kind words!' },
    ...overrides,
  }
}

describe('mapSerpReviewToRow', () => {
  it('maps a complete SerpAPI review payload into an upsert row', () => {
    const row = mapSerpReviewToRow(makeReview(), 'org-1', 'profile-1', NOW)
    expect(row).not.toBeNull()
    expect(row).toMatchObject({
      org_id: 'org-1',
      profile_id: 'profile-1',
      review_id: 'ChZDSUhNMG9nS0VJQ0FnSUR0NXFheVZREAE',
      reviewer_name: 'Jane Doe',
      reviewer_photo_url: 'https://lh3.googleusercontent.com/a/jane.jpg',
      reviewer_profile_url: 'https://www.google.com/maps/contrib/123',
      rating: 5,
      text: 'Excellent service — highly recommend!',
      date_text: '2 weeks ago',
      date_iso: '2026-05-03T10:00:00.000Z',
      is_local_guide: true,
      local_guide_reviews_count: 47,
      helpful_count: 2,
      owner_response: 'Thanks for the kind words!',
      owner_response_date: '1 week ago',
      is_removed: false,
      last_seen_at: NOW,
    })
  })

  it('returns null when review_id is missing', () => {
    const row = mapSerpReviewToRow(makeReview({ review_id: undefined }), 'org-1', 'profile-1', NOW)
    expect(row).toBeNull()
  })

  it('returns null when rating is out of range', () => {
    expect(mapSerpReviewToRow(makeReview({ rating: 0 }), 'org-1', 'profile-1', NOW)).toBeNull()
    expect(mapSerpReviewToRow(makeReview({ rating: 7 }), 'org-1', 'profile-1', NOW)).toBeNull()
  })

  it('rounds fractional ratings to nearest integer (1..5)', () => {
    const row = mapSerpReviewToRow(makeReview({ rating: 4.6 }), 'org-1', 'profile-1', NOW)
    expect(row?.rating).toBe(5)
  })

  it('falls back to owner_answer when response is absent', () => {
    const review = makeReview({
      response: undefined,
      owner_answer: { date: 'yesterday', snippet: 'Backup channel response' },
    })
    const row = mapSerpReviewToRow(review, 'org-1', 'profile-1', NOW)
    expect(row?.owner_response).toBe('Backup channel response')
    expect(row?.owner_response_date).toBe('yesterday')
  })

  it('handles missing user fields gracefully', () => {
    const row = mapSerpReviewToRow(makeReview({ user: undefined }), 'org-1', 'profile-1', NOW)
    expect(row).not.toBeNull()
    expect(row?.reviewer_name).toBeNull()
    expect(row?.reviewer_photo_url).toBeNull()
    expect(row?.is_local_guide).toBe(false)
  })
})

describe('resolveReviewerPhoto', () => {
  it('returns the Google CDN URL when available', () => {
    const res = resolveReviewerPhoto({ thumbnail: 'https://lh3.googleusercontent.com/abc' })
    expect(res.reviewerPhotoUrl).toBe('https://lh3.googleusercontent.com/abc')
  })

  it('returns null when the user has no thumbnail', () => {
    expect(resolveReviewerPhoto({}).reviewerPhotoUrl).toBeNull()
    expect(resolveReviewerPhoto(undefined).reviewerPhotoUrl).toBeNull()
  })
})

describe('resolveReviewPhotos', () => {
  it('maps images to ordered photo rows', () => {
    const res = resolveReviewPhotos([
      { original: 'a.jpg', width: 100, height: 50 },
      { original: 'b.jpg' },
    ])
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({ position: 0, originalUrl: 'a.jpg', width: 100, height: 50, hetznerUrl: null })
    expect(res[1]).toMatchObject({ position: 1, originalUrl: 'b.jpg', hetznerUrl: null })
  })

  it('returns empty array when there are no photos', () => {
    expect(resolveReviewPhotos(undefined)).toEqual([])
    expect(resolveReviewPhotos([])).toEqual([])
  })

  it('skips entries with neither original nor thumbnail URL', () => {
    const res = resolveReviewPhotos([{ width: 100 } as never])
    expect(res).toEqual([])
  })

  it('falls back to thumbnail when original is absent', () => {
    const res = resolveReviewPhotos([{ thumbnail: 'thumb.jpg' }])
    expect(res[0]?.originalUrl).toBe('thumb.jpg')
  })
})
