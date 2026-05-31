import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/twilio/voice', () => ({
  resolveTwilioCredentialsForOrg: vi.fn(),
}))

vi.mock('@/lib/twilio/process-sms', () => ({
  ingestTwilioSms: vi.fn(),
  continueTwilioSmsAutomation: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'
import { ingestTwilioSms, continueTwilioSmsAutomation } from '@/lib/twilio/process-sms'
import { reconcileTwilioInboundSms } from '@/lib/twilio/reconcile-sms'

function thenableQuery<T>(result: T) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return query
}

function buildSupabase(existingSids: Set<string>) {
  let currentSid: string | null = null
  return {
    from: vi.fn((table: string) => {
      if (table === 'twilio_phone_numbers') {
        return thenableQuery({
          data: [{ id: 'pn-1', organization_id: 'org-1', e164: '+18667240005' }],
          error: null,
        })
      }

      if (table === 'conversation_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          contains: vi.fn((_column: string, value: { message_sid?: string }) => {
            currentSid = value.message_sid ?? null
            return {
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: currentSid && existingSids.has(currentSid) ? { id: 'msg-existing' } : null,
                error: null,
              }),
            }
          }),
        }
      }

      return thenableQuery({ data: null, error: null })
    }),
  }
}

describe('reconcileTwilioInboundSms', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T18:00:00Z'))
    vi.clearAllMocks()
    vi.mocked(resolveTwilioCredentialsForOrg).mockResolvedValue({
      accountSid: 'AC_test',
      authToken: 'token',
      fromNumber: '+18667240005',
    })
    vi.mocked(ingestTwilioSms).mockResolvedValue({
      orgId: 'org-1',
      phoneNumberId: 'pn-1',
      conversationId: 'conv-1',
      fromNumber: '+15087402109',
      toNumber: '+18667240005',
      messageText: 'new inbound',
      messageSid: 'SM_new',
      botStatus: 'paused',
    })
    vi.mocked(continueTwilioSmsAutomation).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('inserts recent inbound Twilio messages that are missing from conversation_messages', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      buildSupabase(new Set(['SM_existing'])) as unknown as ReturnType<typeof createServiceRoleClient>,
    )

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          {
            sid: 'SM_new',
            from: '+15087402109',
            to: '+18667240005',
            body: 'new inbound',
            direction: 'inbound',
            status: 'received',
            date_sent: 'Sun, 31 May 2026 17:55:00 +0000',
            date_created: 'Sun, 31 May 2026 17:55:00 +0000',
            account_sid: 'AC_test',
            num_media: '0',
          },
          {
            sid: 'SM_existing',
            from: '+15087402109',
            to: '+18667240005',
            body: 'already stored',
            direction: 'inbound',
            status: 'received',
            date_sent: 'Sun, 31 May 2026 17:50:00 +0000',
            date_created: 'Sun, 31 May 2026 17:50:00 +0000',
            account_sid: 'AC_test',
            num_media: '0',
          },
          {
            sid: 'SM_outbound',
            from: '+18667240005',
            to: '+15087402109',
            body: 'outbound',
            direction: 'outbound-api',
            status: 'sent',
            date_sent: 'Sun, 31 May 2026 17:49:00 +0000',
            date_created: 'Sun, 31 May 2026 17:49:00 +0000',
            account_sid: 'AC_test',
            num_media: '0',
          },
          {
            sid: 'SM_old',
            from: '+15087402109',
            to: '+18667240005',
            body: 'old inbound',
            direction: 'inbound',
            status: 'received',
            date_sent: 'Sun, 31 May 2026 14:00:00 +0000',
            date_created: 'Sun, 31 May 2026 14:00:00 +0000',
            account_sid: 'AC_test',
            num_media: '0',
          },
        ],
        next_page_uri: null,
      }),
    }))

    const result = await reconcileTwilioInboundSms({ lookbackMinutes: 120 })

    expect(result).toMatchObject({
      checkedNumbers: 1,
      scannedMessages: 4,
      insertedMessages: 1,
      alreadyPresent: 1,
      skippedNonInbound: 1,
      skippedOld: 1,
    })
    expect(vi.mocked(ingestTwilioSms)).toHaveBeenCalledWith(
      expect.objectContaining({
        From: '+15087402109',
        To: '+18667240005',
        Body: 'new inbound',
        MessageSid: 'SM_new',
        ReceivedAt: '2026-05-31T17:55:00.000Z',
      }),
      'org-1',
      'pn-1',
    )
    expect(vi.mocked(continueTwilioSmsAutomation)).toHaveBeenCalledOnce()
  })
})
