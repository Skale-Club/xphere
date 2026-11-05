import { describe, expect, it } from 'vitest'

import {
  compareCursors,
  compareTimestamps,
  drainContactUpdates,
  keysetAfterFilter,
  newestCursor,
  type ContactCursor,
  type ContactUpdatesPage,
} from '@/lib/campaigns/contact-cursor'
import {
  INCOMING_CALL_MAX_AGE_MS,
  isFreshIncomingCall,
  laterCreatedAt,
  overlapSince,
  takeUnseen,
} from '@/lib/notifications/poll-window'
import type { Database } from '@/types/database'

type ContactRow = Database['public']['Tables']['campaign_contacts']['Row']
type NotificationRow = Database['public']['Tables']['notifications']['Row']

const TS = '2026-11-05T10:00:00.123456+00:00'

function contact(n: number, updated_at = TS): ContactRow {
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, updated_at } as ContactRow
}

/** In-memory stand-in for the route: same ordering, cursor and page-limit semantics. */
function pager(all: ContactRow[], pageSize: number) {
  return async (cursor: ContactCursor | null): Promise<ContactUpdatesPage> => {
    const rest = all.filter(
      (r) => !cursor || compareCursors({ updatedAt: r.updated_at, id: r.id }, cursor) > 0,
    )
    const rows = rest.slice(0, pageSize)
    const last = rows[rows.length - 1]
    return {
      rows,
      cursor: last ? { updatedAt: last.updated_at, id: last.id } : null,
      hasMore: rows.length === pageSize,
    }
  }
}

describe('campaign contact keyset cursor', () => {
  it('quotes the timestamp and id inside the or() filter', () => {
    expect(keysetAfterFilter({ updatedAt: TS, id: 'abc' })).toBe(
      `updated_at.gt."${TS}",and(updated_at.eq."${TS}",id.gt."abc")`,
    )
  })

  it('orders by timestamp (including sub-millisecond digits) then id', () => {
    expect(compareTimestamps('2026-11-05T10:00:00.1234+00:00', '2026-11-05T10:00:00.123456+00:00')).toBe(-1)
    expect(compareTimestamps('2026-11-05T10:00:01+00:00', '2026-11-05T10:00:00.999+00:00')).toBe(1)
    expect(compareCursors({ updatedAt: TS, id: 'a' }, { updatedAt: TS, id: 'b' })).toBe(-1)
  })

  it('newestCursor picks the greatest (updated_at, id)', () => {
    const rows = [contact(2), contact(9), contact(5), contact(1, '2026-11-05T09:00:00+00:00')]
    expect(newestCursor(rows)).toEqual({ updatedAt: TS, id: contact(9).id })
    expect(newestCursor([])).toBeNull()
  })

  it('drains a burst larger than one page that shares a single timestamp', async () => {
    // 1200 rows with one timestamp: the old `updated_at > since` cursor returned
    // the first 500 and never saw the other 700.
    const all = Array.from({ length: 1200 }, (_, i) => contact(i + 1))
    const first = await drainContactUpdates(pager(all, 500), null)
    expect(first.rows.map((r) => r.id)).toEqual(all.map((r) => r.id))
    // The next poll from the returned cursor finds nothing new.
    const second = await drainContactUpdates(pager(all, 500), first.cursor)
    expect(second.rows).toEqual([])
    expect(second.cursor).toEqual(first.cursor)
  })

  it('stops at maxPages and the next poll resumes from the cursor', async () => {
    const all = Array.from({ length: 30 }, (_, i) => contact(i + 1))
    const a = await drainContactUpdates(pager(all, 10), null, 2)
    expect(a.rows).toHaveLength(20)
    const b = await drainContactUpdates(pager(all, 10), a.cursor, 2)
    expect(b.rows).toHaveLength(10)
  })
})

function notif(id: string, created_at: string, type = 'incoming_call'): NotificationRow {
  return { id, created_at, type, org_id: 'o', user_id: 'u', payload: {}, read_at: null } as NotificationRow
}

describe('notification poll window', () => {
  it('re-reads a few seconds before the newest row seen', () => {
    expect(overlapSince('2026-11-05T10:00:10.000Z', 5000)).toBe('2026-11-05T10:00:05.000Z')
    expect(overlapSince(null)).toBeNull()
  })

  it('keeps the later created_at', () => {
    expect(laterCreatedAt('2026-11-05T10:00:00Z', '2026-11-05T10:00:05Z')).toBe('2026-11-05T10:00:05Z')
    expect(laterCreatedAt('2026-11-05T10:00:05Z', null)).toBe('2026-11-05T10:00:05Z')
  })

  it('does not skip a row that committed after a newer one, and never returns one twice', () => {
    const known = new Set<string>()
    // Poll 1 sees only the newer row (the older one is not committed yet).
    const newer = notif('n2', '2026-11-05T10:00:08.000Z')
    expect(takeUnseen(known, [newer]).map((r) => r.id)).toEqual(['n2'])
    // Poll 2 overlaps the window, so it returns both; only the late one is new.
    const late = notif('n1', '2026-11-05T10:00:06.000Z')
    const since = overlapSince(newer.created_at)!
    expect(new Date(late.created_at).getTime()).toBeGreaterThanOrEqual(new Date(since).getTime())
    expect(takeUnseen(known, [newer, late]).map((r) => r.id)).toEqual(['n1'])
    // Poll 3: nothing new.
    expect(takeUnseen(known, [newer, late])).toEqual([])
  })

  it('rings only for recent incoming calls', () => {
    const now = Date.parse('2026-11-05T10:05:00.000Z')
    const at = (ageMs: number) => new Date(now - ageMs).toISOString()
    expect(isFreshIncomingCall(notif('a', at(20_000)), now)).toBe(true)
    // Seen late by a throttled background tab, still ringing.
    expect(isFreshIncomingCall(notif('b', at(INCOMING_CALL_MAX_AGE_MS - 1)), now)).toBe(true)
    expect(isFreshIncomingCall(notif('c', at(INCOMING_CALL_MAX_AGE_MS + 1)), now)).toBe(false)
    expect(isFreshIncomingCall(notif('d', at(1000), 'missed_call'), now)).toBe(false)
  })
})
