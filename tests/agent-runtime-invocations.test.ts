// tests/agent-runtime-invocations.test.ts
// Unit tests for insertInvocationStart and updateInvocationEnd.
// D-34-03: two-phase write (status='running' at start → final status at end).
// D-34-15: cost computed via agent_model_pricing join; null if no pricing row.
// All Supabase calls mocked — no real DB hits.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock: Supabase service-role client
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  insertInvocationStart,
  updateInvocationEnd,
  type InvocationStartParams,
  type InvocationEndParams,
} from '@/lib/agent-runtime/invocations'

// ---------------------------------------------------------------------------
// Test helpers / fixture builders
// ---------------------------------------------------------------------------

const BASE_START_PARAMS: InvocationStartParams = {
  organizationId: 'org-invocation-test',
  agentId: 'agent-invocation-test',
  traceId: 'trace-inv-00000000-0000-0000-0000-000000000001',
  channel: 'web_widget',
  depth: 0,
  mode: 'production',
  userMessage: 'Hello, invocation test',
  model: 'anthropic/claude-sonnet-4-6',
}

function buildInsertMock(opts: {
  insertedId?: string | null
  insertError?: { message: string } | null
}) {
  const capturedInserts: Record<string, unknown>[] = []

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'agent_invocations') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            capturedInserts.push(payload)
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: opts.insertedId ? { id: opts.insertedId } : null,
                  error: opts.insertError ?? null,
                }),
              }),
            }
          }),
        }
      }
      return {}
    }),
  }

  vi.mocked(createServiceRoleClient).mockReturnValue(mockSupabase as never)
  return { mockSupabase, capturedInserts }
}

function buildUpdateMock(opts: {
  pricingRow?: { input_per_1m_usd: number; output_per_1m_usd: number } | null
  updateError?: { message: string } | null
}) {
  const capturedUpdates: Record<string, unknown>[] = []

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'agent_model_pricing') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.pricingRow ?? null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'agent_invocations') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdates.push(payload)
            return {
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: opts.updateError ?? null,
              }),
            }
          }),
        }
      }
      return {}
    }),
  }

  vi.mocked(createServiceRoleClient).mockReturnValue(mockSupabase as never)
  return { mockSupabase, capturedUpdates }
}

// ---------------------------------------------------------------------------
// insertInvocationStart tests (D-34-03)
// ---------------------------------------------------------------------------

describe('insertInvocationStart (D-34-03)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a row with status="running" (D-34-03 contract)', async () => {
    const { capturedInserts } = buildInsertMock({ insertedId: 'uuid-row-001' })

    await insertInvocationStart(BASE_START_PARAMS)

    expect(capturedInserts).toHaveLength(1)
    expect(capturedInserts[0]).toMatchObject({ status: 'running' })
  })

  it('inserts with the correct organization_id, agent_id, trace_id, channel, depth, mode', async () => {
    const { capturedInserts } = buildInsertMock({ insertedId: 'uuid-row-002' })

    await insertInvocationStart(BASE_START_PARAMS)

    const inserted = capturedInserts[0]
    expect(inserted.organization_id).toBe(BASE_START_PARAMS.organizationId)
    expect(inserted.agent_id).toBe(BASE_START_PARAMS.agentId)
    expect(inserted.trace_id).toBe(BASE_START_PARAMS.traceId)
    expect(inserted.channel).toBe(BASE_START_PARAMS.channel)
    expect(inserted.depth).toBe(BASE_START_PARAMS.depth)
    expect(inserted.mode).toBe(BASE_START_PARAMS.mode)
    expect(inserted.user_message).toBe(BASE_START_PARAMS.userMessage)
    expect(inserted.model).toBe(BASE_START_PARAMS.model)
  })

  it('returns the row UUID on success', async () => {
    buildInsertMock({ insertedId: 'uuid-success-row' })

    const result = await insertInvocationStart(BASE_START_PARAMS)

    expect(result).toBe('uuid-success-row')
  })

  it('returns "insert-failed" when Supabase errors (graceful degradation)', async () => {
    buildInsertMock({
      insertedId: null,
      insertError: { message: 'DB connection refused' },
    })

    const result = await insertInvocationStart(BASE_START_PARAMS)

    expect(result).toBe('insert-failed')
  })

  it('includes optional conversationId when provided', async () => {
    const { capturedInserts } = buildInsertMock({ insertedId: 'uuid-conv-row' })

    await insertInvocationStart({
      ...BASE_START_PARAMS,
      conversationId: 'conv-abc-123',
    })

    expect(capturedInserts[0].conversation_id).toBe('conv-abc-123')
  })

  it('does NOT include conversation_id key when conversationId is not provided', async () => {
    const { capturedInserts } = buildInsertMock({ insertedId: 'uuid-no-conv' })

    await insertInvocationStart(BASE_START_PARAMS)

    // Should not have the conversation_id key at all (optional spread pattern)
    expect(capturedInserts[0]).not.toHaveProperty('conversation_id')
  })
})

