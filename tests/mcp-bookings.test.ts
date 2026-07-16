// tests/mcp-bookings.test.ts
// CAL-01: bookings_create MCP tool must validate identically to the public
// booking flow via resolveAndValidateSlot — never trust a client-supplied
// end_at, never insert on a rejected slot.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/calendar/booking-validation', () => ({ resolveAndValidateSlot: vi.fn() }))
vi.mock('@/lib/calendar/transition', () => ({
  emitCalendarEvent: vi.fn(async () => ({ dispatched: 0, dispatch_id: null })),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveAndValidateSlot } from '@/lib/calendar/booking-validation'
import { bookingsTools } from '@/lib/mcp/tools/bookings'
import type { McpAuthContext } from '@/lib/mcp/auth'

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const auth: McpAuthContext = { kind: 'oauth', orgId: ORG_ID, userId: 'user-1', actor: 'oauth:client:user-1', scope: 'mcp:all' }

const tool = bookingsTools.find((t) => t.name === 'bookings_create')!

const baseInput = {
  event_type_id: '00000000-0000-0000-0000-000000000222',
  start_at: '2099-01-01T15:00:00.000Z',
  end_at: '2099-01-01T23:59:00.000Z', // deliberately wrong — must be ignored
  booker_name: 'Test Booker',
  booker_email: 'booker@example.com',
  contact_id: '00000000-0000-0000-0000-000000000999',
}

function buildFakeAdmin(insertResult: { data: unknown; error: unknown }) {
  const insertedPayloads: Record<string, unknown>[] = []
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedPayloads.push(payload)
            return { select: vi.fn(() => ({ single: vi.fn(async () => insertResult) })) }
          }),
        }
      }
      throw new Error(`unexpected table in this test: ${table}`)
    }),
  }
  return { admin, insertedPayloads }
}

describe('bookings_create MCP tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects with the resolveAndValidateSlot error + never inserts (event_type_not_found)', async () => {
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({ ok: false, error: 'event_type_not_found' })
    const { admin, insertedPayloads } = buildFakeAdmin({ data: null, error: null })
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const result = await tool.handler(baseInput, { auth })
    expect(result).toEqual({ error: 'event_type_not_found', status: 404 })
    expect(insertedPayloads).toHaveLength(0)
  })

  it('rejects with outside_availability / 409', async () => {
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({ ok: false, error: 'outside_availability' })
    const { admin } = buildFakeAdmin({ data: null, error: null })
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const result = await tool.handler(baseInput, { auth })
    expect(result).toEqual({ error: 'outside_availability', status: 409 })
  })

  it('rejects with slot_taken / 409', async () => {
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({ ok: false, error: 'slot_taken' })
    const { admin } = buildFakeAdmin({ data: null, error: null })
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const result = await tool.handler(baseInput, { auth })
    expect(result).toEqual({ error: 'slot_taken', status: 409 })
  })

  it('ignores client-supplied end_at and inserts the server-resolved interval', async () => {
    const resolvedEndAt = new Date('2099-01-01T15:30:00.000Z')
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({
      ok: true,
      data: {
        eventType: {
          id: baseInput.event_type_id, org_id: ORG_ID, user_id: 'host-1', title: 'Discovery',
          duration_minutes: 30, location_type: 'video', location_value: null, allowed_location_kinds: ['video'],
        },
        startAt: new Date('2099-01-01T15:00:00.000Z'),
        endAt: resolvedEndAt,
        hostTimezone: 'UTC',
      },
    })
    const { admin, insertedPayloads } = buildFakeAdmin({ data: { id: 'booking-1' }, error: null })
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    await tool.handler(baseInput, { auth })

    expect(insertedPayloads).toHaveLength(1)
    expect(insertedPayloads[0].end_at).toBe(resolvedEndAt.toISOString())
    expect(insertedPayloads[0].end_at).not.toBe(baseInput.end_at)
    expect(insertedPayloads[0].linked_contact_id).toBe(baseInput.contact_id)
  })
})
