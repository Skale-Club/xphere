// Signing at the edge: an /api/media app path must never reach an external
// consumer (MCP caller, Twilio) as it is. Old Supabase / Twilio URLs pass through.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  callRow: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(async () => JSON.stringify({ account_sid: 'ACxxx', auth_token: 'tok' })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: h.callRow })
      return chain
    },
  }),
}))
// Same behaviour as the real resolveExternalUrl for the cases under test, without R2 or Supabase.
vi.mock('@/lib/storage', () => ({
  resolveExternalUrl: async (url: string) => (url.startsWith('/api/media/') ? `https://signed.example/${url.slice(11)}?sig=1` : url),
}))

import { callsTools } from '@/lib/mcp/tools/calls'
import { sendSms } from '@/lib/twilio/send-sms'

describe('mcp calls_get', () => {
  const tool = callsTools.find((t) => t.name === 'calls_get')!
  const ctx = { auth: { orgId: 'org-1' } } as never

  it('returns a signed URL for an /api/media recording', async () => {
    h.callRow = { id: 'c1', org_id: 'org-1', status: 'completed', recording_url: '/api/media/recordings/org-1/c1.webm' }
    const out = (await tool.handler({ call_id: '11111111-1111-4111-8111-111111111111' } as never, ctx)) as Record<string, unknown>
    expect(out.recording_url).toBe('https://signed.example/recordings/org-1/c1.webm?sig=1')
    expect(out).toMatchObject({ id: 'c1', status: 'completed' })
  })

  it('leaves Twilio / Supabase URLs and a missing recording untouched', async () => {
    h.callRow = { id: 'c2', recording_url: 'https://api.twilio.com/rec/RE1' }
    expect(((await tool.handler({ call_id: '11111111-1111-4111-8111-111111111111' } as never, ctx)) as Record<string, unknown>).recording_url).toBe(
      'https://api.twilio.com/rec/RE1',
    )
    h.callRow = { id: 'c3', recording_url: null }
    expect(((await tool.handler({ call_id: '11111111-1111-4111-8111-111111111111' } as never, ctx)) as Record<string, unknown>).recording_url).toBeNull()
  })

  it('still reports not_found', async () => {
    h.callRow = null
    expect(await tool.handler({ call_id: '11111111-1111-4111-8111-111111111111' } as never, ctx)).toMatchObject({ error: 'not_found' })
  })
})

describe('sendSms MediaUrl', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 201, text: async () => '{"sid":"SM1"}', json: async () => ({ sid: 'SM1' }) }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  function supabase() {
    const results: Record<string, unknown> = {
      integrations: { data: { id: 'i1', encrypted_api_key: 'enc', health_status: 'connected', last_error: null }, error: null },
      twilio_phone_numbers: { data: { e164: '+15550001111', capability_sms: true }, error: null },
    }
    const from = (table: string) => {
      const proxy: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
          if (prop === 'single' || prop === 'maybeSingle') return async () => results[table]
          return () => proxy
        },
      })
      return proxy
    }
    return { from }
  }

  it('signs an /api/media path before handing it to Twilio and passes other URLs as they are', async () => {
    await sendSms(
      { to: '+15551234567', body: 'hi', media_urls: ['/api/media/chat-media/org-1/c/a.jpg', 'https://proj.supabase.co/storage/v1/object/public/chat-media/org-1/old.jpg'] },
      { organizationId: 'org-1', supabase: supabase() } as never,
    )
    const form = new URLSearchParams(String((fetchMock.mock.calls[0][1] as { body: string }).body))
    expect(form.getAll('MediaUrl')).toEqual([
      'https://signed.example/chat-media/org-1/c/a.jpg?sig=1',
      'https://proj.supabase.co/storage/v1/object/public/chat-media/org-1/old.jpg',
    ])
  })
})
