// tests/webhook-signature-zapi-wapi.test.ts
// Security Review — Xphere | S12 Webhook authenticity.
//
// Covers the two fail-open vectors closed in PR 2:
//   - /api/zapi/webhook : signature was optional (silently passed if header
//     absent). Now required and timing-safe; rejects with 403.
//   - /api/wapi/webhook : no signature at all. Now required; rejects with 403.
//
// We mock the provider resolver so the tests don't need DB access. The point
// is to lock the contract: forged or missing tokens MUST 403, valid tokens
// MUST 200 and trigger downstream processing exactly once.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const pendingAfterCallbacks: Array<Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    const result = fn()
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      pendingAfterCallbacks.push(result as Promise<unknown>)
    }
  }),
}))

const processWhatsAppMessageMock = vi.fn(async () => undefined)
vi.mock('@/lib/whatsapp/process-message', () => ({
  processWhatsAppMessage: processWhatsAppMessageMock,
}))

const resolveProviderByZApiInstance = vi.fn()
const resolveProviderByWApiKey = vi.fn()
vi.mock('@/lib/whatsapp/resolve-provider', () => ({
  resolveProviderByZApiInstance,
  resolveProviderByWApiKey,
}))

vi.mock('@/lib/whatsapp/adapters/zapi', () => ({
  zapiAdapter: { name: 'zapi' },
  normalizeZApi: () => [{ id: 'msg-1', text: 'hi' }],
}))
vi.mock('@/lib/whatsapp/adapters/wapi', () => ({
  wapiAdapter: { name: 'wapi' },
  normalizeWApi: () => [{ id: 'msg-1', text: 'hi' }],
}))

async function flushAfter(): Promise<void> {
  while (pendingAfterCallbacks.length) {
    const next = pendingAfterCallbacks.shift()!
    try { await next } catch { /* swallow per route contract */ }
  }
}

beforeEach(() => {
  pendingAfterCallbacks.length = 0
  processWhatsAppMessageMock.mockClear()
  resolveProviderByZApiInstance.mockReset()
  resolveProviderByWApiKey.mockReset()
})

function jsonRequest(url: string, headers: Record<string, string>, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('S12: zapi webhook signature', () => {
  it('rejects when X-Z-API-Token header is missing', async () => {
    resolveProviderByZApiInstance.mockResolvedValue({
      id: 'p1', orgId: 'org-a', provider: 'zapi', config: { instance_id: 'i1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/zapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/zapi/webhook?instance=i1', {}, { instanceId: 'i1' }))
    expect(res.status).toBe(403)
    expect(processWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('rejects when token mismatches', async () => {
    resolveProviderByZApiInstance.mockResolvedValue({
      id: 'p1', orgId: 'org-a', provider: 'zapi', config: { instance_id: 'i1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/zapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/zapi/webhook?instance=i1', { 'x-z-api-token': 'wrong' }, { instanceId: 'i1' }))
    expect(res.status).toBe(403)
    expect(processWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('rejects when no secret is configured on the provider', async () => {
    resolveProviderByZApiInstance.mockResolvedValue({
      id: 'p1', orgId: 'org-a', provider: 'zapi', config: { instance_id: 'i1' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/zapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/zapi/webhook?instance=i1', { 'x-z-api-token': 'anything' }, { instanceId: 'i1' }))
    expect(res.status).toBe(403)
    expect(processWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('accepts and processes when valid token is sent (config.token fallback)', async () => {
    resolveProviderByZApiInstance.mockResolvedValue({
      id: 'p1', orgId: 'org-a', provider: 'zapi', config: { instance_id: 'i1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/zapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/zapi/webhook?instance=i1', { 'x-z-api-token': 'secret123' }, { instanceId: 'i1' }))
    expect(res.status).toBe(200)
    await flushAfter()
    expect(processWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('prefers webhookSecret over config.token when both are set', async () => {
    resolveProviderByZApiInstance.mockResolvedValue({
      id: 'p1', orgId: 'org-a', provider: 'zapi', config: { instance_id: 'i1', token: 'old' }, webhookSecret: 'new-hook-secret',
    })
    const { POST } = await import('@/app/api/zapi/webhook/route')
    const wrong = await POST(jsonRequest('https://x/api/zapi/webhook?instance=i1', { 'x-z-api-token': 'old' }, { instanceId: 'i1' }))
    expect(wrong.status).toBe(403)
    const right = await POST(jsonRequest('https://x/api/zapi/webhook?instance=i1', { 'x-z-api-token': 'new-hook-secret' }, { instanceId: 'i1' }))
    expect(right.status).toBe(200)
  })
})

describe('S12: wapi webhook signature', () => {
  it('rejects when X-WAPI-Token header is missing', async () => {
    resolveProviderByWApiKey.mockResolvedValue({
      id: 'p2', orgId: 'org-a', provider: 'wapi', config: { instance_key: 'k1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/wapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/wapi/webhook?instance=k1', {}, { instance_key: 'k1' }))
    expect(res.status).toBe(403)
    expect(processWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('rejects when token mismatches', async () => {
    resolveProviderByWApiKey.mockResolvedValue({
      id: 'p2', orgId: 'org-a', provider: 'wapi', config: { instance_key: 'k1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/wapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/wapi/webhook?instance=k1', { 'x-wapi-token': 'wrong' }, { instance_key: 'k1' }))
    expect(res.status).toBe(403)
    expect(processWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('rejects when no secret is configured on the provider', async () => {
    resolveProviderByWApiKey.mockResolvedValue({
      id: 'p2', orgId: 'org-a', provider: 'wapi', config: { instance_key: 'k1' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/wapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/wapi/webhook?instance=k1', { 'x-wapi-token': 'anything' }, { instance_key: 'k1' }))
    expect(res.status).toBe(403)
    expect(processWhatsAppMessageMock).not.toHaveBeenCalled()
  })

  it('accepts and processes when valid token is sent', async () => {
    resolveProviderByWApiKey.mockResolvedValue({
      id: 'p2', orgId: 'org-a', provider: 'wapi', config: { instance_key: 'k1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/wapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/wapi/webhook?instance=k1', { 'x-wapi-token': 'secret123' }, { instance_key: 'k1' }))
    expect(res.status).toBe(200)
    await flushAfter()
    expect(processWhatsAppMessageMock).toHaveBeenCalledTimes(1)
  })

  it('accepts the alternate X-W-API-Token header spelling', async () => {
    resolveProviderByWApiKey.mockResolvedValue({
      id: 'p2', orgId: 'org-a', provider: 'wapi', config: { instance_key: 'k1', token: 'secret123' }, webhookSecret: null,
    })
    const { POST } = await import('@/app/api/wapi/webhook/route')
    const res = await POST(jsonRequest('https://x/api/wapi/webhook?instance=k1', { 'x-w-api-token': 'secret123' }, { instance_key: 'k1' }))
    expect(res.status).toBe(200)
  })
})
