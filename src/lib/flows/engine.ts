import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FlowDefinition, FlowEdge, FlowNode, FlowNodeData } from './schema'
import { FlowDefinition as FlowDefinitionSchema } from './schema'
import { interpolate, evaluateCondition } from './interpolate'
import { executeAction, type ActionContext } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'
import type { GhlCredentials } from '@/lib/ghl/client'
import { insertNotification } from '@/lib/notifications/insert'

const MAX_STEPS = 100

export interface RunInput {
  workflowId: string
  versionId: string | null
  definition: FlowDefinition
  orgId: string
  triggerType?: string
  triggerPayload?: Record<string, unknown>
  createdBy?: string | null
  supabase: SupabaseClient<Database>
}

export interface RunResult {
  runId: string
  status: 'succeeded' | 'failed'
  error?: string
}

interface FlowExecutorContext {
  orgId: string
  supabase: SupabaseClient<Database>
  state: Record<string, unknown>
}

type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'pending' | 'completed'

export async function runFlow(input: RunInput): Promise<RunResult> {
  const parsed = FlowDefinitionSchema.safeParse(input.definition)
  if (!parsed.success) {
    return { runId: '', status: 'failed', error: parsed.error.issues[0]?.message ?? 'invalid_definition' }
  }
  const def = parsed.data

  const { data: runRow, error: runErr } = await input.supabase
    .from('workflow_runs')
    .insert({
      org_id: input.orgId,
      workflow_id: input.workflowId,
      workflow_version_id: input.versionId,
      trigger_type: input.triggerType ?? 'manual',
      trigger_payload: input.triggerPayload ?? {},
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: input.createdBy ?? null,
    })
    .select()
    .single()

  if (runErr || !runRow) {
    return { runId: '', status: 'failed', error: runErr?.message ?? 'run_create_failed' }
  }

  const state: Record<string, unknown> = {
    trigger: { type: input.triggerType ?? 'manual', payload: input.triggerPayload ?? {} },
    steps: {} as Record<string, { output: Record<string, unknown> }>,
  }

  const nodesById = new Map(def.nodes.map((n) => [n.id, n]))
  const trigger = def.nodes.find((n) => n.type === 'trigger')

  if (!trigger) {
    await finalizeRun(input.supabase, runRow.id, 'failed', state, 'no_trigger_node')
    return { runId: runRow.id, status: 'failed', error: 'no_trigger_node' }
  }

  const flowCtx: FlowExecutorContext = { orgId: input.orgId, supabase: input.supabase, state }

  let current: FlowNode | undefined = trigger
  let stepCount = 0
  let runError: string | undefined

  while (current && stepCount < MAX_STEPS) {
    const node: FlowNode = current
    stepCount++
    const stepId = `${node.id}_${stepCount}`

    await input.supabase.from('workflow_run_steps').insert({
      run_id: runRow.id,
      step_id: stepId,
      node_id: node.id,
      node_type: node.type,
      status: 'running',
      input: extractNodeConfig(node) as unknown as Record<string, unknown>,
      started_at: new Date().toISOString(),
    })

    const rawConfig = extractNodeConfig(node)
    const resolvedConfig = interpolate(rawConfig, state) as Record<string, unknown>

    let output: Record<string, unknown> = {}
    let stepError: string | undefined
    try {
      output = await executeFlowNode(node, resolvedConfig, flowCtx)
    } catch (err) {
      stepError = err instanceof Error ? err.message : String(err)
    }

    await input.supabase
      .from('workflow_run_steps')
      .update({
        status: stepError ? 'failed' : 'succeeded',
        output,
        error: stepError ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq('run_id', runRow.id)
      .eq('step_id', stepId)

    if (stepError) {
      runError = stepError
      break
    }

    ;(state.steps as Record<string, { output: Record<string, unknown> }>)[node.id] = { output }

    if (node.type === 'end') break

    const next = pickNextNode(node, output, def.edges, nodesById, state)
    current = next
  }

  if (stepCount >= MAX_STEPS) {
    runError = `step_limit_exceeded (${MAX_STEPS})`
  }

  await finalizeRun(input.supabase, runRow.id, runError ? 'failed' : 'succeeded', state, runError)

  if (runError) {
    void insertNotification(input.orgId, 'flow_failed', {
      workflow_id: input.workflowId,
      workflow_run_id: runRow.id,
      error: runError,
    })
  }

  return { runId: runRow.id, status: runError ? 'failed' : 'succeeded', error: runError }
}

async function resolveGhlCredentials(
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<GhlCredentials> {
  const { data: integration } = await supabase
    .from('integrations')
    .select('encrypted_api_key, location_id')
    .eq('organization_id', orgId)
    .eq('provider', 'gohighlevel')
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.encrypted_api_key) {
    return { apiKey: '', locationId: '' }
  }

  const apiKey = await decrypt(integration.encrypted_api_key)
  return { apiKey, locationId: integration.location_id ?? '' }
}

async function executeHttpRequest(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
    status: response.status,
    ok: response.ok,
    body: parsed,
  }
}

async function executeLog(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  console.log('[flow:log]', JSON.stringify(config))
  return { logged: true, payload: config }
}

async function executeBookingConfirm(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
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
    return { booking_id: bookingId, status: 'confirmed', ok: true }
  }

  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_confirm: update failed | ${updateErr.message}`)
  return { booking_id: bookingId, status: 'confirmed', ok: true }
}

async function executeBookingCancel(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
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
  return { booking_id: bookingId, status: 'cancelled', ok: true }
}

async function executeBookingReschedule(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
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
    .update({ start_at: startAt, end_at: endAt, updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_reschedule: update failed | ${updateErr.message}`)
  return { booking_id: bookingId, start_at: startAt, end_at: endAt, ok: true }
}

