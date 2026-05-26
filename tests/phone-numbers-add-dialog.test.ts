// tests/phone-numbers-add-dialog.test.ts
//
// Pure-logic coverage for the Add Phone Number wizard's helpers:
//   1) parseTwilioIncomingNumbers maps the IncomingPhoneNumbers payload into
//      the wizard's row shape and flags alreadyImported on SID or E.164 match.
//   2) buildCreatePayload merges the user's Step 3 overrides on top of the
//      Step 2 selection without losing the phone_sid.
//   3) describeTwilioListError converts Twilio HTTP failures into messages
//      that are actionable for the operator.

import { describe, it, expect } from 'vitest'

import {
  buildCreatePayload,
  describeTwilioListError,
  parseTwilioIncomingNumbers,
  type TwilioIncomingListResponse,
} from '@/lib/phone-numbers/import'

describe('parseTwilioIncomingNumbers', () => {
  const VALID_SID_A = 'PN' + 'a'.repeat(32)
  const VALID_SID_B = 'PN' + 'b'.repeat(32)
  const VALID_SID_C = 'PN' + 'c'.repeat(32)

  it('maps a well-formed payload to wizard rows', () => {
    const payload: TwilioIncomingListResponse = {
      incoming_phone_numbers: [
        {
          sid: VALID_SID_A,
          phone_number: '+14155552671',
          friendly_name: 'Sales',
          capabilities: { voice: true, sms: true, mms: false },
        },
      ],
    }
    const rows = parseTwilioIncomingNumbers(payload, [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      sid: VALID_SID_A,
      e164: '+14155552671',
      friendlyName: 'Sales',
      capabilities: { voice: true, sms: true, mms: false },
      alreadyImported: false,
    })
  })

  it('flags alreadyImported when the SID matches a local row', () => {
    const payload: TwilioIncomingListResponse = {
      incoming_phone_numbers: [
        {
          sid: VALID_SID_A,
          phone_number: '+14155552671',
          friendly_name: 'Sales',
          capabilities: { voice: true, sms: true, mms: false },
        },
      ],
    }
    const rows = parseTwilioIncomingNumbers(payload, [
      { sid: VALID_SID_A, e164: '+19999999999' },
    ])
    expect(rows[0]?.alreadyImported).toBe(true)
  })

  it('flags alreadyImported when only the E.164 matches a local row', () => {
    const payload: TwilioIncomingListResponse = {
      incoming_phone_numbers: [
        {
          sid: VALID_SID_A,
          phone_number: '+14155552671',
          friendly_name: 'Sales',
          capabilities: { voice: true, sms: true, mms: false },
        },
      ],
    }
    const rows = parseTwilioIncomingNumbers(payload, [
      { sid: null, e164: '+14155552671' },
    ])
    expect(rows[0]?.alreadyImported).toBe(true)
  })

  it('falls back to the phone number when friendly_name is blank', () => {
    const payload: TwilioIncomingListResponse = {
      incoming_phone_numbers: [
        {
          sid: VALID_SID_B,
          phone_number: '+14155552671',
          friendly_name: '   ',
          capabilities: { voice: true, sms: false, mms: false },
        },
      ],
    }
    const rows = parseTwilioIncomingNumbers(payload, [])
    expect(rows[0]?.friendlyName).toBe('+14155552671')
  })

  it('drops rows with invalid SID or E.164', () => {
    const payload: TwilioIncomingListResponse = {
      incoming_phone_numbers: [
        { sid: 'NOT_A_SID', phone_number: '+14155552671' },
        { sid: VALID_SID_A, phone_number: 'not-a-phone' },
        { sid: VALID_SID_B, phone_number: '+14155552672' }, // valid
        { sid: undefined, phone_number: '+14155552673' },
        { sid: VALID_SID_C, phone_number: undefined },
      ],
    }
    const rows = parseTwilioIncomingNumbers(payload, [])
    expect(rows.map((r) => r.sid)).toEqual([VALID_SID_B])
  })

  it('returns an empty array for a missing list', () => {
    expect(parseTwilioIncomingNumbers({}, [])).toEqual([])
  })

  it('coerces missing capabilities to all-false', () => {
    const payload: TwilioIncomingListResponse = {
      incoming_phone_numbers: [
        { sid: VALID_SID_A, phone_number: '+14155552671' },
      ],
    }
    const rows = parseTwilioIncomingNumbers(payload, [])
    expect(rows[0]?.capabilities).toEqual({ voice: false, sms: false, mms: false })
  })
})

describe('buildCreatePayload', () => {
  const VALID_SID = 'PN' + 'a'.repeat(32)
  const baseSelection = {
    sid: VALID_SID,
    e164: '+14155552671',
    friendlyName: 'Sales',
    capabilities: { voice: true, sms: true, mms: false },
  }

  it('passes the picked SID and E.164 through unchanged', () => {
    const payload = buildCreatePayload(baseSelection)
    expect(payload.e164).toBe('+14155552671')
    expect(payload.phone_sid).toBe(VALID_SID)
  })

  it('lets Step 3 override friendly name and capabilities', () => {
    const payload = buildCreatePayload(baseSelection, {
      friendlyName: 'Renamed',
      capabilities: { voice: false, sms: true, mms: true },
      isDefault: true,
    })
    expect(payload.friendly_name).toBe('Renamed')
    expect(payload.capability_voice).toBe(false)
    expect(payload.capability_sms).toBe(true)
    expect(payload.capability_mms).toBe(true)
    expect(payload.is_default).toBe(true)
  })

  it('falls back to the E.164 when the friendly name is blanked out', () => {
    const payload = buildCreatePayload(baseSelection, { friendlyName: '   ' })
    expect(payload.friendly_name).toBe('+14155552671')
  })

  it('defaults isDefault to false when not provided', () => {
    expect(buildCreatePayload(baseSelection).is_default).toBe(false)
  })
})

describe('describeTwilioListError', () => {
  it('explains 401 as bad credentials', () => {
    expect(describeTwilioListError(401, '')).toMatch(/Double-check Account SID/i)
  })

  it('explains 403 as missing scope and hints at manual entry', () => {
    expect(describeTwilioListError(403, '')).toMatch(/manually/i)
  })

  it('explains 429 as rate-limiting', () => {
    expect(describeTwilioListError(429, '')).toMatch(/rate-limit/i)
  })

  it('explains 5xx as Twilio unavailability', () => {
    expect(describeTwilioListError(503, '')).toMatch(/unavailable/i)
  })

  it('falls back to the body for unknown statuses', () => {
    const msg = describeTwilioListError(418, 'I am a teapot')
    expect(msg).toContain('418')
    expect(msg).toContain('I am a teapot')
  })

  it('handles an empty body on unknown statuses', () => {
    expect(describeTwilioListError(418, '')).toBe('Twilio responded 418.')
  })
})