// ---------------------------------------------------------------------------
// updateInvocationEnd tests (D-34-03 + D-34-15)
// ---------------------------------------------------------------------------

describe('updateInvocationEnd (D-34-03 + D-34-15)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  const BASE_END_PARAMS: InvocationEndParams = {
    invocationId: 'uuid-update-test',
    agentId: 'agent-invocation-test',
    model: 'anthropic/claude-sonnet-4-6',
    status: 'success',
    assistantReply: 'Hello! I am the test agent.',
    tokensIn: 1000,
    tokensOut: 500,
    toolCallsJson: [],
    startedAt: Date.now() - 100, // 100ms ago
  }

  it('computes cost_usd correctly from pricing row (D-34-15)', async () => {
    const { capturedUpdates } = buildUpdateMock({
      pricingRow: {
        input_per_1m_usd: 3.00,   // $3 per 1M input tokens
        output_per_1m_usd: 15.00, // $15 per 1M output tokens
      },
    })

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      tokensIn: 1_000_000,  // 1M tokens in → $3
      tokensOut: 1_000_000, // 1M tokens out → $15
    })

    // Expected cost: (1M/1M * 3) + (1M/1M * 15) = $18
    expect(capturedUpdates[0].cost_usd).toBeCloseTo(18.00, 4)
  })

  it('sets cost_usd=null and continues when no pricing row found (D-34-15 graceful)', async () => {
    const { capturedUpdates } = buildUpdateMock({
      pricingRow: null,  // model not in agent_model_pricing
    })

    await updateInvocationEnd(BASE_END_PARAMS)

    expect(capturedUpdates[0].cost_usd).toBeNull()
    // Invocation still updates status, tokens, etc.
    expect(capturedUpdates[0].status).toBe('success')
  })

  it('sets duration_ms >= 0 (computed from startedAt)', async () => {
    const { capturedUpdates } = buildUpdateMock({
      pricingRow: { input_per_1m_usd: 3, output_per_1m_usd: 15 },
    })

    const startedAt = Date.now() - 200 // 200ms ago
    await updateInvocationEnd({ ...BASE_END_PARAMS, startedAt })

    expect(capturedUpdates[0].duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('updates with correct status, assistant_reply, tokens_in, tokens_out', async () => {
    const { capturedUpdates } = buildUpdateMock({
      pricingRow: { input_per_1m_usd: 3, output_per_1m_usd: 15 },
    })

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      status: 'error',
      assistantReply: 'Error fallback',
      tokensIn: 0,
      tokensOut: 0,
      errorDetail: 'no_llm_key',
    })

    const update = capturedUpdates[0]
    expect(update.status).toBe('error')
    expect(update.assistant_reply).toBe('Error fallback')
    expect(update.tokens_in).toBe(0)
    expect(update.tokens_out).toBe(0)
  })

  it('does NOT compute cost when tokensIn=0 AND tokensOut=0 (no LLM call made)', async () => {
    const { capturedUpdates } = buildUpdateMock({
      pricingRow: { input_per_1m_usd: 3, output_per_1m_usd: 15 },
    })

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      tokensIn: 0,
      tokensOut: 0,
    })

    // Should be null because no tokens were consumed
    expect(capturedUpdates[0].cost_usd).toBeNull()
  })

  it('includes error_detail in update when errorDetail is provided', async () => {
    const { capturedUpdates } = buildUpdateMock({ pricingRow: null })

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      errorDetail: 'turn_timeout',
    })

    expect(capturedUpdates[0].error_detail).toBe('turn_timeout')
  })

  it('does NOT include error_detail key when errorDetail is undefined', async () => {
    const { capturedUpdates } = buildUpdateMock({ pricingRow: null })

    await updateInvocationEnd({
      ...BASE_END_PARAMS,
      errorDetail: undefined,
    })

    expect(capturedUpdates[0]).not.toHaveProperty('error_detail')
  })
})