async function executeBookingMarkNoShow(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
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
  return { booking_id: bookingId, status: 'no_show', ok: true }
}

async function executeBookingMarkComplete(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
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

  const { error: updateErr } = await ctx.supabase
    .from('bookings')
    .update({ status: 'completed' as 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  if (updateErr) throw new Error(`booking_mark_complete: update failed | ${updateErr.message}`)
  return { booking_id: bookingId, status: 'completed', ok: true }
}

async function executeBookingCreate(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
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
    booking_id: newBooking.id,
    status: newBooking.status,
    start_at: newBooking.start_at,
    end_at: newBooking.end_at,
    ok: true,
  }
}

async function executeBookingGet(
  config: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
  const bookingId = String(config.booking_id ?? '')
  if (!bookingId) throw new Error('booking_get requires booking_id')

  const { data: booking, error: fetchErr } = await ctx.supabase
    .from('bookings')
    .select('id, status, event_type_id, booker_name, booker_email, booker_phone, start_at, end_at, notes, linked_contact_id, meeting_url, created_at, updated_at')
    .eq('id', bookingId)
    .single()

  if (fetchErr || !booking) throw new Error(`booking_get: booking not found (${bookingId})`)

  return {
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
  }
}

async function executeFlowNode(
  node: { id: string; type: string; data: FlowNodeData },
  resolvedConfig: Record<string, unknown>,
  ctx: FlowExecutorContext,
): Promise<Record<string, unknown>> {
  const data = node.data

  if (data.kind === 'trigger' || data.kind === 'end' || data.kind === 'condition') {
    return {}
  }

  if (data.kind === 'wait') {
    return {
      _wait_mode: data.mode,
      _wait_duration: data.duration ?? null,
      _wait_skipped: true,
      _note: 'Wait nodes are recorded but do not suspend execution in this engine version.',
    }
  }

  if (data.kind === 'agent') {
    return {
      _stub: true,
      _agent_id: data.agent_id ?? null,
      _note: 'Agent nodes are stubbed until agent runtime wiring.',
    }
  }

  if (data.kind === 'action') {
    switch (data.action_type) {
      case 'http_request':
        return executeHttpRequest(resolvedConfig)
      case 'log':
        return executeLog(resolvedConfig)
      case 'booking_confirm':
        return executeBookingConfirm(resolvedConfig, ctx)
      case 'booking_cancel':
        return executeBookingCancel(resolvedConfig, ctx)
      case 'booking_reschedule':
        return executeBookingReschedule(resolvedConfig, ctx)
      case 'booking_mark_no_show':
        return executeBookingMarkNoShow(resolvedConfig, ctx)
      case 'booking_mark_complete':
        return executeBookingMarkComplete(resolvedConfig, ctx)
      case 'booking_create':
        return executeBookingCreate(resolvedConfig, ctx)
      case 'booking_get':
        return executeBookingGet(resolvedConfig, ctx)
      default: {
        const credentials = await resolveGhlCredentials(ctx.orgId, ctx.supabase)
        const actionCtx: ActionContext = {
          organizationId: ctx.orgId,
          supabase: ctx.supabase,
        }
        const result = await executeAction(
          data.action_type as Database['public']['Enums']['action_type'],
          resolvedConfig,
          credentials,
          actionCtx,
        )
        return { result }
      }
    }
  }

  return {}
}

function extractNodeConfig(node: FlowNode): Record<string, unknown> {
  const data = node.data
  if (data.kind === 'action') return data.config ?? {}
  if (data.kind === 'trigger') return (data.filter ?? {}) as Record<string, unknown>
  if (data.kind === 'condition') return { expression: data.expression }
  if (data.kind === 'wait') {
    return { mode: data.mode, duration: data.duration, event_filter: data.event_filter, timeout: data.timeout, event_type: data.event_type, offset: data.offset }
  }
  if (data.kind === 'agent') {
    return { agent_id: data.agent_id, system_prompt: data.system_prompt, max_steps: data.max_steps }
  }
  return {}
}

function pickNextNode(
  current: FlowNode,
  output: Record<string, unknown>,
  edges: FlowEdge[],
  nodesById: Map<string, FlowNode>,
  state: Record<string, unknown>,
): FlowNode | undefined {
  if (current.data.kind === 'condition') {
    const branch = evaluateCondition(current.data.expression, state) ? 'true' : 'false'
    const edge = edges.find((e) => e.source === current.id && (e.sourceHandle ?? 'true') === branch)
      ?? edges.find((e) => e.source === current.id)
    return edge ? nodesById.get(edge.target) : undefined
  }

  const edge = edges.find((e) => e.source === current.id)
  void output
  return edge ? nodesById.get(edge.target) : undefined
}

async function finalizeRun(
  supabase: SupabaseClient<Database>,
  runId: string,
  status: 'succeeded' | 'failed',
  state: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await supabase
    .from('workflow_runs')
    .update({
      status,
      state,
      ended_at: new Date().toISOString(),
      error: error ?? null,
    })
    .eq('id', runId)
}
