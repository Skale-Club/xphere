// tests/analytics-game-events.test.ts
// BS-ANALYTICS-001: game events through the analytics ingest pipeline.
//
//   1. game-events.ts   - event name / metadata / session-context validation
//   2. processIngest    - 'game' events are stored (name + metadata), never
//                         counted as conversions, bad ones are dropped, and
//                         every legacy event path is unchanged
//   3. ingest route     - still answers 200 { ok: true } whatever happens
//
// No database is touched: the Supabase client is replaced by a recording fake.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Recording fake for the service-role client ───────────────────────────────

interface Call {
  table: string
  op: 'insert' | 'upsert' | 'update'
  payload: Record<string, unknown>
}

const state = vi.hoisted(() => ({ calls: [] as Call[] }))

vi.mock('@/lib/supabase/admin', () => {
  const rowFor = (table: string) => {
    switch (table) {
      case 'analytics_setups':
        return { organization_id: 'org-1' }
      case 'analytics_visitors':
        return { id: 'vis-1', session_count: 0, page_view_count: 0 }
      case 'analytics_sessions':
        return { id: 'sess-1', page_view_count: 0 }
      default:
        return null
    }
  }
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'in']) b[m] = chain
    for (const op of ['insert', 'upsert', 'update'] as const) {
      b[op] = (payload: Record<string, unknown>) => {
        state.calls.push({ table, op, payload })
        return b
      }
    }
    b.maybeSingle = async () => ({ data: rowFor(table), error: null })
    b.single = async () => ({ data: rowFor(table), error: null })
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return b
  }
  return { createServiceRoleClient: () => ({ from: (t: string) => builder(t) }) }
})

import {
  isValidGameEventName,
  sanitizeGameMetadata,
  validateGameEvent,
  normalizeConnectionType,
  normalizeScreenDimension,
  GAME_METADATA_MAX_BYTES,
} from '@/lib/analytics/game-events'
import { processIngest, isConversionEvent } from '@/lib/analytics/ingest'
import type { IngestPayload } from '@/lib/analytics/types'

function eventInserts() {
  return state.calls.filter((c) => c.table === 'analytics_events' && c.op === 'insert')
}

function gamePayload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    token: 'tok',
    type: 'event',
    visitor_id: 'v1',
    session_key: 's1',
    event_type: 'game',
    event_name: 'match_start',
    url: 'https://brasilshowdown.com/',
    metadata: { match_id: 'm1', p1_fighter: 'lula', game_id: 'brasil-showdown' },
    ...overrides,
  }
}

beforeEach(() => {
  state.calls.length = 0
})

// ─── 1. validation ────────────────────────────────────────────────────────────

describe('isValidGameEventName', () => {
  it.each(['match_start', 'screen_view', 'game_loaded', 'p1_win', 'a'])('accepts %s', (name) => {
    expect(isValidGameEventName(name)).toBe(true)
  })

  it('accepts exactly 48 characters and rejects 49', () => {
    expect(isValidGameEventName('a'.repeat(48))).toBe(true)
    expect(isValidGameEventName('a'.repeat(49))).toBe(false)
  })

  it.each(['', 'Match_Start', 'match-start', 'match start', '1match', '_match', 'match$', 'partída'])(
    'rejects %j',
    (name) => {
      expect(isValidGameEventName(name)).toBe(false)
    },
  )

  it.each([undefined, null, 42, {}, ['match_start']])('rejects non-string %j', (value) => {
    expect(isValidGameEventName(value)).toBe(false)
  })
})

describe('sanitizeGameMetadata', () => {
  it('treats missing metadata as an empty object', () => {
    expect(sanitizeGameMetadata(undefined)).toEqual({})
    expect(sanitizeGameMetadata(null)).toEqual({})
  })

  it('accepts a plain object', () => {
    expect(sanitizeGameMetadata({ a: 1, nested: { b: [1, 2] } })).toEqual({ a: 1, nested: { b: [1, 2] } })
  })

  it.each([[[1, 2]], ['text'], [7], [true]])('rejects non-object %j', (value) => {
    expect(sanitizeGameMetadata(value)).toBeNull()
  })

  it('accepts metadata at the byte limit and rejects one byte over', () => {
    const overhead = JSON.stringify({ k: '' }).length
    const atLimit = { k: 'x'.repeat(GAME_METADATA_MAX_BYTES - overhead) }
    expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(GAME_METADATA_MAX_BYTES)
    expect(sanitizeGameMetadata(atLimit)).toEqual(atLimit)
    expect(sanitizeGameMetadata({ k: atLimit.k + 'x' })).toBeNull()
  })

  it('measures bytes, not characters', () => {
    // 2 bytes per "é": 2100 chars = 4200 bytes > 4096
    expect(sanitizeGameMetadata({ k: 'é'.repeat(2100) })).toBeNull()
  })

  it('rejects unserializable metadata (circular)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(sanitizeGameMetadata(circular)).toBeNull()
  })
})

