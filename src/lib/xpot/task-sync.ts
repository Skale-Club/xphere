import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { xpotSendTask, type XpotTaskMutation } from './client'

// Service-role compatible structural type. Keeping the worker independent of
// one Supabase client flavor lets the cron and tests use the same implementation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

type OutboxRow = {
  id: number
  task_id: string | null
  operation: 'upsert' | 'delete'
  payload: Record<string, unknown>
  attempt_count: number
}

function numericXpotId(payload: Record<string, unknown>): number | null {
  if (payload.external_source !== 'xpot' || typeof payload.external_id !== 'string') return null
  const match = /^xpot-task-(\d+)$/.exec(payload.external_id)
  return match ? Number(match[1]) : null
}

export function mutationForOutbox(row: OutboxRow): XpotTaskMutation {
  const p = row.payload
  return {
    externalId: String(p.id ?? row.task_id),
    xpotTaskId: numericXpotId(p),
    operation: row.operation,
    occurredAt: String(p.updated_at ?? new Date().toISOString()),
    task: {
      title: String(p.title ?? 'Task'),
      description: typeof p.description === 'string' ? p.description : null,
      dueAt: typeof p.due_date === 'string' ? p.due_date : null,
      priority: (p.priority as XpotTaskMutation['task']['priority']) ?? 'medium',
      status: (p.status as XpotTaskMutation['task']['status']) ?? 'todo',
      entityType: (p.entity_type as XpotTaskMutation['task']['entityType']) ?? null,
      entityId: typeof p.entity_id === 'string' ? p.entity_id : null,
    },
  }
}

export async function drainXpotTaskSync(db: Db, limit = 25) {
  const { data, error } = await db.rpc('claim_xpot_task_sync', { batch_size: limit })
  if (error) throw new Error(`Could not claim Xpot task sync: ${error.message}`)
  const rows = (data ?? []) as OutboxRow[]
  let synced = 0
  let retried = 0
  let failed = 0
  for (const row of rows) {
    const result = await xpotSendTask(mutationForOutbox(row))
    if (result.ok) {
      await db.from('xpot_task_sync_outbox').update({
        status: 'synced', processed_at: new Date().toISOString(), last_error: null,
      }).eq('id', row.id)
      synced += 1
      continue
    }
    const terminal = !result.retryable || row.attempt_count >= 10
    const delayMinutes = Math.min(60, 2 ** Math.min(row.attempt_count, 6))
    await db.from('xpot_task_sync_outbox').update({
      status: terminal ? 'failed' : 'pending',
      last_error: result.error.slice(0, 1000),
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      processed_at: terminal ? new Date().toISOString() : null,
    }).eq('id', row.id)
    if (terminal) failed += 1
    else retried += 1
  }
  return { claimed: rows.length, synced, retried, failed }
}

/** Start a prompt drain after the current response. The durable cron remains
 * the fallback when this is called outside a Next request context. */
export function scheduleXpotTaskSync() {
  try {
    after(() => drainXpotTaskSync(createServiceRoleClient(), 25).then(() => undefined))
  } catch {
    // The database trigger already queued the mutation; cron will deliver it.
  }
}
