import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock createServiceRoleClient before importing runFlowSync so that the module
// gets the mock when it first loads.
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'sync-run-1' }, error: null }),
      then: Promise.resolve({ data: null, error: null }).then.bind(
        Promise.resolve({ data: null, error: null }),
      ),
    }),
  })),
}))

vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn().mockResolvedValue({ ok: true }),
}))

import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { executeAction } from '@/lib/action-engine/execute-action'

// ─── YAML spec shape helpers ──────────────────────────────────────────────────
// YAML spec shape: { trigger: {...}, nodes: [{id, kind, ...config}], edges: [{from, to}] }

function yamlDef(opts: {
  event?: string
  nodes?: Record<string, unknown>[]
  edges?: { from: string; to: string }[]
}) {
  return {
    trigger: { type: 'event', event: opts.event ?? 'meeting.confirmed' },
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
  }
}

// ─── FlowDefinition shape helpers ────────────────────────────────────────────
// Flow engine shape: { version: 1, nodes: [{id, type, position, data}], edges: [{id, source, target}] }

function flowDef(opts: {
  nodes?: Record<string, unknown>[]
  edges?: Record<string, unknown>[]
}) {
  return {
    version: 1,
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
  }
}

function flowTrig(id = 'trigger') {
  return { id, type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', event_type: 'manual', label: 'T' } }
}

function flowAct(id: string, actionType = 'send_sms', config: Record<string, unknown> = {}) {
  return { id, type: 'action', position: { x: 0, y: 0 }, data: { kind: 'action', action_type: actionType, config, label: 'A' } }
}

function flowEdge(source: string, target: string) {
  return { id: `e-${source}-${target}`, source, target }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runFlowSync — lib/workflows/run-flow-sync.ts', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── Graph shape + normalization ──────────────────────────────────────────

  it('returns ok:false for an empty definition (no nodes)', async () => {
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition: {},
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('workflow_has_no_nodes')
  })

  it('YAML shape: normalizes trigger+action, skips trigger, calls executeAction', async () => {
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'send_sms', to: '+1555', body: 'hi' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.objectContaining({ to: '+1555', body: 'hi' }),
      expect.any(Object),
      expect.objectContaining({ organizationId: 'org-1' }),
    )
  })

  it('FlowDefinition shape: normalizes trigger+action, skips trigger, calls executeAction', async () => {
    const definition = flowDef({
      nodes: [flowTrig(), flowAct('a1', 'create_contact', { email: 'test@test.com' })],
      edges: [flowEdge('trigger', 'a1')],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'create_contact',
      expect.objectContaining({ email: 'test@test.com' }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  // ── Variable interpolation ───────────────────────────────────────────────

  it('interpolates {{meeting.attendee_contact.name}} from triggerInput into action config', async () => {
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'send_sms', to: '+1555', body: 'Hi {{meeting.attendee_contact.name}}' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: { meeting: { attendee_contact: { name: 'Alice' } } },
      context: { orgId: 'org-1' },
    })
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.objectContaining({ body: 'Hi Alice' }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('interpolates missing path as empty string (no crash)', async () => {
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'send_sms', to: '+1555', body: '{{contact.missing.field}}' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.objectContaining({ body: '' }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('promotes top-level triggerInput keys into scope ({{opportunity.title}} resolves)', async () => {
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'send_sms', to: '+1555', body: '{{opportunity.title}}' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: { opportunity: { title: 'Big Deal' } },
      context: { orgId: 'org-1' },
    })
    expect(vi.mocked(executeAction)).toHaveBeenCalledWith(
      'send_sms',
      expect.objectContaining({ body: 'Big Deal' }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  // ── Wait node ────────────────────────────────────────────────────────────

  it('wait node returns early with a background note (does not block)', async () => {
    const definition = yamlDef({
      nodes: [
        { id: 'w1', kind: 'wait', duration: '1h' },
        { id: 'n1', kind: 'send_sms', to: '+1555', body: 'after wait' },
      ],
      edges: [{ from: 'trigger', to: 'w1' }, { from: 'w1', to: 'n1' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    expect(String(result.result)).toContain('background')
    // The action after the wait is NOT executed — we returned early
    expect(vi.mocked(executeAction)).not.toHaveBeenCalled()
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns ok:false when executeAction throws', async () => {
    vi.mocked(executeAction).mockRejectedValueOnce(new Error('network_error'))
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'send_sms', to: '+1555', body: 'hi' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network_error')
  })

  it('stops after first failing action and does not run subsequent nodes', async () => {
    vi.mocked(executeAction).mockRejectedValueOnce(new Error('step1_failed'))
    const definition = yamlDef({
      nodes: [
        { id: 'n1', kind: 'send_sms', to: '+1', body: 'first' },
        { id: 'n2', kind: 'send_sms', to: '+2', body: 'second' },
      ],
      edges: [{ from: 'trigger', to: 'n1' }, { from: 'n1', to: 'n2' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(false)
    // Only one call — the failing first node
    expect(vi.mocked(executeAction)).toHaveBeenCalledOnce()
  })

  // ── Timeout ───────────────────────────────────────────────────────────────

  it('returns timed_out:true when execution exceeds timeoutMs', async () => {
    vi.mocked(executeAction).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 300)),
    )
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'send_sms', to: '+1555', body: 'slow' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
      timeoutMs: 50,
    })
    expect(result.timed_out).toBe(true)
    expect(result.ok).toBe(true)
  })

  // ── run_id tracking ───────────────────────────────────────────────────────

  it('returns run_id from workflow_runs insert', async () => {
    const definition = yamlDef({
      nodes: [{ id: 'n1', kind: 'log', message: 'hello' }],
      edges: [{ from: 'trigger', to: 'n1' }],
    })
    const result = await runFlowSync({
      workflowId: 'wf-1',
      definition,
      triggerInput: {},
      context: { orgId: 'org-1' },
    })
    expect(result.ok).toBe(true)
    expect(result.run_id).toBe('sync-run-1')
  })
})
