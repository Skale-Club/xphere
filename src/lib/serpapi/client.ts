// src/lib/serpapi/client.ts
// Typed wrapper around the SerpAPI HTTPS endpoint.
//
// Free tier: 100 searches/month per account. Each business is scraped once per day
// (≤30 searches/month), well within budget. Pagination across review pages costs
// one search per page (10 reviews per page).

const SERPAPI_BASE = 'https://serpapi.com/search.json'

export type SerpApiReviewUser = {
  name?: string
  link?: string
  thumbnail?: string
  local_guide?: boolean
  reviews?: number
}

export type SerpApiReviewImage = {
  thumbnail?: string
  original?: string
  title?: string
  width?: number
  height?: number
}

export type SerpApiOwnerAnswer = {
  date?: string
  snippet?: string
}

export type SerpApiReview = {
  review_id?: string
  rating?: number
  date?: string
  iso_date?: string
  iso_date_of_last_edit?: string
  snippet?: string
  likes?: number
  user?: SerpApiReviewUser
  images?: SerpApiReviewImage[]
  response?: SerpApiOwnerAnswer
  owner_answer?: SerpApiOwnerAnswer
}

export type SerpApiReviewsResponse = {
  reviews?: SerpApiReview[]
  place_info?: {
    title?: string
    address?: string
    rating?: number
    reviews?: number
  }
  serpapi_pagination?: {
    next_page_token?: string
    next?: string
  }
  search_metadata?: {
    status?: string
  }
  error?: string
}

export type SerpApiMapsSearchPlace = {
  position?: number
  title?: string
  place_id?: string
  data_id?: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  types?: string[]
  thumbnail?: string
  gps_coordinates?: { latitude?: number; longitude?: number }
}

export type SerpApiMapsSearchResponse = {
  local_results?: SerpApiMapsSearchPlace[]
  place_results?: SerpApiMapsSearchPlace
  error?: string
}

export type SerpApiError = {
  status: 'quota_exceeded' | 'auth_error' | 'request_error' | 'http_error'
  message: string
  httpStatus?: number
}

export class SerpApiClient {
  constructor(private readonly apiKey: string) {}

  /**
   * Fetch reviews for a place_id via google_maps_reviews engine.
   * Pagination uses next_page_token; pass `null` for the first page.
   */
  async fetchReviews(
    placeId: string,
    nextPageToken: string | null,
    opts: { hl?: string; gl?: string; sortBy?: 'newest' | 'rating_high' | 'rating_low' } = {}
  ): Promise<SerpApiReviewsResponse> {
    const params = new URLSearchParams({
      engine: 'google_maps_reviews',
      place_id: placeId,
      api_key: this.apiKey,
    })
    if (opts.hl) params.set('hl', opts.hl)
    if (opts.gl) params.set('gl', opts.gl)
    if (opts.sortBy === 'newest') params.set('sort_by', 'newestFirst')
    if (opts.sortBy === 'rating_high') params.set('sort_by', 'ratingHigh')
    if (opts.sortBy === 'rating_low') params.set('sort_by', 'ratingLow')
    if (nextPageToken) params.set('next_page_token', nextPageToken)

    const url = `${SERPAPI_BASE}?${params.toString()}`
    const res = await fetch(url, { method: 'GET' })

    if (res.status === 401) {
      throw <SerpApiError>{ status: 'auth_error', message: 'SerpAPI rejected the API key.', httpStatus: 401 }
    }
    if (res.status === 429) {
      throw <SerpApiError>{ status: 'quota_exceeded', message: 'SerpAPI quota exceeded.', httpStatus: 429 }
    }
    if (!res.ok) {
      throw <SerpApiError>{
        status: 'http_error',
        message: `SerpAPI returned ${res.status}`,
        httpStatus: res.status,
      }
    }
    const json = (await res.json()) as SerpApiReviewsResponse
    if (json.error) {
      const msg = json.error.toLowerCase()
      if (msg.includes('your account has run out of searches')) {
        throw <SerpApiError>{ status: 'quota_exceeded', message: json.error }
      }
      throw <SerpApiError>{ status: 'request_error', message: json.error }
    }
    return json
  }

  /**
   * Search for businesses by name + (optional) location. Returns Place ID candidates.
   * Used by the Place ID helper in the integration UI.
   */
  async searchBusinesses(
    query: string,
    location?: string,
    opts: { hl?: string; gl?: string; ll?: { lat: number; lng: number } } = {}
  ): Promise<SerpApiMapsSearchPlace[]> {
    // The location is folded into the query instead of being sent as SerpAPI's
    // `location` param: on the google_maps engine that param is rejected with a
    // 400 unless `z`/`m` is also set, and it only accepts SerpAPI's canonical
    // location names ("Hingham,Massachusetts,United States"), not free text.
    const trimmedLocation = location?.trim()
    const params = new URLSearchParams({
      engine: 'google_maps',
      q: trimmedLocation ? `${query} ${trimmedLocation}` : query,
      api_key: this.apiKey,
      type: 'search',
    })
    if (opts.hl) params.set('hl', opts.hl)
    if (opts.gl) params.set('gl', opts.gl)
    // Bias the search to where the user is standing ("near me" by name).
    if (opts.ll) params.set('ll', `@${opts.ll.lat},${opts.ll.lng},14z`)

    const json = await this.mapsRequest(params)
    if (json.place_results) return [json.place_results]
    return json.local_results ?? []
  }

  /**
   * Resolve a single place by an identifier other than its Place ID: Google's
   * CID (`data_cid`) or a Maps `data` blob (`!4m5!3m4!1s<data_id>!8m2!3d<lat>!4d<lng>`).
   * Returns null when SerpAPI finds no place for it.
   */
  async lookupPlace(
    by: { dataCid: string } | { data: string },
    opts: { hl?: string } = {}
  ): Promise<SerpApiMapsSearchPlace | null> {
    const params = new URLSearchParams({ engine: 'google_maps', type: 'place', api_key: this.apiKey })
    if ('dataCid' in by) params.set('data_cid', by.dataCid)
    else params.set('data', by.data)
    if (opts.hl) params.set('hl', opts.hl)
    const json = await this.mapsRequest(params)
    return json.place_results ?? null
  }

  private async mapsRequest(params: URLSearchParams): Promise<SerpApiMapsSearchResponse> {
    const url = `${SERPAPI_BASE}?${params.toString()}`
    const res = await fetch(url, { method: 'GET' })

    if (res.status === 401) {
      throw <SerpApiError>{ status: 'auth_error', message: 'SerpAPI rejected the API key.', httpStatus: 401 }
    }
    if (res.status === 429) {
      throw <SerpApiError>{ status: 'quota_exceeded', message: 'SerpAPI quota exceeded.', httpStatus: 429 }
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw <SerpApiError>{
        status: 'http_error',
        message: body?.error ? `SerpAPI returned ${res.status}: ${body.error}` : `SerpAPI returned ${res.status}`,
        httpStatus: res.status,
      }
    }
    const json = (await res.json()) as SerpApiMapsSearchResponse
    if (json.error) {
      const msg = json.error.toLowerCase()
      if (msg.includes('your account has run out of searches')) {
        throw <SerpApiError>{ status: 'quota_exceeded', message: json.error }
      }
      throw <SerpApiError>{ status: 'request_error', message: json.error }
    }
    return json
  }
}

export function isSerpApiError(err: unknown): err is SerpApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'string'
  )
}
