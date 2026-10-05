// Search Console sync against the in-memory database with the API mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const api = vi.hoisted(() => ({ calls: [] as Array<{ dimensions: string[]; startDate: string; endDate: string }> }))

vi.mock('@/lib/seo/gsc/tokens', async () => {
  class GscNotConnectedError extends Error {}
  return {
    GscNotConnectedError,
    getGscAccessToken: vi.fn(async (_sb: unknown, orgId: string) => {
      if (orgId === 'disconnected-org') throw new GscNotConnectedError('Reconnect it.')
      return 'token'
    }),
  }
})

vi.mock('@/lib/seo/gsc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo/gsc/client')>()
  return {
    ...actual,
    querySearchAnalytics: vi.fn(async (_t: string, _p: string, q: { dimensions: string[]; startDate: string; endDate: string }) => {
      api.calls.push(q)
      if (q.dimensions.join() === 'date,device') {
        return [
          { keys: [q.endDate, 'MOBILE'], clicks: 4, impressions: 50, ctr: 0.08, position: 6 },
          { keys: [q.endDate, 'DESKTOP'], clicks: 1, impressions: 20, ctr: 0.05, position: 9 },
        ]
      }
      return [{ keys: [q.dimensions[0] === 'query' ? 'acme plumbing' : 'https://acme.test/'], clicks: 5, impressions: 70, ctr: 0.07, position: 7 }]
    }),
  }
})

import { runGscSyncs } from '@/lib/seo/gsc/sync'
import { fakeSupabase } from './helpers/seo-fake-supabase'

function site(db: Record<string, Record<string, unknown>[]>, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: randomUUID(),
    org_id: 'org',
    name: 'Acme',
    root_url: 'https://acme.test/',
    host: 'acme.test',
    gsc_property: 'sc-domain:acme.test',
    gsc_next_sync_at: null,
    gsc_synced_at: null,
    gsc_backfilled_at: null,
    gsc_last_error: null,
    ...over,
  }
  db.seo_sites.push(row)
  return row
}

describe('runGscSyncs', () => {
  beforeEach(() => {
    api.calls = []
  })

  it('backfills on first sync, then syncs incrementally', async () => {
    const { db, client } = fakeSupabase()
    const s = site(db)

    const first = await runGscSyncs(client)
    expect(first.synced).toHaveLength(1)
    expect(first.synced[0].backfill).toBe(true)
    expect(api.calls.map((c) => c.dimensions.join())).toEqual(['date,device', 'query', 'page'])
    expect(db.seo_gsc_daily).toHaveLength(2)
    expect(db.seo_gsc_top.map((r) => r.dimension).sort()).toEqual(['page', 'query'])
    expect(s.gsc_backfilled_at).toBeTruthy()
    expect(new Date(s.gsc_next_sync_at as string).getTime()).toBeGreaterThan(Date.now() + 19 * 3_600_000)

    // Not due again until tomorrow.
    expect((await runGscSyncs(client)).claimed).toBe(0)

    // Force it due: incremental range, same-day upsert (no duplicate rows), no new top snapshot.
    s.gsc_next_sync_at = null
    api.calls = []
    const second = await runGscSyncs(client)
    expect(second.synced[0].backfill).toBe(false)
    expect(api.calls.map((c) => c.dimensions.join())).toEqual(['date,device'])
    expect(db.seo_gsc_daily).toHaveLength(2)
  })

  it('records a disconnected grant on the site and retries later', async () => {
    const { db, client } = fakeSupabase()
    const s = site(db, { org_id: 'disconnected-org' })
    const res = await runGscSyncs(client)
    expect(res.failed).toHaveLength(1)
    expect(s.gsc_last_error).toContain('Reconnect')
    expect(new Date(s.gsc_next_sync_at as string).getTime()).toBeGreaterThan(Date.now() + 5 * 3_600_000)
  })

  it('ignores sites without a property', async () => {
    const { db, client } = fakeSupabase()
    site(db, { gsc_property: null })
    expect((await runGscSyncs(client)).claimed).toBe(0)
  })
})
