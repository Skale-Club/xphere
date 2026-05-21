// Canonical Zod schema for the workflow graph.
// Single source of truth: validates DB writes, types React Flow canvas state,
// and is serialized via zod-to-json-schema for the LLM tool calls in Phase C.

import { z } from 'zod'

// ─── Node primitives ──────────────────────────────────────────────────────────

export const FlowNodeType = z.enum([
  'trigger',
  'action',
  'condition',
  'wait',
  'agent',
  'end',
])
export type FlowNodeType = z.infer<typeof FlowNodeType>

// Discriminated union: each node type has its own `data` shape.

const TriggerNodeData = z.object({
  kind: z.literal('trigger'),
  event_type: z.string().default('manual'),
  filter: z.record(z.unknown()).optional(),
  schedule_cron: z.string().optional(),
  label: z.string().default('Trigger'),
})

const ActionNodeData = z.object({
  kind: z.literal('action'),
  action_type: z.string().default('http_request'),
  config: z.record(z.unknown()).default({}),
  credential_ref: z.string().optional(),
  label: z.string().default('Action'),
})

const ConditionNodeData = z.object({
  kind: z.literal('condition'),
  expression: z.string().default(''),
  label: z.string().default('Condition'),
})

const WaitNodeData = z.object({
  kind: z.literal('wait'),
  mode: z.enum(['sleep', 'wait_for_event']).default('sleep'),
  duration: z.string().optional(),
  event_filter: z.record(z.unknown()).optional(),
  event_type: z.string().optional(),
  offset: z.string().optional(),
  timeout: z.string().optional(),
  label: z.string().default('Wait'),
})

const AgentNodeData = z.object({
  kind: z.literal('agent'),
  agent_id: z.string().optional(),
  system_prompt: z.string().default(''),
  max_steps: z.number().int().min(1).max(50).default(10),
  label: z.string().default('Agent'),
})

const EndNodeData = z.object({
  kind: z.literal('end'),
  label: z.string().default('End'),
})

export const FlowNodeData = z.discriminatedUnion('kind', [
  TriggerNodeData,
  ActionNodeData,
  ConditionNodeData,
  WaitNodeData,
  AgentNodeData,
  EndNodeData,
])
export type FlowNodeData = z.infer<typeof FlowNodeData>

// ─── Graph node + edge ────────────────────────────────────────────────────────

export const FlowNode = z.object({
  id: z.string(),
  type: FlowNodeType,
  position: z.object({ x: z.number(), y: z.number() }),
  data: FlowNodeData,
})
export type FlowNode = z.infer<typeof FlowNode>

export const FlowEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  label: z.string().optional(),
})
export type FlowEdge = z.infer<typeof FlowEdge>

// ─── Variables + metadata ─────────────────────────────────────────────────────

export const FlowVariable = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  default_value: z.string().optional(),
})
export type FlowVariable = z.infer<typeof FlowVariable>

export const FlowMetadata = z.object({
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
})
export type FlowMetadata = z.infer<typeof FlowMetadata>

// ─── Full graph definition ────────────────────────────────────────────────────

export const FlowDefinition = z.object({
  version: z.literal(1).default(1),
  nodes: z.array(FlowNode).default([]),
  edges: z.array(FlowEdge).default([]),
  variables: z.array(FlowVariable).default([]),
  metadata: FlowMetadata.default({ description: undefined, tags: [] }),
})
export type FlowDefinition = z.infer<typeof FlowDefinition>

export const emptyFlowDefinition = (): FlowDefinition => ({
  version: 1,
  nodes: [],
  edges: [],
  variables: [],
  metadata: { tags: [] },
})

// ─── Validation issues (used by validateFlow tool in Phase C) ────────────────

export type FlowIssue = {
  level: 'error' | 'warning'
  node_id?: string
  message: string
}

export function validateFlow(def: FlowDefinition): FlowIssue[] {
  const issues: FlowIssue[] = []

  const triggers = def.nodes.filter((n) => n.type === 'trigger')
  if (triggers.length === 0) {
    issues.push({ level: 'error', message: 'Flow has no trigger node' })
  }
  if (triggers.length > 1) {
    issues.push({ level: 'warning', message: 'Flow has multiple triggers; only the first will fire' })
  }

  if (def.nodes.length > 0 && def.edges.length === 0) {
    issues.push({ level: 'warning', message: 'Nodes are not connected' })
  }

  const nodeIds = new Set(def.nodes.map((n) => n.id))
  for (const edge of def.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({ level: 'error', message: `Edge ${edge.id} references missing source ${edge.source}` })
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({ level: 'error', message: `Edge ${edge.id} references missing target ${edge.target}` })
    }
  }

  return issues
}
