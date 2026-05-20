// SEED-026 Phase A: pure workflow validator with structured errors.
//
// Designed for LLM consumption: every error carries a `suggestion` field
// engineered so the Copilot or external coding agent can read the error
// and fix the YAML/JSON on the next attempt without human help.
//
// Inputs: a workflow definition (parsed YAML/JSON) + the org-filtered spec.
// Output: { ok, errors[] } — never throws.

import type { WorkflowSpec } from '@/lib/workflows/spec'

export interface ValidationError {
  path: string                                // JSON path into the definition
  code: ValidationCode
  message: string
  suggestion: string
}

export type ValidationCode =
  | 'missing_field'
  | 'invalid_type'
  | 'unknown_trigger'
  | 'unknown_node_type'
  | 'unknown_integration'
  | 'integration_unavailable'
  | 'unresolved_variable'
  | 'duplicate_node_id'
  | 'cycle_detected'
  | 'unreachable_node'
  | 'no_trigger'
  | 'invalid_edge'
  | 'invalid_config'

export interface WorkflowDefinition {
  name?: string
  description?: string
  trigger?: {
    type?: string
    event?: string
    config?: Record<string, unknown>
  }
  nodes?: Array<{
    id: string
    kind: string
    integration?: string
    [k: string]: unknown
  }>
  edges?: Array<{ from: string; to: string }>
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

// Variable scope is tracked as a set of prefixes. A reference like
// `{{contact.phone}}` is valid if `contact.` is in scope (we don't validate
// the leaf field — the runtime resolves the actual lookup).
function buildInitialScope(triggerType: string): Set<string> {
  const scope = new Set<string>(['trigger', 'input'])
  if (triggerType.startsWith('event:meeting.')) {
    scope.add('meeting')
    scope.add('contact')
  }
  if (triggerType.startsWith('event:contact.')) {
    scope.add('contact')
  }
  if (triggerType.startsWith('event:workflow.')) {
    scope.add('workflow')
  }
  if (triggerType === 'tool_call' || triggerType === 'webhook_url' || triggerType === 'manual') {
    scope.add('contact')          // contact is opportunistic — present when caller provides it
  }
  return scope
}

function extractVariableRefs(value: unknown, out: string[] = []): string[] {
  if (value == null) return out
  if (typeof value === 'string') {
    const re = /\{\{([^}]+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      out.push(m[1].trim())
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const v of value) extractVariableRefs(v, out)
    return out
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      extractVariableRefs(v, out)
    }
    return out
  }
  return out
}

function variableInScope(ref: string, scope: Set<string>): boolean {
  // A ref is in scope if its top-level prefix is in scope.
  // 'contact.phone' → top-level 'contact'; 'meeting.attendee_contact.phone' → 'meeting'.
  const top = ref.split('.')[0]
  return scope.has(top)
}

export function validateWorkflow(
  definition: WorkflowDefinition,
  spec: WorkflowSpec,
): ValidationResult {
  const errors: ValidationError[] = []

  // ─── Trigger ────────────────────────────────────────────────────────────────
  const trigger = definition.trigger
  if (!trigger || !trigger.type) {
    errors.push({
      path: 'trigger',
      code: 'no_trigger',
      message: 'Workflow must declare a trigger.',
      suggestion:
        'Add a `trigger` block with a `type` field. Common types: ' +
        spec.triggers.slice(0, 3).map((t) => `"${t.type}"`).join(', ') + '.',
    })
    return { ok: false, errors }
  }

  const triggerKey = trigger.event ? `event:${trigger.event}` : trigger.type
  const triggerSpec = spec.triggers.find((t) => t.type === triggerKey)

  if (!triggerSpec) {
    errors.push({
      path: 'trigger.type',
      code: 'unknown_trigger',
      message: `Trigger "${triggerKey}" is not registered.`,
      suggestion:
        'Use one of: ' +
        spec.triggers.map((t) => `"${t.type}"`).slice(0, 8).join(', ') +
        '. See the full list at the /api/workflows/spec endpoint.',
    })
  }

  // SEED-033: tool_call triggers must declare an `input_schema` so the agent
  // runtime can derive a Zod schema for the LLM to satisfy. Workflows whose
  // trigger is `tool_call` without `input_schema` are blocked because the
  // LLM has no idea what shape the input should take.
  if (triggerKey === 'tool_call') {
    const triggerConfig = (trigger.config ?? {}) as Record<string, unknown>
    const inputSchema = triggerConfig.input_schema as Record<string, unknown> | undefined
    if (
      !inputSchema ||
      typeof inputSchema !== 'object' ||
      Array.isArray(inputSchema) ||
      Object.keys(inputSchema).length === 0
    ) {
      errors.push({
        path: 'trigger.config.input_schema',
        code: 'missing_field',
        message:
          'tool_call triggers require an `input_schema` describing the fields the AI agent must provide.',
        suggestion:
          'Add `trigger.config.input_schema` with one entry per input field, e.g. ' +
          '`{ to: { type: "string", required: true, description: "Phone number" } }`. ' +
          'See WORKFLOWS.md for the full shape.',
      })
    }
  }

  const scope = buildInitialScope(triggerKey)

  // ─── Nodes ──────────────────────────────────────────────────────────────────
  const nodes = definition.nodes ?? []
  if (nodes.length === 0) {
    errors.push({
      path: 'nodes',
      code: 'missing_field',
      message: 'Workflow must contain at least one node.',
      suggestion: 'Add an action node — for example { id: "notify", kind: "send_sms", ... }.',
    })
  }

  const seenIds = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const path = `nodes[${i}]`

    if (!node.id) {
      errors.push({
        path: `${path}.id`,
        code: 'missing_field',
        message: 'Node is missing required field "id".',
        suggestion: 'Add a unique string id for this node, e.g. "send-reminder".',
      })
      continue
    }
    if (seenIds.has(node.id)) {
      errors.push({
        path: `${path}.id`,
        code: 'duplicate_node_id',
        message: `Duplicate node id "${node.id}".`,
        suggestion: 'Every node must have a unique id within the workflow.',
      })
    }
    seenIds.add(node.id)

    const nodeSpec = spec.nodes.find((n) => n.type === node.kind)
    if (!nodeSpec) {
      errors.push({
        path: `${path}.kind`,
        code: 'unknown_node_type',
        message: `Unknown node kind "${node.kind}".`,
        suggestion:
          'Available node kinds for this org: ' +
          spec.nodes.map((n) => `"${n.type}"`).slice(0, 8).join(', ') +
          (spec.nodes.length > 8 ? ', …' : '') + '.',
      })
      continue
    }

    // Integration availability
    if (node.integration) {
      const integration = String(node.integration)
      if (
        nodeSpec.integration_required &&
        !nodeSpec.integration_required.includes(integration)
      ) {
        errors.push({
          path: `${path}.integration`,
          code: 'unknown_integration',
          message: `Node "${node.kind}" cannot use integration "${integration}".`,
          suggestion:
            `Use one of: ${nodeSpec.integration_required.map((p) => `"${p}"`).join(', ')}.`,
        })
      }
      if (!spec.available_integrations.includes(integration)) {
        errors.push({
          path: `${path}.integration`,
          code: 'integration_unavailable',
          message: `Integration "${integration}" is not connected for this org.`,
          suggestion:
            `Available integrations: ${
              spec.available_integrations.map((p) => `"${p}"`).join(', ') || '(none connected)'
            }. ` +
            'Connect the integration in /integrations or pick a different node kind.',
        })
      }
    } else if (nodeSpec.integration_required && nodeSpec.integration_required.length > 0) {
      // Pick an available one when the node requires an integration but none specified.
      const candidates = nodeSpec.integration_required.filter((p) =>
        spec.available_integrations.includes(p),
      )
      if (candidates.length === 0) {
        errors.push({
          path: `${path}.integration`,
          code: 'integration_unavailable',
          message:
            `Node "${node.kind}" requires one of [${nodeSpec.integration_required.join(', ')}] ` +
            'but none are connected for this org.',
          suggestion:
            'Connect a supported integration first, or remove this node from the workflow.',
        })
      }
    }

    // Variable references — every {{ref}} in the node body must be in scope.
    const refs = extractVariableRefs(node)
    for (const ref of refs) {
      if (!variableInScope(ref, scope)) {
        errors.push({
          path,
          code: 'unresolved_variable',
          message: `{{${ref}}} is not in scope at this node.`,
          suggestion:
            'Variables available at this trigger: ' +
            (triggerSpec?.variables.join(', ') ?? 'trigger.*, input.*') +
            '. Pick a variable from a namespace that is in scope, or move this node downstream of a node that produces the value.',
        })
      }
    }

    // After this node executes, its id becomes available as a scope prefix.
    // This is how downstream nodes reference earlier outputs.
    scope.add(node.id)
  }

