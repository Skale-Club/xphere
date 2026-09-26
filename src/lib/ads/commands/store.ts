// Ledger persistence for the command engine.
//
// Every status change is a conditional UPDATE (`WHERE status IN (...)`) that
// returns the row only when it actually moved. That makes the database the
// arbiter between concurrent callers — two approvals of the same change, or a
// cron retry racing a manual retry: exactly one wins the transition, the
// other gets null and backs off. Each successful transition appends an event.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/types/database'
import type { ActorType, ChangeStatus } from './types'

export type ChangeRow = Database['public']['Tables']['ads_change_requests']['Row']
export type ChangeInsert = Database['public']['Tables']['ads_change_requests']['Insert']
export type ChangeUpdate = Database['public']['Tables']['ads_change_requests']['Update']
export type ChangeEventRow = Database['public']['Tables']['ads_change_events']['Row']

function db() {
  return createServiceRoleClient()
}

export type EventActor = { type: ActorType; id: string | null; label: string }

export async function appendEvent(params: {
  orgId: string
  changeId: string
  eventType: string
  from?: ChangeStatus | null
  to?: ChangeStatus | null
  actor: EventActor
  detail?: Record<string, unknown>
}): Promise<void> {
  const { error } = await db().from('ads_change_events').insert({
    org_id: params.orgId,
    change_request_id: params.changeId,
    event_type: params.eventType,
    from_status: params.from ?? null,
    to_status: params.to ?? null,
    actor_type: params.actor.type,
    actor_id: params.actor.id,
    actor_label: params.actor.label,
    detail: (params.detail ?? {}) as Json,
  })
  // The event log is the audit trail; losing an entry silently is worse than
  // a noisy log line, but it must not undo a provider write that happened.
  if (error) console.error('[ads/commands] failed to append event:', error.message)
}

/**
 * Insert a new change, or return the existing one when the idempotency key was
 * already used — the same command against the same state is the same change.
 */
export async function insertChange(row: ChangeInsert): Promise<{ row: ChangeRow; duplicate: boolean }> {
  const { data, error } = await db().from('ads_change_requests').insert(row).select('*').single()
  if (data) return { row: data, duplicate: false }

  if (error?.code === '23505') {
    const { data: existing } = await db()
      .from('ads_change_requests')
      .select('*')
      .eq('org_id', row.org_id)
      .eq('idempotency_key', row.idempotency_key)
      .maybeSingle()
    if (existing) return { row: existing, duplicate: true }
  }
  throw new Error(`Failed to record change request: ${error?.message ?? 'unknown error'}`)
}

export async function getChangeRow(orgId: string, changeId: string): Promise<ChangeRow | null> {
  const { data } = await db()
    .from('ads_change_requests')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', changeId)
    .maybeSingle()
  return data ?? null
}

/** Move a change from one of `from` to `to`, atomically. null = someone else moved it first. */
export async function transition(params: {
  orgId: string
  changeId: string
  from: ChangeStatus[]
  to: ChangeStatus
  patch?: ChangeUpdate
  actor: EventActor
  eventType?: string
  detail?: Record<string, unknown>
}): Promise<ChangeRow | null> {
  const { data, error } = await db()
    .from('ads_change_requests')
    .update({ ...(params.patch ?? {}), status: params.to })
    .eq('org_id', params.orgId)
    .eq('id', params.changeId)
    .in('status', params.from)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`Failed to update change request: ${error.message}`)
  if (!data) return null

  await appendEvent({
    orgId: params.orgId,
    changeId: params.changeId,
    eventType: params.eventType ?? params.to,
    // Exact when the guard allowed a single source state; otherwise the row's
    // previous status isn't known without a second read.
    from: params.from.length === 1 ? params.from[0] : null,
    to: params.to,
    actor: params.actor,
    detail: params.detail,
  })
  return data
}

export type ChangeFilters = {
  status?: ChangeStatus[]
  platform?: 'meta' | 'google'
  adAccountId?: string
  campaignId?: string
  batchId?: string
  limit?: number
}

