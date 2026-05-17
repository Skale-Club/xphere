/**
 * Shared types for the home dashboard activity feed.
 * Kept separate from the server-action module so it can be imported by
 * client components without pulling the 'use server' wrapper.
 */

export type ActivityFeedFilter = 'all' | 'messages' | 'calls' | 'deals' | 'reviews'

export interface ActivityFeedEvent {
  id: string
  /** Visual category — drives icon + tone in the feed renderer. */
  type: 'message' | 'call' | 'agent' | 'tool' | 'review' | 'error'
  title: string
  description?: string
  timestamp: string
  href?: string
  channel?: string | null
}
