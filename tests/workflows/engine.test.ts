import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { FlowDefinition } from '@/lib/flows/schema'

vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('mock-api-key'),
}))
vi.mock('@/lib/notifications/insert', () => ({
  insertNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/calendar/transition', () => ({
  confirmBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markNoShow: vi.fn(),
  markShowed: vi.fn(),
  rescheduleBooking: vi.fn(),
  emitCalendarEvent: vi.fn().mockResolvedValue({ dispatched: 0, dispatch_id: null }),
}))

import { runFlow } from '@/lib/flows/engine'
import { executeAction } from '@/lib/action-engine/execute-action'
import {
  confirmBooking,
  cancelBooking,
  markNoShow,
  markShowed,
  rescheduleBooking,
  emitCalendarEvent,
} from '@/lib/calendar/transition'

// ─── Supabase chain factory ───────────────────────────────────────────────────
// Makes a chainable object that is also awaitable (resolves to terminalResult).
// Used for chains that end with .eq() rather than .single().

function makeChain(terminalResult = { data: null as unknown, error: null as unknown }) {
  const resolved = Promise.resolve(terminalResult)
  return {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue(terminalResult),
    then: resolved.then.bind(resolved),
  }
}

function makeSupabase(opts?: { runId?: string; runInsertError?: boolean }) {
  const runId = opts?.runId ?? 'run-1'
  const runInsertResult = opts?.runInsertError
    ? { data: null, error: { message: 'db_error' } }
    : { data: { id: runId }, error: null }

  const runChain = makeChain(runInsertResult)
  const defaultChain = makeChain({ data: null, error: null })

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workflow_runs') return runChain
      return defaultChain
    }),
  } as unknown as SupabaseClient<Database>
}

// ─── Flow builders ────────────────────────────────────────────────────────────

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return { version: 1, nodes: [], edges: [], variables: [], metadata: { tags: [] }, ...overrides }
}

