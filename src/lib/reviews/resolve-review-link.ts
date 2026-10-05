import 'server-only'

// Server half of the Review Link tool: expands Google short links, then turns
// the parsed URL (or a plain business name) into a writereview link, calling
// SerpAPI only when the link itself carries no Place ID.

import { SerpApiClient, isSerpApiError, type SerpApiMapsSearchPlace } from '@/lib/serpapi/client'

import {
  extractUrl,
  fallbackReviewUrl,
  isGoogleHost,
  isShortMapsHost,
  parseMapsUrl,
  textWithoutUrl,
  writeReviewUrl,
  type ReviewLinkPlace,
  type ReviewLinkResult,
} from './review-link'

const MAX_HOPS = 6
const MAX_CANDIDATES = 8
// Short links answer a plain 302 to a browser; some answer a JS page to bots.
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'

type LatLng = { lat: number; lng: number }

/**
 * Follow a maps.app.goo.gl / share.google link to the long Maps URL. Every hop
 * must stay on a Google host (no SSRF through an open redirect), and Google's
 * EU consent interstitial is unwrapped via its `continue` param.
 */
export async function expandShortUrl(start: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let current = start
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let url: URL
    try {
      url = new URL(current)
    } catch {
      return null
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !isGoogleHost(url.hostname)) return null
    if (url.hostname === 'consent.google.com') {
      const next = url.searchParams.get('continue')
      if (!next) return null
      current = next
      continue
    }
    if (!isShortMapsHost(url.hostname)) return current

    const res = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en' },
      signal: AbortSignal.timeout(8_000),
    })
    const location = res.headers.get('location')
    if (!location) return null
    current = new URL(location, current).toString()
  }
  return null
}

function toPlace(p: SerpApiMapsSearchPlace): ReviewLinkPlace | null {
  if (!p.place_id) return null
  return {
    placeId: p.place_id,
    title: p.title ?? null,
    address: p.address ?? null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviews: typeof p.reviews === 'number' ? p.reviews : null,
    reviewUrl: writeReviewUrl(p.place_id),
  }
}

function serpError(err: unknown): ReviewLinkResult {
  return { kind: 'error', error: isSerpApiError(err) ? err.message : 'Business search failed.' }
}

const NO_KEY: ReviewLinkResult = {
  kind: 'error',
  error: 'Business search needs a SerpAPI key. Paste a Google Maps link instead, or ask the platform admin to add one.',
}

async function searchByName(client: SerpApiClient | null, query: string, near: LatLng | null): Promise<ReviewLinkResult> {
  if (!client) return NO_KEY
  try {
    const results = await client.searchBusinesses(query, undefined, near ? { ll: near } : {})
    const candidates = results.map(toPlace).filter((p): p is ReviewLinkPlace => p !== null).slice(0, MAX_CANDIDATES)
    if (candidates.length === 0) return { kind: 'error', error: `No businesses found for "${query}".` }
    if (candidates.length === 1) return { kind: 'place', place: candidates[0] }
    return { kind: 'candidates', candidates }
  } catch (err) {
    return serpError(err)
  }
}

export async function resolveReviewLink(
  input: { text: string; near?: LatLng | null },
  deps: { serpApiKey: string | null; fetchImpl?: typeof fetch },
): Promise<ReviewLinkResult> {
  const text = input.text.trim()
  if (!text) return { kind: 'error', error: 'Paste a Google Maps link or type a business name.' }
  const client = deps.serpApiKey ? new SerpApiClient(deps.serpApiKey) : null
  const near = input.near ?? null

  const link = extractUrl(text)
  const hint = textWithoutUrl(text) || null
  if (!link) {
    if (text.length < 2) return { kind: 'error', error: 'Type at least 2 characters.' }
    return searchByName(client, text, near)
  }

  let host: string
  try {
    host = new URL(link).hostname
  } catch {
    return { kind: 'error', error: 'That link is not valid.' }
  }
  if (!isGoogleHost(host)) {
    return hint ? searchByName(client, hint, near) : { kind: 'error', error: 'That is not a Google Maps link.' }
  }

  let long: string | null = link
  if (isShortMapsHost(host)) {
    try {
      long = await expandShortUrl(link, deps.fetchImpl)
    } catch {
      long = null
    }
  }
  if (!long) {
    return hint
      ? searchByName(client, hint, near)
      : { kind: 'error', error: 'Could not open that link. Try copying it again, or type the business name.' }
  }

  const parsed = parseMapsUrl(long)
  const title = parsed.name ?? hint

  if (parsed.placeId) {
    return {
      kind: 'place',
      place: { placeId: parsed.placeId, title, address: null, rating: null, reviews: null, reviewUrl: writeReviewUrl(parsed.placeId) },
    }
  }

  if (client) {
    const lookups: Array<{ dataCid: string } | { data: string }> = []
    if (parsed.cid) lookups.push({ dataCid: parsed.cid })
    if (parsed.dataId && parsed.lat != null && parsed.lng != null) {
      lookups.push({ data: `!4m5!3m4!1s${parsed.dataId}!8m2!3d${parsed.lat}!4d${parsed.lng}` })
    }
    let lastError: unknown = null
    for (const by of lookups) {
      try {
        const found = await client.lookupPlace(by)
        const place = found ? toPlace(found) : null
        if (place) return { kind: 'place', place: { ...place, title: place.title ?? title } }
      } catch (err) {
        lastError = err
      }
    }
    // Without a data id or a name there is nothing left to try, so surface the SerpAPI error.
    if (lastError && !parsed.dataId && !title) return serpError(lastError)
  }

  if (parsed.dataId) {
    return {
      kind: 'place',
      place: { placeId: null, title, address: null, rating: null, reviews: null, reviewUrl: fallbackReviewUrl(parsed.dataId, title) },
    }
  }

  if (title) {
    const coords = parsed.lat != null && parsed.lng != null ? { lat: parsed.lat, lng: parsed.lng } : near
    return searchByName(client, title, coords)
  }
  return { kind: 'error', error: 'That link does not point to a business. Open the business itself in Google Maps and share it.' }
}
