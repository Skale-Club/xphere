import { yamlToFlow } from '@/lib/workflows/yaml-to-flow'
import type { WorkflowDefinition } from '@/lib/workflows/validate'

describe('yamlToFlow', () => {
  it('converts trigger-only workflow', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'meeting.confirmed' },
      nodes: [{ id: 'action1', kind: 'send_sms', to: '{{meeting.attendee_contact.phone}}', body: 'Hi' }],
      edges: [{ from: 'trigger', to: 'action1' }],
    }
    const result = yamlToFlow(def, { slug: 'test-flow' })

    expect(result.version).toBe(1)
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
    expect(result.metadata).toEqual({ tags: ['platform-default'] })
    expect(result.variables).toEqual([])
  })

  it('creates trigger node with correct event_type', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'meeting.scheduled' },
      nodes: [],
      edges: [],
    }
    const result = yamlToFlow(def, { slug: 'test' })

    const trigger = (result.nodes as Record<string, unknown>[]).find((n) => n.type === 'trigger')
    expect(trigger).toBeDefined()
    expect((trigger as Record<string, unknown>).id).toBe('trigger')
    expect(((trigger as Record<string, unknown>).data as Record<string, unknown>).event_type).toBe('meeting.scheduled')
  })

  it('uses manual trigger event when no event specified', () => {
    const def: WorkflowDefinition = { nodes: [{ id: 'n1', kind: 'http_request' }], edges: [] }
    const result = yamlToFlow(def, { slug: 'test' })

    const trigger = (result.nodes as Record<string, unknown>[]).find((n) => n.type === 'trigger')
    expect(((trigger as Record<string, unknown>).data as Record<string, unknown>).event_type).toBe('manual')
  })

  it('converts action nodes with config', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'meeting.created' },
      nodes: [{ id: 'sms1', kind: 'send_sms', to: '+551199999999', body: 'Hello' }],
      edges: [{ from: 'trigger', to: 'sms1' }],
    }
    const result = yamlToFlow(def, { slug: 'test' })

    const action = (result.nodes as Record<string, unknown>[]).find((n) => n.type === 'action')
    expect(action).toBeDefined()
    const data = (action as Record<string, unknown>).data as Record<string, unknown>
    expect(data.action_type).toBe('send_sms')
    expect((data.config as Record<string, unknown>).to).toBe('+551199999999')
    expect((data.config as Record<string, unknown>).body).toBe('Hello')
    expect(data.label).toBe('sms1')
  })

  it('converts wait nodes', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'meeting.ended' },
      nodes: [{ id: 'wait1', kind: 'wait', duration: '1h' }],
      edges: [{ from: 'trigger', to: 'wait1' }],
    }
    const result = yamlToFlow(def, { slug: 'test' })

    const wait = (result.nodes as Record<string, unknown>[]).find((n) => n.type === 'wait')
    expect(wait).toBeDefined()
    const data = (wait as Record<string, unknown>).data as Record<string, unknown>
    expect(data.kind).toBe('wait')
    expect(data.duration).toBe('1h')
  })

  it('converts edges with source and target', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'x' },
      nodes: [
        { id: 'a1', kind: 'send_sms' },
        { id: 'a2', kind: 'http_request' },
      ],
      edges: [
        { from: 'trigger', to: 'a1' },
        { from: 'a1', to: 'a2' },
      ],
    }
    const result = yamlToFlow(def, { slug: 'test' })

    const resultEdges = result.edges as Array<{ id: string; source: string; target: string }>
    expect(resultEdges).toHaveLength(2)
    expect(resultEdges[0]).toMatchObject({ source: 'trigger', target: 'a1' })
    expect(resultEdges[1]).toMatchObject({ source: 'a1', target: 'a2' })
  })

  it('assigns auto-layout positions in BFS order', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'x' },
      nodes: [
        { id: 'a1', kind: 'send_sms' },
        { id: 'a2', kind: 'send_sms' },
        { id: 'a3', kind: 'send_sms' },
      ],
      edges: [
        { from: 'trigger', to: 'a1' },
        { from: 'a1', to: 'a2' },
        { from: 'a2', to: 'a3' },
      ],
    }
    const result = yamlToFlow(def, { slug: 'test' })

    const resultNodes = result.nodes as Array<{ id: string; position: { x: number; y: number } }>
    const trigger = resultNodes.find((n) => n.id === 'trigger')
    const a1 = resultNodes.find((n) => n.id === 'a1')
    const a2 = resultNodes.find((n) => n.id === 'a2')
    const a3 = resultNodes.find((n) => n.id === 'a3')

    expect(trigger!.position).toEqual({ x: 300, y: 50 })
    expect(a1!.position.y).toBeGreaterThan(trigger!.position.y)
    expect(a2!.position.y).toBeGreaterThan(a1!.position.y)
    expect(a3!.position.y).toBeGreaterThan(a2!.position.y)
  })

  it('handles empty nodes and edges', () => {
    const def: WorkflowDefinition = { trigger: { type: 'event', event: 'x' } }
    const result = yamlToFlow(def, { slug: 'empty' })
    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
  })

  it('preserves extra node fields in config', () => {
    const def: WorkflowDefinition = {
      trigger: { type: 'event', event: 'x' },
      nodes: [{ id: 't1', kind: 'send_telegram_notification', integration: 'telegram', text: 'hello', parse_mode: 'HTML' }],
      edges: [{ from: 'trigger', to: 't1' }],
    }
    const result = yamlToFlow(def, { slug: 'test' })

    const action = (result.nodes as Record<string, unknown>[]).find((n) => n.type === 'action')
    const config = (action as Record<string, unknown>).data as Record<string, unknown>
    expect(config.action_type).toBe('send_telegram_notification')
    expect((config.config as Record<string, unknown>).integration).toBe('telegram')
    expect((config.config as Record<string, unknown>).text).toBe('hello')
    expect((config.config as Record<string, unknown>).parse_mode).toBe('HTML')
  })
})
