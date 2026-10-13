import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendTask = vi.hoisted(() => vi.fn())
vi.mock('@/lib/xpot/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/xpot/client')>()),
  xpotSendTask: sendTask,
}))

const { drainXpotTaskSync, mutationForOutbox } = await import('@/lib/xpot/task-sync')

beforeEach(() => sendTask.mockReset())

describe('Xphere -> Xpot task outbox mapping', () => {
  it('maps a native Xphere task to the inbound contract', () => {
    const mutation = mutationForOutbox({
      id: 1,
      task_id: '11111111-1111-4111-8111-111111111111',
      operation: 'upsert',
      attempt_count: 1,
      payload: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Call the customer', status: 'in_progress', priority: 'high',
        due_date: '2026-09-10T14:00:00Z', entity_type: 'account',
        entity_id: '22222222-2222-4222-8222-222222222222', updated_at: '2026-09-01T12:00:00Z',
      },
    })
    expect(mutation).toMatchObject({
      externalId: '11111111-1111-4111-8111-111111111111',
      xpotTaskId: null,
      operation: 'upsert',
      occurredAt: '2026-09-01T12:00:00Z',
      task: { title: 'Call the customer', status: 'in_progress', priority: 'high', entityType: 'account' },
    })
  })

  it('recognizes a task that originated in Xpot and targets the source id', () => {
    const mutation = mutationForOutbox({
      id: 2,
      task_id: '33333333-3333-4333-8333-333333333333',
      operation: 'delete',
      attempt_count: 1,
      payload: {
        id: '33333333-3333-4333-8333-333333333333', title: 'Mirrored task',
        status: 'done', priority: 'medium', external_source: 'xpot', external_id: 'xpot-task-42',
      },
    })
    expect(mutation.xpotTaskId).toBe(42)
    expect(mutation.operation).toBe('delete')
  })

  it('claims and acknowledges a successful delivery', async () => {
    const updates: Array<Record<string, unknown>> = []
    const row = {
      id: 7, task_id: '44444444-4444-4444-8444-444444444444', operation: 'upsert' as const,
      attempt_count: 1, payload: { id: '44444444-4444-4444-8444-444444444444', title: 'Queued', status: 'todo', priority: 'medium' },
    }
    const db = {
      rpc: vi.fn(async () => ({ data: [row], error: null })),
      from: vi.fn(() => ({
        update: (patch: Record<string, unknown>) => ({
          eq: async () => { updates.push(patch); return { error: null } },
        }),
      })),
    }
    sendTask.mockResolvedValue({ ok: true, action: 'created', taskId: 9 })
    await expect(drainXpotTaskSync(db, 10)).resolves.toEqual({ claimed: 1, synced: 1, retried: 0, failed: 0 })
    expect(sendTask).toHaveBeenCalledOnce()
    expect(updates[0]).toMatchObject({ status: 'synced', last_error: null })
  })
})
