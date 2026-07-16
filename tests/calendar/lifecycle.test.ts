// Phase 127 (LIFE-01, LIFE-02) — unit coverage for the canonical, RPC-backed
// booking lifecycle service in src/lib/calendar/transition.ts.
//
// Covers, for every guarded transition (confirmBooking/cancelBooking/
// markNoShow/markShowed):
//   - a real transition emits exactly one matching calendar event
//   - an idempotent no-op (RPC returns transitioned:false) never re-emits
//   - illegal_transition / booking_not_found RPC errors are surfaced typed,
//     never emit
//   - the RPC is invoked with the exact expected args (org-scoped, always
//     p_allowed_from: ['confirmed'])
// Plus confirmBooking's best-effort Google Meet link branch, and
// rescheduleBooking's separate SELECT + guarded UPDATE path (does not use
// the RPC — status is unchanged by a reschedule).
//
// Emission is asserted indirectly through the observable side effects of
// emitCalendarEvent (the `event_dispatches` insert payload + whether the
// `workflows` table was ever queried) rather than by spying on
// emitCalendarEvent directly — it is a same-module function, and internal
// same-module calls are not interceptable via vi.mock/vi.spyOn.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/workflows/run-flow-sync', () => ({
  runFlowSync: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/flows/engine', () => ({
  runFlow: vi.fn().mockResolvedValue({ ok: true }),
  definitionHasWait: vi.fn().mockReturnValue(false),
  resumeRun: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/calendar/scope', () => ({
  buildMeetingScope: vi.fn().mockResolvedValue({ id: 'book-1', attendee_contact: null }),
}))

vi.mock('@/lib/calendar/google-calendar', () => ({
  createMeetingLink: vi.fn(),
}))

import {
  confirmBooking,
  cancelBooking,
  markNoShow,
  markShowed,
  rescheduleBooking,
} from '@/lib/calendar/transition'
import { createMeetingLink } from '@/lib/calendar/google-calendar'

// ─── Fake Supabase chain factory ───────────────────────────────────────────

interface ChainResult {
  data: unknown
  error: unknown
}

function makeChain(terminalResult: ChainResult, onInsert?: (payload: unknown) => void) {
  const resolved = Promise.resolve(terminalResult)
  const chain: Record<string, unknown> = {
    insert: vi.fn((payload: unknown) => {
      onInsert?.(payload)
      return chain
    }),
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    contains: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(terminalResult),
    maybeSingle: vi.fn().mockResolvedValue(terminalResult),
    then: resolved.then.bind(resolved),
  }
  return chain
}

