// src/lib/twilio/send-sms.ts
// Executor for the send_sms action type.
//
// Sends an SMS via the Twilio Messages REST API using the org's stored
// Twilio credentials (Account SID + Auth Token) from the integrations table.
//
// Credential blob format (encrypted_api_key JSON): { account_sid, auth_token }
//
// Number resolution (v2.3):
//   1. If `params.fromNumberId` is provided, the corresponding active row in
//      `twilio_phone_numbers` is used (must have `capability_sms=true`).
//   2. Otherwise, the org's default number (is_default=true, is_active=true,
//      capability_sms=true) is used.
//   3. Legacy fallback: `integrations.config.from_number` (removed in the
//      next milestone | the migration 058 backfill covers existing rows).
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
    .select('encrypted_api_key, config')
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

  // Resolve the From number: specific id > org default > legacy config.from_number
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
    // Legacy fallback | kept for one release while orgs migrate.
    const config = row.config as { from_number?: string } | null
    if (config?.from_number) {
      fromNumber = config.from_number
      console.warn(
        '[twilio/send-sms] DEPRECATED legacy from_number used for org',
        ctx.organizationId,
        '— add the number to twilio_phone_numbers via Settings > Phone Numbers',
      )
    }
  }

  if (!fromNumber) {
    throw new Error('Twilio integration has no default phone number. Configure one in /integrations/twilio.')
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

  if (!to) throw new Error('send_sms requires a "to" phone number parameter.')
  if (!body) throw new Error('send_sms requires a "body" message parameter.')

  const basicAuth = btoa(`${creds.accountSid}:${creds.authToken}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: creds.fromNumber,
      Body: body,
    }).toString(),
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
