// tests/call-routing.test.ts
// SEED-007 — TwiML builder + routing resolver tests.
//
// Coverage:
//   ROUTE-01: twimlForwardToPhone wraps the number in <Dial><Number> with record
//   ROUTE-02: twimlForwardToSip emits <Sip>{uri}</Sip>
//   ROUTE-03: twimlForwardToClient emits <Client>{identity}</Client>
//   ROUTE-04: recording callback URL points at /api/twilio/recording
//   ROUTE-05: status callback (Dial action) points at /api/twilio/status
//   ROUTE-06: XML-escapes hostile user input
//   ROUTE-07: buildSipUri composes correctly + returns null when missing inputs

import { describe, it, expect } from 'vitest'
import {
  twimlForwardToPhone,
  twimlForwardToSip,
  twimlForwardToClient,
  twimlOutboundDial,
  twimlReject,
  xmlEscape,
} from '@/lib/calls/twiml-builder'
import { buildSipUri } from '@/lib/calls/resolve-routing'

const CTX = { baseUrl: 'https://operator.skale.club', recordCalls: true }

describe('TwiML builder', () => {
  it('ROUTE-01: forwards inbound to a phone number with recording enabled', () => {
    const xml = twimlForwardToPhone('+14155551234', CTX)
    expect(xml).toContain('<Number>+14155551234</Number>')
    expect(xml).toContain('record="record-from-answer"')
  })

  it('ROUTE-02: routes to a SIP URI', () => {
    const xml = twimlForwardToSip('sip:user@acme.sip.twilio.com', CTX)
    expect(xml).toContain('<Sip>sip:user@acme.sip.twilio.com</Sip>')
  })

  it('ROUTE-03: routes to a browser Client identity', () => {
    const xml = twimlForwardToClient('user-abcdef12', CTX)
    expect(xml).toContain('<Client>user-abcdef12</Client>')
  })

  it('ROUTE-04: recording callback points at /api/twilio/recording', () => {
    const xml = twimlForwardToPhone('+14155551234', CTX)
    expect(xml).toContain('recordingStatusCallback="https://operator.skale.club/api/twilio/recording"')
  })

  it('ROUTE-05: dial action points at /api/twilio/status', () => {
    const xml = twimlForwardToPhone('+14155551234', CTX)
    expect(xml).toContain('action="https://operator.skale.club/api/twilio/status"')
  })

  it('ROUTE-05b: disables recording when recordCalls is false', () => {
    const xml = twimlForwardToPhone('+14155551234', { ...CTX, recordCalls: false })
    expect(xml).not.toContain('record="record-from-answer"')
    expect(xml).not.toContain('recordingStatusCallback')
  })

  it('ROUTE-06: escapes hostile XML characters in identity', () => {
    const xml = twimlForwardToClient(`evil"><Hangup/><Client>real`, CTX)
    expect(xml).toContain('&quot;')
    expect(xml).toContain('&lt;')
    // Should not allow an injected <Hangup/> outside an escaped string
    expect(xml.match(/<Hangup\/>/g) ?? []).toHaveLength(0)
  })

  it('ROUTE-06b: xmlEscape handles ampersands and quotes', () => {
    expect(xmlEscape(`a & b "c"`)).toBe('a &amp; b &quot;c&quot;')
  })

  it('twimlReject without message hangs up', () => {
    expect(twimlReject()).toContain('<Hangup/>')
  })

  it('twimlReject with message uses <Say> + <Hangup/>', () => {
    const xml = twimlReject('Try later')
    expect(xml).toContain('<Say')
    expect(xml).toContain('Try later')
    expect(xml).toContain('<Hangup/>')
  })

  it('twimlOutboundDial bridges to a number', () => {
    const xml = twimlOutboundDial('+14155551234', CTX)
    expect(xml).toContain('<Number>+14155551234</Number>')
  })

  it('Includes callerId when provided', () => {
    const xml = twimlForwardToPhone('+14155551234', { ...CTX, callerId: '+15550000000' })
    expect(xml).toContain('callerId="+15550000000"')
  })

  it('Trailing slash in baseUrl does not duplicate slashes in callbacks', () => {
    const xml = twimlForwardToPhone('+14155551234', { baseUrl: 'https://x.com/', recordCalls: true })
    expect(xml).not.toContain('//api/')
  })
})

describe('buildSipUri', () => {
  it('ROUTE-07: composes a SIP URI when both parts are present', () => {
    expect(buildSipUri('alice', 'acme.sip.twilio.com')).toBe('sip:alice@acme.sip.twilio.com')
  })

  it('returns null when username is missing', () => {
    expect(buildSipUri(null, 'acme.sip.twilio.com')).toBeNull()
  })

  it('returns null when domain is missing', () => {
    expect(buildSipUri('alice', null)).toBeNull()
  })
})
