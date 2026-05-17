// tests/evolution-send-message.test.ts
// SEED-004 — Outbound dispatcher hits Evolution Go REST API with correct payload.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/evolution/credentials', () => ({
  resolveEvolutionInstance: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { resolveEvolutionInstance } from '@/lib/evolution/credentials'
import { createServiceRoleClient } from '@/lib/supabase/admin'

function mockSupabase() {
  const insertMessageSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  return {
    insertMessageSpy,
    from: vi.fn(() => ({ insert: insertMessageSpy })),
  }
}

const fetchSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = fetchSpy
})

describe('Evolution sendWhatsappMessage', () => {
  it('POSTs to /message/sendText/{instance} with the correct payload', async () => {
    vi.mocked(resolveEvolutionInstance).mockResolvedValue({
      id: 'inst-1',
      org_id: 'org-1',
      instance_name: 'wa-prod',
      base_url: 'https://evo.example.com',
      status: 'connected',
      phone_number: '+15553334444',
      config: { baseUrl: 'https://evo.example.com', token: 'TOKEN_X' },
      webhookSecret: null,
    })

    const db = mockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'EVO_OUT_1', remoteJid: '5511...' } }),
    })

    const { sendWhatsappMessage } = await import('@/lib/evolution/send-message')
    const res = await sendWhatsappMessage({
      orgId: 'org-1',
      to: '+5511999998888',
      text: 'Hi there',
      splitIntoChunks: false,
    })

    expect(res.ok).toBe(true)
    expect(res.messageIds).toEqual(['EVO_OUT_1'])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://evo.example.com/message/sendText/wa-prod')
    expect(init.method).toBe('POST')
    expect(init.headers.apikey).toBe('TOKEN_X')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      number: '+5511999998888',
      text: 'Hi there',
      mentionsEveryOne: false,
    })
  })

  it('fails fast when the resolved instance is not connected', async () => {
    vi.mocked(resolveEvolutionInstance).mockResolvedValue({
      id: 'inst-2',
      org_id: 'org-1',
      instance_name: 'wa-prod',
      base_url: 'https://evo.example.com',
      status: 'qr_pending',
      phone_number: null,
      config: { baseUrl: 'https://evo.example.com', token: 'T' },
      webhookSecret: null,
    })

    const { sendWhatsappMessage } = await import('@/lib/evolution/send-message')
    const res = await sendWhatsappMessage({
      orgId: 'org-1',
      to: '+5511999998888',
      text: 'Hi',
      splitIntoChunks: false,
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('not connected')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns error when no instance is configured for the org', async () => {
    vi.mocked(resolveEvolutionInstance).mockResolvedValue(null)

    const { sendWhatsappMessage } = await import('@/lib/evolution/send-message')
    const res = await sendWhatsappMessage({
      orgId: 'org-1',
      to: '+5511999998888',
      text: 'Hi',
    })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('No active Evolution Go instance')
  })

  it('persists the outbound message to conversation_messages when conversationId is set', async () => {
    vi.mocked(resolveEvolutionInstance).mockResolvedValue({
      id: 'inst-1',
      org_id: 'org-1',
      instance_name: 'wa-prod',
      base_url: 'https://evo.example.com',
      status: 'connected',
      phone_number: '+15553334444',
      config: { baseUrl: 'https://evo.example.com', token: 'T' },
      webhookSecret: null,
    })

    const db = mockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'EVO_OUT_42', remoteJid: '...' } }),
    })

    const { sendWhatsappMessage } = await import('@/lib/evolution/send-message')
    await sendWhatsappMessage({
      orgId: 'org-1',
      to: '+5511999998888',
      text: 'Persisted reply',
      conversationId: 'conv-99',
      splitIntoChunks: false,
    })

    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-99',
        org_id: 'org-1',
        role: 'assistant',
        content: 'Persisted reply',
        metadata: expect.objectContaining({
          channel: 'whatsapp',
          evolution_message_id: 'EVO_OUT_42',
        }),
      }),
    )
  })
})
