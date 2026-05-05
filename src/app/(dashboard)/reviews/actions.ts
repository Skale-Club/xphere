'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import { getPlatformSetting } from '@/lib/platform-settings'
import type { Database } from '@/types/database'

const COOLDOWN_MS = 24 * 60 * 60 * 1000
const GOOGLE_FIELD_MASK = 'id,displayName,formattedAddress,rating,userRatingCount,reviews'

type GoogleLocationRow = Database['public']['Tables']['google_locations']['Row']
type GoogleReviewInsert = Database['public']['Tables']['google_reviews']['Insert']

type PlaceReview = {
  name?: string
  authorAttribution?: {
    displayName?: string
    photoUri?: string
    uri?: string
  }
  rating?: number
  text?: {
    text?: string
  }
  originalText?: {
    text?: string
  }
  relativePublishTimeDescription?: string
  publishTime?: string
  googleMapsUri?: string
}

async function getOrgContext() {
  const user = await getUser()

  if (!user) {
    return { error: 'Not authenticated.' as const }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    return { error: 'No active organization.' as const }
  }

  return { supabase, orgId }
}

export async function addLocation(input: {
  placeId: string
  name: string
  address?: string
  mapsUrl?: string
  category?: string
  clientName?: string
}): Promise<{ error?: string; locationId?: string }> {
  const context = await getOrgContext()

  if ('error' in context) {
    return { error: context.error }
  }

  const { data, error } = await context.supabase
    .from('google_locations')
    .insert({
      org_id: context.orgId,
      place_id: input.placeId,
      name: input.name,
      address: input.address ?? null,
      maps_url: input.mapsUrl ?? null,
      category: input.category ?? null,
      client_name: input.clientName ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { error: error?.message ?? 'Failed to add location.' }
  }

  revalidatePath('/reviews')
  return { locationId: data.id }
}

export async function syncReviews(
  locationId: string
): Promise<{ error?: string; reviewCount?: number }> {
  const context = await getOrgContext()

  if ('error' in context) {
    return { error: context.error }
  }

  const { supabase, orgId } = context

  const { data: location, error: locationError } = await supabase
    .from('google_locations')
    .select('id, place_id, fetched_at')
    .eq('id', locationId)
    .single<Pick<GoogleLocationRow, 'id' | 'place_id' | 'fetched_at'>>()

  if (locationError || !location) {
    return { error: 'Location not found.' }
  }

  if (location.fetched_at) {
    const msSinceLastSync = Date.now() - new Date(location.fetched_at).getTime()

    if (msSinceLastSync < COOLDOWN_MS) {
      const hoursRemaining = (COOLDOWN_MS - msSinceLastSync) / (1000 * 60 * 60)
      return {
        error: `Sync available in ${hoursRemaining.toFixed(1)} hours (24h minimum between syncs).`,
      }
    }
  }

  const apiKey = await getPlatformSetting('GOOGLE_PLACES_API_KEY')

  if (!apiKey) {
    return { error: 'Google Places API key not configured. Contact your administrator.' }
  }

  let response: Response

  try {
    response = await fetch(`https://places.googleapis.com/v1/places/${location.place_id}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'

    await supabase
      .from('google_locations')
      .update({
        last_fetch_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', locationId)

    return { error: message }
  }

  if (!response.ok) {
    const message = `Google Places API returned ${response.status}`

    await supabase
      .from('google_locations')
      .update({
        last_fetch_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', locationId)

    return { error: message }
  }

  const payload = (await response.json()) as { reviews?: PlaceReview[] }
  const reviews = (payload.reviews ?? []).slice(0, 5)

  const reviewRows: GoogleReviewInsert[] = reviews.map((r, index) => ({
    location_id: locationId,
    org_id: orgId,
    google_review_id: r.name ?? `${location.place_id}-${index}`,
    author_name: r.authorAttribution?.displayName ?? 'Anonymous',
    author_photo_url: r.authorAttribution?.photoUri ?? null,
    author_uri: r.authorAttribution?.uri ?? null,
    rating: Math.min(5, Math.max(1, Math.round(r.rating ?? 0))),
    review_text: r.text?.text ?? null,
    original_text: r.originalText?.text ?? null,
    relative_time: r.relativePublishTimeDescription ?? null,
    published_at: r.publishTime ?? null,
    google_maps_url: r.googleMapsUri ?? null,
    display_order: index,
  }))

  const { error: deleteError } = await supabase
    .from('google_reviews')
    .delete()
    .eq('location_id', locationId)

  if (deleteError) {
    await supabase
      .from('google_locations')
      .update({
        last_fetch_error: deleteError.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', locationId)

    return { error: deleteError.message }
  }

  if (reviewRows.length > 0) {
    const { error: insertError } = await supabase.from('google_reviews').insert(reviewRows)

    if (insertError) {
      await supabase
        .from('google_locations')
        .update({
          last_fetch_error: insertError.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', locationId)

      return { error: insertError.message }
    }
  }

  const { error: updateError } = await supabase
    .from('google_locations')
    .update({
      fetched_at: new Date().toISOString(),
      last_fetch_error: null,
      review_count: reviewRows.length,
      updated_at: new Date().toISOString(),
    })
    .eq('id', locationId)

  if (updateError) {
    return { error: updateError.message }
  }

  revalidatePath('/reviews')
  return { reviewCount: reviewRows.length }
}

export async function deleteLocation(
  locationId: string
): Promise<{ error?: string }> {
  const context = await getOrgContext()

  if ('error' in context) {
    return { error: context.error }
  }

  const { error } = await context.supabase
    .from('google_locations')
    .delete()
    .eq('id', locationId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/reviews')
  return {}
}
