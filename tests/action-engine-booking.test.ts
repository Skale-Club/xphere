// Phase 127 (LIFE-01/LIFE-03): coverage for the wait-free action-engine's
// booking-lifecycle adapter (src/lib/action-engine/executors/booking-lifecycle-actions.ts),
// its registration in execute-action.ts's dispatcher, and the fixed
// update_booking_status executor (src/lib/action-engine/executors/update-booking-status.ts).
//
// All five booking_* action types and update_booking_status route through the
// canonical, RPC-backed transition service (src/lib/calendar/transition.ts,
// Plan 127-01) -- mocked here so these tests exercise only the adapters'
// param-validation, dispatch, and error-translation behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

vi.mock('@/lib/calendar/transition', () => ({
  confirmBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markNoShow: vi.fn(),
  markShowed: vi.fn(),
  rescheduleBooking: vi.fn(),
}))

import {
  confirmBooking,
  cancelBooking,
  markNoShow,
  markShowed,
  rescheduleBooking,
} from '@/lib/calendar/transition'

import {
  executeBookingConfirmAction,
  executeBookingCancelAction,
  executeBookingRescheduleAction,
  executeBookingMarkNoShowAction,
  executeBookingMarkCompleteAction,
} from '@/lib/action-engine/executors/booking-lifecycle-actions'

import { executeUpdateBookingStatus } from '@/lib/action-engine/executors/update-booking-status'

import { executeAction, type ActionContext } from '@/lib/action-engine/execute-action'
import type { GhlCredentials } from '@/lib/ghl/client'

const supabase = {} as SupabaseClient<Database>

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- Task 1: booking-lifecycle-actions.ts adapter ----

describe('booking-lifecycle-actions adapter', () => {
  const cases = [
    {
      label: 'executeBookingConfirmAction',
      fn: executeBookingConfirmAction,
      transitionFn: confirmBooking,
      actionName: 'booking_confirm',
      status: 'confirmed',
    },
    {
      label: 'executeBookingCancelAction',
      fn: executeBookingCancelAction,
      transitionFn: cancelBooking,
      actionName: 'booking_cancel',
      status: 'cancelled',
    },
    {
      label: 'executeBookingMarkNoShowAction',
      fn: executeBookingMarkNoShowAction,
      transitionFn: markNoShow,
      actionName: 'booking_mark_no_show',
      status: 'no_show',
    },
    {
      label: 'executeBookingMarkCompleteAction',
      fn: executeBookingMarkCompleteAction,
      transitionFn: markShowed,
      actionName: 'booking_mark_complete',
      status: 'showed',
    },
  ] as const

  for (const { label, fn, transitionFn, actionName, status } of cases) {
    describe(label, () => {
      it('throws when booking_id is missing, before calling the transition function', async () => {
        await expect(fn({}, 'org-1', supabase)).rejects.toThrow(
          `${actionName} requires booking_id`,
        )
        expect(vi.mocked(transitionFn)).not.toHaveBeenCalled()
      })

      it('returns {ok:true, booking_id, status} and calls the transition fn with orgId', async () => {
        vi.mocked(transitionFn).mockResolvedValueOnce({ ok: true })

        const result = await fn({ booking_id: 'b1' }, 'org-1', supabase)

        expect(JSON.parse(result)).toEqual({ ok: true, booking_id: 'b1', status })
        expect(vi.mocked(transitionFn)).toHaveBeenCalledWith(
          expect.objectContaining({ supabase }),
          'b1',
          'org-1',
        )
      })

      it('throws when the transition fn resolves illegal_transition', async () => {
        vi.mocked(transitionFn).mockResolvedValueOnce({ ok: false, error: 'illegal_transition' })

        await expect(fn({ booking_id: 'b1' }, 'org-1', supabase)).rejects.toThrow(
          `${actionName}: illegal_transition`,
        )
      })
    })
  }

  describe('executeBookingRescheduleAction', () => {
    it('throws when booking_id is missing', async () => {
      await expect(
        executeBookingRescheduleAction({ start_at: 's', end_at: 'e' }, 'org-1', supabase),
      ).rejects.toThrow('booking_reschedule requires booking_id')
      expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
    })

    it('throws when start_at is missing', async () => {
      await expect(
        executeBookingRescheduleAction({ booking_id: 'b1', end_at: 'e' }, 'org-1', supabase),
      ).rejects.toThrow('booking_reschedule requires start_at')
      expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
    })

    it('throws when end_at is missing', async () => {
      await expect(
        executeBookingRescheduleAction({ booking_id: 'b1', start_at: 's' }, 'org-1', supabase),
      ).rejects.toThrow('booking_reschedule requires end_at')
      expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
    })

    it('returns {ok:true, booking_id, start_at, end_at} on success', async () => {
      vi.mocked(rescheduleBooking).mockResolvedValueOnce({ ok: true })

      const result = await executeBookingRescheduleAction(
        { booking_id: 'b1', start_at: 's', end_at: 'e' },
        'org-1',
        supabase,
      )

      expect(JSON.parse(result)).toEqual({ ok: true, booking_id: 'b1', start_at: 's', end_at: 'e' })
      expect(vi.mocked(rescheduleBooking)).toHaveBeenCalledWith(
        expect.objectContaining({ supabase }),
        'b1',
        'org-1',
        's',
        'e',
      )
    })

    it('throws booking_reschedule: <error> when rescheduleBooking resolves ok:false', async () => {
      vi.mocked(rescheduleBooking).mockResolvedValueOnce({ ok: false, error: 'illegal_transition' })

      await expect(
        executeBookingRescheduleAction(
          { booking_id: 'b1', start_at: 's', end_at: 'e' },
          'org-1',
          supabase,
        ),
      ).rejects.toThrow('booking_reschedule: illegal_transition')
    })
  })
})

