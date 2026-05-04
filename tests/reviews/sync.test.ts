import { describe, it } from 'vitest'

describe('GREV-05: 24h cooldown enforcement', () => {
  it.todo('returns { error } containing "hours" when fetched_at is less than 24h ago')
  it.todo('returns hours remaining as a decimal (e.g. "22.5 hours") in the error message')
  it.todo('allows sync when fetched_at is null (never synced)')
  it.todo('allows sync when fetched_at is exactly 24h ago or older')
  it.todo('does NOT update fetched_at on the location when sync fails')
})

describe('GREV-02: Places API field mapping', () => {
  it.todo('calls fetch with URL https://places.googleapis.com/v1/places/{place_id}')
  it.todo('includes X-Goog-Api-Key header from GOOGLE_PLACES_API_KEY env var')
  it.todo('includes X-Goog-FieldMask header: id,displayName,formattedAddress,rating,userRatingCount,reviews')
  it.todo('maps r.name (resource path) as google_review_id — not r.id which is undefined')
  it.todo('maps r.authorAttribution.displayName as author_name')
  it.todo('maps r.authorAttribution.photoUri as author_photo_url')
  it.todo('maps r.authorAttribution.uri as author_uri')
  it.todo('maps r.text.text as review_text')
  it.todo('maps r.rating as integer rating (1-5)')
  it.todo('stores display_order as array index (0-based)')
  it.todo('returns { error: "Google Places API key not configured." } when env var is missing')
  it.todo('returns { error } and saves last_fetch_error when Places API returns non-200')
})

describe('GREV-02: Review upsert strategy', () => {
  it.todo('deletes all existing google_reviews for location before inserting new set')
  it.todo('updates review_count on google_locations to match inserted review count')
  it.todo('updates fetched_at on google_locations after successful upsert')
  it.todo('clears last_fetch_error on google_locations after successful sync')
  it.todo('returns { reviewCount: number } on success')
})

describe('GREV-03: Manual sync trigger', () => {
  it.todo('syncReviews is callable via server action import (correct "use server" export)')
  it.todo('returns { error: "Not authenticated." } when user session is absent')
})