function trig(id = 'trigger'): FlowDefinition['nodes'][0] {
  return { id, type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', event_type: 'manual', label: 'T' } }
}

function act(id: string, actionType = 'send_sms', config: Record<string, unknown> = {}): FlowDefinition['nodes'][0] {
  return { id, type: 'action', position: { x: 0, y: 0 }, data: { kind: 'action', action_type: actionType, config, label: 'A' } }
}

function end(id = 'end1'): FlowDefinition['nodes'][0] {
  return { id, type: 'end', position: { x: 0, y: 0 }, data: { kind: 'end', label: 'End' } }
}

function wait(id = 'w1'): FlowDefinition['nodes'][0] {
  return { id, type: 'wait', position: { x: 0, y: 0 }, data: { kind: 'wait', mode: 'sleep', duration: '5m', label: 'Wait' } }
}

function cond(id: string, expression: string): FlowDefinition['nodes'][0] {
  return { id, type: 'condition', position: { x: 0, y: 0 }, data: { kind: 'condition', expression, label: 'Cond' } }
}

function edge(source: string, target: string, sourceHandle?: string): FlowDefinition['edges'][0] {
  return { id: `e-${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runFlow — lib/flows/engine.ts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns failed (no runId) when definition fails schema parse', async () => {
    const supabase = makeSupabase()
    // A node with an unknown type fails FlowNodeType enum validation → Zod rejects
    // the whole definition before any supabase call is made.
    const badDef = {
      version: 1,
      nodes: [{ id: 'n1', type: 'NOT_VALID', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    } as unknown as FlowDefinition
    const result = await runFlow({
      workflowId: 'wf-1',
      versionId: null,
      definition: badDef,
      orgId: 'org-1',
      supabase,
    })
    expect(result.status).toBe('failed')
    expect(result.runId).toBe('')
    // Supabase was never called because we failed before the insert
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('returns failed when workflow_runs insert fails', async () => {
    const supabase = makeSupabase({ runInsertError: true })
    const def = makeFlow({ nodes: [trig()] })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('db_error')
  })

  it('fails with no_trigger_node when flow has no trigger', async () => {
    const supabase = makeSupabase()
    const def = makeFlow({ nodes: [act('a1')], edges: [] })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('no_trigger_node')
  })

  it('succeeds for a trigger → action linear flow', async () => {
    const supabase = makeSupabase()
    const def = makeFlow({
      nodes: [trig(), act('a1')],
      edges: [edge('trigger', 'a1')],
    })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('succeeded')
    expect(result.runId).toBe('run-1')
    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ organizationId: 'org-1' }),
    )
  })

  it('propagates triggerPayload into state and passes it to action config after interpolation', async () => {
    const supabase = makeSupabase()
    const def = makeFlow({
      nodes: [trig(), act('a1', 'send_sms', { to: '{{trigger.payload.phone}}' })],
      edges: [edge('trigger', 'a1')],
    })
    await runFlow({
      workflowId: 'wf-1',
      versionId: null,
      definition: def,
      orgId: 'org-1',
      triggerPayload: { phone: '+15551234567' },
      supabase,
    })
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.objectContaining({ to: '+15551234567' }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('marks run as failed and fires notification when action throws', async () => {
    const { insertNotification } = await import('@/lib/notifications/insert')
    vi.mocked(executeAction).mockRejectedValueOnce(new Error('executor_crashed'))
    const supabase = makeSupabase()
    const def = makeFlow({
      nodes: [trig(), act('a1')],
      edges: [edge('trigger', 'a1')],
    })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('executor_crashed')
    expect(vi.mocked(insertNotification)).toHaveBeenCalledWith('org-1', 'flow_failed', expect.any(Object))
  })

  it('wait node suspends the run (status waiting) and defers downstream nodes', async () => {
    const supabase = makeSupabase()
    const def = makeFlow({
      nodes: [trig(), wait(), act('a1')],
      edges: [edge('trigger', 'w1'), edge('w1', 'a1')],
    })
    const result = await runFlow({ workflowId: 'wf-1', versionId: 'ver-1', definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('waiting')
    // The action after the wait is NOT executed until the run resumes.
    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
    // A workflow_waits row was created for the suspended run.
    expect(supabase.from).toHaveBeenCalledWith('workflow_waits')
  })

  it('resumeRun continues the flow from after the wait node', async () => {
    const { resumeRun } = await import('@/lib/flows/engine')
    const def = makeFlow({
      nodes: [trig(), wait(), act('a1'), end()],
      edges: [edge('trigger', 'w1'), edge('w1', 'a1'), edge('a1', 'end1')],
    })
    // Tailored supabase: run is waiting + version returns the definition. The
    // status→running claim UPDATE ... WHERE status='waiting' RETURNING id must
    // return one row (this resumer wins the atomic claim).
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workflow_runs') {
          return {
            ...makeChain({ data: [{ id: 'run-1' }], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'run-1', org_id: 'org-1', workflow_id: 'wf-1',
                workflow_version_id: 'ver-1', state: { steps: {} }, status: 'waiting',
              },
              error: null,
            }),
          }
        }
        if (table === 'workflow_versions') {
          return {
            ...makeChain({ data: null, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: { definition: def }, error: null }),
          }
        }
        return makeChain({ data: null, error: null })
      }),
    } as unknown as SupabaseClient<Database>

    const result = await resumeRun(supabase, { runId: 'run-1', nodeId: 'w1', event: 'meeting.confirmed' })
    expect(result.status).toBe('succeeded')
    // The deferred action now runs.
    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })

  it('resumeRun no-ops when the atomic claim is lost (double-resume guard)', async () => {
    const { resumeRun } = await import('@/lib/flows/engine')
    const def = makeFlow({
      nodes: [trig(), wait(), act('a1'), end()],
      edges: [edge('trigger', 'w1'), edge('w1', 'a1'), edge('a1', 'end1')],
    })
    // Run reads as 'waiting', but the claim UPDATE affects ZERO rows (another
    // resumer already flipped it to 'running') → this call must not execute.
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'workflow_runs') {
          return {
            ...makeChain({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'run-1', org_id: 'org-1', workflow_id: 'wf-1',
                workflow_version_id: 'ver-1', state: { steps: {} }, status: 'waiting',
              },
              error: null,
            }),
          }
        }
        if (table === 'workflow_versions') {
          return {
            ...makeChain({ data: null, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: { definition: def }, error: null }),
          }
        }
        return makeChain({ data: null, error: null })
      }),
    } as unknown as SupabaseClient<Database>

    const result = await resumeRun(supabase, { runId: 'run-1', nodeId: 'w1', event: 'meeting.confirmed' })
    expect(result.status).toBe('waiting')
    // The post-wait action must NOT run — the other resumer owns this run.
    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
  })

  it('stops execution at end node and skips subsequent action', async () => {
    const supabase = makeSupabase()
    const def = makeFlow({
      nodes: [trig(), end(), act('unreachable')],
      edges: [edge('trigger', 'end1'), edge('end1', 'unreachable')],
    })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('succeeded')
    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
  })

  it('condition: empty expression is always true → takes true branch', async () => {
    const supabase = makeSupabase()
    // Empty expression evaluates to true, so true branch (a_true) is executed.
    const def = makeFlow({
      nodes: [trig(), cond('c1', ''), act('a_true'), act('a_false')],
      edges: [
        edge('trigger', 'c1'),
        edge('c1', 'a_true', 'true'),
        edge('c1', 'a_false', 'false'),
      ],
    })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('succeeded')
    // Only one of the two branches is executed
    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })

  it('condition: false expression → takes false branch', async () => {
    const supabase = makeSupabase()
    // 'no_such_key == 1' → lhs is undefined → undefined == 1 is false
    const def = makeFlow({
      nodes: [
        trig(),
        cond('c1', 'no_such_key == 1'),
        act('a_true', 'send_sms', { branch: 'true' }),
        act('a_false', 'send_sms', { branch: 'false' }),
      ],
      edges: [
        edge('trigger', 'c1'),
        edge('c1', 'a_true', 'true'),
        edge('c1', 'a_false', 'false'),
      ],
    })
    await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.objectContaining({ branch: 'false' }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('trigger → multiple chained actions all execute in order', async () => {
    const supabase = makeSupabase()
    const def = makeFlow({
      nodes: [trig(), act('a1'), act('a2'), act('a3')],
      edges: [edge('trigger', 'a1'), edge('a1', 'a2'), edge('a2', 'a3')],
    })
    const result = await runFlow({ workflowId: 'wf-1', versionId: null, definition: def, orgId: 'org-1', supabase })
    expect(result.status).toBe('succeeded')
    expect(vi.mocked(executeAction)).toHaveBeenCalledTimes(3)
  })

  describe('booking_* action nodes', () => {
    function flowFor(actionType: string, config: Record<string, unknown> = { booking_id: 'book-1' }) {
      return makeFlow({
        nodes: [trig(), act('a1', actionType, config), end()],
        edges: [edge('trigger', 'a1'), edge('a1', 'end1')],
      })
    }

    // The 'a1' node's own workflow_run_steps update call (status: 'succeeded')
    // carries the handler's return value as `output` — makeSupabase() routes
    // every non-workflow_runs table (including workflow_run_steps) to the same
    // shared chain instance, so re-requesting it here reads the recorded calls.
    // The trigger and end nodes also produce a 'succeeded' update, but with an
    // empty output object (their executeFlowNode branches return {}), so the
    // 'a1' booking action node is the only one with a non-empty output.
    function lastStepOutput(supabase: SupabaseClient<Database>): Record<string, unknown> {
      const stepsChain = supabase.from('workflow_run_steps') as unknown as {
        update: ReturnType<typeof vi.fn>
      }
      const succeededCall = stepsChain.update.mock.calls.find((args: unknown[]) => {
        const call = args[0] as { status?: string; output?: Record<string, unknown> }
        return call.status === 'succeeded' && Object.keys(call.output ?? {}).length > 0
      })
      return ((succeededCall?.[0] as { output?: Record<string, unknown> } | undefined)?.output) ?? {}
    }

    const parallelActions: Array<{
      actionType: string
      fn: typeof confirmBooking
      resultStatus: string
    }> = [
      { actionType: 'booking_confirm', fn: confirmBooking, resultStatus: 'confirmed' },
      { actionType: 'booking_cancel', fn: cancelBooking, resultStatus: 'cancelled' },
      { actionType: 'booking_mark_no_show', fn: markNoShow, resultStatus: 'no_show' },
      { actionType: 'booking_mark_complete', fn: markShowed, resultStatus: 'showed' },
    ]

    describe.each(parallelActions)('$actionType', ({ actionType, fn, resultStatus }) => {
      it('missing booking_id throws before calling the transition service', async () => {
        const supabase = makeSupabase()
        const result = await runFlow({
          workflowId: 'wf-1', versionId: null, definition: flowFor(actionType, {}), orgId: 'org-1', supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('requires booking_id')
        expect(vi.mocked(fn)).not.toHaveBeenCalled()
      })

      it('delegates to the canonical transition service with ctx.orgId, returning the new status on ok:true', async () => {
        vi.mocked(fn).mockResolvedValueOnce({ ok: true })
        const supabase = makeSupabase()
        const result = await runFlow({
          workflowId: 'wf-1', versionId: null, definition: flowFor(actionType), orgId: 'org-1', supabase,
        })
        expect(result.status).toBe('succeeded')
        expect(vi.mocked(fn)).toHaveBeenCalledWith(
          expect.objectContaining({ supabase: expect.anything() }),
          'book-1',
          'org-1',
        )
        expect(lastStepOutput(supabase)).toEqual({ booking_id: 'book-1', status: resultStatus, ok: true })
      })

      it('throws illegal_transition when the transition service reports it', async () => {
        vi.mocked(fn).mockResolvedValueOnce({ ok: false, error: 'illegal_transition' })
        const supabase = makeSupabase()
        const result = await runFlow({
          workflowId: 'wf-1', versionId: null, definition: flowFor(actionType), orgId: 'org-1', supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('illegal_transition')
      })

      it('throws booking_not_found when the transition service reports it', async () => {
        vi.mocked(fn).mockResolvedValueOnce({ ok: false, error: 'booking_not_found' })
        const supabase = makeSupabase()
        const result = await runFlow({
          workflowId: 'wf-1', versionId: null, definition: flowFor(actionType), orgId: 'org-1', supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('booking_not_found')
      })
    })

    describe('booking_reschedule', () => {
      it('missing start_at throws before calling rescheduleBooking', async () => {
        const supabase = makeSupabase()
        const result = await runFlow({
          workflowId: 'wf-1',
          versionId: null,
          definition: flowFor('booking_reschedule', { booking_id: 'book-1', end_at: '2026-08-01T11:00:00Z' }),
          orgId: 'org-1',
          supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('requires start_at')
        expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
      })

      it('missing end_at throws before calling rescheduleBooking', async () => {
        const supabase = makeSupabase()
        const result = await runFlow({
          workflowId: 'wf-1',
          versionId: null,
          definition: flowFor('booking_reschedule', { booking_id: 'book-1', start_at: '2026-08-01T10:00:00Z' }),
          orgId: 'org-1',
          supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('requires end_at')
        expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
      })

      it('delegates to rescheduleBooking with ctx.orgId, returning start_at/end_at on ok:true', async () => {
        vi.mocked(rescheduleBooking).mockResolvedValueOnce({ ok: true })
        const supabase = makeSupabase()
        const config = { booking_id: 'book-1', start_at: '2026-08-01T10:00:00Z', end_at: '2026-08-01T11:00:00Z' }
        const result = await runFlow({
          workflowId: 'wf-1', versionId: null, definition: flowFor('booking_reschedule', config), orgId: 'org-1', supabase,
        })
        expect(result.status).toBe('succeeded')
        expect(vi.mocked(rescheduleBooking)).toHaveBeenCalledWith(
          expect.objectContaining({ supabase: expect.anything() }),
          'book-1',
          'org-1',
          '2026-08-01T10:00:00Z',
          '2026-08-01T11:00:00Z',
        )
        expect(lastStepOutput(supabase)).toEqual({
          booking_id: 'book-1',
          start_at: '2026-08-01T10:00:00Z',
          end_at: '2026-08-01T11:00:00Z',
          ok: true,
        })
      })

      it('throws illegal_transition when rescheduleBooking reports it', async () => {
        vi.mocked(rescheduleBooking).mockResolvedValueOnce({ ok: false, error: 'illegal_transition' })
        const supabase = makeSupabase()
        const config = { booking_id: 'book-1', start_at: '2026-08-01T10:00:00Z', end_at: '2026-08-01T11:00:00Z' }
        const result = await runFlow({
          workflowId: 'wf-1', versionId: null, definition: flowFor('booking_reschedule', config), orgId: 'org-1', supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('illegal_transition')
      })
    })

    describe('booking_create', () => {
      const createConfig = {
        event_type_id: 'et-1',
        booker_name: 'Jane Doe',
        booker_email: 'jane@example.com',
        start_at: '2026-08-01T10:00:00Z',
        end_at: '2026-08-01T11:00:00Z',
      }

      // booking_create's own insert() targets the 'bookings' table (unlike the
      // five status-transition handlers, which never touch supabase directly
      // anymore) -- give it its own chain distinct from the shared
      // workflow_run_steps chain so .single() resolves independently.
      function makeCreateSupabase(insertResult: { data: unknown; error: unknown }) {
        const runChain = makeChain({ data: { id: 'run-1' }, error: null })
        const bookingsChain = makeChain(insertResult)
        const stepsChain = makeChain({ data: null, error: null })
        return {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'workflow_runs') return runChain
            if (table === 'bookings') return bookingsChain
            return stepsChain
          }),
        } as unknown as SupabaseClient<Database>
      }

      it('emits meeting.scheduled on successful insert, output shape unchanged', async () => {
        const supabase = makeCreateSupabase({
          data: {
            id: 'booking-1',
            status: 'confirmed',
            start_at: createConfig.start_at,
            end_at: createConfig.end_at,
          },
          error: null,
        })
        const result = await runFlow({
          workflowId: 'wf-1',
          versionId: null,
          definition: flowFor('booking_create', createConfig),
          orgId: 'org-1',
          supabase,
        })
        expect(result.status).toBe('succeeded')
        expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
          expect.objectContaining({ supabase: expect.anything() }),
          { event: 'meeting.scheduled', booking_id: 'booking-1', org_id: 'org-1' },
        )
        expect(lastStepOutput(supabase)).toEqual({
          booking_id: 'booking-1',
          status: 'confirmed',
          start_at: createConfig.start_at,
          end_at: createConfig.end_at,
          ok: true,
        })
      })

      it('does not emit when the insert fails, and still throws as before', async () => {
        const supabase = makeCreateSupabase({ data: null, error: { message: 'db_error' } })
        const result = await runFlow({
          workflowId: 'wf-1',
          versionId: null,
          definition: flowFor('booking_create', createConfig),
          orgId: 'org-1',
          supabase,
        })
        expect(result.status).toBe('failed')
        expect(result.error).toContain('insert failed')
        expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
      })
    })
  })
})
