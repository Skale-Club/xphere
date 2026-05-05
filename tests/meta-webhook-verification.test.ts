import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ---- Mock next/server (after runs the callback synchronously in tests) ----
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => fn()),
}))

// ---- Mock processMetaEvent to avoid DB calls ----
vi.mock('@/lib/meta/process-event', () => ({
  processMetaEvent: vi.fn().mockResolvedValue(undefined),
}))

// ---- Helpers ----

/**
 * Compute the x-hub-signature-256 header value for a given body and secret.
 * This mirrors exactly what Meta sends in production.
 */
function computeSignature(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Build a GET Request simulating Meta's hub challenge.
 */
function makeGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/api/meta/webhook')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString(), { method: 'GET' })
}

/**
 * Build a POST Request simulating Meta's event notification.
 */
function makePostRequest(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signature !== null) {
    headers['x-hub-signature-256'] = signature
  }
  return new Request('http://localhost/api/meta/webhook', {
    method: 'POST',
    body,
    headers,
  })
}

const TEST_VERIFY_TOKEN = 'test-verify-token'
const TEST_APP_SECRET = 'test-app-secret'

describe('METAEV-01: GET hub challenge verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.META_VERIFY_TOKEN = TEST_VERIFY_TOKEN
    process.env.META_APP_SECRET = TEST_APP_SECRET
  })

  it('returns the hub.challenge value when hub.mode is subscribe and verify token matches', async () => {
    const { GET } = await import('@/app/api/meta/webhook/route')
    const request = makeGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': 'challenge-abc123',
    })

    const response = await GET(request)

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toBe('challenge-abc123')
  })

  it('returns 403 when verify token does not match META_VERIFY_TOKEN', async () => {
    const { GET } = await import('@/app/api/meta/webhook/route')
    const request = makeGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge-abc123',
    })

    const response = await GET(request)

    expect(response.status).toBe(403)
  })

  it('returns 403 when hub.mode is not subscribe', async () => {
    const { GET } = await import('@/app/api/meta/webhook/route')
    const request = makeGetRequest({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': 'challenge-abc123',
    })

    const response = await GET(request)

    expect(response.status).toBe(403)
  })
})

describe('METAEV-01: POST HMAC-SHA256 signature verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.META_VERIFY_TOKEN = TEST_VERIFY_TOKEN
    process.env.META_APP_SECRET = TEST_APP_SECRET
  })

  it('returns 200 when x-hub-signature-256 header matches HMAC of raw body', async () => {
    const { POST } = await import('@/app/api/meta/webhook/route')
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'page-123',
        messaging: [{ sender: { id: 'igsid-456' }, message: { mid: 'mid-001', text: 'Hello' } }],
      }],
    })
    const signature = computeSignature(body, TEST_APP_SECRET)

    const response = await POST(makePostRequest(body, signature))

    expect(response.status).toBe(200)
    const json = await response.json() as { ok: boolean }
    expect(json.ok).toBe(true)
  })

  it('returns 403 when x-hub-signature-256 header is missing', async () => {
    const { POST } = await import('@/app/api/meta/webhook/route')
    const body = JSON.stringify({ object: 'instagram', entry: [] })

    const response = await POST(makePostRequest(body, null))

    expect(response.status).toBe(403)
  })

  it('returns 403 when x-hub-signature-256 header does not match expected HMAC', async () => {
    const { POST } = await import('@/app/api/meta/webhook/route')
    const body = JSON.stringify({ object: 'instagram', entry: [] })
    const wrongSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'

    const response = await POST(makePostRequest(body, wrongSignature))

    expect(response.status).toBe(403)
  })

  it('returns 200 even when signature is valid but payload is malformed JSON', async () => {
    const { POST } = await import('@/app/api/meta/webhook/route')
    const malformedBody = 'not-valid-json{{{}'
    const signature = computeSignature(malformedBody, TEST_APP_SECRET)

    const response = await POST(makePostRequest(malformedBody, signature))

    // Valid HMAC + malformed JSON should still return 200 (not crash)
    expect(response.status).toBe(200)
  })
})
