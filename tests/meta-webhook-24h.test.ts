import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MetaWebhookPayload } from '@/lib/meta/process-event'

// ---- Mock createServiceRoleClient ----
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

// ---- Mock executeAction ----
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn().mockResolvedValue('automation result'),
}))

// ---- Mock decrypt ----
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('plaintext-api-key'),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction } from '@/lib/action-engine/execute-action'

// Build a timestamp that is N hours in the past
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}

function buildMockSupabase(lastInboundAt: string | null) {
  const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEqSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy })

  const fromMock = vi.fn((table: string) => {
    if (table === 'meta_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { org_id: 'org-1', automation_id: 'tool-config-id', config: {} },
          error: null,
        }),
      }
    }

    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          lastInboundAt !== undefined
            ? {
                data: {
                  id: 'conv-24h',
                  channel_metadata: { igsid: 'igsid-456', page_id: 'page-123' },
                  last_inbound_at: lastInboundAt,
                },
                error: null,
              }
            : { data: null, error: null }
        ),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
        }),
        update: updateSpy,
      }
    }

    if (table === 'conversation_messages') {
      return { insert: insertSpy }
    }

    if (table === 'tool_configs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'tool-config-id',
            action_type: 'create_contact',
            integrations: {
              encrypted_api_key: 'encrypted-key',
              location_id: 'loc-001',
            },
          },
          error: null,
        }),
      }
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from: fromMock, _insertSpy: insertSpy, _updateSpy: updateSpy, _updateEqSpy: updateEqSpy }
}

function makePayload(): MetaWebhookPayload {
  return {
    object: 'instagram',
    entry: [{
      id: 'page-123',
      messaging: [{
        sender: { id: 'igsid-456' },
        message: { mid: 'mid-24h', text: 'Hello again' },
      }],
    }],
  }
}

describe('METAEV-05: 24h messaging window enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('fires automation when last_inbound_at is less than 24 hours ago', async () => {
    // 12 hours ago — within window
    const mockDb = buildMockSupabase(hoursAgo(12))
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })

  it('blocks automation when last_inbound_at is more than 24 hours ago', async () => {
    // 25 hours ago — window expired
    const mockDb = buildMockSupabase(hoursAgo(25))
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
  })

  it('sets window_expired="true" in channel_metadata when 24h window has elapsed', async () => {
    // 25 hours ago — window expired
    const mockDb = buildMockSupabase(hoursAgo(25))
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    // update should have been called with window_expired='true' in channel_metadata
    expect(mockDb._updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_metadata: expect.objectContaining({ window_expired: 'true' }),
      })
    )
  })

  it('updates last_inbound_at on every inbound message even when window is expired', async () => {
    // 25 hours ago — window expired; but last_inbound_at should still be updated
    const mockDb = buildMockSupabase(hoursAgo(25))
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    expect(mockDb._updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        last_inbound_at: expect.any(String),
      })
    )
  })

  it('fires automation on first message (no prior last_inbound_at)', async () => {
    // No existing conversation — first message ever
    const fromMock = vi.fn((table: string) => {
      if (table === 'meta_channels') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { org_id: 'org-1', automation_id: 'tool-config-id', config: {} },
            error: null,
          }),
        }
      }
      if (table === 'conversations') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'conv-first' }, error: null }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversation_messages') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'tool_configs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'tool-config-id',
              action_type: 'create_contact',
              integrations: { encrypted_api_key: 'enc-key', location_id: 'loc-001' },
            },
            error: null,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    // First message should trigger automation (no prior last_inbound_at = no expiry)
    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })
})
