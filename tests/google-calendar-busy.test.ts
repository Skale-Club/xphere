// tests/google-calendar-busy.test.ts
// Phase 129 Plan 01 — unit tests for fetchBusyTimes's multi-calendar support
// (SYNC-01 Gap 1). Mocks @/lib/supabase/admin and @/lib/crypto so
// getCalendarTokens resolves a fresh token without hitting real crypto or a
// real DB, then stubs global fetch per test to control the freeBusy response.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(async () => JSON.stringify({ access_token: 'tok', refresh_token: 'refresh' })),
  encrypt: vi.fn(async (s: string) => `enc:${s}`),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { fetchBusyTimes } from '@/lib/calendar/google-calendar'

function buildFakeAdmin() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: 'integration-1',
          encrypted_api_key: 'enc-blob',
          config: { token_expiry: Date.now() + 10 * 60_000 },
        },
        error: null,
      })),
    })),
  }
}

describe('fetchBusyTimes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceRoleClient).mockReturnValue(buildFakeAdmin() as any)
  })

  it('Test 1: defaults to primary calendar when no calendarIds passed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ calendars: { primary: { busy: [{ start: 'a', end: 'b' }] } } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchBusyTimes('user', 'org', 'min', 'max')
    expect(result).toEqual([{ start: 'a', end: 'b' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.items).toEqual([{ id: 'primary' }])
  })

  it('Test 2: merges busy intervals across multiple calendarIds in ONE request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        calendars: {
          primary: { busy: [{ start: 'a1', end: 'a2' }] },
          'cal2@group.calendar.google.com': { busy: [{ start: 'b1', end: 'b2' }] },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchBusyTimes('user', 'org', 'min', 'max', ['primary', 'cal2@group.calendar.google.com'])
    expect(result).toEqual([{ start: 'a1', end: 'a2' }, { start: 'b1', end: 'b2' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.items).toEqual([{ id: 'primary' }, { id: 'cal2@group.calendar.google.com' }])
  })

  it('Test 3: a calendarId missing from the response contributes no intervals, does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ calendars: { primary: { busy: [] } } }) })))
    const result = await fetchBusyTimes('user', 'org', 'min', 'max', ['primary', 'missing-cal'])
    expect(result).toEqual([])
  })

  it('Test 4: a non-ok response returns an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const result = await fetchBusyTimes('user', 'org', 'min', 'max', ['primary'])
    expect(result).toEqual([])
  })
})
