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

function buildMockSupabase(keyword: string | null = 'hello') {
  const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null })

  const fromMock = vi.fn((table: string) => {
    if (table === 'meta_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            org_id: 'org-1',
            automation_id: 'tool-config-id',
            config: keyword !== null ? { keyword_trigger: keyword } : {},
          },
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
          single: vi.fn().mockResolvedValue({ data: { id: 'conv-kw' }, error: null }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
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

  return { from: fromMock, _insertSpy: insertSpy }
}

function makePayload(text: string): MetaWebhookPayload {
  return {
    object: 'instagram',
    entry: [{
      id: 'page-123',
      messaging: [{
        sender: { id: 'igsid-456' },
        message: { mid: 'mid-kw', text },
      }],
    }],
  }
}

describe('METAEV-04: keyword trigger filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('fires automation when message text contains keyword (case-insensitive)', async () => {
    const mockDb = buildMockSupabase('hello')
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    // Message contains "HELLO" — should match keyword "hello" case-insensitively
    await processMetaEvent(makePayload('Say HELLO to me'))

    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })

  it('blocks automation when message text does not contain keyword', async () => {
    const mockDb = buildMockSupabase('hello')
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    // Message does NOT contain "hello"
    await processMetaEvent(makePayload('Good morning'))

    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
  })

  it('fires automation on every message when keyword_trigger is null', async () => {
    // keyword_trigger is null → config is {} (no keyword_trigger key)
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload('Any message at all'))

    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })

  it('fires automation on every message when keyword_trigger is empty string', async () => {
    // keyword_trigger = '' → falsy, so should not gate
    const mockDb = buildMockSupabase('')
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makePayload('Any message at all'))

    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })
})
