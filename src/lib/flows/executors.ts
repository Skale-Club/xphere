// Per-node executors for the flow engine.
// Each executor receives interpolated config + accumulated run state and
// returns the step's output (merged into state.steps[stepId].output).

import type { FlowNodeData } from './schema'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { executeCreateTask, executeCreateNote } from '@/lib/action-engine/executors/create-task'

export interface ExecutorContext {
  orgId: string
  supabase: SupabaseClient<Database>
  state: Record<string, unknown>
}

// Booking status type aligned with DB enum + aspirational transitions
type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'pending' | 'completed'

export interface ExecutorResult {
  output: Record<string, unknown>
}

// ─── http_request ────────────────────────────────────────────────────────────

async function executeHttpRequest(
  config: Record<string, unknown>,
): Promise<ExecutorResult> {
  const url = String(config.url ?? '')
  if (!url) throw new Error('http_request requires a url')

  const method = String(config.method ?? 'GET').toUpperCase()
  const headers = (config.headers as Record<string, string>) ?? { 'Content-Type': 'application/json' }
  const body = config.body
  const init: RequestInit = { method, headers }
  if (body !== undefined && body !== null && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const response = await fetch(url, init)
  const text = await response.text()
  let parsed: unknown = text
  try { parsed = JSON.parse(text) } catch { /* keep text */ }

  return {
    output: {
      status: response.status,
      ok: response.ok,
      body: parsed,
    },
  }
}

// ─── log (built-in no-op for debugging) ──────────────────────────────────────

async function executeLog(config: Record<string, unknown>): Promise<ExecutorResult> {
  console.log('[flow:log]', JSON.stringify(config))
  return { output: { logged: true, payload: config } }
}

// ─── booking_confirm ─────────────────────────────────────────────────────────

async function executeBookingConfirm(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const bookingId = String(config.booking_id ?? '')
  if (!bookingId) throw new Error('booking_confirm requires booking_id')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_confirm: booking not found (${bookingId})`)

  const current = booking.status as BookingStatus
  if (current !== 'pending' && current !== 'confirmed') {
    throw new Error(`booking_confirm: cannot confirm a booking with status '${current}' (must be pending)`)
  }
  if (current === 'confirmed') {
    // Idempotent | already confirmed
    return { output: { booking_id: bookingId, status: 'confirmed', ok: true } }
  }

  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_confirm: update failed | ${updateErr.message}`)

  return { output: { booking_id: bookingId, status: 'confirmed', ok: true } }
}

// ─── booking_cancel ───────────────────────────────────────────────────────────

async function executeBookingCancel(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const bookingId = String(config.booking_id ?? '')
  if (!bookingId) throw new Error('booking_cancel requires booking_id')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_cancel: booking not found (${bookingId})`)

  const current = booking.status as BookingStatus
  const cancellableStatuses: BookingStatus[] = ['pending', 'confirmed']
  if (!cancellableStatuses.includes(current)) {
    throw new Error(`booking_cancel: cannot cancel a booking with status '${current}'`)
  }

  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_cancel: update failed | ${updateErr.message}`)

  return { output: { booking_id: bookingId, status: 'cancelled', ok: true } }
}

// ─── booking_reschedule ───────────────────────────────────────────────────────

async function executeBookingReschedule(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const bookingId = String(config.booking_id ?? '')
  const startAt = String(config.start_at ?? '')
  const endAt = String(config.end_at ?? '')

  if (!bookingId) throw new Error('booking_reschedule requires booking_id')
  if (!startAt) throw new Error('booking_reschedule requires start_at')
  if (!endAt) throw new Error('booking_reschedule requires end_at')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_reschedule: booking not found (${bookingId})`)

  const current = booking.status as BookingStatus
  const reschedulableStatuses: BookingStatus[] = ['pending', 'confirmed']
  if (!reschedulableStatuses.includes(current)) {
    throw new Error(`booking_reschedule: cannot reschedule a booking with status '${current}'`)
  }

  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({
      start_at: startAt,
      end_at: endAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_reschedule: update failed | ${updateErr.message}`)

  return { output: { booking_id: bookingId, start_at: startAt, end_at: endAt, ok: true } }
}

// ─── booking_mark_no_show ─────────────────────────────────────────────────────

async function executeBookingMarkNoShow(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const bookingId = String(config.booking_id ?? '')
  if (!bookingId) throw new Error('booking_mark_no_show requires booking_id')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_mark_no_show: booking not found (${bookingId})`)

  const current = booking.status as BookingStatus
  if (current !== 'confirmed') {
    throw new Error(`booking_mark_no_show: can only mark no_show from 'confirmed', got '${current}'`)
  }

  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ status: 'no_show', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_mark_no_show: update failed | ${updateErr.message}`)

  return { output: { booking_id: bookingId, status: 'no_show', ok: true } }
}

// ─── booking_mark_complete ────────────────────────────────────────────────────

async function executeBookingMarkComplete(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const bookingId = String(config.booking_id ?? '')
  if (!bookingId) throw new Error('booking_mark_complete requires booking_id')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_mark_complete: booking not found (${bookingId})`)

  const current = booking.status as BookingStatus
  if (current !== 'confirmed') {
    throw new Error(`booking_mark_complete: can only mark completed from 'confirmed', got '${current}'`)
  }

  // 'completed' is an aspirational status (SEED-027 Phase E migration).
  // Until the DB enum is extended, we cast to bypass the current type constraint.
  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ status: 'completed' as 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_mark_complete: update failed | ${updateErr.message}`)

  return { output: { booking_id: bookingId, status: 'completed', ok: true } }
}

// ─── booking_create ───────────────────────────────────────────────────────────

