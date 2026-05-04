import { createServiceRoleClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  Vary: 'Origin',
} as const

type ReviewsWidgetPayload = {
  location: {
    name: string
    mapsUrl: string | null
    fetchedAt: string
    reviewCount: number
  }
  reviews: Array<{
    id: string
    authorName: string
    authorPhotoUrl: string | null
    authorUri: string | null
    rating: number
    reviewText: string | null
    originalText: string | null
    relativeTime: string | null
    publishedAt: string | null
    googleMapsUrl: string | null
  }>
}

type GoogleReviewRow = {
  id: string
  author_name: string
  author_photo_url: string | null
  author_uri: string | null
  rating: number
  review_text: string | null
  original_text: string | null
  relative_time: string | null
  published_at: string | null
  google_maps_url: string | null
  display_order: number
}

type GoogleLocationRow = {
  name: string
  maps_url: string | null
  fetched_at: string | null
  review_count: number
  google_reviews: GoogleReviewRow[] | null
}

function unavailable(): Response {
  return Response.json(
    { error: 'Unavailable' },
    {
      status: 404,
      headers: CORS_HEADERS,
    }
  )
}

function isStale(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true

  const timestamp = new Date(fetchedAt).getTime()
  if (Number.isNaN(timestamp)) return true

  return Date.now() - timestamp > STALE_WINDOW_MS
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params

  if (!token) {
    return unavailable()
  }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('google_locations')
    .select('name, maps_url, fetched_at, review_count, google_reviews(*)')
    .eq('review_token', token)
    .single<GoogleLocationRow>()

  if (error || !data || isStale(data.fetched_at)) {
    return unavailable()
  }

  const reviews = [...(data.google_reviews ?? [])].sort((a, b) => a.display_order - b.display_order)

  if (reviews.length === 0) {
    return unavailable()
  }

  const payload: ReviewsWidgetPayload = {
    location: {
      name: data.name,
      mapsUrl: data.maps_url,
      fetchedAt: data.fetched_at!,
      reviewCount: data.review_count,
    },
    reviews: reviews.map((review) => ({
      id: review.id,
      authorName: review.author_name,
      authorPhotoUrl: review.author_photo_url,
      authorUri: review.author_uri,
      rating: review.rating,
      reviewText: review.review_text,
      originalText: review.original_text,
      relativeTime: review.relative_time,
      publishedAt: review.published_at,
      googleMapsUrl: review.google_maps_url,
    })),
  }

  return Response.json(payload, {
    headers: CORS_HEADERS,
  })
}
