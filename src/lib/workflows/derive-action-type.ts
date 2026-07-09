// SEED-033: extract the single action_type from a kind='tool' workflow
// definition. A tool workflow is a 1-action graph; multi-action graphs are
// kind='flow' and should not be passed here.
//
// Accepts both shapes seen in the codebase:
//   - YAML/spec shape: { trigger: {...}, nodes: [{ id, kind: 'send_sms', ... }] }
//   - Flow engine shape: { nodes: [{ id, type: 'action', data: { kind: 'action', action_type: 'send_sms', ... } }] }

interface YamlStyleNode {
  id?: string
  kind?: string
  [k: string]: unknown
}

interface FlowEngineNode {
  id?: string
  type?: string
  data?: {
    kind?: string
    action_type?: string
    [k: string]: unknown
  }
}

export function extractActionTypeFromDefinition(definition: unknown): string {
  if (!definition || typeof definition !== 'object') return 'unknown'
  const def = definition as Record<string, unknown>
  const nodes = (def.nodes as Array<YamlStyleNode | FlowEngineNode> | undefined) ?? []

  const nonTriggerNodes: Array<{ actionType: string }> = []

  for (const node of nodes) {
    // Flow engine shape | node has top-level `type` and `data.kind`
    const fe = node as FlowEngineNode
    if (fe.type && fe.data && typeof fe.data === 'object') {
      const dataKind = fe.data.kind
      if (fe.type === 'trigger' || dataKind === 'trigger') continue
      if (dataKind === 'action' && typeof fe.data.action_type === 'string') {
        nonTriggerNodes.push({ actionType: fe.data.action_type })
        continue
      }
      // condition/wait/end nodes have no action_type | skip
      if (dataKind && dataKind !== 'action') continue
    }

    // YAML/spec shape | node has top-level `kind` (the action name).
    // Control-flow kinds are not actions — skip so a condition/wait/end node is
    // never returned as the workflow's action_type.
    const ys = node as YamlStyleNode
    const CONTROL_FLOW = new Set(['trigger', 'condition', 'wait', 'end', 'agent'])
    if (typeof ys.kind === 'string' && ys.id !== 'trigger' && !CONTROL_FLOW.has(ys.kind)) {
      nonTriggerNodes.push({ actionType: ys.kind })
    }
  }

  if (nonTriggerNodes.length === 0) return 'unknown'
  // Multiple non-trigger action nodes means the workflow should be kind='flow'.
  // We still return the first node's action_type so callers can degrade
  // gracefully, but log a warning to surface the misconfiguration.
  if (nonTriggerNodes.length > 1) {
    console.warn(
      JSON.stringify({
        event: 'extract_action_type_multiple_nodes',
        count: nonTriggerNodes.length,
        first: nonTriggerNodes[0].actionType,
      }),
    )
  }
  return nonTriggerNodes[0].actionType
}
