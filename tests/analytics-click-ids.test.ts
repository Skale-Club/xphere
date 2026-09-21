// tests/analytics-click-ids.test.ts
// Phase E1 (.planning/clients/o-bigode-portugues/PHASE-E-SPEC.md): Google
// click-id capture.
//
// Two things under test:
//   1. extractClickIdFields — the server-side pure mapper from an ingest
//      payload onto the analytics_sessions columns (src/lib/analytics/ingest.ts).
//   2. CLICK_ID_SCRIPT — the actual browser-side JS text embedded into the
//      analytics script (src/app/api/analytics/script/route.ts), exercised
//      for real via Node's vm module against a fake localStorage/location so
//      the shipped capture/validity/newest-wins logic itself is proven, not
//      just a parallel TS reimplementation of it.

import { describe, it, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { extractClickIdFields } from '@/lib/analytics/click-ids'
import { CLICK_ID_SCRIPT } from '@/lib/analytics/click-id-script'

describe('extractClickIdFields', () => {
  it('passes through provided click ids', () => {
    expect(extractClickIdFields({ gclid: 'g1', gbraid: 'gb1', wbraid: 'wb1', fbclid: 'fb1' })).toEqual({
      gclid: 'g1',
      gbraid: 'gb1',
      wbraid: 'wb1',
      fbclid: 'fb1',
    })
  })

  it('normalizes missing/empty values to null', () => {
    expect(extractClickIdFields({})).toEqual({ gclid: null, gbraid: null, wbraid: null, fbclid: null })
    expect(extractClickIdFields({ gclid: '', gbraid: undefined, wbraid: null as unknown as undefined, fbclid: '' })).toEqual({
      gclid: null,
      gbraid: null,
      wbraid: null,
      fbclid: null,
    })
  })
})

// ─── CLICK_ID_SCRIPT (browser code, run for real via vm) ──────────────────────

interface FakeStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function makeStorage(initial: Record<string, string> = {}): { storage: FakeStorage; data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    storage: {
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => {
        data[k] = v
      },
    },
  }
}

function collectClickIds(search: string, initial: Record<string, string> = {}) {
  const { storage, data } = makeStorage(initial)
  const context = {
    localStorage: storage,
    location: { search },
    URLSearchParams,
    Date,
    JSON,
    result: undefined as unknown,
  }
  runInNewContext(`${CLICK_ID_SCRIPT}\nresult = collectClickIds();`, context)
  return { ids: context.result as Record<string, string | undefined>, data }
}

const DAY_MS = 86_400_000

describe('CLICK_ID_SCRIPT (browser click-id capture)', () => {
  it('captures gclid/gbraid/wbraid from the URL and persists them to localStorage', () => {
    const { ids, data } = collectClickIds('?gclid=abc123&gbraid=gb1&wbraid=wb1')
    expect(ids).toEqual({ gclid: 'abc123', gbraid: 'gb1', wbraid: 'wb1' })

    const stored = JSON.parse(data['_xp_gclid'])
    expect(stored.v).toBe('abc123')
    expect(typeof stored.t).toBe('number')
  })

  it('returns undefined for a click id with no URL param and nothing stored', () => {
    const { ids } = collectClickIds('')
    expect(ids).toEqual({ gclid: undefined, gbraid: undefined, wbraid: undefined })
  })

  it('reuses a still-valid stored gclid when the URL has no param (89 days old)', () => {
    const storedAt = Date.now() - 89 * DAY_MS
    const { ids } = collectClickIds('', { _xp_gclid: JSON.stringify({ v: 'old-click', t: storedAt }) })
    expect(ids.gclid).toBe('old-click')
  })

  it('drops an expired stored gclid (91 days old) when the URL has no param', () => {
    const storedAt = Date.now() - 91 * DAY_MS
    const { ids } = collectClickIds('', { _xp_gclid: JSON.stringify({ v: 'stale-click', t: storedAt }) })
    expect(ids.gclid).toBeUndefined()
  })

  it('newest wins: a fresh URL param overwrites an older, still-valid stored value', () => {
    const storedAt = Date.now() - 10 * DAY_MS
    const { ids, data } = collectClickIds('?gclid=fresh-click', {
      _xp_gclid: JSON.stringify({ v: 'older-click', t: storedAt }),
    })
    expect(ids.gclid).toBe('fresh-click')
    expect(JSON.parse(data['_xp_gclid']).v).toBe('fresh-click')
  })

  it('tolerates corrupted stored JSON without throwing', () => {
    const { ids } = collectClickIds('', { _xp_gclid: 'not-json{' })
    expect(ids.gclid).toBeUndefined()
  })
})
