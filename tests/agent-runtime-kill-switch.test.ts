// tests/agent-runtime-kill-switch.test.ts
// GATE-03: kill switch flip must make runAgent() return within 1s with status='skipped'.
// Phase 34 D-34-08: GATE-03 kill switch subset only (rate limiting is Vercel edge layer).

import { describe, it, expect, vi, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — kill switch must fire before ANY DB writes or LLM calls
// ---------------------------------------------------------------------------

vi.mock('@/lib/agent-runtime/invocations', () => ({
  insertInvocationStart: vi.fn(),
  updateInvocationEnd: vi.fn(),
}))

vi.mock('@/lib/agent-runtime/resolve-agent', () => ({
  resolveAgent: vi.fn(),
}))

// Build a minimal chainable Supabase mock for tests where the pipeline proceeds past kill switch
function buildPassthroughSupabaseMock() {
  const chainable: Record<string, () => unknown> = {}
  const make = (): unknown => new Proxy(chainable, {
    get: () => () => make(),
    apply: () => Promise.resolve({ data: null, error: null }),
  })
  return {
    from: () => make(),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => buildPassthroughSupabaseMock()),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { runAgent } from '@/lib/agent-runtime'
import { insertInvocationStart } from '@/lib/agent-runtime/invocations'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_OPTS = {
  orgId: 'org-kill-switch-test',
  agentId: 'agent-kill-switch-test',
  channel: 'web_widget' as const,
  userMessage: 'hello kill switch test',
}

// A minimal ResolvedAgent stub for the ENABLED=true path
const MOCK_RESOLVED_AGENT = {
  agentId: TEST_OPTS.agentId,
  orgId: TEST_OPTS.orgId,
  name: 'Test Agent',
  systemPrompt: 'You are a test agent.',
  model: 'anthropic/claude-sonnet-4-6',
  temperature: undefined,
  maxTokens: 1024,
  maxHistory: 20,
  fallbackMessage: "I can't help right now.",
  allowedChannels: ['web_widget'] as const,
  isActive: true,
  kbScope: null,
}

// ---------------------------------------------------------------------------
// GATE-03 Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  delete process.env.AGENT_RUNTIME_ENABLED
  vi.clearAllMocks()
})

describe('GATE-03: kill switch', () => {
  it('returns status=skipped within 1s when AGENT_RUNTIME_ENABLED=false', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'false'

    const start = Date.now()
    const result = await runAgent(TEST_OPTS)
    const elapsed = Date.now() - start

    // GATE-03: must return within 1s (kill switch fires before any IO)
    expect(elapsed).toBeLessThan(1000)

    // Status assertion
    expect(result.status).toBe('skipped')
    expect(result.text).toBe('Service temporarily unavailable')

    // Kill switch must fire before any DB writes
    expect(insertInvocationStart).not.toHaveBeenCalled()
  })

  it('returns result with non-empty traceId even when kill switch is active', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'false'

    const result = await runAgent(TEST_OPTS)

    // traceId is generated before kill switch check — must be present
    expect(result.traceId).toBeTruthy()
    expect(result.traceId.length).toBeGreaterThan(0)
  })

  it('returns invocationId="" (no DB row written) when kill switch is active', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'false'

    const result = await runAgent(TEST_OPTS)

    // No invocation row written for a skipped call
    expect(result.invocationId).toBe('')
  })

  it('proceeds normally when AGENT_RUNTIME_ENABLED=true — resolveAgent returns null → status=error', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'true'
    // resolveAgent returns null → runAgent treats it as agent_not_found → status='error'
    // Kill switch does NOT fire — result.status must be 'error', never 'skipped'
    vi.mocked(resolveAgent).mockResolvedValue(null)

    const result = await runAgent(TEST_OPTS)

    // Kill switch did NOT fire
    expect(result.status).toBe('error')
    expect(result.status).not.toBe('skipped')
    expect(result.errorDetail).toBe('agent_not_found')
  })

  it('ENABLED=true → resolveAgent IS called (kill switch does not short-circuit)', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'true'
    // Return null → runAgent returns 'error' quickly (no LLM calls, no timeouts)
    vi.mocked(resolveAgent).mockResolvedValue(null)

    await runAgent(TEST_OPTS)

    // resolveAgent was called — kill switch did not stop execution before agent resolution
    expect(resolveAgent).toHaveBeenCalledWith(TEST_OPTS.agentId, TEST_OPTS.orgId, TEST_OPTS.channel)
  })

  it('ENABLED=false → resolveAgent is NOT called (kill switch short-circuits)', async () => {
    process.env.AGENT_RUNTIME_ENABLED = 'false'

    await runAgent(TEST_OPTS)

    // Kill switch fires before resolveAgent
    expect(resolveAgent).not.toHaveBeenCalled()
  })
})