export async function listChangeRows(orgId: string, filters: ChangeFilters = {}): Promise<ChangeRow[]> {
  let q = db()
    .from('ads_change_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(Math.min(filters.limit ?? 50, 200))
  if (filters.status?.length) q = q.in('status', filters.status)
  if (filters.platform) q = q.eq('platform', filters.platform)
  if (filters.adAccountId) q = q.eq('ad_account_id', filters.adAccountId)
  if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId)
  if (filters.batchId) q = q.eq('batch_id', filters.batchId)
  const { data } = await q
  return data ?? []
}

export async function listChangeEvents(orgId: string, changeId: string): Promise<ChangeEventRow[]> {
  const { data } = await db()
    .from('ads_change_events')
    .select('*')
    .eq('org_id', orgId)
    .eq('change_request_id', changeId)
    .order('created_at', { ascending: true })
  return data ?? []
}

/** Queued changes whose retry time has come, across all orgs (cron only). */
export async function dueQueuedChanges(limit: number): Promise<Array<Pick<ChangeRow, 'id' | 'org_id'>>> {
  const { data } = await db()
    .from('ads_change_requests')
    .select('id, org_id')
    .eq('status', 'queued')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  return data ?? []
}

/** Approvals past their deadline (cron only). */
export async function staleApprovals(limit: number): Promise<Array<Pick<ChangeRow, 'id' | 'org_id'>>> {
  const { data } = await db()
    .from('ads_change_requests')
    .select('id, org_id')
    .eq('status', 'awaiting_approval')
    .lt('approval_expires_at', new Date().toISOString())
    .limit(limit)
  return data ?? []
}

/**
 * Changes stuck mid-flight (process died between claim and completion). They
 * are surfaced, never auto-retried: whether the provider write landed is
 * unknown, and re-sending blindly is exactly what the ledger exists to prevent.
 */
export async function stuckChanges(olderThanMinutes: number, limit: number): Promise<Array<Pick<ChangeRow, 'id' | 'org_id' | 'status'>>> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()
  const { data } = await db()
    .from('ads_change_requests')
    .select('id, org_id, status')
    .in('status', ['executing', 'verifying'])
    .lt('updated_at', cutoff)
    .limit(limit)
  return data ?? []
}

/**
 * Transient failures recorded for one account in the last `minutes` — the
 * circuit breaker's input. Counts rows re-queued after a platform error plus
 * rows that ran out of retries.
 */
export async function recentAccountFailures(
  orgId: string,
  platform: string,
  adAccountId: string,
  minutes: number,
): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const { count } = await db()
    .from('ads_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('platform', platform)
    .eq('ad_account_id', adAccountId)
    .gte('updated_at', since)
    .or('and(status.eq.queued,attempt_count.gt.0),error_code.eq.retries_exhausted')
    .not('error_code', 'is', null)
  return count ?? 0
}

/** Applied changes due for an external-drift check (cron only, all orgs). */
export async function changesToReconcile(limit: number, maxAgeDays: number, everyHours: number): Promise<ChangeRow[]> {
  const oldest = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString()
  const staleBefore = new Date(Date.now() - everyHours * 3_600_000).toISOString()
  const { data } = await db()
    .from('ads_change_requests')
    .select('*')
    .eq('status', 'succeeded')
    .gte('completed_at', oldest)
    .or(`last_reconciled_at.is.null,last_reconciled_at.lt.${staleBefore}`)
    .order('last_reconciled_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  return data ?? []
}

/**
 * Was the same resource changed again by a later applied change? Then drift
 * against this (older) change is expected, not external.
 */
export async function hasLaterChange(row: ChangeRow): Promise<boolean> {
  if (!row.resource_id || !row.completed_at) return false
  const { count } = await db()
    .from('ads_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', row.org_id)
    .eq('platform', row.platform)
    .eq('command_type', row.command_type)
    .eq('resource_id', row.resource_id)
    .in('status', ['succeeded', 'drifted'])
    .gt('completed_at', row.completed_at)
  return (count ?? 0) > 0
}

export async function updateReconciliation(
  orgId: string,
  changeId: string,
  patch: Pick<ChangeUpdate, 'last_reconciled_at' | 'external_drift' | 'external_drift_detected_at'>,
): Promise<void> {
  await db().from('ads_change_requests').update(patch).eq('org_id', orgId).eq('id', changeId)
}
