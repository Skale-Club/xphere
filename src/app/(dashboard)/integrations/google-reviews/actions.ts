'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'
import { SerpApiClient, isSerpApiError, type SerpApiMapsSearchPlace } from '@/lib/serpapi/client'
import { scrapeAllReviews } from '@/lib/serpapi/scrape-reviews'
import { upsertReviews } from '@/lib/serpapi/upsert-reviews'

async function getOrgContext() {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' as const }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' as const }

  return { supabase, orgId, userId: user.id }
}

export async function saveSerpApiKey(input: { apiKey: string }): Promise<{ error?: string; success?: boolean }> {
  const ctx = await getOrgContext()
  if ('error' in ctx) return { error: ctx.error }

  const trimmed = input.apiKey.trim()
  if (trimmed.length < 20) return { error: 'API key looks invalid (too short).' }

  const encrypted = await encrypt(trimmed)

  // Check if profile exists
  const { data: existing } = await ctx.supabase
    .from('google_business_profiles')
    .select('id')
    .maybeSingle()

  if (existing) {
    const { error } = await ctx.supabase
      .from('google_business_profiles')
      .update({ serpapi_key_encrypted: encrypted })
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    // Pre-create with placeholder place_id | user will complete via selectPlaceId
    const { error } = await ctx.supabase
      .from('google_business_profiles')
      .insert({
        org_id: ctx.orgId,
        place_id: '__pending__',
        serpapi_key_encrypted: encrypted,
        is_active: false,
      })
    if (error) return { error: error.message }
  }

  revalidatePath('/integrations/google-reviews')
  return { success: true }
}

export async function searchBusinesses(input: {
  query: string
  location?: string
}): Promise<{ error?: string; results?: SerpApiMapsSearchPlace[] }> {
  const ctx = await getOrgContext()
  if ('error' in ctx) return { error: ctx.error }

  const { data: profile } = await ctx.supabase
    .from('google_business_profiles')
    .select('serpapi_key_encrypted')
    .maybeSingle()
  if (!profile?.serpapi_key_encrypted) {
    return { error: 'Save your SerpAPI key first.' }
  }

  const trimmed = input.query.trim()
  if (trimmed.length < 2) return { error: 'Search query is too short.' }

  try {
    const apiKey = await decrypt(profile.serpapi_key_encrypted)
    const client = new SerpApiClient(apiKey)
    const results = await client.searchBusinesses(trimmed, input.location)
    return { results: results.slice(0, 15) }
  } catch (err) {
    if (isSerpApiError(err)) return { error: err.message }
    return { error: err instanceof Error ? err.message : 'Search failed.' }
  }
}

export async function selectPlaceId(input: {
  placeId: string
  businessName: string
  address?: string
}): Promise<{ error?: string; success?: boolean }> {
  const ctx = await getOrgContext()
  if ('error' in ctx) return { error: ctx.error }

  const { data: profile } = await ctx.supabase
    .from('google_business_profiles')
    .select('id')
    .maybeSingle()
  if (!profile) return { error: 'Save your SerpAPI key first.' }

  const { error } = await ctx.supabase
    .from('google_business_profiles')
    .update({
      place_id: input.placeId,
      business_name: input.businessName,
      address: input.address ?? null,
      is_active: true,
    })
    .eq('id', profile.id)
  if (error) return { error: error.message }

  revalidatePath('/integrations/google-reviews')
  revalidatePath('/reviews')
  return { success: true }
}

export async function refreshNow(): Promise<{
  error?: string
  newReviews?: number
  upserted?: number
  removed?: number
  pagesFetched?: number
}> {
  const ctx = await getOrgContext()
  if ('error' in ctx) return { error: ctx.error }

  // Use the same code path as the scrape endpoint but with the org-scoped client.
  const { data: profile } = await ctx.supabase
    .from('google_business_profiles')
    .select('id, place_id, serpapi_key_encrypted')
    .eq('is_active', true)
    .maybeSingle()
  if (!profile) return { error: 'No active business profile.' }

  const admin = createServiceRoleClient()
  const scrapeStartedAt = new Date().toISOString()
  try {
    const apiKey = await decrypt(profile.serpapi_key_encrypted)
    const { reviews, placeInfo, pagesFetched } = await scrapeAllReviews(apiKey, profile.place_id)
    const summary = await upsertReviews(admin, {
      orgId: ctx.orgId,
      profileId: profile.id,
      scrapeStartedAt,
      reviews,
    })
    await admin
      .from('google_business_profiles')
      .update({
        last_scraped_at: new Date().toISOString(),
        last_scrape_status: 'success',
        last_scrape_error: null,
        total_reviews_count: placeInfo?.reviews ?? summary.totalReviewsCount,
        average_rating: placeInfo?.rating ?? summary.averageRating,
        business_name: placeInfo?.title ?? undefined,
        address: placeInfo?.address ?? undefined,
      })
      .eq('id', profile.id)

    revalidatePath('/integrations/google-reviews')
    revalidatePath('/reviews')
    return {
      newReviews: summary.newReviews,
      upserted: summary.upserted,
      removed: summary.removed,
      pagesFetched,
    }
  } catch (err) {
    const status = isSerpApiError(err) && err.status === 'quota_exceeded' ? 'quota_exceeded' : 'error'
    const message = isSerpApiError(err) ? err.message : err instanceof Error ? err.message : 'Unknown error'
    await admin
      .from('google_business_profiles')
      .update({
        last_scraped_at: new Date().toISOString(),
        last_scrape_status: status,
        last_scrape_error: message.slice(0, 500),
      })
      .eq('id', profile.id)
    return { error: message }
  }
}

export async function getKeyHint(): Promise<{ hint: string | null }> {
  const ctx = await getOrgContext()
  if ('error' in ctx) return { hint: null }

  const { data } = await ctx.supabase
    .from('google_business_profiles')
    .select('serpapi_key_encrypted')
    .maybeSingle()
  if (!data?.serpapi_key_encrypted) return { hint: null }
  try {
    const decrypted = await decrypt(data.serpapi_key_encrypted)
    return { hint: maskApiKey(decrypted) }
  } catch {
    return { hint: null }
  }
}

export async function disconnect(): Promise<{ error?: string; success?: boolean }> {
  const ctx = await getOrgContext()
  if ('error' in ctx) return { error: ctx.error }

  const { error } = await ctx.supabase.from('google_business_profiles').delete().neq('id', '__never__')
  if (error) return { error: error.message }

  revalidatePath('/integrations/google-reviews')
  revalidatePath('/reviews')
  return { success: true }
}
