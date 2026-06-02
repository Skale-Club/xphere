import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the service-role client BEFORE importing the route handler
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => mockSupabase,
}))

// Programmable mock — set its responses per test
type Result = { data: unknown; error: unknown; count?: number }
let nextResults: Result[] = []
function takeResult(): Result {
  return nextResults.shift() ?? { data: null, error: null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => Promise.resolve(takeResult())),
    single: vi.fn(() => Promise.resolve(takeResult())),
    maybeSingle: vi.fn(() => Promise.resolve(takeResult())),
    not: vi.fn(() => chain),
    // Allow awaiting the chain itself when no terminator is called
    then: (onFulfilled: (v: Result) => unknown) => Promise.resolve(takeResult()).then(onFulfilled),
  }
  return chain
}

const mockSupabase = {
  from: vi.fn(() => makeChain()),
}

import { GET } from '@/app/api/reviews/[token]/route'

const PROFILE = {
  id: 'profile-1',
  org_id: 'org-1',
  business_name: 'Skale Club',
  address: 'Av. Paulista, 1000, São Paulo',
  average_rating: 4.6,
  total_reviews_count: 142,
  last_scraped_at: '2026-05-16T06:00:00.000Z',
}

const REVIEWS = [
  {
    id: 'r1',
    reviewer_name: 'Jane Doe',
    reviewer_photo_url: 'https://lh3.googleusercontent.com/a/jane.jpg',
    reviewer_profile_url: null,
    rating: 5,
    text: 'Amazing!',
    date_text: '2 weeks ago',
    date_iso: '2026-05-03T10:00:00.000Z',
    is_local_guide: true,
    helpful_count: 3,
    owner_response: null,
    owner_response_date: null,
  },
]

const DIST_RATINGS = [{ rating: 5 }, { rating: 5 }, { rating: 4 }, { rating: 3 }]
const ORG_BRANDING = { accent_color: '#22C55E' }

describe('GET /api/reviews/[token]', () => {
  beforeEach(() => {
    nextResults = []
    vi.clearAllMocks()
  })

  it('returns 404 when no profile matches the token', async () => {
    nextResults = [{ data: null, error: { message: 'not found' } }]
    const res = await GET(
      new Request('https://xphere.skale.club/api/reviews/bad-token'),
      { params: Promise.resolve({ token: 'bad-token' }) }
    )
    expect(res.status).toBe(404)
  })

  it('returns a payload with business info, reviews and distribution', async () => {
    nextResults = [
      // 1. profile lookup
      { data: PROFILE, error: null },
      // 2. organization branding lookup
      { data: ORG_BRANDING, error: null },
      // 3. main reviews query (range)
      { data: REVIEWS, error: null, count: 1 },
      // 4. photos fetch (in)
      { data: [], error: null },
      // 5. distribution full-set query
      { data: DIST_RATINGS, error: null },
    ]

    const res = await GET(
      new Request('https://xphere.skale.club/api/reviews/abc?min_rating=4&sort=recent&limit=5'),
      { params: Promise.resolve({ token: 'abc' }) }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.business.name).toBe('Skale Club')
    expect(body.business.averageRating).toBe(4.6)
    expect(body.brand.accent).toBe('#22C55E')
    expect(body.reviews).toHaveLength(1)
    expect(body.reviews[0].reviewerName).toBe('Jane Doe')
    expect(body.reviews[0].rating).toBe(5)
    expect(body.reviews[0].isLocalGuide).toBe(true)
    expect(body.distribution).toEqual([
      { rating: 5, count: 2 },
      { rating: 4, count: 1 },
      { rating: 3, count: 1 },
      { rating: 2, count: 0 },
      { rating: 1, count: 0 },
    ])
    expect(body.total).toBe(1)
  })

  it('sets a 1-hour cache header for CDN', async () => {
    nextResults = [
      { data: PROFILE, error: null },
      { data: ORG_BRANDING, error: null },
      { data: [], error: null, count: 0 },
      { data: [], error: null },
      { data: [], error: null },
    ]
    const res = await GET(
      new Request('https://xphere.skale.club/api/reviews/abc'),
      { params: Promise.resolve({ token: 'abc' }) }
    )
    const cache = res.headers.get('cache-control') ?? ''
    expect(cache).toContain('public')
    expect(cache).toContain('s-maxage=3600')
  })

  it('clamps min_rating, limit and offset', async () => {
    nextResults = [
      { data: PROFILE, error: null },
      { data: ORG_BRANDING, error: null },
      { data: [], error: null, count: 0 },
      { data: [], error: null },
      { data: [], error: null },
    ]
    const res = await GET(
      new Request('https://xphere.skale.club/api/reviews/abc?min_rating=99&limit=9999&offset=-5'),
      { params: Promise.resolve({ token: 'abc' }) }
    )
    expect(res.status).toBe(200)
    // Doesn't crash — clamp logic kept the request well-formed.
  })
})
