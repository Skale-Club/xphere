// tests/calls-recording-webhook.test.ts
// SEED-007 — /api/twilio/recording webhook tests.
//
// Coverage:
//   REC-01: Signature validation enforced when integration is found
//   REC-02: Returns 200 and acks when no call_log row exists yet
//   REC-03: Successful upload updates call_logs.recording_url + recording_duration
//   REC-04: Non-`completed` recording statuses are acked without uploading

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// Capture after() callbacks
const pendingAfterCallbacks: Array<Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    const r = fn()
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      pendingAfterCallbacks.push(r as Promise<unknown>)
    }
  }),
}))

async function flushAfterCallbacks(): Promise<void> {
  while (pendingAfterCallbacks.length > 0) {
    const n = pendingAfterCallbacks.shift()
    if (n) await n
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

const TEST_AUTH_TOKEN = 'test-rec-auth-token'
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue(
    JSON.stringify({ account_sid: 'AC_rec', auth_token: TEST_AUTH_TOKEN }),
  ),
}))

// Mock uploader so we don't hit Hetzner during tests
const uploadSpy = vi.fn().mockResolvedValue({
  storedUrl: 'https://hetzner.example/recordings/org-1/CA-9/RE-9.mp3',
  uploaded: true,
  contentType: 'audio/mpeg',
})
vi.mock('@/lib/calls/upload-recording', () => ({
  uploadRecordingToHetzner: uploadSpy,
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'

const TEST_URL = 'http://localhost/api/twilio/recording'

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

function buildSupabaseMock(opts: {
  callLog: { id: string; org_id: string } | null
  integration: boolean
}) {
  const updateEqSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy })

  const fromMock = vi.fn((table: string) => {
    if (table === 'call_logs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.callLog, error: null }),
        update: updateSpy,
      }
    }
    if (table === 'integrations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.integration
            ? {
                organization_id: 'org-1',
                encrypted_api_key: 'ENC',
                config: { from_number: '+19990000000' },
              }
            : null,
          error: null,
        }),
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
  return { fromMock, updateSpy, updateEqSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
  pendingAfterCallbacks.length = 0
})

describe('POST /api/twilio/recording', () => {
  it('REC-01: invalid signature → 403', async () => {
    buildSupabaseMock({
      callLog: { id: 'cl-1', org_id: 'org-1' },
      integration: true,
    })
    const params = {
      CallSid: 'CA-9',
      RecordingSid: 'RE-9',
      RecordingUrl: 'https://api.twilio.com/r/RE-9',
      RecordingDuration: '12',
      RecordingStatus: 'completed',
    }
    const { POST } = await import('@/app/api/twilio/recording/route')
    const res = await POST(makePost(params, 'NOPE'))
    expect(res.status).toBe(403)
  })

  it('REC-02: no call_log row → 200 ack, no upload', async () => {
    buildSupabaseMock({ callLog: null, integration: true })
    const params = {
      CallSid: 'CA-9',
      RecordingSid: 'RE-9',
      RecordingUrl: 'https://api.twilio.com/r/RE-9',
      RecordingDuration: '12',
      RecordingStatus: 'completed',
    }
    const { POST } = await import('@/app/api/twilio/recording/route')
    const res = await POST(makePost(params, 'ANY'))
    expect(res.status).toBe(200)
    await flushAfterCallbacks()
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  it('REC-03: completed status → uploads + updates call_logs.recording_url', async () => {
    const { updateSpy, updateEqSpy } = buildSupabaseMock({
      callLog: { id: 'cl-9', org_id: 'org-1' },
      integration: true,
    })
    const params = {
      CallSid: 'CA-9',
      RecordingSid: 'RE-9',
      RecordingUrl: 'https://api.twilio.com/r/RE-9',
      RecordingDuration: '42',
      RecordingStatus: 'completed',
    }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/recording/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    await flushAfterCallbacks()
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      recording_url: 'https://hetzner.example/recordings/org-1/CA-9/RE-9.mp3',
      recording_duration: 42,
    }))
    expect(updateEqSpy).toHaveBeenCalledWith('id', 'cl-9')
  })

  it('REC-04: non-completed status → 200 ack, no upload', async () => {
    buildSupabaseMock({ callLog: { id: 'cl-9', org_id: 'org-1' }, integration: true })
    const params = {
      CallSid: 'CA-9',
      RecordingSid: 'RE-9',
      RecordingUrl: 'https://api.twilio.com/r/RE-9',
      RecordingDuration: '5',
      RecordingStatus: 'in-progress',
    }
    const sig = sign(TEST_URL, params, TEST_AUTH_TOKEN)
    const { POST } = await import('@/app/api/twilio/recording/route')
    const res = await POST(makePost(params, sig))
    expect(res.status).toBe(200)
    await flushAfterCallbacks()
    expect(uploadSpy).not.toHaveBeenCalled()
  })
})
