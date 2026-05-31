import { afterEach, describe, expect, it, vi } from 'vitest'

import { configureTwilioSmsWebhook } from '@/lib/twilio/configure-number'

describe('configureTwilioSmsWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears SmsApplicationSid so direct SmsUrl receives inbound messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await configureTwilioSmsWebhook({
      accountSid: 'AC_test',
      authToken: 'token',
      phoneSid: 'PN_test',
      smsUrl: 'https://xphere.app/api/twilio/sms',
    })

    expect(result).toEqual({ ok: true })
    const body = fetchMock.mock.calls[0]?.[1]?.body as string
    const params = new URLSearchParams(body)
    expect(params.get('SmsUrl')).toBe('https://xphere.app/api/twilio/sms')
    expect(params.get('SmsMethod')).toBe('POST')
    expect(params.get('SmsApplicationSid')).toBe('')
  })
})
