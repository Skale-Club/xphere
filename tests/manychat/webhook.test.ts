import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock createServiceRoleClient — webhook uses service role, no user session
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

// Mock dispatchManychatEvent — webhook tests should not transitively run matcher
vi.mock('@/lib/manychat/dispatch-event', () => ({
  dispatchManychatEvent: vi.fn().mockResolvedValue(undefined),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { dispatchManychatEvent } from '@/lib/manychat/dispatch-event'

// Build a minimal mock Supabase client for webhook tests.
// As of Phase 23, manychat_events.insert(...) is chained with .select('id').single()
// to capture the inserted id for the dispatcher.
function buildWebhookMockSupabase(
  channelRow: { id: string; org_id: string } | null,
  insertedEventId: string = 'event-1'
) {
  const singleSpy = vi.fn().mockResolvedValue({
    data: { id: insertedEventId },
    error: null,
  })
  const selectAfterInsertSpy = vi.fn().mockReturnValue({ single: singleSpy })
  const insertSpy = vi.fn().mockReturnValue({ select: selectAfterInsertSpy })

  const fromMock = vi.fn((table: string) => {
    if (table === 'manychat_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: channelRow, error: null }),
      }
    }
    if (table === 'manychat_events') {
      return { insert: insertSpy }
    }
    return {}
  })

  return { from: fromMock, _insertSpy: insertSpy, _selectSpy: selectAfterInsertSpy, _singleSpy: singleSpy }
}

function makePostRequest(body: string, secret: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) {
    headers['x-operator-secret'] = secret
  }
  return new Request('http://localhost/api/manychat/webhook', {
    method: 'POST',
    body,
    headers,
  })
}

describe('WEBHOOK-02: invalid or missing X-Operator-Secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildWebhookMockSupabase(null) as ReturnType<typeof createServiceRoleClient>
    )
  })

  it('returns 403 when X-Operator-Secret header is missing', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    const response = await POST(makePostRequest('{}', null))
    expect(response.status).toBe(403)
  })

  it('returns 403 when X-Operator-Secret does not match any channel', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    const response = await POST(makePostRequest('{}', 'invalid-secret'))
    expect(response.status).toBe(403)
  })

  it('does NOT call dispatchManychatEvent on 403 path', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    await POST(makePostRequest('{}', 'invalid-secret'))
    expect(dispatchManychatEvent).not.toHaveBeenCalled()
  })
})

describe('WEBHOOK-01, WEBHOOK-03, WEBHOOK-04: valid secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildWebhookMockSupabase({ id: 'channel-1', org_id: 'org-1' }) as ReturnType<typeof createServiceRoleClient>
    )
  })

  it('WEBHOOK-04: returns 200 when X-Operator-Secret is valid', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    const response = await POST(makePostRequest(
      JSON.stringify({ event_type: 'flow_completed', subscriber_id: 'sub-1' }),
      'valid-secret-uuid'
    ))
    expect(response.status).toBe(200)
    const json = await response.json() as { ok: boolean }
    expect(json.ok).toBe(true)
  })

  it('WEBHOOK-03: logs event to manychat_events with status unmatched', async () => {
    const mockClient = buildWebhookMockSupabase({ id: 'channel-1', org_id: 'org-1' })
    vi.mocked(createServiceRoleClient).mockReturnValue(
      mockClient as ReturnType<typeof createServiceRoleClient>
    )

    const { POST } = await import('@/app/api/manychat/webhook/route')
    await POST(makePostRequest(
      JSON.stringify({ event_type: 'flow_completed', subscriber_id: 'sub-1' }),
      'valid-secret-uuid'
    ))

    expect(mockClient._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        channel_id: 'channel-1',
        status: 'unmatched',
      })
    )
  })

  it('WEBHOOK-04: returns 200 even when event payload is malformed JSON', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    const response = await POST(makePostRequest('not-valid-json{{{', 'valid-secret-uuid'))
    expect(response.status).toBe(200)
  })
})

describe('ROUTING-03 / ROUTING-04: dispatcher invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildWebhookMockSupabase({ id: 'channel-1', org_id: 'org-1' }, 'evt-99') as ReturnType<typeof createServiceRoleClient>
    )
  })

  it('calls dispatchManychatEvent with the resolved orgId from channel (NOT from body)', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    await POST(makePostRequest(
      JSON.stringify({
        event_type: 'flow_completed',
        // Spoofed org_id in the body — must be IGNORED
        org_id: 'attacker-org',
      }),
      'valid-secret-uuid'
    ))

    expect(dispatchManychatEvent).toHaveBeenCalledTimes(1)
    expect(dispatchManychatEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-99',
        orgId: 'org-1',           // resolved from channel.org_id
        channelId: 'channel-1',
        eventType: 'flow_completed',
      }),
      expect.anything()
    )
  })

  it('passes the full request body as payload to the dispatcher', async () => {
    const { POST } = await import('@/app/api/manychat/webhook/route')
    await POST(makePostRequest(
      JSON.stringify({ event_type: 'flow_completed', flow_id: 'XYZ', subscriber_id: 'sub-1' }),
      'valid-secret-uuid'
    ))

    expect(dispatchManychatEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          flow_id: 'XYZ',
          subscriber_id: 'sub-1',
        }),
      }),
      expect.anything()
    )
  })
})
