import type { Database } from '@/types/database'

type NotificationRow = Database['public']['Tables']['notifications']['Row']

/**
 * A ringing toast is only useful while the call is still ringing. Rows older
 * than this still appear in the list but never ring (a laptop that slept, a
 * background tab whose timers were throttled to once a minute).
 */
export const INCOMING_CALL_MAX_AGE_MS = 90_000

/**
 * The poll re-reads this much before the newest `created_at` seen. A row
 * commits after a newer one was already visible (transaction order differs from
 * `created_at` order), so a strict `>` cursor would skip it. Rows seen again
 * are dropped by id.
 */
export const NOTIFICATION_POLL_OVERLAP_MS = 5_000

/** `gte` bound for the next poll, or null for the very first read. */
export function overlapSince(newest: string | null, overlapMs = NOTIFICATION_POLL_OVERLAP_MS): string | null {
  if (!newest) return null
  const t = new Date(newest).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t - overlapMs).toISOString()
}

/** The later of two `created_at` strings (the original string is kept). */
export function laterCreatedAt(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(b).getTime() > new Date(a).getTime() ? b : a
}

/** Rows this client has not seen before, oldest first. Mutates `known` to include them. */
export function takeUnseen(known: Set<string>, rows: ReadonlyArray<NotificationRow>): NotificationRow[] {
  const fresh: NotificationRow[] = []
  for (const row of rows) {
    if (known.has(row.id)) continue
    known.add(row.id)
    fresh.push(row)
  }
  return fresh.sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime())
}

export function isFreshIncomingCall(row: Pick<NotificationRow, 'type' | 'created_at'>, now = Date.now()): boolean {
  if (row.type !== 'incoming_call') return false
  const age = now - new Date(row.created_at).getTime()
  return Number.isFinite(age) && age < INCOMING_CALL_MAX_AGE_MS
}
