// tests/twilio-voice-webhook.test.ts
// SEED-007 — /api/twilio/voice webhook tests.
//
// Coverage:
//   VOICE-01: HMAC-SHA1 signature validation (valid → 200 TwiML, invalid → 403)
//   VOICE-02: phone_forward mode emits <Dial><Number>
//   VOICE-03: sip mode emits <Dial><Sip>
//   VOICE-04: browser mode emits <Dial><Client>
//   VOICE-05: missing call_settings → graceful <Hangup/> + 200
//
// Mirrors the SMS-webhook test style.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ── Mock next/server.after() to capture pending callbacks ────────────────────
const pendingAfterCallbacks: Array<Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    const result = fn()
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      pendingAfterCallbacks.push(result as Promise<unknown>)
    }
  }),
}))

async function flushAfterCallbacks(): Promise<void> {
  while (pendingAfterCallbacks.length > 0) {
    const next = pendingAfterCallbacks.shift()
    if (next) await next
  }
}

// ── Mock supabase admin ─────────────────────────────────────────────────────
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

// ── Mock decrypt to return a JSON blob ──────────────────────────────────────
const TEST_AUTH_TOKEN = 'test-voice-auth-token'
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue(
    JSON.stringify({ account_sid: 'AC_voice', auth_token: TEST_AUTH_TOKEN }),
  ),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'

const TEST_URL = 'http://localhost/api/twilio/voice'

function sign(url: string, params: Record<string, string>, token: string): string {
  const sortedKeys = Object.keys(params).sort()
  let canonical = url
  for (const key of sortedKeys) canonical += key + params[key]
  return createHmac('sha1', token).update(canonical, 'utf8').digest('base64')
}

function makePost(params: Record<string, string>, signature: string | null): Request {
  const body = new URLSearchParams(params).toString()
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (signature !== null) headers['x-twilio-signature'] = signature
  return new Request(TEST_URL, { method: 'POST', body, headers })
}

interface MockRouting {
  routing_mode: 'phone_forward' | 'sip' | 'browser'
  phone_forward?: string | null
  sip_username?: string | null
  twilio_client_identity?: string | null
  record_calls?: boolean
}

function buildSupabaseMock(opts: {
  integration: { organization_id: string } | null
  callSettings: (MockRouting & { user_id?: string }) | null
  sipDomain?: string | null
}) {
  // Supports both a bare insert and the `.insert(...).select('id').single()`
  // chain that logIncomingCall uses on first insert.
  const callLogInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
    }),
    then: (resolve: (v: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
  })

  const fromMock = vi.fn((table: string) => {
    if (table === 'integrations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.integration
            ? {
                organization_id: opts.integration.organization_id,
                encrypted_api_key: 'ENC',
                config: opts.sipDomain ? { sip_domain: opts.sipDomain, from_number: '+19990000000' } : { from_number: '+19990000000' },
              }
            : null,
          error: null,
        }),
      }
    }
    if (table === 'twilio_phone_numbers') {
      // Two readers hit this table:
      //   * resolveTwilioOrgByToNumber — selects ALL active rows for an e164 and
      //     awaits the builder directly (array result, no .maybeSingle()).
      //   * resolveTwilioCredentialsForOrg — default-number lookup via
      //     .maybeSingle() (single row).
      // The builder is therefore both chainable AND thenable.
      const row = opts.integration
        ? {
            id: 'phone-1',
            organization_id: opts.integration.organization_id,
            e164: '+19990000000',
            is_active: true,
          }
        : null
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: row ? [row] : [], error: null }),
      }
    }
    if (table === 'call_settings') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.callSettings
            ? {
                org_id: opts.integration?.organization_id ?? 'org-1',
                user_id: opts.callSettings.user_id ?? 'user-1',
                routing_mode: opts.callSettings.routing_mode,
                phone_forward: opts.callSettings.phone_forward ?? null,
                sip_username: opts.callSettings.sip_username ?? null,
                twilio_client_identity: opts.callSettings.twilio_client_identity ?? null,
                record_calls: opts.callSettings.record_calls ?? true,
              }
            : null,
          error: null,
        }),
      }
    }
    if (table === 'call_logs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: callLogInsert,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      }
    }
    if (table === 'contacts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  ;(createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock })
  return { fromMock, callLogInsert }
}

