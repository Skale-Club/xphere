import { describe, it } from 'vitest'

describe('SMS-01: sendSms calls Twilio Messages API', () => {
  it.todo('POSTs to https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json with Basic auth (btoa(accountSid:authToken))')
  it.todo('sends Content-Type: application/x-www-form-urlencoded body with To, From, Body fields')
  it.todo('reads accountSid and authToken from encrypted_api_key JSON blob (fields: account_sid, auth_token)')
})

describe('SMS-02: sendSms reads params and resolves From via twilio_phone_numbers', () => {
  it.todo('reads "to" param from tool call params (falls back to nothing — param is required)')
  it.todo('reads "body" param from tool call params (falls back to "message" key if body is absent)')
  it.todo('resolves From from twilio_phone_numbers (specific id via phone_number_id, then org default) — never from integrations.config')
})

describe('SMS-03: sendSms returns single-line string with SID', () => {
  it.todo('returns "SMS sent. SID: SM..." on success (exact prefix "SMS sent. SID: ")')
  it.todo('return value contains no newline characters')
  it.todo('throws Twilio error string (includes status code) on non-2xx Twilio response')
})

describe('SMS-04: sendSms throws clear error when Twilio integration missing', () => {
  it.todo('throws "Twilio not connected for this org. Add a Twilio integration in /integrations." when no active twilio row in integrations table')
  it.todo('throws "No default Twilio phone number configured..." when twilio_phone_numbers has no active default row')
  it.todo('throws "send_sms requires a \\"to\\" phone number parameter." when to param is missing')
  it.todo('throws "send_sms requires a \\"body\\" message parameter." when body and message params are both missing')
})
