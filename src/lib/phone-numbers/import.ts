/**
 * Pure helpers used by the Add Phone Number wizard to import numbers from
 * a connected Twilio account. Extracted from the dialog so the parsing /
 * merging logic is unit-testable without React or fetch infra.
 */

export interface TwilioIncomingPhoneNumberPayload {
  sid?: string
  phone_number?: string
  friendly_name?: string | null
  capabilities?: {
    voice?: boolean
    sms?: boolean
    mms?: boolean
  } | null
}

export interface TwilioIncomingListResponse {
  incoming_phone_numbers?: TwilioIncomingPhoneNumberPayload[]
}

export interface LocalNumberRef {
  sid: string | null
  e164: string
}

export interface TwilioRemoteNumber {
  sid: string
  e164: string
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
  alreadyImported: boolean
}

const PHONE_SID_REGEX = /^PN[a-f0-9]{32}$/i
const E164_REGEX = /^\+[1-9]\d{6,14}$/

/**
 * Convert a Twilio IncomingPhoneNumbers payload into the shape the wizard
 * renders. Drops malformed rows (missing sid/phone_number, malformed E.164).
 * The merge with local rows happens here so the caller gets a ready-to-render
 * list with an `alreadyImported` flag per item.
 */
export function parseTwilioIncomingNumbers(
  payload: TwilioIncomingListResponse,
  localRefs: LocalNumberRef[],
): TwilioRemoteNumber[] {
  const localBySid = new Set(
    localRefs.map((row) => row.sid).filter((sid): sid is string => Boolean(sid)),
  )
  const localByE164 = new Set(localRefs.map((row) => row.e164))

  const rows = payload.incoming_phone_numbers ?? []
  const result: TwilioRemoteNumber[] = []

  for (const row of rows) {
    if (!row.sid || !PHONE_SID_REGEX.test(row.sid)) continue
    if (!row.phone_number || !E164_REGEX.test(row.phone_number)) continue

    const caps = row.capabilities ?? {}
    result.push({
      sid: row.sid,
      e164: row.phone_number,
      friendlyName: (row.friendly_name ?? '').trim() || row.phone_number,
      capabilities: {
        voice: Boolean(caps.voice),
        sms: Boolean(caps.sms),
        mms: Boolean(caps.mms),
      },
      alreadyImported: localBySid.has(row.sid) || localByE164.has(row.phone_number),
    })
  }

  return result
}

/**
 * Map a Twilio HTTP failure to a user-facing message. Returns a string the
 * dialog can show inline; the caller logs the raw status/body separately.
 */
export function describeTwilioListError(status: number, body: string): string {
  if (status === 401) {
    return 'Twilio rejected the credentials. Double-check Account SID and Auth Token.'
  }
  if (status === 403) {
    return 'Twilio credentials lack permission to list phone numbers. Use a key with the IncomingPhoneNumbers.Read scope or enter the number manually.'
  }
  if (status === 429) {
    return 'Twilio is rate-limiting requests. Wait a few seconds and try again.'
  }
  if (status >= 500) {
    return 'Twilio is unavailable. Try again in a moment.'
  }
  const trimmed = body.trim()
  return trimmed.length > 0
    ? `Twilio responded ${status}: ${trimmed.slice(0, 200)}`
    : `Twilio responded ${status}.`
}

export interface ImportSelection {
  sid: string
  e164: string
  friendlyName: string
  capabilities: { voice: boolean; sms: boolean; mms: boolean }
}

export interface CreateNumberPayload {
  e164: string
  phone_sid: string
  friendly_name: string
  capability_voice: boolean
  capability_sms: boolean
  capability_mms: boolean
  is_default: boolean
}

/**
 * Build the payload for createTwilioNumber from the user's Step 2 + Step 3
 * choices. Caller passes the picked remote number plus any overrides the user
 * made on Step 3 (friendly name override, capability toggles, default flag).
 */
export function buildCreatePayload(
  selection: ImportSelection,
  overrides: {
    friendlyName?: string
    capabilities?: Partial<{ voice: boolean; sms: boolean; mms: boolean }>
    isDefault?: boolean
  } = {},
): CreateNumberPayload {
  const caps = {
    voice: overrides.capabilities?.voice ?? selection.capabilities.voice,
    sms: overrides.capabilities?.sms ?? selection.capabilities.sms,
    mms: overrides.capabilities?.mms ?? selection.capabilities.mms,
  }
  return {
    e164: selection.e164,
    phone_sid: selection.sid,
    friendly_name: (overrides.friendlyName ?? selection.friendlyName).trim() || selection.e164,
    capability_voice: caps.voice,
    capability_sms: caps.sms,
    capability_mms: caps.mms,
    is_default: overrides.isDefault ?? false,
  }
}
