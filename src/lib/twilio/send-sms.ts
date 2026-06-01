// src/lib/twilio/send-sms.ts
// Executor for the send_sms action type.
//
// Sends an SMS via the Twilio Messages REST API using the org's stored
// Twilio credentials (Account SID + Auth Token) from the integrations table.
//
// Credential blob format (encrypted_api_key JSON): { account_sid, auth_token }
//
// Number resolution:
//   1. If `params.phone_number_id` (or legacy `fromNumberId`) is provided, the
//      corresponding active row in `twilio_phone_numbers` is used (must have
//      `capability_sms=true`).
//   2. Otherwise, the org's default number (is_default=true, is_active=true,
//      capability_sms=true) is used.
//
// Result strings never contain newlines | Vapi's response parser breaks on \n.

import { decrypt } from '@/lib/crypto'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export interface TwilioCredentials {
  accountSid: string
  authToken: string
  fromNumber: string
}

export interface ResolveTwilioCredentialsOptions {
  /** Specific `twilio_phone_numbers.id` to use instead of the org's default. */
  fromNumberId?: string
}

export async function resolveTwilioCredentials(
  ctx: ActionContext,
  options: ResolveTwilioCredentialsOptions = {},
): Promise<TwilioCredentials> {
  const { data: row, error } = await ctx.supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', ctx.organizationId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .single()

  if (error || !row) {
    throw new Error('Twilio not connected for this org. Add a Twilio integration in /integrations.')
  }

  const blob = JSON.parse(await decrypt(row.encrypted_api_key)) as {
    account_sid: string
    auth_token: string
  }

  // Resolve the From number: specific id > org default. There is no legacy
  // fallback — phone numbers must live in `twilio_phone_numbers`.
  let fromNumber: string | null = null

  if (options.fromNumberId) {
    const { data: numberRow } = await ctx.supabase
      .from('twilio_phone_numbers')
      .select('e164, is_active, capability_sms')
      .eq('id', options.fromNumberId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle()
    if (!numberRow) {
      throw new Error(`Twilio phone number ${options.fromNumberId} not found for this org.`)
    }
    if (!numberRow.is_active) {
      throw new Error(`Twilio phone number ${numberRow.e164} is inactive.`)
    }
    if (!numberRow.capability_sms) {
      throw new Error(`Twilio phone number ${numberRow.e164} does not have SMS capability enabled.`)
    }
    fromNumber = numberRow.e164
  } else {
    const { data: defaultRow } = await ctx.supabase
      .from('twilio_phone_numbers')
      .select('e164, capability_sms')
      .eq('organization_id', ctx.organizationId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle()
    if (defaultRow) {
      if (!defaultRow.capability_sms) {
        throw new Error(`Default Twilio number ${defaultRow.e164} does not have SMS capability enabled.`)
      }
      fromNumber = defaultRow.e164
    }
  }

  if (!fromNumber) {
    throw new Error(
      'No default Twilio phone number configured. Add one in Settings > Phone Numbers.',
    )
  }

  return {
    accountSid: blob.account_sid,
    authToken: blob.auth_token,
    fromNumber,
  }
}

export async function sendSms(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  // Workflow spec exposes `phone_number_id` (snake_case to match other params).
  // Older internal call sites used `fromNumberId` — keep both for backward compat.
  const phoneNumberIdParam =
    typeof params.phone_number_id === 'string' && params.phone_number_id.length > 0
      ? params.phone_number_id
      : typeof params.fromNumberId === 'string' && params.fromNumberId.length > 0
        ? params.fromNumberId
        : undefined
  const creds = await resolveTwilioCredentials(ctx, { fromNumberId: phoneNumberIdParam })

  const to = String(params.to ?? '')
  const body = String(params.body ?? params.message ?? '')
  // MMS: optional public media URLs (e.g. Supabase chat-media public URLs).
  // Twilio accepts up to 10 repeated `MediaUrl` parameters per message and the
  // URLs must be publicly reachable so Twilio can fetch them.
  const mediaUrls = Array.isArray(params.media_urls)
    ? (params.media_urls as unknown[]).filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      )
    : []

  if (!to) throw new Error('send_sms requires a "to" phone number parameter.')
  if (!body && mediaUrls.length === 0) {
    throw new Error('send_sms requires a "body" message or at least one media URL.')
  }

  const basicAuth = btoa(`${creds.accountSid}:${creds.authToken}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`

  const form = new URLSearchParams({ To: to, From: creds.fromNumber })
  if (body) form.set('Body', body)
  for (const mediaUrl of mediaUrls) form.append('MediaUrl', mediaUrl)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Twilio error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { sid: string }
  // Single-line result | no newlines (Vapi parser breaks on \n)
  return `SMS sent. SID: ${data.sid}`
}
