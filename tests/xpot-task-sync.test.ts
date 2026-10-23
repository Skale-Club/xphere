import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendTask = vi.hoisted(() => vi.fn())
const getCreds = vi.hoisted(() => vi.fn())
vi.mock('@/lib/xpot/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/xpot/client')>()),
  xpotSendTask: sendTask,
}))
vi.mock('@/lib/xpot/credentials', () => ({ getXpotCredentialsForOrg: getCreds }))

const { drainXpotTaskSync, mutationForOutbox } = await import('@/lib/xpot/task-sync')

const XPOT_ORG = '55555555-5555-4555-8555-555555555555'
const CREDS = { baseUrl: 'https://xpot.place', apiKey: 'xpot_test' }

beforeEach(() => {
  sendTask.mockReset()
  getCreds.mockReset()
  getCreds.mockImplementation(async (orgId: string) => (orgId === XPOT_ORG ? CREDS : null))
})

function fakeDb(rows: unknown[], updates: Array<Record<string, unknown>>) {
  return {
    rpc: vi.fn(async () => ({ data: rows, error: null })),
    from: vi.fn(() => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => { updates.push(patch); return { error: null } },
      }),
    })),
  }
}

describe('Xphere -> Xpot task outbox mapping', () => {
  it('maps a native Xphere task to the inbound contract', () => {
    const mutation = mutationForOutbox({
      id: 1,
      org_id: XPOT_ORG,
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
      org_id: XPOT_ORG,
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

  it('claims and acknowledges a successful delivery to the org’s own Xpot', async () => {
    const updates: Array<Record<string, unknown>> = []
    const row = {
      id: 7, org_id: XPOT_ORG, task_id: '44444444-4444-4444-8444-444444444444', operation: 'upsert' as const,
      attempt_count: 1, payload: { id: '44444444-4444-4444-8444-444444444444', title: 'Queued', status: 'todo', priority: 'medium' },
    }
    sendTask.mockResolvedValue({ ok: true, action: 'created', taskId: 9 })
    await expect(drainXpotTaskSync(fakeDb([row], updates), 10)).resolves.toEqual({ claimed: 1, synced: 1, retried: 0, failed: 0 })
    expect(sendTask).toHaveBeenCalledOnce()
    expect(sendTask.mock.calls[0][0]).toEqual(CREDS)
    expect(updates[0]).toMatchObject({ status: 'synced', last_error: null })
  })

  it('never sends a task of an org without an Xpot connection', async () => {
    const updates: Array<Record<string, unknown>> = []
    const row = {
      id: 8, org_id: '66666666-6666-4666-8666-666666666666', task_id: null, operation: 'upsert' as const,
      attempt_count: 1, payload: { id: '77777777-7777-4777-8777-777777777777', title: 'Other tenant', status: 'todo', priority: 'low' },
    }
    await expect(drainXpotTaskSync(fakeDb([row], updates), 10)).resolves.toEqual({ claimed: 1, synced: 0, retried: 0, failed: 1 })
    expect(sendTask).not.toHaveBeenCalled()
    expect(updates[0]).toMatchObject({ status: 'failed', last_error: 'Xpot is not connected for this org.' })
  })

  it('looks the connection up once per org in a drain', async () => {
    const rows = [1, 2, 3].map((id) => ({
      id, org_id: XPOT_ORG, task_id: null, operation: 'upsert' as const, attempt_count: 1,
      payload: { id: `t-${id}`, title: `Task ${id}`, status: 'todo', priority: 'medium' },
    }))
    sendTask.mockResolvedValue({ ok: true, action: 'updated', taskId: null })
    await drainXpotTaskSync(fakeDb(rows, []), 10)
    expect(getCreds).toHaveBeenCalledOnce()
    expect(sendTask).toHaveBeenCalledTimes(3)
  })
})