async function executeBookingCreate(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const eventTypeId = String(config.event_type_id ?? '')
  const bookerName = String(config.booker_name ?? '')
  const bookerEmail = String(config.booker_email ?? '')
  const startAt = String(config.start_at ?? '')
  const endAt = String(config.end_at ?? '')

  if (!eventTypeId) throw new Error('booking_create requires event_type_id')
  if (!bookerName) throw new Error('booking_create requires booker_name')
  if (!bookerEmail) throw new Error('booking_create requires booker_email')
  if (!startAt) throw new Error('booking_create requires start_at')
  if (!endAt) throw new Error('booking_create requires end_at')

  const bookerPhone = config.booker_phone ? String(config.booker_phone) : null
  const bookerTimezone = config.booker_timezone ? String(config.booker_timezone) : 'UTC'
  const notes = config.notes ? String(config.notes) : null
  const linkedContactId = config.linked_contact_id ? String(config.linked_contact_id) : null

  const { data: newBooking, error: insertErr } = await ctx.supabase
    .from('bookings')
    .insert({
      org_id: ctx.orgId,
      event_type_id: eventTypeId,
      booker_name: bookerName,
      booker_email: bookerEmail,
      booker_phone: bookerPhone,
      booker_timezone: bookerTimezone,
      start_at: startAt,
      end_at: endAt,
      notes,
      status: 'confirmed',
      linked_contact_id: linkedContactId,
    })
    .select('id, status, start_at, end_at')
    .single()

  if (insertErr || !newBooking) {
    throw new Error(`booking_create: insert failed | ${insertErr?.message ?? 'unknown error'}`)
  }

  return {
    output: {
      booking_id: newBooking.id,
      status: newBooking.status,
      start_at: newBooking.start_at,
      end_at: newBooking.end_at,
      ok: true,
    },
  }
}

// ─── booking_get ──────────────────────────────────────────────────────────────

async function executeBookingGet(
  config: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const bookingId = String(config.booking_id ?? '')
  if (!bookingId) throw new Error('booking_get requires booking_id')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status, event_type_id, booker_name, booker_email, booker_phone, start_at, end_at, notes, linked_contact_id, meeting_url, created_at, updated_at')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_get: booking not found (${bookingId})`)

  return {
    output: {
      booking_id: booking.id,
      status: booking.status,
      event_type_id: booking.event_type_id,
      booker_name: booking.booker_name,
      booker_email: booking.booker_email,
      booker_phone: booking.booker_phone,
      start_at: booking.start_at,
      end_at: booking.end_at,
      notes: booking.notes,
      linked_contact_id: booking.linked_contact_id,
      meeting_url: booking.meeting_url,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
      ok: true,
    },
  }
}

// ─── stub: not-yet-wired actions ─────────────────────────────────────────────

async function executeStub(
  actionType: string,
  config: Record<string, unknown>,
): Promise<ExecutorResult> {
  // Phase B placeholder: returns a structured "would have done X" without
  // calling real integrations. Phase B+ wires send_whatsapp / send_email /
  // create_contact / etc. into the existing action-engine.
  return {
    output: {
      _stub: true,
      _action_type: actionType,
      _params: config,
      _note: 'Executor not yet wired. Action recorded but not dispatched.',
    },
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function executeNode(
  node: { id: string; type: string; data: FlowNodeData },
  resolvedConfig: Record<string, unknown>,
  _ctx: ExecutorContext,
): Promise<ExecutorResult> {
  const data = node.data

  if (data.kind === 'trigger') {
    // Trigger node simply emits its payload as output (already in state.trigger)
    return { output: {} }
  }

  if (data.kind === 'end') {
    return { output: { terminated: true } }
  }

  if (data.kind === 'condition') {
    // Handled by engine itself for branching; executor is a no-op
    return { output: {} }
  }

  if (data.kind === 'wait') {
    // Phase B v1 doesn't suspend execution; just record intent so the run
    // history shows the planned wait. Real suspension lands when pgmq/pg_cron
    // ship.
    return {
      output: {
        _wait_mode: data.mode,
        _wait_duration: data.duration ?? null,
        _wait_skipped: true,
        _note: 'Wait nodes are recorded but do not suspend execution in this engine version.',
      },
    }
  }

  if (data.kind === 'agent') {
    // Phase B placeholder. Phase C+ will spin up an agent loop.
    return {
      output: {
        _stub: true,
        _agent_id: data.agent_id ?? null,
        _note: 'Agent nodes are stubbed until Phase B agent runtime wiring.',
      },
    }
  }

  if (data.kind === 'action') {
    switch (data.action_type) {
      case 'http_request':        return executeHttpRequest(resolvedConfig)
      case 'log':                 return executeLog(resolvedConfig)
      case 'booking_confirm':     return executeBookingConfirm(resolvedConfig, _ctx)
      case 'booking_cancel':      return executeBookingCancel(resolvedConfig, _ctx)
      case 'booking_reschedule':  return executeBookingReschedule(resolvedConfig, _ctx)
      case 'booking_mark_no_show': return executeBookingMarkNoShow(resolvedConfig, _ctx)
      case 'booking_mark_complete': return executeBookingMarkComplete(resolvedConfig, _ctx)
      case 'booking_create':      return executeBookingCreate(resolvedConfig, _ctx)
      case 'booking_get':         return executeBookingGet(resolvedConfig, _ctx)
      case 'create_task': {
        const taskResult = await executeCreateTask(resolvedConfig, _ctx.orgId)
        return { output: { result: taskResult } }
      }
      case 'create_note': {
        const noteResult = await executeCreateNote(resolvedConfig, _ctx.orgId)
        return { output: { result: noteResult } }
      }
      default:                    return executeStub(data.action_type, resolvedConfig)
    }
  }

  return { output: {} }
}
