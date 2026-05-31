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

  it('widget: DB insert only, sendMetaMessage NOT called, returns 201', async () => {
    const mockSupabase = buildMockSupabase({ conv: WIDGET_CONV })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(201)
    expect(vi.mocked(sendMetaMessage)).not.toHaveBeenCalled()
    const body = await res.json() as { message: { id: string } }
    expect(body.message).toBeDefined()
  })

  it('messenger: calls sendMetaMessage with sender_id as recipientId', async () => {
    vi.mocked(sendMetaMessage).mockResolvedValue({ messageId: 'mid-1' })
    const mockSupabase = buildMockSupabase({ conv: MESSENGER_CONV, metaChannel: META_CHANNEL })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(201)
    expect(vi.mocked(sendMetaMessage)).toHaveBeenCalledWith('decrypted-page-token', 'psid-321', 'hello')
  })

  it('instagram: calls sendMetaMessage with igsid as recipientId', async () => {
    vi.mocked(sendMetaMessage).mockResolvedValue({ messageId: 'mid-2' })
    const mockSupabase = buildMockSupabase({ conv: INSTAGRAM_CONV, metaChannel: META_CHANNEL })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(201)
    expect(vi.mocked(sendMetaMessage)).toHaveBeenCalledWith('decrypted-page-token', 'igsid-456', 'hello')
  })

  it('Meta error code 190 → 400 with { error: token_revoked, channel }', async () => {
    vi.mocked(sendMetaMessage).mockResolvedValue({ error: 'Token expired', code: 190 })
    const mockSupabase = buildMockSupabase({ conv: MESSENGER_CONV, metaChannel: META_CHANNEL })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; channel: string }
    expect(body.error).toBe('token_revoked')
    expect(body.channel).toBe('messenger')
  })

  it('other Meta error → 502 with { error: meta_send_failed, message }', async () => {
    vi.mocked(sendMetaMessage).mockResolvedValue({ error: 'Rate limit exceeded' })
    const mockSupabase = buildMockSupabase({ conv: MESSENGER_CONV, metaChannel: META_CHANNEL })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('meta_send_failed')
    expect(body.message).toBe('Rate limit exceeded')
  })

  it('missing meta_channels record → 400 with { error: channel_not_configured }', async () => {
    const mockSupabase = buildMockSupabase({ conv: MESSENGER_CONV, metaChannel: null })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('channel_not_configured')
  })

  it('unauthenticated request → 401', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const mockSupabase = buildMockSupabase({ conv: WIDGET_CONV })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(401)
    expect(vi.mocked(sendMetaMessage)).not.toHaveBeenCalled()
  })

  it('widget DB insert fails -> 500, sendMetaMessage NOT called', async () => {
    const mockSupabase = buildMockSupabase({
      conv: WIDGET_CONV,
      msgInsertError: { message: 'DB error' },
    })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(500)
    expect(vi.mocked(sendMetaMessage)).not.toHaveBeenCalled()
  })

  it('messenger DB insert fails after Meta accepts the message', async () => {
    vi.mocked(sendMetaMessage).mockResolvedValue({ messageId: 'mid-1' })
    const mockSupabase = buildMockSupabase({
      conv: MESSENGER_CONV,
      metaChannel: META_CHANNEL,
      msgInsertError: { message: 'DB error' },
    })
    const res = await callRoute('conv-1', { content: 'hello', role: 'assistant' }, mockSupabase)
    expect(res.status).toBe(500)
    expect(vi.mocked(sendMetaMessage)).toHaveBeenCalledWith('decrypted-page-token', 'psid-321', 'hello')
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('message_persist_failed')
    expect(body.message).toContain('could not save')
  })
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
