// Ledger row -> view mappers shared by the GBP pages. Pure.
//
// Business Profile changes live in the Ads Command Engine ledger
// (ads_change_requests, platform 'google_business'), keyed by the location's
// engine target accounts/{a}/locations/{l}.

import { COMMAND_CATALOG, type AdsCommandType } from '@/lib/ads/commands/catalog'
import type { DiffEntry } from '@/lib/ads/commands/types'
import type { Database } from '@/types/database'

type ChangeRow = Database['public']['Tables']['ads_change_requests']['Row']

export const CHANGE_FIELDS = 'id, command_type, status, actor_label, actor_type, created_at, completed_at, error_message, diff, rollback_of'

export const REVIEW_COMMANDS = ['google_business.review.reply', 'google_business.review.delete_reply']
export const POST_COMMANDS = ['google_business.local_post.create', 'google_business.local_post.update', 'google_business.local_post.delete']
/** Every location.* command: Local SEO's own edits and those made through MCP, the Copilot or a workflow. */
export const PROFILE_COMMANDS = (Object.keys(COMMAND_CATALOG) as AdsCommandType[]).filter((t) => t.startsWith('google_business.location.'))

/** Applied changes that can be undone with one click (the engine builds the inverse). */
const REVERSIBLE = new Set([
  'google_business.location.update_info',
  'google_business.location.set_regular_hours',
  'google_business.location.set_open_status',
  'google_business.review.reply',
  'google_business.review.delete_reply',
  'google_business.local_post.update',
])

export function gbpTarget(location: { gbp_account_name: string | null; gbp_location_name: string | null }): string | null {
  return location.gbp_account_name && location.gbp_location_name ? `${location.gbp_account_name}/${location.gbp_location_name}` : null
}

export function toChangeView(c: Pick<ChangeRow, 'id' | 'command_type' | 'status' | 'actor_label' | 'actor_type' | 'created_at' | 'completed_at' | 'error_message' | 'diff' | 'rollback_of'>) {
  const diff = (Array.isArray(c.diff) ? c.diff : []) as unknown as DiffEntry[]
  return {
    id: c.id,
    commandType: c.command_type,
    label: COMMAND_CATALOG[c.command_type as AdsCommandType]?.label ?? c.command_type,
    status: c.status,
    actorLabel: c.actor_label,
    actorType: c.actor_type,
    createdAt: c.created_at,
    completedAt: c.completed_at,
    errorMessage: c.error_message,
    diff: diff.map((d) => ({ label: d.label, before: d.before == null ? null : d.beforeDisplay, after: d.after == null ? null : d.afterDisplay })),
    rollbackOf: c.rollback_of,
    reversible: REVERSIBLE.has(c.command_type),
  }
}
