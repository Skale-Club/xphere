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

import { runFlow } from '@/lib/flows/engine'
import { executeAction } from '@/lib/action-engine/execute-action'

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
})
