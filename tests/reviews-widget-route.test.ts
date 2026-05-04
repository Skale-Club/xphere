import { describe, it } from 'vitest'

describe('GWDGT-04: GET /api/reviews/[token]', () => {
  it.todo('returns CORS headers for GET requests')
  it.todo('returns CORS headers for OPTIONS requests')
  it.todo('returns cached location + reviews payload for a valid review_token')
  it.todo('orders reviews by display_order ascending')
  it.todo('includes author name, author uri, author photo, relative date, maps links, and fetched_at in JSON')
})

describe('GWDGT-06: token invalid or data unavailable', () => {
  it.todo('returns non-200 for an invalid token')
  it.todo('returns non-200 when no reviews exist for the location')
  it.todo('returns non-200 when fetched_at is older than 30 days')
})

describe('GWDGT-05: Google attribution payload', () => {
  it.todo('includes place name and maps url needed for attribution footer/button')
  it.todo('never calls Google Places API live from the route')
})
