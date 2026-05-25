// Tests that emitCalendarEvent fires runFlowSync for each matched workflow
// and that cascade depth is respected. This is the key regression guard for
// the gap identified in SEED-047: "event dispatch never executes workflows."

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// vi.mock is hoisted — factory must not reference outer const/let variables.
vi.mock('@/lib/workflows/run-flow-sync', () => ({
  runFlowSync: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/scheduling/scope', () => ({
  buildMeetingScope: vi.fn().mockResolvedValue({
    id: 'book-1',
    title: 'Strategy session',
    starts_at: '2026-06-01T10:00:00Z',
    status: 'confirmed',
  }),
}))

import { emitCalendarEvent } from '@/lib/scheduling/transition'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'

// ─── Supabase chain factory ───────────────────────────────────────────────────

function makeChain(terminalResult = { data: null as unknown, error: null as unknown }) {
  const resolved = Promise.resolve(terminalResult)
  return {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(terminalResult),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: resolved.then.bind(resolved),
  }
}

interface FakeWorkflow {
  id: string
  current_version_id: string | null
  definition?: Record<string, unknown>
}

function makeSupabase(workflows: FakeWorkflow[]) {
  const workflowRows = workflows.map((w) => ({ id: w.id, current_version_id: w.current_version_id }))

  const versionRows = workflows
    .filter((w) => w.current_version_id && w.definition)
    .map((w) => ({ id: w.current_version_id, definition: w.definition }))

  // Each from() call returns a chain. We switch on the table name so that
  // workflows, workflow_versions, and event_dispatches all behave correctly.
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workflows') {
        return makeChain({ data: workflowRows, error: null })
      }
      if (table === 'workflow_versions') {
        return makeChain({ data: versionRows, error: null })
      }
      if (table === 'event_dispatches') {
        return makeChain({ data: { id: 'dispatch-1' }, error: null })
      }
      return makeChain({ data: null, error: null })
    }),
  } as unknown as SupabaseClient<Database>
}

const SIMPLE_DEFINITION = {
  trigger: { type: 'event', event: 'meeting.confirmed' },
  nodes: [{ id: 'n1', kind: 'log', message: 'confirmed!' }],
  edges: [{ from: 'trigger', to: 'n1' }],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('emitCalendarEvent — lib/scheduling/transition.ts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls runFlowSync for each matched active workflow', async () => {
    const supabase = makeSupabase([
      { id: 'wf-a', current_version_id: 'ver-a', definition: SIMPLE_DEFINITION },
      { id: 'wf-b', current_version_id: 'ver-b', definition: SIMPLE_DEFINITION },
    ])

    const result = await emitCalendarEvent(
      { supabase },
      { event: 'meeting.confirmed', booking_id: 'book-1', org_id: 'org-1' },
    )

    // Let the fire-and-forget void promises settle
    await new Promise((r) => setImmediate(r))

    expect(result.dispatched).toBe(2)
    expect(vi.mocked(runFlowSync)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(runFlowSync)).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-a',
        definition: SIMPLE_DEFINITION,
        context: expect.objectContaining({ orgId: 'org-1' }),
      }),
    )
  })

  it('returns dispatched:0 when no workflows match', async () => {
    const supabase = makeSupabase([])

    const result = await emitCalendarEvent(
      { supabase },
      { event: 'meeting.confirmed', booking_id: 'book-1', org_id: 'org-1' },
    )

    await new Promise((r) => setImmediate(r))

    expect(result.dispatched).toBe(0)
    expect(vi.mocked(runFlowSync)).not.toHaveBeenCalled()
  })

  it('returns dispatched:0 when workflow has no current_version_id', async () => {
    const supabase = makeSupabase([
      { id: 'wf-a', current_version_id: null },
    ])

    const result = await emitCalendarEvent(
      { supabase },
      { event: 'meeting.confirmed', booking_id: 'book-1', org_id: 'org-1' },
    )

    await new Promise((r) => setImmediate(r))

    // Workflow matched but has no version → not dispatched
    expect(result.dispatched).toBe(0)
    expect(vi.mocked(runFlowSync)).not.toHaveBeenCalled()
  })

  it('respects cascade depth limit (MAX_CASCADE_DEPTH = 3)', async () => {
    const supabase = makeSupabase([
      { id: 'wf-a', current_version_id: 'ver-a', definition: SIMPLE_DEFINITION },
    ])

    const result = await emitCalendarEvent(
      { supabase, depth: 4 },
      { event: 'meeting.confirmed', booking_id: 'book-1', org_id: 'org-1' },
    )

    await new Promise((r) => setImmediate(r))

    expect(result.dispatched).toBe(0)
    expect(vi.mocked(runFlowSync)).not.toHaveBeenCalled()
  })

  it('passes rescheduled_from/to into triggerInput for meeting.rescheduled', async () => {
    const supabase = makeSupabase([
      { id: 'wf-a', current_version_id: 'ver-a', definition: SIMPLE_DEFINITION },
    ])

    await emitCalendarEvent(
      { supabase },
      {
        event: 'meeting.rescheduled',
        booking_id: 'book-1',
        org_id: 'org-1',
        rescheduled_from: '2026-06-01T10:00:00Z',
        rescheduled_to: '2026-06-02T10:00:00Z',
      },
    )

    await new Promise((r) => setImmediate(r))

    expect(vi.mocked(runFlowSync)).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerInput: expect.objectContaining({
          event: 'meeting.rescheduled',
        }),
      }),
    )
  })

  it('records a dispatch audit row even when no workflows match', async () => {
    const supabase = makeSupabase([])

    const result = await emitCalendarEvent(
      { supabase },
      { event: 'meeting.no_show', booking_id: 'book-1', org_id: 'org-1' },
    )

    expect(result.dispatch_id).toBe('dispatch-1')
    expect(supabase.from).toHaveBeenCalledWith('event_dispatches')
  })

  it('does not throw if runFlowSync rejects (fire-and-forget error handling)', async () => {
    vi.mocked(runFlowSync).mockRejectedValueOnce(new Error('runner_crashed'))
    const supabase = makeSupabase([
      { id: 'wf-a', current_version_id: 'ver-a', definition: SIMPLE_DEFINITION },
    ])

    await expect(
      emitCalendarEvent(
        { supabase },
        { event: 'meeting.confirmed', booking_id: 'book-1', org_id: 'org-1' },
      ),
    ).resolves.not.toThrow()

    // Let the rejection settle without crashing the test
    await new Promise((r) => setImmediate(r))
  })
})