  // ─── Edges ──────────────────────────────────────────────────────────────────
  const edges = definition.edges ?? []
  const adjacency: Record<string, string[]> = {}
  const incoming = new Set<string>()

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (!e.from || !e.to) {
      errors.push({
        path: `edges[${i}]`,
        code: 'invalid_edge',
        message: 'Edge missing required field "from" or "to".',
        suggestion: 'Each edge must specify both `from` and `to` node ids.',
      })
      continue
    }
    if (e.from !== 'trigger' && !seenIds.has(e.from)) {
      errors.push({
        path: `edges[${i}].from`,
        code: 'invalid_edge',
        message: `Edge references unknown node "${e.from}".`,
        suggestion: `Use one of: ${['trigger', ...seenIds].join(', ')}.`,
      })
    }
    if (!seenIds.has(e.to)) {
      errors.push({
        path: `edges[${i}].to`,
        code: 'invalid_edge',
        message: `Edge references unknown node "${e.to}".`,
        suggestion: `Use one of: ${[...seenIds].join(', ')}.`,
      })
    }
    adjacency[e.from] = adjacency[e.from] ?? []
    adjacency[e.from].push(e.to)
    incoming.add(e.to)
  }

  // ─── Cycle detection ────────────────────────────────────────────────────────
  function detectCycle(start: string): boolean {
    const stack = [{ node: start, path: new Set<string>() }]
    while (stack.length > 0) {
      const { node, path } = stack.pop()!
      if (path.has(node)) return true
      const nextPath = new Set(path)
      nextPath.add(node)
      for (const next of adjacency[node] ?? []) {
        stack.push({ node: next, path: nextPath })
      }
    }
    return false
  }
  for (const id of ['trigger', ...seenIds]) {
    if (detectCycle(id)) {
      errors.push({
        path: 'edges',
        code: 'cycle_detected',
        message: 'Workflow graph contains a cycle.',
        suggestion:
          'Remove or restructure edges so that no path returns to a previously-visited node.',
      })
      break
    }
  }

  // ─── Reachability ───────────────────────────────────────────────────────────
  for (const node of nodes) {
    if (!incoming.has(node.id)) {
      // Allowed: nodes connected from "trigger".
      const reachableFromTrigger = (adjacency.trigger ?? []).includes(node.id)
      if (!reachableFromTrigger) {
        errors.push({
          path: `nodes[${node.id}]`,
          code: 'unreachable_node',
          message: `Node "${node.id}" has no incoming edge from the trigger or any other node.`,
          suggestion:
            `Add an edge from "trigger" (or another node) to "${node.id}" — or remove this node.`,
        })
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
