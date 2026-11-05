import type { Database } from '@/types/database'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

/** Keyset position in the `(updated_at, id)` order. `updatedAt` is the raw string the server sent. */
export interface ContactCursor {
  updatedAt: string
  id: string
}

export interface ContactUpdatesPage {
  rows: CampaignContactRow[]
  /** Position of the last row returned; null when the page is empty. */
  cursor: ContactCursor | null
  /** True when the server stopped at its page limit and more rows follow the cursor. */
  hasMore: boolean
}

/**
 * Compare two Postgres timestamp strings. Milliseconds come from Date, the
 * sub-millisecond digits (PostgREST sends up to 6 fraction digits, trimming
 * trailing zeros) break ties, so `...00.1234` and `...00.123456` order right.
 */
export function compareTimestamps(a: string, b: string): number {
  const diff = new Date(a).getTime() - new Date(b).getTime()
  if (diff !== 0) return diff < 0 ? -1 : 1
  const micro = (s: string) => {
    const m = /\.(\d+)/.exec(s)
    return m ? Number(m[1].padEnd(6, '0').slice(3, 6)) : 0
  }
  const d = micro(a) - micro(b)
  return d === 0 ? 0 : d < 0 ? -1 : 1
}

export function compareCursors(a: ContactCursor, b: ContactCursor): number {
  const t = compareTimestamps(a.updatedAt, b.updatedAt)
  if (t !== 0) return t
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

/** The greatest `(updated_at, id)` among the rows, or null for none. */
export function newestCursor(
  rows: ReadonlyArray<Pick<CampaignContactRow, 'updated_at' | 'id'>>,
): ContactCursor | null {
  let best: ContactCursor | null = null
  for (const row of rows) {
    const c = { updatedAt: row.updated_at, id: row.id }
    if (!best || compareCursors(c, best) > 0) best = c
  }
  return best
}

/**
 * PostgREST `.or()` filter for "strictly after the cursor" in `(updated_at, id)`
 * order. Values are double-quoted so the `:` and `+` of a timestamp are not
 * parsed as filter syntax; callers validate both values first.
 */
export function keysetAfterFilter(cursor: ContactCursor): string {
  const ts = `"${cursor.updatedAt}"`
  const id = `"${cursor.id}"`
  return `updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${id})`
}

/**
 * Follow `fetchPage` until the server reports no more rows (or `maxPages`
 * is hit; the next poll resumes from the returned cursor). Rows come back in
 * the order received.
 */
export async function drainContactUpdates(
  fetchPage: (cursor: ContactCursor | null) => Promise<ContactUpdatesPage>,
  start: ContactCursor | null,
  maxPages = 20,
): Promise<{ rows: CampaignContactRow[]; cursor: ContactCursor | null }> {
  const rows: CampaignContactRow[] = []
  let cursor = start
  for (let i = 0; i < maxPages; i += 1) {
    const page = await fetchPage(cursor)
    rows.push(...page.rows)
    if (page.cursor) cursor = page.cursor
    if (!page.hasMore || !page.cursor) break
  }
  return { rows, cursor }
}
