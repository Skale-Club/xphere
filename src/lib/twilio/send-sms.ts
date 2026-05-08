// src/lib/twilio/send-sms.ts
// Executor for the send_sms action type.
//
// Sends an SMS via the Twilio Messages REST API using the org's stored
// Twilio credentials (Account SID + Auth Token) from the integrations table.
//
// Credential blob format (encrypted_api_key JSON): { account_sid, auth_token }
// from_number stored in integrations.config.from_number
//
// Result strings never contain newlines — Vapi's response parser breaks on \n.

import { decrypt } from '@/lib/crypto'
import type { ActionContext } from '@/lib/action-engine/execute-action'

export interface TwilioCredentials {
  accountSid: string
  authToken: string
  fromNumber: string
}

export async function resolveTwilioCredentials(ctx: ActionContext): Promise<TwilioCredentials> {
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

  const config = row.config as { from_number?: string } | null
  if (!config?.from_number) {
    throw new Error('Twilio integration is missing from_number in config. Update the integration.')
  }

  return {
    accountSid: blob.account_sid,
    authToken: blob.auth_token,
    fromNumber: config.from_number,
  }
}

export async function sendSms(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const creds = await resolveTwilioCredentials(ctx)

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
  // Single-line result — no newlines (Vapi parser breaks on \n)
  return `SMS sent. SID: ${data.sid}`
}
