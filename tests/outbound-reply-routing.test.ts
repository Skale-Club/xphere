import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mocks (hoisted — declared before imports) ----
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@/lib/meta/send-message', () => ({
  sendMetaMessage: vi.fn(),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('decrypted-page-token'),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { sendMetaMessage } from '@/lib/meta/send-message'

// ---- Supabase mock builder ----
// Supports the chained query the route uses:
//   supabase.from('conversations').select(...).eq(...).single()
//   supabase.from('conversation_messages').insert(...).select(...).single()
//   supabase.from('conversations').update(...).eq(...)
//   supabase.from('meta_channels').select(...).eq(...).eq(...).eq(...).maybeSingle()
function buildMockSupabase({
  conv = null as Record<string, unknown> | null,
  msgInsertError = null as { message: string } | null,
  metaChannel = null as Record<string, unknown> | null,
} = {}) {
  const updateSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })

  const fromMock = vi.fn((table: string) => {
    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: conv, error: conv ? null : { message: 'not found' } }),
          }),
        }),
        update: updateSpy,
      }
    }

    if (table === 'conversation_messages') {
      const insertData = msgInsertError
        ? null
        : { id: 'msg-1', conversation_id: 'conv-1', role: 'assistant', content: 'hello', created_at: new Date().toISOString(), metadata: null }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: insertData, error: msgInsertError }),
          }),
        }),
      }
    }

    if (table === 'meta_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: metaChannel, error: null }),
      }
    }

    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  return { from: fromMock, updateSpy }
}

// ---- Helper: make a POST request to the route ----
async function callRoute(
  convId: string,
  body: unknown,
  mockSupabase: ReturnType<typeof buildMockSupabase>
) {
  vi.mocked(createClient).mockResolvedValue(mockSupabase as never)
  vi.resetModules()
  const { POST } = await import('@/app/api/chat/conversations/[id]/messages/route')
  const req = new Request(`http://localhost/api/chat/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const params = Promise.resolve({ id: convId })
  return POST(req, { params })
}

const WIDGET_CONV = {
  id: 'conv-1',
  org_id: 'org-1',
  channel: 'widget',
  channel_metadata: {},
}

const MESSENGER_CONV = {
  id: 'conv-1',
  org_id: 'org-1',
  channel: 'messenger',
  channel_metadata: { sender_id: 'psid-321', page_id: 'page-789' },
}

const INSTAGRAM_CONV = {
  id: 'conv-1',
  org_id: 'org-1',
  channel: 'instagram',
  channel_metadata: { igsid: 'igsid-456', page_id: 'page-789' },
}

const META_CHANNEL = {
  encrypted_page_access_token: 'encrypted-token',
}

describe('POST /api/chat/conversations/[id]/messages — outbound reply routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never)
  })

  it.todo('widget: DB insert only, sendMetaMessage NOT called, returns 201')

  it.todo('messenger: calls sendMetaMessage with sender_id as recipientId')

  it.todo('instagram: calls sendMetaMessage with igsid as recipientId')

  it.todo('Meta error code 190 → 400 with { error: token_revoked, channel }')

  it.todo('other Meta error → 502 with { error: meta_send_failed, message }')

  it.todo('missing meta_channels record → 400 with { error: channel_not_configured }')

  it.todo('unauthenticated request → 401')

  it.todo('DB insert fails → 500, sendMetaMessage NOT called')
})

// Re-export fixtures and helpers so Plan 02 can import them when writing GREEN tests
export {
  buildMockSupabase,
  callRoute,
  WIDGET_CONV,
  MESSENGER_CONV,
  INSTAGRAM_CONV,
  META_CHANNEL,
}
