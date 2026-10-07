// /api/mcp must answer clients that don't advertise text/event-stream. The
// server only replies with JSON, so a strict 406 just broke credential probes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/mcp/auth', () => ({
  authenticateMcpRequest: vi.fn(),
  writeMcpAuditLog: vi.fn(),
}))

import { authenticateMcpRequest } from '@/lib/mcp/auth'
import { POST } from '@/app/api/mcp/route'

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
})

function post(accept: string | null, auth = 'Bearer xph_test') {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: auth }
  if (accept !== null) headers.accept = accept
  return new Request('https://xphere.app/api/mcp', { method: 'POST', headers, body: INIT })
}

describe('POST /api/mcp Accept handling', () => {
  beforeEach(() => {
    vi.mocked(authenticateMcpRequest).mockResolvedValue({
      kind: 'legacy_token',
      orgId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      actor: 'mcp:xph_test',
      scope: 'mcp:all',
    })
  })

  it.each([
    ['both types', 'application/json, text/event-stream'],
    ['json only', 'application/json'],
    ['wildcard', '*/*'],
    ['no header', null],
  ])('initializes with Accept: %s', async (_label, accept) => {
    const res = await POST(post(accept))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe('xphere-mcp')
  })

  it('still rejects a missing credential with 401', async () => {
    vi.mocked(authenticateMcpRequest).mockResolvedValue(null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const res = await POST(post('application/json', ''))
    expect(res.status).toBe(401)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[mcp] POST 401 rpc=initialize'))
    warn.mockRestore()
  })
})
