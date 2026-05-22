import { validateFlow, type FlowDefinition } from '@/lib/flows/schema'

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    version: 1,
    nodes: [],
    edges: [],
    variables: [],
    metadata: { tags: [] },
    ...overrides,
  }
}

function triggerNode(id = 't1'): FlowDefinition['nodes'][0] {
  return { id, type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'trigger', event_type: 'manual', label: 'Trigger' } }
}

function actionNode(id = 'a1'): FlowDefinition['nodes'][0] {
  return { id, type: 'action', position: { x: 0, y: 0 }, data: { kind: 'action', action_type: 'send_sms', config: {}, label: 'Action' } }
}

describe('validateFlow', () => {
  it('returns error when flow has no trigger node', () => {
    const issues = validateFlow(makeFlow({ nodes: [actionNode()] }))
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ message: 'Flow has no trigger node' })
  })

  it('returns warning for multiple triggers', () => {
    const issues = validateFlow(makeFlow({ nodes: [triggerNode('t1'), triggerNode('t2')] }))
    const warnings = issues.filter((i) => i.level === 'warning')
    expect(warnings.some((w) => w.message.includes('multiple triggers'))).toBe(true)
  })

  it('returns warning when nodes exist but no edges', () => {
    const issues = validateFlow(makeFlow({ nodes: [triggerNode(), actionNode()], edges: [] }))
    const warnings = issues.filter((i) => i.level === 'warning')
    expect(warnings.some((w) => w.message.includes('not connected'))).toBe(true)
  })

  it('returns error for edge referencing non-existent source', () => {
    const issues = validateFlow(makeFlow({
      nodes: [triggerNode(), actionNode('a1')],
      edges: [{ id: 'e1', source: 'ghost', target: 'a1' }],
    }))
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors.some((e) => e.message.includes('missing source ghost'))).toBe(true)
  })

  it('returns error for edge referencing non-existent target', () => {
    const issues = validateFlow(makeFlow({
      nodes: [triggerNode('t1'), actionNode('a1')],
      edges: [{ id: 'e1', source: 't1', target: 'ghost' }],
    }))
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors.some((e) => e.message.includes('missing target ghost'))).toBe(true)
  })

  it('returns errors for every missing edge endpoint', () => {
    const issues = validateFlow(makeFlow({
      nodes: [triggerNode('t1')],
      edges: [
        { id: 'e1', source: 'ghost1', target: 'ghost2' },
      ],
    }))
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(2)
    expect(errors[0].message).toContain('ghost1')
    expect(errors[1].message).toContain('ghost2')
  })

  it('returns warning for a trigger-only flow (no edges)', () => {
    const issues = validateFlow(makeFlow({
      nodes: [triggerNode('t1')],
      edges: [],
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warning', message: expect.stringContaining('not connected') })
  })

  it('returns no issues for a valid linear flow', () => {
    const issues = validateFlow(makeFlow({
      nodes: [triggerNode('t1'), actionNode('a1')],
      edges: [{ id: 'e1', source: 't1', target: 'a1' }],
    }))
    expect(issues).toHaveLength(0)
  })
})
