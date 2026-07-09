import type { WorkflowDefinition } from '@/lib/workflows/validate'

const TRIGGER_X = 300
const TRIGGER_Y = 50
const V_SPACING = 120

interface ConvertOptions {
  slug: string
  eventType?: string
}

export function yamlToFlow(definition: WorkflowDefinition, _options: ConvertOptions): Record<string, unknown> {
  const nodes: Record<string, unknown>[] = []
  const edges: Record<string, unknown>[] = []

  const triggerEvent = definition.trigger?.event ?? 'manual'
  nodes.push({
    id: 'trigger',
    type: 'trigger',
    position: { x: TRIGGER_X, y: TRIGGER_Y },
    data: {
      kind: 'trigger',
      event_type: triggerEvent,
      label: 'Trigger',
    },
  })

  const yamlNodes = definition.nodes ?? []
  const yamlEdges = definition.edges ?? []

  const adjacency = new Map<string, string[]>()
  for (const edge of yamlEdges) {
    const from = String(edge.from ?? '')
    const to = String(edge.to ?? '')
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from)!.push(to)
  }

  const nodePositions = new Map<string, { x: number; y: number }>()
  const visited = new Set<string>()
  const queue: { id: string; depth: number }[] = [{ id: 'trigger', depth: 0 }]
  visited.add('trigger')

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    nodePositions.set(id, { x: TRIGGER_X, y: TRIGGER_Y + depth * V_SPACING })
    for (const child of adjacency.get(id) ?? []) {
      if (!visited.has(child)) {
        visited.add(child)
        queue.push({ id: child, depth: depth + 1 })
      }
    }
  }

  for (const yamlNode of yamlNodes) {
    const id = String(yamlNode.id ?? '')
    const kind = String(yamlNode.kind ?? '')
    const pos = nodePositions.get(id) ?? { x: TRIGGER_X, y: TRIGGER_Y + V_SPACING }

    if (kind === 'wait') {
      nodes.push({
        id,
        type: 'wait',
        position: pos,
        data: {
          kind: 'wait',
          duration: yamlNode.duration ?? undefined,
          label: yamlNode.label ?? id,
        },
      })
    } else if (kind === 'condition') {
      nodes.push({
        id,
        type: 'condition',
        position: pos,
        data: {
          kind: 'condition',
          expression: String(yamlNode.expression ?? ''),
          label: yamlNode.label ?? id,
        },
      })
    } else {
      const { id: _id, kind: _k, label, ...config } = yamlNode
      void _id; void _k
      nodes.push({
        id,
        type: 'action',
        position: pos,
        data: {
          kind: 'action',
          action_type: kind,
          config,
          label: label ?? id,
        },
      })
    }
  }

  let edgeCounter = 0
  for (const yamlEdge of yamlEdges) {
    edgeCounter++
    // Preserve the condition branch label so the flow engine can pick the
    // right outgoing edge. YAML authors it as `when`/`handle`; the flow engine
    // reads it from `sourceHandle`. Dropping it here collapsed every condition
    // to its first edge.
    const e = yamlEdge as Record<string, unknown>
    const branch =
      e.when !== undefined ? String(e.when)
      : e.handle !== undefined ? String(e.handle)
      : undefined
    edges.push({
      id: `e${edgeCounter}`,
      source: String(yamlEdge.from ?? ''),
      target: String(yamlEdge.to ?? ''),
      ...(branch !== undefined ? { sourceHandle: branch } : {}),
    })
  }

  return {
    version: 1,
    nodes,
    edges,
    variables: [],
    metadata: { tags: ['platform-default'] },
  }
}
