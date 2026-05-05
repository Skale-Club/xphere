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

// ---- Supabase mock builder ----
function buildMockSupabase(options: {
  automationId?: string | null
  toolConfig?: { data: unknown; error: unknown }
} = {}) {
  const automationId = options.automationId !== undefined ? options.automationId : 'tool-config-id'
  const toolConfigResult = options.toolConfig ?? {
    data: {
      id: 'tool-config-id',
      action_type: 'create_contact',
      integrations: {
        encrypted_api_key: 'encrypted-key',
        location_id: 'loc-001',
      },
    },
    error: null,
  }

  const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null })

  const fromMock = vi.fn((table: string) => {
    if (table === 'meta_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { org_id: 'org-1', automation_id: automationId, config: {} },
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
          single: vi.fn().mockResolvedValue({ data: { id: 'conv-auto' }, error: null }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }
    }

    if (table === 'conversation_messages') {
      return {
        insert: insertSpy,
      }
    }

    if (table === 'tool_configs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(toolConfigResult),
      }
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from: fromMock, _insertSpy: insertSpy }
}

function makePayload(text = 'Hello'): MetaWebhookPayload {
  return {
    object: 'instagram',
    entry: [{
      id: 'page-123',
      messaging: [{
        sender: { id: 'igsid-456' },
        message: { mid: 'mid-001', text },
      }],
    }],
  }
}

describe('METAEV-03: automation dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('calls executeAction when meta_channels.automation_id is set and no keyword filter', async () => {
    const mockDb = buildMockSupabase({ automationId: 'tool-config-id' })
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'create_contact',
      expect.objectContaining({ message: 'Hello', conversation_id: 'conv-auto' }),
      expect.objectContaining({ apiKey: 'plaintext-api-key', locationId: 'loc-001' }),
      expect.objectContaining({ organizationId: 'org-1' })
    )
  })

  it('persists automation response as assistant message in conversation_messages', async () => {
    const mockDb = buildMockSupabase({ automationId: 'tool-config-id' })
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    // Insert should be called twice: once for user message, once for assistant message
    expect(mockDb._insertSpy).toHaveBeenCalledTimes(2)
    expect(mockDb._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'Hello' })
    )
    expect(mockDb._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'automation result' })
    )
  })

  it('does not call executeAction when meta_channels.automation_id is null', async () => {
    const mockDb = buildMockSupabase({ automationId: null })
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
  })

  it('skips processing and logs warning when no active meta_channel row matches page_id+channel_type', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'meta_channels') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as any)

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload())

    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[meta/webhook]'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )

    consoleWarnSpy.mockRestore()
  })
})
