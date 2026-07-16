import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createClient, getUser } from '@/lib/supabase/server'
import { createEventType, updateEventType } from '@/app/(dashboard)/calendar/_actions/event-types'

const USER = { id: 'user-1' }

function makeQuery(result: { data: unknown; error: unknown }) {
  const q: any = {}
  const methods = ['select', 'eq', 'insert', 'update', 'order', 'or']
  for (const m of methods) q[m] = vi.fn(() => q)
  q.single = vi.fn(() => Promise.resolve(result))
  return q
}

function fakeClient(insertedRow: unknown) {
  return {
    rpc: vi.fn(async () => ({ data: 'org-1' })),
    from: vi.fn(() => makeQuery({ data: insertedRow, error: null })),
  }
}

const baseInput = {
  title: 'Consult',
  duration_minutes: 30,
  color: '#6366F1',
  location_type: 'video' as const,
  active: true,
  booking_type: 'personal' as const,
}

describe('createEventType — allowed_location_kinds (SYNC-04)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Test 1: persists allowed_location_kinds when every entry is in the reachable set', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    vi.mocked(createClient).mockResolvedValue(
      fakeClient({ id: 'et-1', allowed_location_kinds: ['custom_link', 'phone_call'] }) as any,
    )

    const result = await createEventType({
      ...baseInput,
      allowed_location_kinds: ['custom_link', 'phone_call'],
    })

    expect(result.ok).toBe(true)
  })

  it('Test 2: rejects a location kind outside the reachable set (e.g. zoom)', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    vi.mocked(createClient).mockResolvedValue(fakeClient({}) as any)

    const result = await createEventType({
      ...baseInput,
      allowed_location_kinds: ['zoom'] as any,
    })

    expect(result.ok).toBe(false)
  })

  it('Test 3: still accepts booking_type=round_robin on existing rows (D-02: data preserved, no migration)', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    vi.mocked(createClient).mockResolvedValue(
      fakeClient({ id: 'et-2', booking_type: 'round_robin' }) as any,
    )

    const result = await createEventType({ ...baseInput, booking_type: 'round_robin' })

    expect(result.ok).toBe(true)
  })
})

describe('updateEventType — validation (I5: previously updateEventType had zero schema validation)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Test 4: rejects a location kind outside the reachable set via updateEventType too, not just createEventType', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    vi.mocked(createClient).mockResolvedValue(fakeClient({}) as any)

    const result = await updateEventType('et-1', { allowed_location_kinds: ['zoom'] as any })

    expect(result.ok).toBe(false)
  })

  it('Test 5: still accepts a valid partial update (e.g. just title)', async () => {
    vi.mocked(getUser).mockResolvedValue(USER as any)
    vi.mocked(createClient).mockResolvedValue(
      fakeClient({ id: 'et-1', title: 'Renamed' }) as any,
    )

    const result = await updateEventType('et-1', { title: 'Renamed' })

    expect(result.ok).toBe(true)
  })
})
