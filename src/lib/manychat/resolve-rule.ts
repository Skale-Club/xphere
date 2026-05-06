// src/lib/manychat/resolve-rule.ts
// Resolves the first manychat_rule (priority order) whose JSONB condition is
// contained in the inbound payload. First-match-wins.
//
// Strategy: query by (org_id, channel_id, event_type, is_active=true) ORDER BY
// priority ASC, then iterate in JS and check containment. JS containment is
// chosen over SQL `@>` because:
//   - Per-org rule sets are small (5–50 typical) — single round-trip is fine
//   - First-match-wins short-circuits cleanly in JS
//   - JSON-vs-JS type coercion edge cases are avoided
//   - The matcher is trivially unit-testable with mocked rule arrays
//
// Priority semantics: ASC (lower number wins). Default in DDL is 0.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type ManychatRuleRow = Database['public']['Tables']['manychat_rules']['Row']

export async function resolveRule(
  orgId: string,
  channelId: string,
  eventType: string,
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>
): Promise<ManychatRuleRow | null> {
  const { data, error } = await supabase
    .from('manychat_rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('channel_id', channelId)
    .eq('event_type', eventType)
    .eq('is_active', true)
    .order('priority', { ascending: true })

  if (error || !data) return null

  for (const rule of data) {
    const cond = (rule.condition ?? {}) as Record<string, unknown>
    if (matchesCondition(cond, payload)) {
      return rule as ManychatRuleRow
    }
  }
  return null
}

/**
 * Returns true when every (k, v) in `condition` is contained in `payload`.
 * - Primitive v: strict equality with payload[k]
 * - Object v: recursive containment (payload[k] must also be an object)
 * - Array v: handled as a primitive (strict array reference equality is rare; rules
 *   should use scalar conditions for v1 — nested array containment is deferred)
 */
function matchesCondition(
  condition: Record<string, unknown>,
  payload: Record<string, unknown>
): boolean {
  for (const [k, v] of Object.entries(condition)) {
    const pv = payload[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (pv === null || typeof pv !== 'object' || Array.isArray(pv)) return false
      if (!matchesCondition(
        v as Record<string, unknown>,
        pv as Record<string, unknown>
      )) return false
    } else {
      if (pv !== v) return false
    }
  }
  return true
}
