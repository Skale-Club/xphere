// tests/evolution-mention-all.test.ts
// SEED-004 — Group mention-all uses mentionsEveryOne: true.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = fetchSpy
})

describe('sendGroupMentionAll', () => {
  it('POSTs to /message/sendText with mentionsEveryOne=true for plain-text mentions', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'GROUP_MSG_1', remoteJid: 'group@g.us' } }),
    })

    const { sendGroupMentionAll } = await import('@/lib/evolution/client')
    const res = await sendGroupMentionAll(
      { baseUrl: 'https://evo.example.com', token: 'T' },
      'wa-prod',
      '120363012345678901@g.us',
      'Atenção pessoal!',
    )

    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://evo.example.com/message/sendText/wa-prod')

    const body = JSON.parse(init.body)
    expect(body.mentionsEveryOne).toBe(true)
    expect(body.number).toBe('120363012345678901@g.us')
    expect(body.text).toBe('Atenção pessoal!')
  })

  it('uses /message/sendMedia when mediaUrl is supplied, still with mentionsEveryOne=true', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'GROUP_MEDIA_1', remoteJid: 'group@g.us' } }),
    })

    const { sendGroupMentionAll } = await import('@/lib/evolution/client')
    const res = await sendGroupMentionAll(
      { baseUrl: 'https://evo.example.com', token: 'T' },
      'wa-prod',
      '120363012345678901@g.us',
      'Veja o relatório',
      { mediaUrl: 'https://cdn.example.com/report.pdf', mediaType: 'document', fileName: 'report.pdf' },
    )

    expect(res.ok).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://evo.example.com/message/sendMedia/wa-prod')

    const body = JSON.parse(init.body)
    expect(body.mentionsEveryOne).toBe(true)
    expect(body.media).toBe('https://cdn.example.com/report.pdf')
    expect(body.mediatype).toBe('document')
    expect(body.fileName).toBe('report.pdf')
    expect(body.caption).toBe('Veja o relatório')
  })
})

describe('send_whatsapp_mention_all executor', () => {
  it('rejects non-group JIDs', async () => {
    vi.doMock('@/lib/evolution/credentials', () => ({
      resolveEvolutionInstance: vi.fn().mockResolvedValue({
        id: 'inst-1',
        org_id: 'org-1',
        instance_name: 'wa-prod',
        base_url: 'https://evo.example.com',
        status: 'connected',
        phone_number: '+1',
        config: { baseUrl: 'https://evo.example.com', token: 'T' },
        webhookSecret: null,
      }),
    }))

    const { sendWhatsappMentionAllAction } = await import(
      '@/lib/action-engine/executors/send-whatsapp-mention-all'
    )

    await expect(
      sendWhatsappMentionAllAction(
        { group_jid: '5511999998888@s.whatsapp.net', text: 'hi' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { organizationId: 'org-1', supabase: {} as any },
      ),
    ).rejects.toThrow(/must end with @g.us/)
  })

  it('calls Evolution Go with mentionsEveryOne when invoked with valid group_jid', async () => {
    vi.resetModules()

    vi.doMock('@/lib/evolution/credentials', () => ({
      resolveEvolutionInstance: vi.fn().mockResolvedValue({
        id: 'inst-1',
        org_id: 'org-1',
        instance_name: 'wa-prod',
        base_url: 'https://evo.example.com',
        status: 'connected',
        phone_number: '+1',
        config: { baseUrl: 'https://evo.example.com', token: 'T' },
        webhookSecret: null,
      }),
    }))

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'OUT_MENTION_1', remoteJid: 'group@g.us' } }),
    })

    const { sendWhatsappMentionAllAction } = await import(
      '@/lib/action-engine/executors/send-whatsapp-mention-all'
    )

    const result = await sendWhatsappMentionAllAction(
      { group_jid: '120363012345678901@g.us', text: 'Atenção' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { organizationId: 'org-1', supabase: {} as any },
    )

    expect(result).toContain('OUT_MENTION_1')
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.mentionsEveryOne).toBe(true)
  })
})
