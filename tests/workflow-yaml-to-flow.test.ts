// What a YAML node carries into the stored flow definition.
//
// The case that matters here is `fallback_message`. It is not an action
// parameter — it is what the assistant SAYS when the executor throws — and it
// has to land on the node's data, where resolveWorkflowAsTool() reads it.
// Left inside `config`, the tool resolves with an empty fallback, and on a
// phone call an empty fallback is the robot going silent mid-sentence. That is
// how this was found: a tool call that hit a container mid-rollout answered
// with "" and a 200, and the caller would have heard nothing at all.

import { describe, it, expect } from 'vitest'
import { yamlToFlow } from '@/lib/workflows/yaml-to-flow'
import type { WorkflowDefinition } from '@/lib/workflows/validate'

const definition = (nodes: Record<string, unknown>[]): WorkflowDefinition =>
  ({
    name: 'test',
    trigger: { type: 'tool_call', config: { tool_name: 'test_tool' } },
    nodes,
    edges: [{ from: 'trigger', to: String(nodes[0]?.id ?? 'a') }],
  }) as unknown as WorkflowDefinition

function actionNode(flow: Record<string, unknown>): Record<string, unknown> {
  const nodes = flow.nodes as { type: string; data: Record<string, unknown> }[]
  const node = nodes.find((n) => n.type === 'action')
  expect(node, 'no action node in the converted flow').toBeTruthy()
  return node!.data
}

describe('yamlToFlow', () => {
  it('lifts fallback_message out of config and onto the node', () => {
    const flow = yamlToFlow(
      definition([
        {
          id: 'slots',
          kind: 'calendar_list_slots',
          event_type: 'conversa-inicial',
          date: '{{input.date}}',
          fallback_message: 'I could not read the calendar just now.',
        },
      ]),
      { slug: 'test' },
    )

    const data = actionNode(flow)
    expect(data.fallback_message).toBe('I could not read the calendar just now.')
    expect(data.config).toEqual({ event_type: 'conversa-inicial', date: '{{input.date}}' })
  })

  it('leaves it off entirely when the YAML does not set one', () => {
    const data = actionNode(
      yamlToFlow(definition([{ id: 'slots', kind: 'calendar_list_slots', date: '{{input.date}}' }]), {
        slug: 'test',
      }),
    )
    expect(data).not.toHaveProperty('fallback_message')
  })

  it('ignores a blank one rather than storing silence', () => {
    const data = actionNode(
      yamlToFlow(definition([{ id: 'slots', kind: 'calendar_list_slots', fallback_message: '   ' }]), {
        slug: 'test',
      }),
    )
    expect(data).not.toHaveProperty('fallback_message')
  })

  it('still carries every other key through as action config', () => {
    const data = actionNode(
      yamlToFlow(
        definition([
          {
            id: 'book',
            kind: 'calendar_book_meeting',
            label: 'Book it',
            event_type: 'conversa-inicial',
            require_voice_confirmation: true,
            fallback_message: 'Nothing was booked.',
          },
        ]),
        { slug: 'test' },
      ),
    )
    expect(data.label).toBe('Book it')
    expect(data.action_type).toBe('calendar_book_meeting')
    expect(data.config).toEqual({ event_type: 'conversa-inicial', require_voice_confirmation: true })
    expect(data.fallback_message).toBe('Nothing was booked.')
  })
})