beforeEach(() => {
  vi.clearAllMocks()
  pendingAfterCallbacks.length = 0
})

describe('POST /api/twilio/voice', () => {
  it('VOICE-01: returns 403 when signature is invalid', async () => {
    buildSupabaseMock({
      integration: { organization_id: 'org-1' },
      callSettings: { routing_mode: 'phone_forward', phone_forward: '+14155551234' },
    })
    const { POST } = await import('@/app/api/twilio/voice/route')
    const req = makePost({ From: '+12025550000', To: '+19990000000', CallSid: 'CA-1' }, 'WRONG')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('VOICE-02: phone_forward mode emits <Dial><Number>', async () => {
    buildSupabaseMock({
      integration: { organization_id: 'org-1' },
      callSettings: { routing_mode: 'phone_forward', phone_forward: '+14155551234' },
    })
    const params = { From: '+12025550000', To: '+19990000000', CallSid: 'CA-2' }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/voice/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<Number>+14155551234</Number>')
    await flushAfterCallbacks()
  })

  it('VOICE-03: sip mode emits <Dial><Sip>', async () => {
    buildSupabaseMock({
      integration: { organization_id: 'org-1' },
      callSettings: { routing_mode: 'sip', sip_username: 'alice' },
      sipDomain: 'acme.sip.twilio.com',
    })
    const params = { From: '+12025550000', To: '+19990000000', CallSid: 'CA-3' }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/voice/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<Sip>sip:alice@acme.sip.twilio.com</Sip>')
    await flushAfterCallbacks()
  })

  it('VOICE-04: browser mode emits <Dial><Client>', async () => {
    buildSupabaseMock({
      integration: { organization_id: 'org-1' },
      callSettings: { routing_mode: 'browser', twilio_client_identity: 'user-abcd1234' },
    })
    const params = { From: '+12025550000', To: '+19990000000', CallSid: 'CA-4' }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/voice/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<Client>user-abcd1234</Client>')
    await flushAfterCallbacks()
  })

  it('VOICE-05: no call_settings → <Hangup/> with a polite message and still 200', async () => {
    buildSupabaseMock({
      integration: { organization_id: 'org-1' },
      callSettings: null,
    })
    const params = { From: '+12025550000', To: '+19990000000', CallSid: 'CA-5' }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/voice/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<Hangup/>')
  })

  it('VOICE-07: browser SDK outbound (Direction=inbound, Caller=client:) bridges to the dialed number', async () => {
    // Twilio delivers Voice-SDK-originated calls to the TwiML App with
    // Direction=inbound and Caller=client:<identity>. The org must resolve via
    // the client identity (call_settings), NOT by looking up the dialed contact
    // number in twilio_phone_numbers — otherwise every contact call is rejected
    // with "not connected to a Xphere workspace".
    buildSupabaseMock({
      integration: { organization_id: 'org-1' },
      callSettings: { routing_mode: 'browser', twilio_client_identity: 'user-abcd1234' },
    })

    const params = {
      From: 'client:user-abcd1234',
      Caller: 'client:user-abcd1234',
      To: '+15088018190',
      Direction: 'inbound',
      CallSid: 'CA-7',
    }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/voice/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    const xml = await res.text()
    // Bridges out to the dialed PSTN number — NOT a rejection.
    expect(xml).toContain('+15088018190')
    expect(xml).not.toContain('not connected to a Xphere workspace')
    await flushAfterCallbacks()
  })

  it('VOICE-06: no Twilio integration for `To` → graceful hangup', async () => {
    buildSupabaseMock({
      integration: null,
      callSettings: null,
    })
    const params = { From: '+12025550000', To: '+19990000000', CallSid: 'CA-6' }
    const { POST } = await import('@/app/api/twilio/voice/route')
    const res = await POST(makePost(params, 'ANY'))
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<Hangup/>')
  })
})
