import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'
import { continueTwilioSmsAutomation, ingestTwilioSms } from '@/lib/twilio/process-sms'

type TwilioMessage = {
  sid: string
  from: string
  to: string
  body: string | null
  direction: string
  status: string
  date_sent: string | null
  date_created: string | null
  account_sid: string
  num_media?: string
}

type TwilioListResponse = {
  messages?: TwilioMessage[]
  next_page_uri?: string | null
}

type SmsNumberRow = {
  id: string
  organization_id: string
  e164: string
}

export type TwilioSmsReconcileOptions = {
  orgId?: string
  phoneNumberId?: string
  lookbackMinutes?: number
  maxPagesPerNumber?: number
  autoReply?: boolean
}

export type TwilioSmsReconcileResult = {
  checkedNumbers: number
  scannedMessages: number
  insertedMessages: number
  alreadyPresent: number
  skippedOld: number
  skippedNonInbound: number
  failedMessages: Array<{ sid: string; reason: string }>
}

const DEFAULT_LOOKBACK_MINUTES = 120
const DEFAULT_MAX_PAGES_PER_NUMBER = 3

function twilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

function messageTimestamp(message: TwilioMessage): string | null {
  return message.date_sent ?? message.date_created ?? null
}

async function fetchMessagesPage(
  accountSid: string,
  authToken: string,
  pageUrl: string,
): Promise<TwilioListResponse> {
  const response = await fetch(pageUrl, {
    headers: { Authorization: twilioAuthHeader(accountSid, authToken) },
    cache: 'no-store',
  })
  if (!response.ok) {
    const text = await response.text().catch(() => `status ${response.status}`)
    throw new Error(`Twilio messages list failed ${response.status}: ${text}`)
  }
  return (await response.json()) as TwilioListResponse
}

async function messageSidExists(orgId: string, messageSid: string): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'user')
    .contains('metadata', { message_sid: messageSid })
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

export async function reconcileTwilioInboundSms(
  options: TwilioSmsReconcileOptions = {},
): Promise<TwilioSmsReconcileResult> {
  const supabase = createServiceRoleClient()
  const lookbackMinutes = options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES
  const maxPagesPerNumber = options.maxPagesPerNumber ?? DEFAULT_MAX_PAGES_PER_NUMBER
  const cutoffMs = Date.now() - lookbackMinutes * 60_000

  let numbersQuery = supabase
    .from('twilio_phone_numbers')
    .select('id, organization_id, e164')
    .eq('is_active', true)
    .eq('capability_sms', true)

  if (options.orgId) numbersQuery = numbersQuery.eq('organization_id', options.orgId)
  if (options.phoneNumberId) numbersQuery = numbersQuery.eq('id', options.phoneNumberId)

  const { data: numbers, error } = await numbersQuery
  if (error) throw new Error(`Failed to list Twilio numbers: ${error.message}`)

  const result: TwilioSmsReconcileResult = {
    checkedNumbers: 0,
    scannedMessages: 0,
    insertedMessages: 0,
    alreadyPresent: 0,
    skippedOld: 0,
    skippedNonInbound: 0,
    failedMessages: [],
  }

  for (const number of (numbers ?? []) as SmsNumberRow[]) {
    const credentials = await resolveTwilioCredentialsForOrg(number.organization_id, {
      phoneNumberId: number.id,
    })
    if (!credentials?.accountSid || !credentials.authToken) {
      result.failedMessages.push({ sid: number.e164, reason: 'missing_twilio_credentials' })
      continue
    }

    result.checkedNumbers += 1
    let nextUrl: string | null =
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json?` +
      new URLSearchParams({ To: number.e164, PageSize: '100' }).toString()

    for (let page = 0; nextUrl && page < maxPagesPerNumber; page += 1) {
      const pageData = await fetchMessagesPage(credentials.accountSid, credentials.authToken, nextUrl)
      const messages = pageData.messages ?? []
      let sawRecentMessage = false

      for (const message of messages) {
        result.scannedMessages += 1
        const timestamp = messageTimestamp(message)
        const timestampMs = timestamp ? Date.parse(timestamp) : NaN
        const isRecent = Number.isFinite(timestampMs) && timestampMs >= cutoffMs

        if (!isRecent) {
          result.skippedOld += 1
          continue
        }
        sawRecentMessage = true

        if (!message.direction.startsWith('inbound')) {
          result.skippedNonInbound += 1
          continue
        }

        if (await messageSidExists(number.organization_id, message.sid)) {
          result.alreadyPresent += 1
          continue
        }

        const ingested = await ingestTwilioSms(
          {
            From: message.from,
            To: message.to,
            Body: message.body ?? '',
            MessageSid: message.sid,
            AccountSid: message.account_sid,
            NumMedia: message.num_media,
            ReceivedAt: new Date(timestampMs).toISOString(),
          },
          number.organization_id,
          number.id,
        )

        if (!ingested) {
          result.failedMessages.push({ sid: message.sid, reason: 'ingest_returned_null' })
          continue
        }

        result.insertedMessages += 1
        if (options.autoReply !== false) {
          await continueTwilioSmsAutomation(ingested)
        }
      }

      if (!sawRecentMessage) break
      nextUrl = pageData.next_page_uri
        ? `https://api.twilio.com${pageData.next_page_uri}`
        : null
    }
  }

  return result
}
