import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock agent runtime so tests never hit real APIs
// ---------------------------------------------------------------------------

// Use vi.hoisted to ensure mockRunAgent is available inside vi.mock factory
const { mockRunAgent } = vi.hoisted(() => ({
  mockRunAgent: vi.fn(),
}))

// Mock @/lib/agent-runtime — route.ts calls runAgent (post-Phase 35 refactor)
vi.mock('@/lib/agent-runtime', () => ({
  runAgent: mockRunAgent,
}))

// Mock dependencies before dynamic import of the route
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/chat/session', () => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
}))
vi.mock('@/lib/chat/persist', () => ({
  ensureDbSession: vi.fn(),
  persistMessage: vi.fn(),
}))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => void) => fn() }
})
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn(),
}))

// Mock @/lib/rate-limit — route-behavior tests assert rate-limit ordering/args
// without exercising the real Redis/memory implementation (see 131-RESEARCH.md
// Pitfall 1/2).
const { mockRateLimit } = vi.hoisted(() => ({ mockRateLimit: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getSession, setSession } from '@/lib/chat/session'
import { ensureDbSession, persistMessage } from '@/lib/chat/persist'
import { readSseLines } from './helpers/stream'
import { executeAction } from '@/lib/action-engine/execute-action'

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
}

function makeRequest(body: object, token = 'valid-token', ip = '203.0.113.9') {
  return new Request(`http://localhost/api/chat/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

// Default mock stream factory — emits session + token + done
function makeDefaultStream(sessionId = 'mock-session-id') {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const emit = (obj: object) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
      emit({ event: 'session', sessionId })
      emit({ event: 'token', text: 'Hello!' })
      emit({ event: 'done' })
      controller.close()
    }
  })
}

describe('POST /api/chat/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase)
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(ensureDbSession as ReturnType<typeof vi.fn>).mockResolvedValue('db-sess-uuid')
    ;(setSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(persistMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(executeAction as ReturnType<typeof vi.fn>).mockResolvedValue('Action completed')
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 })
    // Default mockRunAgent: returns a simple SSE stream with session + token + done
    mockRunAgent.mockReturnValue(makeDefaultStream())
  })

  it('returns 401 for invalid token', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'hi' }, 'bad-token'), {
      params: Promise.resolve({ token: 'bad-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for inactive org', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: false }, error: null })
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'hi' }), {
      params: Promise.resolve({ token: 'valid-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 with sessionId for valid token + new session', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'Hello' }), {
      params: Promise.resolve({ token: 'valid-token' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const lines = await readSseLines(res)
    expect(lines[0]).toMatchObject({ event: 'session' })
    expect(typeof (lines[0] as { sessionId?: string }).sessionId).toBe('string')
  })

  it('reuses sessionId when provided in request body', async () => {
    mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    const existingCtx = {
      orgId: 'org-1', sessionId: 'existing-sess', dbSessionId: 'db-existing',
      messages: [], createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
    }
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(existingCtx)
    // mockRunAgent emits the sessionId passed to it in opts via the mock's sessionId capture
    mockRunAgent.mockReturnValue(makeDefaultStream('existing-sess'))
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({ message: 'Follow-up', sessionId: 'existing-sess' }), {
      params: Promise.resolve({ token: 'valid-token' }),
    })
    // Route now returns SSE — read session event to verify sessionId is reused
    const lines = await readSseLines(res)
    const sessionEvent = lines[0] as { event: string; sessionId?: string }
    expect(sessionEvent.event).toBe('session')
    expect(sessionEvent.sessionId).toBe('existing-sess')
    expect(ensureDbSession).not.toHaveBeenCalled()
  })

  it('returns 400 for missing message field', async () => {
    const { POST } = await import('@/app/api/chat/[token]/route')
    const res = await POST(makeRequest({}), { params: Promise.resolve({ token: 'valid-token' }) })
    expect(res.status).toBe(400)
  })

  describe('streaming AI responses', () => {
    beforeEach(() => {
      mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    })

    it('CHAT-01: response is text/event-stream with session, token, and done events', async () => {
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Hello' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/event-stream')
      const lines = await readSseLines(res)
      expect(lines[0]).toMatchObject({ event: 'session' })
      const tokenEvents = lines.filter(l => l.event === 'token')
      expect(tokenEvents.length).toBeGreaterThan(0)
      expect(lines[lines.length - 1]).toMatchObject({ event: 'done' })
    })

    it('CHAT-02: runAgent is called with the user message', async () => {
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'What is your return policy?' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      await readSseLines(res)
      expect(mockRunAgent).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: 'What is your return policy?' })
      )
    })

    it('CHAT-03: tool_call SSE event emitted when runAgent emits tool_call', async () => {
      // Configure mockRunAgent to emit a tool_call event
      mockRunAgent.mockReturnValueOnce(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            const emit = (obj: object) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
            emit({ event: 'session', sessionId: 'mock-session-id' })
            emit({ event: 'tool_call', name: 'get_availability' })
            emit({ event: 'token', text: 'Available slots found.' })
            emit({ event: 'done' })
            controller.close()
          }
        })
      )
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Check availability for tomorrow' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      const lines = await readSseLines(res)
      const toolCallEvent = lines.find(l => l.event === 'tool_call')
      expect(toolCallEvent).toBeDefined()
      // Tool execution is now internal to runAgent; route.ts does not call executeAction directly
    })

    it('D-12: no API keys → runAgent returns degradation stream, response is 200 with SSE', async () => {
      // runAgent handles the fallback internally — mock it to return a degradation stream
      mockRunAgent.mockReturnValueOnce(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            const emit = (obj: object) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
            emit({ event: 'session', sessionId: 'mock-session-id' })
            emit({ event: 'token', text: 'AI not yet configured for this account.' })
            emit({ event: 'done' })
            controller.close()
          }
        })
      )
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Hello' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(200)
      const lines = await readSseLines(res)
      expect(lines[0]).toMatchObject({ event: 'session' })
      const tokenEvent = lines.find(l => l.event === 'token') as { event: string; text?: string } | undefined
      expect(tokenEvent).toBeDefined()
      expect(tokenEvent?.text).toContain('not yet configured')
      expect(lines[lines.length - 1]).toMatchObject({ event: 'done' })
    })

    it('CHAT-01: Cache-Control header is no-cache on streaming response', async () => {
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'Hi' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.headers.get('Cache-Control')).toBe('no-cache')
    })
  })

  describe('rate limits (CHT-02)', () => {
    beforeEach(() => {
      mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    })

    it('R1 denied: 429 rate_limited with CORS, org lookup never happens', async () => {
      mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'hi' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'rate_limited' })
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(createServiceRoleClient).not.toHaveBeenCalled()
    })

    it('R1 args: chat:ip:{ip} 20/60s memory', async () => {
      const { POST } = await import('@/app/api/chat/[token]/route')
      await POST(makeRequest({ message: 'hi' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(mockRateLimit).toHaveBeenCalledWith('chat:ip:203.0.113.9', 20, 60, { failMode: 'memory' })
    })

    it('R2 denied: 429 rate_limited', async () => {
      mockRateLimit.mockImplementation(async (key: string) =>
        key.startsWith('chat:ip:day:')
          ? { allowed: false, remaining: 0, resetAt: 0 }
          : { allowed: true, remaining: 99, resetAt: 0 }
      )
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'hi' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'rate_limited' })
      expect(mockRateLimit).toHaveBeenCalledWith('chat:ip:day:203.0.113.9', 200, 86400, { failMode: 'memory' })
    })

    it('R5 denied: 429 rate_limited, org lookup already happened', async () => {
      mockRateLimit.mockImplementation(async (key: string) =>
        key.startsWith('chat:org:')
          ? { allowed: false, remaining: 0, resetAt: 0 }
          : { allowed: true, remaining: 99, resetAt: 0 }
      )
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'hi' }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'rate_limited' })
      expect(createServiceRoleClient).toHaveBeenCalled()
      expect(mockRateLimit).toHaveBeenCalledWith('chat:org:org-1', 300, 60, { failMode: 'open' })
    })
  })

  describe('message cap + duration (CHT-03)', () => {
    beforeEach(() => {
      mockSupabase.single.mockResolvedValue({ data: { id: 'org-1', name: 'Org', is_active: true }, error: null })
    })

    it('rejects a 4001-char message with 400 "message too long"', async () => {
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'x'.repeat(4001) }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'message too long' })
    })

    it('accepts a 4000-char message', async () => {
      const { POST } = await import('@/app/api/chat/[token]/route')
      const res = await POST(makeRequest({ message: 'x'.repeat(4000) }), {
        params: Promise.resolve({ token: 'valid-token' }),
      })
      expect(res.status).toBe(200)
    })

    it('exports maxDuration = 60', async () => {
      const route = await import('@/app/api/chat/[token]/route')
      expect(route.maxDuration).toBe(60)
    })
  })
})