// ---- Task 1: execute-action.ts dispatcher wiring ----

describe('execute-action.ts booking_* dispatcher wiring', () => {
  const credentials: GhlCredentials = { apiKey: 'k', locationId: 'l' }

  const dispatchCases = [
    { actionType: 'booking_confirm', transitionFn: confirmBooking, status: 'confirmed' },
    { actionType: 'booking_cancel', transitionFn: cancelBooking, status: 'cancelled' },
    { actionType: 'booking_mark_no_show', transitionFn: markNoShow, status: 'no_show' },
    { actionType: 'booking_mark_complete', transitionFn: markShowed, status: 'showed' },
  ] as const

  for (const { actionType, transitionFn, status } of dispatchCases) {
    it(`executeAction('${actionType}', ...) delegates to the canonical service via the adapter and returns its result`, async () => {
      vi.mocked(transitionFn).mockResolvedValueOnce({ ok: true })

      const ctx: ActionContext = { organizationId: 'org-1', supabase }
      const result = await executeAction(
        actionType as never,
        { booking_id: 'b1' },
        credentials,
        ctx,
      )

      expect(vi.mocked(transitionFn)).toHaveBeenCalledWith(
        expect.objectContaining({ supabase }),
        'b1',
        'org-1',
      )
      expect(JSON.parse(result)).toEqual({ ok: true, booking_id: 'b1', status })
    })

    it(`executeAction('${actionType}', ...) without ctx.organizationId/ctx.supabase throws`, async () => {
      await expect(
        executeAction(actionType as never, { booking_id: 'b1' }, credentials),
      ).rejects.toThrow(`${actionType} requires ctx.organizationId and ctx.supabase`)
    })
  }

  it("executeAction('booking_reschedule', ...) delegates to rescheduleBooking via the adapter", async () => {
    vi.mocked(rescheduleBooking).mockResolvedValueOnce({ ok: true })

    const ctx: ActionContext = { organizationId: 'org-1', supabase }
    const result = await executeAction(
      'booking_reschedule' as never,
      { booking_id: 'b1', start_at: 's', end_at: 'e' },
      credentials,
      ctx,
    )

    expect(vi.mocked(rescheduleBooking)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase }),
      'b1',
      'org-1',
      's',
      'e',
    )
    expect(JSON.parse(result)).toEqual({ ok: true, booking_id: 'b1', start_at: 's', end_at: 'e' })
  })

  it("executeAction('booking_reschedule', ...) without ctx.organizationId/ctx.supabase throws", async () => {
    await expect(
      executeAction(
        'booking_reschedule' as never,
        { booking_id: 'b1', start_at: 's', end_at: 'e' },
        credentials,
      ),
    ).rejects.toThrow('booking_reschedule requires ctx.organizationId and ctx.supabase')
  })
})

// ---- Task 2: executeUpdateBookingStatus routes by target status through the canonical service ----

describe('executeUpdateBookingStatus', () => {
  const targets = [
    { status: 'confirmed', transitionFn: confirmBooking },
    { status: 'cancelled', transitionFn: cancelBooking },
    { status: 'no_show', transitionFn: markNoShow },
    { status: 'showed', transitionFn: markShowed },
  ] as const

  for (const { status, transitionFn } of targets) {
    it(`delegates status='${status}' to the matching canonical transition function`, async () => {
      vi.mocked(transitionFn).mockResolvedValueOnce({ ok: true })

      const result = await executeUpdateBookingStatus(
        { booking_id: 'b1', status },
        'org-1',
        supabase,
      )

      expect(vi.mocked(transitionFn)).toHaveBeenCalledWith(
        expect.objectContaining({ supabase }),
        'b1',
        'org-1',
      )
      expect(JSON.parse(result)).toEqual({ ok: true, booking_id: 'b1', status })
    })
  }

  it('throws update_booking_status: illegal_transition when the delegate resolves ok:false, error:illegal_transition', async () => {
    vi.mocked(confirmBooking).mockResolvedValueOnce({ ok: false, error: 'illegal_transition' })

    await expect(
      executeUpdateBookingStatus({ booking_id: 'b1', status: 'confirmed' }, 'org-1', supabase),
    ).rejects.toThrow('update_booking_status: illegal_transition')
  })

  it('throws when status is missing', async () => {
    await expect(
      executeUpdateBookingStatus({ booking_id: 'b1' }, 'org-1', supabase),
    ).rejects.toThrow('update_booking_status: status must be one of confirmed, cancelled, no_show, showed')
  })

  it("throws when status is not a valid BookingStatus (e.g. 'pending')", async () => {
    await expect(
      executeUpdateBookingStatus({ booking_id: 'b1', status: 'pending' }, 'org-1', supabase),
    ).rejects.toThrow('update_booking_status: status must be one of confirmed, cancelled, no_show, showed')
  })

  it('throws when booking_id is missing', async () => {
    await expect(
      executeUpdateBookingStatus({ status: 'confirmed' }, 'org-1', supabase),
    ).rejects.toThrow('update_booking_status: booking_id is required')
  })
})