describe('validateGameEvent', () => {
  it('returns name and metadata for a valid event', () => {
    expect(validateGameEvent({ event_name: 'match_end', metadata: { outcome: 'completed' } })).toEqual({
      event_name: 'match_end',
      metadata: { outcome: 'completed' },
    })
  })

  it('returns null for a bad name or bad metadata', () => {
    expect(validateGameEvent({ event_name: 'Bad', metadata: {} })).toBeNull()
    expect(validateGameEvent({ metadata: {} })).toBeNull()
    expect(validateGameEvent({ event_name: 'ok_name', metadata: [] })).toBeNull()
  })
})

describe('session context normalizers', () => {
  it('keeps only known effectiveType values', () => {
    for (const v of ['slow-2g', '2g', '3g', '4g']) expect(normalizeConnectionType(v)).toBe(v)
    expect(normalizeConnectionType('5g')).toBeNull()
    expect(normalizeConnectionType('<script>')).toBeNull()
    expect(normalizeConnectionType(undefined)).toBeNull()
    expect(normalizeConnectionType(4)).toBeNull()
  })

  it('keeps screen sizes between 1 and 20000 and rounds them', () => {
    expect(normalizeScreenDimension(1920)).toBe(1920)
    expect(normalizeScreenDimension(390.4)).toBe(390)
    expect(normalizeScreenDimension(0)).toBeNull()
    expect(normalizeScreenDimension(-5)).toBeNull()
    expect(normalizeScreenDimension(20001)).toBeNull()
    expect(normalizeScreenDimension(Number.NaN)).toBeNull()
    expect(normalizeScreenDimension('1920')).toBeNull()
  })
})

// ─── 2. processIngest ─────────────────────────────────────────────────────────

describe('processIngest: game events', () => {
  it('stores a game event with its event_name and metadata', async () => {
    await processIngest(gamePayload(), null, null, null, null)

    const inserts = eventInserts()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].payload).toMatchObject({
      organization_id: 'org-1',
      session_id: 'sess-1',
      visitor_id: 'vis-1',
      event_type: 'game',
      event_name: 'match_start',
      metadata: { match_id: 'm1', p1_fighter: 'lula', game_id: 'brasil-showdown' },
    })
  })

  it('never marks the session as converted', async () => {
    await processIngest(gamePayload(), null, null, null, null)
    const sessionUpdates = state.calls.filter((c) => c.table === 'analytics_sessions' && c.op === 'update')
    expect(sessionUpdates.some((c) => 'is_converted' in c.payload)).toBe(false)
  })

  it('does not treat game as a conversion event type', () => {
    expect(isConversionEvent('game')).toBe(false)
  })

  it.each(['Match_Start', 'match-start', '', 'a'.repeat(49)])('drops a game event named %j', async (name) => {
    await processIngest(gamePayload({ event_name: name }), null, null, null, null)
    expect(eventInserts()).toHaveLength(0)
  })

  it('drops a game event without an event_name', async () => {
    await processIngest(gamePayload({ event_name: undefined }), null, null, null, null)
    expect(eventInserts()).toHaveLength(0)
  })

  it('drops a game event whose metadata is over 4 KB', async () => {
    await processIngest(
      gamePayload({ metadata: { blob: 'x'.repeat(GAME_METADATA_MAX_BYTES) } }),
      null, null, null, null,
    )
    expect(eventInserts()).toHaveLength(0)
  })

  it('drops a game event whose metadata is not an object', async () => {
    await processIngest(gamePayload({ metadata: [1, 2, 3] as unknown as Record<string, unknown> }), null, null, null, null)
    expect(eventInserts()).toHaveLength(0)
  })

  it('stores a game event with no metadata as {}', async () => {
    await processIngest(gamePayload({ metadata: undefined }), null, null, null, null)
    expect(eventInserts()[0].payload.metadata).toEqual({})
  })
})

