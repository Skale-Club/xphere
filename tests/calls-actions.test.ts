import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted by Vitest, so these declarations run before any imports below.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

// calls/actions.ts does not call revalidatePath, but mock it defensively.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Import AFTER mock declarations.
import { createClient, getUser } from '@/lib/supabase/server'
import { getUnifiedCalls, getUnifiedCall } from '@/app/(dashboard)/calls/actions'

// ─── Test data fixtures ───────────────────────────────────────────────────────

const baseAiCall = {
  id: 'uuid-ai-1',
  call_type: 'ai' as const,
  org_id: 'org-uuid',
  external_id: 'vapi-call-id',
  counterpart_number: '+1234567890',
  counterpart_name: 'Test User',
  contact_id: null,
  direction: 'inbound' as const,
  duration_seconds: 120,
  status: 'ended',
  substatus: 'customer-ended-call',
  recording_url: null,
  recording_duration: null,
  transcript: 'Hello world',
  notes: 'Test summary',
  cost: 0.05,
  assistant_id: 'assistant-uuid',
  routing_mode: null,
  started_at: '2024-01-01T10:00:00Z',
  ended_at: '2024-01-01T10:02:00Z',
  created_at: '2024-01-01T10:00:00Z',
}

const baseHumanCall = {
  id: 'uuid-human-1',
  call_type: 'human' as const,
  org_id: 'org-uuid',
  external_id: 'CA1234567890',
  counterpart_number: '+0987654321',
  counterpart_name: null,
  contact_id: null,
  direction: 'outbound' as const,
  duration_seconds: 60,
  status: 'completed',
  substatus: null,
  recording_url: 'https://example.com/recording.mp3',
  recording_duration: 60,
  transcript: null,
  notes: null,
  cost: null,
  assistant_id: null,
  routing_mode: 'browser',
  started_at: '2024-01-01T11:00:00Z',
  ended_at: '2024-01-01T11:01:00Z',
  created_at: '2024-01-01T11:00:00Z',
}

// ─── Fake Supabase client builder ─────────────────────────────────────────────

interface FakeTableResult {
  data?: unknown
  count?: number | null
  error?: { message: string } | null
}

/**
 * Builds a fake Supabase client for testing getUnifiedCalls and getUnifiedCall.
 *
 * Each table gets its own chainable proxy. Every proxy method returns `this`
 * to support arbitrary chains. The proxy is also a thenable: awaiting it
 * resolves with the canned result for that table.
 *
 * Special case: maybeSingle() returns a Promise directly (not the proxy)
 * because the actions await it at the end of the chain.
 */
function buildFakeClient(responses: {
  unifiedCalls?: FakeTableResult
  contacts?: FakeTableResult
}) {
  const makeProxy = (result: FakeTableResult | undefined): any => {
    const resolved: FakeTableResult = result ?? { data: null, error: null }
    const proxy: any = {}
    const chainMethods = [
      'select',
      'order',
      'eq',
      'in',
      'or',
      'ilike',
      'gte',
      'lte',
      'range',
      'filter',
      'contains',
      'single',
    ]
    for (const m of chainMethods) {
      proxy[m] = vi.fn(() => proxy)
    }
    // maybeSingle must return a Promise (not proxy) because the actions do:
    //   const { data } = await supabase.from(...).select(...).eq(...).maybeSingle()
    proxy.maybeSingle = vi.fn(() => Promise.resolve(resolved))
    // Make the proxy thenable so `await proxy` resolves with the canned result.
    proxy.then = (resolve: (v: FakeTableResult) => void) =>
      Promise.resolve(resolved).then(resolve)
    return proxy
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'unified_calls') return makeProxy(responses.unifiedCalls)
      if (table === 'contacts') return makeProxy(responses.contacts)
      return makeProxy({ data: null, error: null })
    }),
  }
}

// ─── getUnifiedCalls tests ────────────────────────────────────────────────────

