import type { ActivityFeedEvent } from '@/app/(dashboard)/activity-feed-types'

/** The feed never grows past this many events in memory. */
export const ACTIVITY_FEED_MAX_EVENTS = 200

/**
 * Merge a freshly polled first page into the events already on screen.
 *
 * Events the screen does not have yet are added; events it already has are left
 * untouched (so rows the user loaded with "Load more" stay put). The result is
 * ordered newest first. Returns `prev` itself when nothing is new, so React
 * can skip the re-render.
 */
export function mergeActivityEvents(
  prev: ActivityFeedEvent[],
  polled: ActivityFeedEvent[],
  max = ACTIVITY_FEED_MAX_EVENTS,
): ActivityFeedEvent[] {
  if (polled.length === 0) return prev
  const known = new Set(prev.map((e) => e.id))
  const added = polled.filter((e) => e.id && !known.has(e.id))
  if (added.length === 0) return prev
  const time = (e: ActivityFeedEvent) => new Date(e.timestamp).getTime() || 0
  return [...added, ...prev].sort((a, b) => time(b) - time(a)).slice(0, max)
}
