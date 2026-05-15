// tests/ghl-list-opportunities.test.ts
// Phase 32 — REENG-01, REENG-03 coverage.
// GREEN as of Plan 02 (src/lib/ghl/list-opportunities.ts shipped).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FIXTURE_CREDENTIALS,
  FIXTURE_LOST_OLD_PAGE_1,
  FIXTURE_LOST_OLD_PAGE_2,
  FIXTURE_EMPTY,
} from './__mocks__/ghl-opportunities-fixture'
import {
  listOpportunities,
  GHL_DATE_FILTER_PARAM,
} from '@/lib/ghl/list-opportunities'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('listOpportunities (REENG-01, REENG-03)', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('issues GET to /opportunities/search with Bearer + Version header + status=lost + location_id query', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(FIXTURE_EMPTY))

    await listOpportunities(FIXTURE_CREDENTIALS, { status: 'lost', limit: 50 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [urlArg, initArg] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(urlArg).toContain('/opportunities/search')
    expect(urlArg).toContain('status=lost')
    expect(urlArg).toContain(`location_id=${FIXTURE_CREDENTIALS.locationId}`)
    expect(urlArg).toContain('limit=50')

    const headers = initArg.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${FIXTURE_CREDENTIALS.apiKey}`)
    expect(headers['Version']).toBe('2021-07-28')
  })

  it('follows cursor pagination via meta.startAfter + meta.startAfterId until exhausted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(FIXTURE_LOST_OLD_PAGE_1))
      .mockResolvedValueOnce(jsonResponse(FIXTURE_LOST_OLD_PAGE_2))

    const results = await listOpportunities(FIXTURE_CREDENTIALS, { status: 'lost' })

    expect(results).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCallUrl = fetchMock.mock.calls[1][0] as string
    expect(secondCallUrl).toContain('startAfter=1714557600000')
    expect(secondCallUrl).toContain('startAfterId=opp_003')
  })

  it('enforces maxPages hard cap when meta keeps returning a cursor (defensive)', async () => {
    // Use mockImplementation so each call gets a fresh Response (bodies are single-use).
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse(FIXTURE_LOST_OLD_PAGE_1))

    const results = await listOpportunities(FIXTURE_CREDENTIALS, { status: 'lost', maxPages: 3 })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(results).toHaveLength(9) // 3 pages × 3 items
  })

  it('returns empty array on empty response without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(FIXTURE_EMPTY))
    const results = await listOpportunities(FIXTURE_CREDENTIALS, { status: 'lost' })
    expect(results).toEqual([])
  })

  it('sends the date-cutoff query param for updatedBefore (param name verified in staging probe)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(FIXTURE_EMPTY))
    const cutoff = new Date('2025-11-16T00:00:00.000Z')

    await listOpportunities(FIXTURE_CREDENTIALS, { status: 'lost', updatedBefore: cutoff })

    const urlArg = fetchMock.mock.calls[0][0] as string
    // GHL_DATE_FILTER_PARAM is the staging-probe-locked constant (default 'date');
    // ISO of cutoff is URL-encoded by URLSearchParams so colons → %3A.
    expect(urlArg).toContain(`${GHL_DATE_FILTER_PARAM}=${encodeURIComponent(cutoff.toISOString())}`)
  })
})
