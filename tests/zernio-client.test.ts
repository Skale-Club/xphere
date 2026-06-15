import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendZernioDm } from '@/lib/zernio/send-dm'
import { sendZernioCommentReply } from '@/lib/zernio/send-comment-reply'
import { registerZernioWebhook, SUBSCRIBED_EVENTS } from '@/lib/zernio/register-webhook'

describe('Zernio REST client contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends DMs through the conversation endpoint with accountId + message', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { messageId: 'msg-1' } }), { status: 200 }),
    )

    const result = await sendZernioDm('conv-1', 'acct-1', 'Hello', 'ze_key')

    expect(result.messageId).toBe('msg-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://zernio.com/api/v1/inbox/conversations/conv-1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer ze_key' }),
        body: JSON.stringify({ accountId: 'acct-1', message: 'Hello' }),
      }),
    )
  })

  it('sends Zernio DM attachments with attachmentUrl and attachmentType', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { messageId: 'msg-2' } }), { status: 200 }),
    )

    await sendZernioDm('conv-1', 'acct-1', 'Voice note', 'ze_key', {
      attachment: { url: 'https://xphere.app/audio.ogg', mime_type: 'audio/ogg; codecs=opus' },
      voiceNote: true,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://zernio.com/api/v1/inbox/conversations/conv-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          accountId: 'acct-1',
          message: 'Voice note',
          attachmentUrl: 'https://xphere.app/audio.ogg',
          attachmentType: 'audio',
          voiceNote: true,
        }),
      }),
    )
  })

  it('replies to comments through the comments endpoint', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { commentId: 'reply-1' } }), { status: 200 }),
    )

    const result = await sendZernioCommentReply({
      postId: 'post-1',
      accountId: 'acct-1',
      commentId: 'comment-1',
      text: 'Thanks',
      apiKey: 'ze_key',
    })

    expect(result.commentId).toBe('reply-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://zernio.com/api/v1/inbox/comments/post-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ accountId: 'acct-1', message: 'Thanks', commentId: 'comment-1' }),
      }),
    )
  })

  it('creates a webhook through POST /webhooks/settings subscribed to every SUBSCRIBED_EVENT', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ webhook: { _id: 'wh-1', events: [...SUBSCRIBED_EVENTS] } }),
        { status: 201 },
      ),
    )

    const result = await registerZernioWebhook('ze_key', 'https://xphere.app/api/zernio/webhook?t=tok', 'secret')

    expect(result.webhookId).toBe('wh-1')
    expect(result.missingEvents).toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://zernio.com/api/v1/webhooks/settings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Xphere Inbox',
          url: 'https://xphere.app/api/zernio/webhook?t=tok',
          secret: 'secret',
          events: [...SUBSCRIBED_EVENTS],
          isActive: true,
        }),
      }),
    )
  })

  it('updates existing settings via PUT /webhooks/settings (singleton, no id in URL)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ webhook: { _id: 'wh-1', events: [...SUBSCRIBED_EVENTS] } }),
        { status: 200 },
      ),
    )

    await registerZernioWebhook('ze_key', 'https://xphere.app/api/zernio/webhook?t=tok', 'secret', 'wh-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://zernio.com/api/v1/webhooks/settings',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining(`"events":${JSON.stringify([...SUBSCRIBED_EVENTS])}`),
      }),
    )
    // id travels in the body envelope from Zernio, never in our request URL
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sentBody).not.toHaveProperty('_id')
  })

  it('reports drift when Zernio does not persist every requested event', async () => {
    // Webhook echoes back only a subset of the events we asked for.
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ webhook: { _id: 'wh-1', events: ['message.received', 'comment.received'] } }),
        { status: 200 },
      ),
    )

    const result = await registerZernioWebhook(
      'ze_key',
      'https://xphere.app/api/zernio/webhook?t=tok',
      'secret',
      'wh-1',
    )

    expect(result.missingEvents).toContain('message.sent')
    expect(result.missingEvents).toContain('whatsapp.template.status_updated')
  })

  it('reads settings back to confirm events when the write response omits them', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      // PUT response has no events field...
      .mockResolvedValueOnce(new Response(JSON.stringify({ webhook: { _id: 'wh-1' } }), { status: 200 }))
      // ...so a follow-up GET /webhooks/settings confirms the subscription.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ webhook: { _id: 'wh-1', events: [...SUBSCRIBED_EVENTS] } }),
          { status: 200 },
        ),
      )

    const result = await registerZernioWebhook(
      'ze_key',
      'https://xphere.app/api/zernio/webhook?t=tok',
      'secret',
      'wh-1',
    )

    expect(result.missingEvents).toEqual([])
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://zernio.com/api/v1/webhooks/settings',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('fails webhook registration when Zernio does not return an id', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ webhook: { events: [] } }), { status: 201 }),
    )

    await expect(
      registerZernioWebhook('ze_key', 'https://xphere.app/api/zernio/webhook?t=tok', 'secret'),
    ).rejects.toThrow('Zernio did not return a webhook id.')
  })
})
