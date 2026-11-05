import type { Database } from '@/types/database'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

/** The newest `updated_at` among the rows, kept as the original string. */
export function newestUpdatedAt(rows: ReadonlyArray<Pick<CampaignContactRow, 'updated_at'>>): string | null {
  let best: string | null = null
  let bestTime = -Infinity
  for (const row of rows) {
    const t = new Date(row.updated_at).getTime()
    if (Number.isFinite(t) && t > bestTime) {
      best = row.updated_at
      bestTime = t
    }
  }
  return best
}

/**
 * Apply polled campaign_contacts changes to the rows on screen: rows already
 * present are merged field by field (like the old Realtime UPDATE handler),
 * rows not seen before are appended. Returns `prev` itself when `updates` is
 * empty so React can skip the re-render.
 */
export function mergeCampaignContacts(
  prev: CampaignContactRow[],
  updates: CampaignContactRow[],
): CampaignContactRow[] {
  if (updates.length === 0) return prev
  const byId = new Map(updates.map((u) => [u.id, u]))
  const seen = new Set<string>()
  const next = prev.map((row) => {
    const update = byId.get(row.id)
    if (!update) return row
    seen.add(row.id)
    return { ...row, ...update }
  })
  for (const update of updates) {
    if (!seen.has(update.id)) next.push(update)
  }
  return next
}
