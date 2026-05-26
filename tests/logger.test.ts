// tests/logger.test.ts
// Unit tests for the event_logs ingestion helper (src/lib/logger.ts).
// The Supabase client is mocked — no real DB connection is required.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---- Supabase mock setup -----------------------------------------------
// We intercept the @supabase/supabase-js createClient so the module under
// test never touches a real database.

const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
const mockClient = { from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient),
}))

// ---- Import after mock --------------------------------------------------
import { log } from '@/lib/logger'

describe('log() — event_logs ingestion helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    // Provide env vars so the lazy client is created with real-looking values
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('calls supabase.from("event_logs").insert() with the provided entry', async () => {
    await log({
      event_type: 'test.event',
      source: 'test-source',
    })

    expect(mockFrom).toHaveBeenCalledWith('event_logs')
    expect(mockInsert).toHaveBeenCalledOnce()
    const insertArg = mockInsert.mock.calls[0][0]
    expect(insertArg.event_type).toBe('test.event')
    expect(insertArg.source).toBe('test-source')
  })

  it('defaults severity to "info" when not provided', async () => {
    await log({ event_type: 'test.event', source: 'src' })
    const insertArg = mockInsert.mock.calls[0][0]
    expect(insertArg.severity).toBe('info')
  })

  it('defaults status to "ok" when not provided', async () => {
    await log({ event_type: 'test.event', source: 'src' })
    const insertArg = mockInsert.mock.calls[0][0]
    expect(insertArg.status).toBe('ok')
  })

  it('forwards org_id, severity, status, actor_type, actor_id when provided', async () => {
    await log({
      event_type: 'action.executed',
      source: 'action-engine',
      severity: 'error',
      status: 'failed',
      org_id: 'org-uuid-123',
      actor_type: 'system',
      actor_id: 'worker-1',
      error_message: 'something went wrong',
      duration_ms: 42,
    })

    const arg = mockInsert.mock.calls[0][0]
    expect(arg.severity).toBe('error')
    expect(arg.status).toBe('failed')
    expect(arg.org_id).toBe('org-uuid-123')
    expect(arg.actor_type).toBe('system')
    expect(arg.actor_id).toBe('worker-1')
    expect(arg.error_message).toBe('something went wrong')
    expect(arg.duration_ms).toBe(42)
  })

  it('sets org_id to null when not provided', async () => {
    await log({ event_type: 'platform.event', source: 'cron' })
    const arg = mockInsert.mock.calls[0][0]
    expect(arg.org_id).toBeNull()
  })

  it('sets payload to empty object when not provided', async () => {
    await log({ event_type: 'test.event', source: 'src' })
    const arg = mockInsert.mock.calls[0][0]
    expect(arg.payload).toEqual({})
  })

  it('forwards payload when provided', async () => {
    await log({
      event_type: 'test.event',
      source: 'src',
      payload: { key: 'value', count: 3 },
    })
    const arg = mockInsert.mock.calls[0][0]
    expect(arg.payload).toEqual({ key: 'value', count: 3 })
  })

  it('does NOT throw when the DB insert returns an error', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'DB connection failed', code: '08000' } })
    // Should resolve without throwing
    await expect(log({ event_type: 'test.event', source: 'src' })).resolves.toBeUndefined()
  })

  it('does NOT throw when createClient itself throws', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error('Config error')
    })
    await expect(log({ event_type: 'test.event', source: 'src' })).resolves.toBeUndefined()
  })

  it('returns void (undefined) on success', async () => {
    const result = await log({ event_type: 'test.event', source: 'src' })
    expect(result).toBeUndefined()
  })
})
