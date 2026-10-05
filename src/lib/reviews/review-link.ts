// Pure helpers for the Review Link tool: turn whatever a user pastes or shares
// from Google Maps into the pieces needed for a "write a review" link.
//
// Google Maps hands out many URL shapes for the same business:
//   https://maps.app.goo.gl/AbC123                       (Share → Copy link)
//   https://share.google/AbC123                          (newer share sheet)
//   https://www.google.com/maps/place/Name/@lat,lng,17z/data=!4m6!3m5!1s0x…:0x…!8m2!3d…!4d…
//   https://maps.google.com/?cid=123456789
//   https://www.google.com/maps?q=Name,+Address&ftid=0x…:0x…
//   https://www.google.com/maps/search/?api=1&query=…&query_place_id=ChIJ…
// Only a Place ID builds the writereview link, so each shape is mined for a
// Place ID first, then a CID / data id (resolved to a Place ID via SerpAPI),
// then a name to search for.

import { cidFromDataId } from '@/lib/local-seo/providers/serpapi'

const URL_RE = /https?:\/\/[^\s<>"']+/i

/** Hosts whose links we follow / parse. Anything else is treated as plain text. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co', 'share.google', 'g.page'])

export function isShortMapsHost(host: string): boolean {
  return SHORT_HOSTS.has(host.toLowerCase())
}

/** google.com, www.google.com.br, maps.google.co.uk, search.google.com, consent.google.com … */
export function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase()
  if (isShortMapsHost(h)) return true
  return /^([a-z0-9-]+\.)*google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)
}

/** First http(s) URL in a blob of shared text, trailing punctuation trimmed. */
export function extractUrl(text: string): string | null {
  const match = text.match(URL_RE)
  if (!match) return null
  return match[0].replace(/[).,;!?]+$/, '')
}

/** The shared text minus its URL, e.g. the business name Android puts above the link. */
export function textWithoutUrl(text: string): string {
  return text
    .replace(new RegExp(URL_RE.source, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type ParsedMapsUrl = {
  placeId: string | null
  cid: string | null
  dataId: string | null
  name: string | null
  lat: number | null
  lng: number | null
}

const DATA_ID_RE = /(0x[0-9a-f]+:0x[0-9a-f]+)/i

function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw
  try {
    value = decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    value = raw.replace(/\+/g, ' ')
  }
  value = value.replace(/\s+/g, ' ').trim()
  return value.length >= 2 ? value : null
}

/** Mine a (long) Google Maps URL for the identifiers it carries. */
export function parseMapsUrl(raw: string): ParsedMapsUrl {
  const out: ParsedMapsUrl = { placeId: null, cid: null, dataId: null, name: null, lat: null, lng: null }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return out
  }
  const params = url.searchParams
  const full = `${url.pathname}${url.search}${url.hash}`

  // Place ID
  const q = params.get('q') ?? params.get('query') ?? ''
  const placeIdFromQ = q.match(/^place_id:([A-Za-z0-9_-]+)$/)?.[1] ?? null
  out.placeId =
    params.get('placeid') ?? params.get('place_id') ?? params.get('query_place_id') ?? placeIdFromQ ?? null

  // CID / data id
  const cid = params.get('cid') ?? params.get('ludocid')
  if (cid && /^\d+$/.test(cid)) out.cid = cid
  const dataId =
    full.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ??
    params.get('ftid')?.match(DATA_ID_RE)?.[1] ??
    url.hash.match(/lrd=(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ??
    null
  if (dataId) {
    out.dataId = dataId
    out.cid ??= cidFromDataId(dataId)
  }

  // Name: /maps/place/<Name>/…, else a free-text q= (not place_id:…)
  const placeSegment = url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1]
  out.name = cleanName(placeSegment) ?? (placeIdFromQ ? null : cleanName(q))

  // Coordinates: the pin (!3d…!4d…) beats the viewport centre (@lat,lng)
  const pin = full.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  const viewport = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  const coords = pin ?? viewport
  if (coords) {
    const lat = Number(coords[1])
    const lng = Number(coords[2])
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      out.lat = lat
      out.lng = lng
    }
  }

  return out
}

/** The link that opens Google's "rate and review" dialog for a business. */
export function writeReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
}

/**
 * Last-resort review link when only a data id is known (no Place ID): Google
 * Search opens the review dialog for `#lrd=<data_id>,3`. Works on desktop and
 * mobile web, less reliably inside the Maps app than writereview.
 */
export function fallbackReviewUrl(dataId: string, name: string | null): string {
  const q = encodeURIComponent(name ?? '')
  return `https://www.google.com/search?q=${q}#lrd=${dataId},3,,,`
}

/** Combine the title/text/url a Web Share Target hands us into one input string. */
export function sharedInput(parts: Array<string | string[] | undefined>): string {
  let lines: string[] = []
  for (const part of parts) {
    const value = (Array.isArray(part) ? part[0] : part)?.trim()
    if (!value) continue
    // Apps repeat the title and url inside text: keep only the part that holds the others.
    if (lines.some((line) => line.includes(value))) continue
    lines = [...lines.filter((line) => !value.includes(line)), value]
  }
  return lines.join('\n').slice(0, 2000)
}

export type ReviewLinkPlace = {
  /** Null only for the data-id fallback link (see fallbackReviewUrl). */
  placeId: string | null
  title: string | null
  address: string | null
  rating: number | null
  reviews: number | null
  reviewUrl: string
}

export type ReviewLinkResult =
  | { kind: 'place'; place: ReviewLinkPlace }
  | { kind: 'candidates'; candidates: ReviewLinkPlace[] }
  | { kind: 'error'; error: string }