describe('processIngest: legacy events are unchanged', () => {
  it('stores form_submit and marks the session converted', async () => {
    await processIngest(
      { token: 't', type: 'event', visitor_id: 'v1', session_key: 's1', event_type: 'form_submit', metadata: { action: '/x' } },
      null, null, null, null,
    )
    expect(eventInserts()[0].payload).toMatchObject({ event_type: 'form_submit', event_name: null, metadata: { action: '/x' } })
    const converted = state.calls.find((c) => c.table === 'analytics_sessions' && c.op === 'update' && c.payload.is_converted === true)
    expect(converted).toBeDefined()
  })

  it('passes event_name through for non-game events without validating it', async () => {
    await processIngest(
      { token: 't', type: 'event', visitor_id: 'v1', session_key: 's1', event_type: 'custom_conversion', event_name: 'Any Name Here' },
      null, null, null, null,
    )
    expect(eventInserts()[0].payload).toMatchObject({ event_type: 'custom_conversion', event_name: 'Any Name Here', metadata: {} })
  })

  it('defaults a missing event_type to custom_conversion', async () => {
    await processIngest({ token: 't', type: 'event', visitor_id: 'v1', session_key: 's1' }, null, null, null, null)
    expect(eventInserts()[0].payload.event_type).toBe('custom_conversion')
  })
})

describe('processIngest: session_start context', () => {
  const start = (extra: Partial<IngestPayload>): IngestPayload => ({
    token: 't', type: 'session_start', visitor_id: 'v1', session_key: 's1', url: 'https://x.test/', ...extra,
  })

  it('stores connection type and screen size', async () => {
    await processIngest(start({ connection_type: '4g', screen_width: 1920, screen_height: 1080 }), null, null, null, null)
    const upsert = state.calls.find((c) => c.table === 'analytics_sessions' && c.op === 'upsert')
    expect(upsert?.payload).toMatchObject({ connection_type: '4g', screen_width: 1920, screen_height: 1080 })
  })

  it('stores nulls when the script sends nothing (older scripts)', async () => {
    await processIngest(start({}), null, null, null, null)
    const upsert = state.calls.find((c) => c.table === 'analytics_sessions' && c.op === 'upsert')
    expect(upsert?.payload).toMatchObject({ connection_type: null, screen_width: null, screen_height: null })
  })

  it('sanitizes junk values', async () => {
    await processIngest(
      start({ connection_type: 'warp-speed', screen_width: -1, screen_height: 1e9 }),
      null, null, null, null,
    )
    const upsert = state.calls.find((c) => c.table === 'analytics_sessions' && c.op === 'upsert')
    expect(upsert?.payload).toMatchObject({ connection_type: null, screen_width: null, screen_height: null })
  })
})

// ─── 3. route keeps the always-200 contract ───────────────────────────────────

const routeMocks = vi.hoisted(() => ({
  processIngest: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimit: routeMocks.rateLimit }))
vi.mock('@/lib/request-ip', () => ({ getClientIp: () => '203.0.113.7' }))

describe('POST /api/analytics/ingest', () => {
  beforeEach(() => {
    routeMocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 100, resetAt: 0 })
    routeMocks.processIngest.mockReset()
  })

  async function post(body: unknown, raw = false) {
    vi.resetModules()
    vi.doMock('@/lib/analytics/ingest', () => ({ processIngest: routeMocks.processIngest }))
    const { POST } = await import('@/app/api/analytics/ingest/route')
    const request = new Request('https://xphere.app/api/analytics/ingest', {
      method: 'POST',
      body: raw ? (body as string) : JSON.stringify(body),
    })
    return POST(request)
  }

  it('answers 200 and hands a game event to processIngest', async () => {
    const res = await post(gamePayload())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(routeMocks.processIngest).toHaveBeenCalledTimes(1)
    expect(routeMocks.processIngest.mock.calls[0][0]).toMatchObject({ event_type: 'game', event_name: 'match_start' })
  })

  it('answers 200 for malformed JSON', async () => {
    const res = await post('{not json', true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('answers 200 when ingest throws', async () => {
    routeMocks.processIngest.mockRejectedValue(new Error('database down'))
    const res = await post(gamePayload())
    expect(res.status).toBe(200)
  })

  it('answers 200 and skips ingest when rate limited', async () => {
    routeMocks.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 })
    const res = await post(gamePayload())
    expect(res.status).toBe(200)
    expect(routeMocks.processIngest).not.toHaveBeenCalled()
  })
})
