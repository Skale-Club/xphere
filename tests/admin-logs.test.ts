import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  getUser: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getPlatformLogs } from '@/app/(admin)/admin/logs/_actions/get-platform-logs'

type QueryCall = {
  method: string
  args: unknown[]
}

function makeThenableQuery(result: unknown, calls: QueryCall[]) {
  const query = {
    gte: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'gte', args })
      return query
    }),
    eq: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'eq', args })
      return query
    }),
    is: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'is', args })
      return query
    }),
    in: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'in', args })
      return query
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'order', args })
      return query
    }),
    limit: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'limit', args })
      return query
    }),
    range: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'range', args })
      return query
    }),
    or: vi.fn((...args: unknown[]) => {
      calls.push({ method: 'or', args })
      return query
    }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return query
}

function buildAdminClient(results: unknown[], calls: QueryCall[]) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn((...args: unknown[]) => {
        calls.push({ method: 'from.select', args: [table, ...args] })
        return makeThenableQuery(results.shift(), calls)
      }),
    })),
  }
}

describe('getPlatformLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PLATFORM_ADMIN_EMAIL', 'admin@xphere.app')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects non-platform admins before creating a service-role client', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 'tenant@example.com' } as Awaited<ReturnType<typeof getUser>>)

    await expect(getPlatformLogs()).rejects.toThrow('Unauthorized')
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('returns cross-tenant logs and applies requested filters', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'admin-1', email: 'admin@xphere.app' } as Awaited<ReturnType<typeof getUser>>)

    const calls: QueryCall[] = []
    const admin = buildAdminClient([
      {
        data: [{
          id: 'log-1',
          org_id: 'org-1',
          event_type: 'action.failed',
          source: 'action-engine',
          severity: 'error',
          status: 'failed',
          correlation_id: null,
          actor_type: 'system',
          actor_id: null,
          payload: { action_type: 'send_sms' },
          error_message: 'boom',
          error_stack: null,
          duration_ms: 42,
          created_at: '2026-05-27T12:00:00.000Z',
        }],
        count: 64,
        error: null,
      },
      { data: [{ id: 'org-1', name: 'Skale Club' }], error: null },
      { data: [{ source: 'action-engine' }, { source: 'vapi-webhook' }], error: null },
      { count: 3, error: null },
      { count: 2, error: null },
      { count: 1, error: null },
    ], calls)

    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const result = await getPlatformLogs({
      tenant: 'org-1',
      severity: 'error',
      status: 'failed',
      source: 'action-engine',
      period: '7d',
      q: 'boom',
      page: '2',
    })

    expect(result.logs[0].org_name).toBe('Skale Club')
    expect(result.pagination).toMatchObject({ page: 2, pageSize: 50, pageCount: 2, total: 64 })
    expect(result.stats).toMatchObject({ total: 64, errors: 3, warnings: 2, platform: 1 })

    expect(calls).toContainEqual({ method: 'range', args: [50, 99] })
    expect(calls).toContainEqual({ method: 'eq', args: ['org_id', 'org-1'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['severity', 'error'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'failed'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['source', 'action-engine'] })
    expect(calls.some((call) => call.method === 'or' && String(call.args[0]).includes('event_type.ilike.%boom%'))).toBe(true)
  })
})