function makeSupabase() {
  const state = {
    rpcImpl: vi.fn(),
    bookingsQueue: [] as ChainResult[],
    eventTypesQueue: [] as ChainResult[],
    workflowsResponse: { data: [] as unknown[], error: null as unknown } as ChainResult,
    eventDispatchInserts: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
  }

  const supabase = {
    rpc: state.rpcImpl,
    from: vi.fn((table: string) => {
      state.fromCalls.push(table)
      if (table === 'bookings') {
        return makeChain(state.bookingsQueue.shift() ?? { data: null, error: null })
      }
      if (table === 'event_types') {
        return makeChain(state.eventTypesQueue.shift() ?? { data: null, error: null })
      }
      if (table === 'workflows') {
        return makeChain(state.workflowsResponse)
      }
      if (table === 'event_dispatches') {
        return makeChain({ data: { id: 'dispatch-1' }, error: null }, (payload) => {
          state.eventDispatchInserts.push(payload as Record<string, unknown>)
        })
      }
      return makeChain({ data: null, error: null })
    }),
  }

  return { supabase, state }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('calendar lifecycle transitions (LIFE-01, LIFE-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe.each([
    {
      label: 'confirmBooking',
      fn: confirmBooking,
      target: 'confirmed',
      event: 'meeting.confirmed',
      touchesBookingsAfterRpc: true,
    },
    {
      label: 'cancelBooking',
      fn: cancelBooking,
      target: 'cancelled',
      event: 'meeting.cancelled',
      touchesBookingsAfterRpc: false,
    },
    {
      label: 'markNoShow',
      fn: markNoShow,
      target: 'no_show',
      event: 'meeting.no_show',
      touchesBookingsAfterRpc: false,
    },
    {
      label: 'markShowed',
      fn: markShowed,
      target: 'showed',
      event: 'meeting.completed',
      touchesBookingsAfterRpc: false,
    },
  ])('$label', ({ fn, target, event, touchesBookingsAfterRpc }) => {
    const bookingId = 'book-1'
    const orgId = 'org-1'

    it('real transition (transitioned:true) returns ok:true and emits exactly one matching event', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: { transitioned: true, old_status: 'confirmed', new_status: target },
        error: null,
      })
      if (touchesBookingsAfterRpc) {
        state.bookingsQueue.push({
          data: {
            location_kind: 'in_person',
            event_type_id: 'et-1',
            start_at: '2026-01-01T10:00:00Z',
            end_at: '2026-01-01T10:30:00Z',
            booker_email: 'a@b.com',
            meeting_url: null,
          },
          error: null,
        })
      }

      const result = await fn({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: true })
      expect(state.eventDispatchInserts).toHaveLength(1)
      expect(state.eventDispatchInserts[0]).toMatchObject({
        event_type: event,
        source_id: bookingId,
        org_id: orgId,
      })
    })

    it('idempotent no-op (transitioned:false) returns ok:true and never emits', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: { transitioned: false, old_status: target, new_status: target },
        error: null,
      })

      const result = await fn({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: true })
      expect(state.eventDispatchInserts).toHaveLength(0)
      expect(state.fromCalls).not.toContain('workflows')
    })

    it('illegal_transition RPC error returns ok:false and never emits', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: null,
        error: { message: `illegal_transition: cannot go from cancelled to ${target}` },
      })

      const result = await fn({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: false, error: 'illegal_transition' })
      expect(state.eventDispatchInserts).toHaveLength(0)
    })

    it('booking_not_found RPC error returns ok:false and never emits', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: null,
        error: { message: 'booking_not_found' },
      })

      const result = await fn({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: false, error: 'booking_not_found' })
      expect(state.eventDispatchInserts).toHaveLength(0)
    })

    it('calls the RPC with the exact expected args (org-scoped, allowed_from confirmed)', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: { transitioned: false, old_status: target, new_status: target },
        error: null,
      })

      await fn({ supabase } as any, bookingId, orgId)

      expect(state.rpcImpl).toHaveBeenCalledWith('transition_booking_status', {
        p_booking_id: bookingId,
        p_org_id: orgId,
        p_new_status: target,
        p_allowed_from: ['confirmed'],
      })
    })
  })

  describe('confirmBooking — Google Meet link creation (best-effort, non-fatal)', () => {
    const bookingId = 'book-1'
    const orgId = 'org-1'

    it('attempts Meet link creation when location_kind is google_meet with no existing meeting_url, and still emits on success', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: { transitioned: true, old_status: 'confirmed', new_status: 'confirmed' },
        error: null,
      })
      state.bookingsQueue.push({
        data: {
          location_kind: 'google_meet',
          event_type_id: 'et-1',
          start_at: '2026-01-01T10:00:00Z',
          end_at: '2026-01-01T10:30:00Z',
          booker_email: 'a@b.com',
          meeting_url: null,
        },
        error: null,
      })
      state.eventTypesQueue.push({ data: { title: 'Consult' }, error: null })
      vi.mocked(createMeetingLink).mockResolvedValueOnce({
        meeting_url: 'https://meet.google.com/xyz',
        google_event_id: 'gcal-1',
      })

      const result = await confirmBooking({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: true })
      expect(createMeetingLink).toHaveBeenCalledWith(orgId, expect.objectContaining({ title: 'Consult' }))
      expect(state.eventDispatchInserts).toHaveLength(1)
      expect(state.eventDispatchInserts[0]).toMatchObject({ event_type: 'meeting.confirmed' })
    })

    it('still emits meeting.confirmed even when Meet link creation rejects (non-fatal)', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: { transitioned: true, old_status: 'confirmed', new_status: 'confirmed' },
        error: null,
      })
      state.bookingsQueue.push({
        data: {
          location_kind: 'google_meet',
          event_type_id: 'et-1',
          start_at: '2026-01-01T10:00:00Z',
          end_at: '2026-01-01T10:30:00Z',
          booker_email: 'a@b.com',
          meeting_url: null,
        },
        error: null,
      })
      state.eventTypesQueue.push({ data: { title: 'Consult' }, error: null })
      vi.mocked(createMeetingLink).mockRejectedValueOnce(new Error('google api down'))

      const result = await confirmBooking({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: true })
      expect(createMeetingLink).toHaveBeenCalled()
      expect(state.eventDispatchInserts).toHaveLength(1)
    })

    it('does not attempt Meet link creation when location_kind is not google_meet, still emits', async () => {
      const { supabase, state } = makeSupabase()
      state.rpcImpl.mockResolvedValue({
        data: { transitioned: true, old_status: 'confirmed', new_status: 'confirmed' },
        error: null,
      })
      state.bookingsQueue.push({
        data: {
          location_kind: 'in_person',
          event_type_id: 'et-1',
          start_at: '2026-01-01T10:00:00Z',
          end_at: '2026-01-01T10:30:00Z',
          booker_email: 'a@b.com',
          meeting_url: null,
        },
        error: null,
      })

      const result = await confirmBooking({ supabase } as any, bookingId, orgId)

      expect(result).toEqual({ ok: true })
      expect(createMeetingLink).not.toHaveBeenCalled()
      expect(state.eventDispatchInserts).toHaveLength(1)
    })
  })

  describe('rescheduleBooking (SELECT + guarded UPDATE, no RPC — reschedule does not change status)', () => {
    const bookingId = 'book-1'
    const orgId = 'org-1'
    const newStartAt = '2026-02-01T10:00:00Z'
    const newEndAt = '2026-02-01T10:30:00Z'

    it('updates start_at/end_at and emits meeting.rescheduled with correct from/to when booking is confirmed and org matches', async () => {
      const { supabase, state } = makeSupabase()
      const oldStart = '2026-01-01T10:00:00Z'
      state.bookingsQueue.push({
        data: { id: bookingId, org_id: orgId, status: 'confirmed', start_at: oldStart },
        error: null,
      })
      state.bookingsQueue.push({ data: { id: bookingId }, error: null })

      const result = await rescheduleBooking({ supabase } as any, bookingId, orgId, newStartAt, newEndAt)

      expect(result).toEqual({ ok: true })
      expect(state.eventDispatchInserts).toHaveLength(1)
      expect(state.eventDispatchInserts[0]).toMatchObject({
        event_type: 'meeting.rescheduled',
        source_id: bookingId,
        org_id: orgId,
        payload: expect.objectContaining({
          rescheduled_from: oldStart,
          rescheduled_to: newStartAt,
        }),
      })
    })

    it('returns booking_not_found and never emits or attempts UPDATE when org_id does not match', async () => {
      const { supabase, state } = makeSupabase()
      state.bookingsQueue.push({
        data: { id: bookingId, org_id: 'other-org', status: 'confirmed', start_at: '2026-01-01T10:00:00Z' },
        error: null,
      })

      const result = await rescheduleBooking({ supabase } as any, bookingId, orgId, newStartAt, newEndAt)

      expect(result).toEqual({ ok: false, error: 'booking_not_found' })
      expect(state.eventDispatchInserts).toHaveLength(0)
      expect(state.fromCalls.filter((t) => t === 'bookings')).toHaveLength(1)
    })

    it('returns illegal_transition and never emits when booking status is not confirmed', async () => {
      const { supabase, state } = makeSupabase()
      state.bookingsQueue.push({
        data: { id: bookingId, org_id: orgId, status: 'cancelled', start_at: '2026-01-01T10:00:00Z' },
        error: null,
      })

      const result = await rescheduleBooking({ supabase } as any, bookingId, orgId, newStartAt, newEndAt)

      expect(result).toEqual({ ok: false, error: 'illegal_transition' })
      expect(state.eventDispatchInserts).toHaveLength(0)
    })

    it('returns illegal_transition and never emits when the guarded UPDATE affects no row (concurrent status change)', async () => {
      const { supabase, state } = makeSupabase()
      state.bookingsQueue.push({
        data: { id: bookingId, org_id: orgId, status: 'confirmed', start_at: '2026-01-01T10:00:00Z' },
        error: null,
      })
      state.bookingsQueue.push({ data: null, error: null })

      const result = await rescheduleBooking({ supabase } as any, bookingId, orgId, newStartAt, newEndAt)

      expect(result).toEqual({ ok: false, error: 'illegal_transition' })
      expect(state.eventDispatchInserts).toHaveLength(0)
    })
  })
})
