// tests/__mocks__/ghl-opportunities-fixture.ts
// Shared fixture for GHL /opportunities/search response shape.
// Per 32-RESEARCH.md Open Question Q1/Q2 and Assumption A1, the exact contact embed
// shape needs a staging probe — these fixtures match the OPTIMISTIC shape (contact
// embedded with id/firstName/phone) and Plan 03 must keep a normalization seam.

export interface FixtureContact {
  id: string
  firstName?: string | null
  phone?: string | null
}

export interface FixtureOpportunity {
  id: string
  status: 'open' | 'won' | 'lost' | 'abandoned'
  updatedAt: string
  statusChangeDate?: string
  contact: FixtureContact
}

export interface FixtureSearchResponse {
  opportunities: FixtureOpportunity[]
  meta: {
    startAfter?: number
    startAfterId?: string
    nextPageUrl?: string | null
    total?: number
    currentPage?: number
  }
}

export const FIXTURE_CREDENTIALS = {
  apiKey: 'fake-ghl-bearer-token-do-not-use',
  locationId: 'loc_test_skleanings',
} as const

// Older than 180 days from "now" if "now" is 2026-05-15 → updatedAt before 2025-11-16
const OLD = '2025-04-01T10:00:00.000Z'
const RECENT = '2026-05-01T10:00:00.000Z'

export const FIXTURE_LOST_OLD_PAGE_1: FixtureSearchResponse = {
  opportunities: [
    { id: 'opp_001', status: 'lost', updatedAt: OLD,
      contact: { id: 'ct_001', firstName: 'Maria', phone: '+5511999990001' } },
    { id: 'opp_002', status: 'lost', updatedAt: OLD,
      contact: { id: 'ct_002', firstName: 'João', phone: '+5511999990002' } },
    { id: 'opp_003', status: 'lost', updatedAt: OLD,
      contact: { id: 'ct_003', firstName: null, phone: '+5511999990003' } },
  ],
  meta: { startAfter: 1714557600000, startAfterId: 'opp_003', total: 5, currentPage: 1 },
}

export const FIXTURE_LOST_OLD_PAGE_2: FixtureSearchResponse = {
  opportunities: [
    { id: 'opp_004', status: 'lost', updatedAt: OLD,
      contact: { id: 'ct_004', firstName: 'Ana', phone: '11999990004' } },     // non-E.164
    { id: 'opp_005', status: 'lost', updatedAt: OLD,
      contact: { id: 'ct_005', firstName: 'Carlos', phone: '+5511999990005' } },
  ],
  meta: { total: 5, currentPage: 2 },  // no startAfter/startAfterId → loop terminates
}

export const FIXTURE_LOST_RECENT_ONLY: FixtureSearchResponse = {
  opportunities: [
    { id: 'opp_recent', status: 'lost', updatedAt: RECENT,
      contact: { id: 'ct_recent', firstName: 'TooRecent', phone: '+5511999999999' } },
  ],
  meta: { total: 1, currentPage: 1 },
}

export const FIXTURE_EMPTY: FixtureSearchResponse = {
  opportunities: [],
  meta: { total: 0, currentPage: 1 },
}