describe('getUnifiedCalls', () => {
  beforeEach(() => {
    vi.mocked(getUser).mockResolvedValue({ id: 'test-user-id' } as any)
  })

  it('Test 1: no filters returns rows array, total count, page and pageSize defaults', async () => {
    const fake = buildFakeClient({
      unifiedCalls: { data: [baseAiCall, baseHumanCall], count: 2, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCalls()

    expect(result.rows).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(20)
    expect(result.rows[0].contact).toBeNull()
  })

  it('Test 2: type="ai" filter — result rows are all call_type ai', async () => {
    const fake = buildFakeClient({
      unifiedCalls: { data: [baseAiCall], count: 1, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCalls({ type: 'ai' })

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every((r) => r.call_type === 'ai')).toBe(true)
  })

  it('Test 3: type="human" filter — result rows are all call_type human', async () => {
    const fake = buildFakeClient({
      unifiedCalls: { data: [baseHumanCall], count: 1, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCalls({ type: 'human' })

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every((r) => r.call_type === 'human')).toBe(true)
  })

  it('Test 4: direction="inbound" filter — result rows are all inbound', async () => {
    const inboundHumanCall = { ...baseHumanCall, direction: 'inbound' as const }
    const fake = buildFakeClient({
      unifiedCalls: { data: [baseAiCall, inboundHumanCall], count: 2, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCalls({ direction: 'inbound' })

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every((r) => r.direction === 'inbound')).toBe(true)
  })

  it('Test 7: Supabase error returns empty rows and total 0', async () => {
    const fake = buildFakeClient({
      unifiedCalls: { data: null, count: null, error: { message: 'DB error' } },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCalls()

    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
  })
})

// ─── getUnifiedCall tests ─────────────────────────────────────────────────────

describe('getUnifiedCall', () => {
  beforeEach(() => {
    vi.mocked(getUser).mockResolvedValue({ id: 'test-user-id' } as any)
  })

  it('Test 5: returns correct UnifiedCallWithContact shape for existing call (no contact_id)', async () => {
    const callData = {
      ...baseAiCall,
      id: 'test-uuid',
      contact_id: null,
    }
    const fake = buildFakeClient({
      unifiedCalls: { data: callData, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCall('test-uuid')

    expect(result).not.toBeNull()
    expect(result!.id).toBe('test-uuid')
    expect(result!.call_type).toBe('ai')
    expect(result!.contact).toBeNull()
  })

  it('Test 6: returns null when call not found (maybeSingle resolves data: null)', async () => {
    const fake = buildFakeClient({
      unifiedCalls: { data: null, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCall('nonexistent-id')

    expect(result).toBeNull()
  })

  it('Test 8: enriches contact when contact_id is present', async () => {
    const callWithContact = {
      ...baseHumanCall,
      id: 'call-uuid',
      contact_id: 'contact-uuid',
    }
    const contactData = {
      id: 'contact-uuid',
      name: 'Jane Doe',
      phone: '+5511999999999',
      email: 'jane@example.com',
    }
    const fake = buildFakeClient({
      unifiedCalls: { data: callWithContact, error: null },
      contacts: { data: contactData, error: null },
    })
    vi.mocked(createClient).mockResolvedValue(fake as any)

    const result = await getUnifiedCall('call-uuid')

    expect(result).not.toBeNull()
    expect(result!.contact).not.toBeNull()
    expect(result!.contact!.name).toBe('Jane Doe')
    expect(result!.contact!.id).toBe('contact-uuid')
  })
})

// ─── Legacy getCalls — todo stubs (out of scope for phase 85) ────────────────

describe('getCalls: pagination (OBS-02)', () => {
  it.todo('returns calls array and total count')
  it.todo('applies LIMIT 20 and correct OFFSET for page 1')
  it.todo('applies LIMIT 20 and correct OFFSET for page 2')
  it.todo('orders results by created_at descending')
})

describe('getCalls: filters (OBS-03)', () => {
  it.todo('filters by from date using gte on started_at')
  it.todo('filters by to date using lte on started_at')
  it.todo('filters by status (ended_reason equality match)')
  it.todo('filters by assistantId equality on assistant_id column')
  it.todo('filters by callType equality on call_type column')
  it.todo('applies multiple filters simultaneously')
})

describe('getCalls: search (OBS-04)', () => {
  it.todo('filters by q param using ILIKE on customer_number')
  it.todo('filters by q param using ILIKE on customer_name')
  it.todo('returns empty array when q matches nothing')
})
