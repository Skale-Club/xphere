// src/lib/twilio/voice.ts
// Twilio Voice client wrapper (SEED-007).
//
// Resolves org-level Twilio credentials (same pattern as send-sms.ts) and exposes
// helpers used by the voice webhook + outbound-call endpoint:
//   * resolveTwilioCredentialsForOrg(orgId) — service-role lookup keyed by org
//   * createOutboundCall(creds, params)     — REST API call creation
//   * twilioBasicAuthHeader(creds)          — for recording downloads
//
// Twilio Access Tokens (Voice SDK) are generated in `src/lib/twilio/access-token.ts`
// so they can be Edge-runtime-safe (Web Crypto / HMAC).

import { decrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export interface TwilioVoiceCredentials {
  accountSid: string
  authToken: string
  fromNumber: string
  apiKeySid?: string
  apiKeySecret?: string
  twimlAppSid?: string
}

/**
 * Look up a Twilio integration by organization_id using the service-role client.
 * Bypasses RLS — only call this from trusted server-only code (webhooks, signed
 * server actions). Mirrors the credential shape from send-sms.ts.
 */
export async function resolveTwilioCredentialsForOrg(
  orgId: string,
): Promise<TwilioVoiceCredentials | null> {
  const supabase = createServiceRoleClient()
  const { data: row, error } = await supabase
    .from('integrations')
    .select('encrypted_api_key, config')
    .eq('organization_id', orgId)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error || !row) return null

  let blob: {
    account_sid?: string
    auth_token?: string
    api_key_sid?: string
    api_key_secret?: string
  }
  try {
    blob = JSON.parse(await decrypt(row.encrypted_api_key))
  } catch {
    return null
  }

  const config = (row.config ?? {}) as {
    from_number?: string
    twiml_app_sid?: string
  }

  if (!blob.account_sid || !blob.auth_token) return null
  return {
    accountSid: blob.account_sid,
    authToken: blob.auth_token,
    fromNumber: config.from_number ?? '',
    apiKeySid: blob.api_key_sid,
    apiKeySecret: blob.api_key_secret,
    twimlAppSid: config.twiml_app_sid,
  }
}

/**
 * Look up the active Twilio integration matching the destination phone number.
 * Used by the inbound voice webhook to resolve which org owns the called number.
 */
export async function resolveTwilioOrgByToNumber(
  toNumber: string,
): Promise<{ orgId: string; creds: TwilioVoiceCredentials } | null> {
  const supabase = createServiceRoleClient()
  const { data: row } = await supabase
    .from('integrations')
    .select('organization_id, encrypted_api_key, config')
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .eq('config->>from_number', toNumber)
    .limit(1)
    .maybeSingle()

  if (!row) return null

  let blob: {
    account_sid?: string
    auth_token?: string
    api_key_sid?: string
    api_key_secret?: string
  }
  try {
    blob = JSON.parse(await decrypt(row.encrypted_api_key))
  } catch {
    return null
  }

  if (!blob.account_sid || !blob.auth_token) return null

  const config = (row.config ?? {}) as {
    from_number?: string
    twiml_app_sid?: string
  }

  return {
    orgId: row.organization_id,
    creds: {
      accountSid: blob.account_sid,
      authToken: blob.auth_token,
      fromNumber: config.from_number ?? toNumber,
      apiKeySid: blob.api_key_sid,
      apiKeySecret: blob.api_key_secret,
      twimlAppSid: config.twiml_app_sid,
    },
  }
}

export function twilioBasicAuthHeader(creds: TwilioVoiceCredentials): string {
  return `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`
}

export interface CreateOutboundCallParams {
  to: string
  from?: string
  /**
   * Absolute URL Twilio will fetch for TwiML when the callee picks up.
   * Twilio POSTs the same shape as an inbound voice webhook, so we point this at
   * /api/twilio/voice to reuse the routing logic for the originating user.
   */
  twimlUrl: string
  statusCallback?: string
  record?: boolean
}

/**
 * Wraps the Twilio REST API `Calls` endpoint. Uses HTTP basic-auth with the
 * account SID + auth token rather than the SDK to keep the bundle small and the
 * runtime Edge-compatible.
 */
export async function createOutboundCall(
  creds: TwilioVoiceCredentials,
  params: CreateOutboundCallParams,
): Promise<{ sid: string }> {
  const from = params.from ?? creds.fromNumber
  if (!from) throw new Error('createOutboundCall: missing From number')

  const body: Record<string, string> = {
    To: params.to,
    From: from,
    Url: params.twimlUrl,
    Method: 'POST',
  }
  if (params.statusCallback) {
    body.StatusCallback = params.statusCallback
    body.StatusCallbackMethod = 'POST'
    body.StatusCallbackEvent = 'initiated ringing answered completed'
  }
  if (params.record) {
    body.Record = 'true'
    body.RecordingChannels = 'dual'
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioBasicAuthHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`Twilio outbound call error ${res.status}: ${text}`)
  }
  const data = (await res.json()) as { sid: string }
  return { sid: data.sid }
}
