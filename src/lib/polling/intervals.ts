/**
 * Poll intervals for the dashboard, in one place so they are easy to tune.
 *
 * These replace Supabase Realtime subscriptions (docs/database/execution-plan.md,
 * item A1). Each value is the base interval while the tab is visible; the
 * `usePolling` hook adds jitter, pauses on hidden tabs and backs off on errors.
 */

/** Open conversation messages and the inbox list. */
export const POLL_CHAT_MS = 3_000

/** Outbound call status, only while a call is being tracked. */
export const POLL_OUTBOUND_CALL_MS = 2_000

/** Contact import progress, only while the import is queued or processing. */
export const POLL_IMPORT_PROGRESS_MS = 3_000

/** Campaign contact board while the campaign is running. */
export const POLL_CAMPAIGN_ACTIVE_MS = 5_000

/** Global knowledge Notion sync while a sync job is queued or processing. */
export const POLL_KNOWLEDGE_SYNC_ACTIVE_MS = 5_000

/** Notification bell. Short because incoming-call alerts arrive through it. */
export const POLL_NOTIFICATIONS_MS = 3_000

/** Notification bell while the tab is hidden (it keeps polling so calls still ring). */
export const POLL_NOTIFICATIONS_HIDDEN_MS = 10_000

/** Sidebar unread chat badge. */
export const POLL_UNREAD_COUNT_MS = 30_000

/** Copilot credits indicator. */
export const POLL_CREDITS_MS = 30_000

/** Home dashboard activity feed. */
export const POLL_ACTIVITY_FEED_MS = 30_000

/** Idle campaign board / idle knowledge sync status. */
export const POLL_IDLE_MS = 30_000
