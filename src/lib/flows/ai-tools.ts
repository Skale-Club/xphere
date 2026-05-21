// AI Builder | tool definitions exposed to Claude for graph mutation.
// These are described to the model as Anthropic tool-use schemas; their
// implementations apply mutations to a working FlowDefinition snapshot.

import type Anthropic from '@anthropic-ai/sdk'
import type { FlowDefinition, FlowNode, FlowNodeData, FlowNodeType } from './schema'

export const NODE_TYPE_VALUES: FlowNodeType[] = [
  'trigger', 'action', 'condition', 'wait', 'agent', 'end',
]

// ─── Tool schemas (Anthropic Tool[]) ──────────────────────────────────────────

export const AI_BUILDER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_nodes',
    description: 'Returns the current flow snapshot | all nodes and edges. Call this first to understand the existing graph before mutating it.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'add_node',
    description: 'Add a new node to the canvas. Returns the new node id, which you can use to connect it.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: NODE_TYPE_VALUES,
          description: 'Node type. Every flow needs exactly one trigger and usually an end.',
        },
        label: { type: 'string', description: 'Human-readable label shown on the node.' },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y'],
        },
        config: {
          type: 'object',
          description: 'Type-specific config. For action: { action_type, config }. For trigger: { event_type }. For condition: { expression }. For wait: { mode, duration }. For agent: { system_prompt, max_steps }.',
        },
      },
      required: ['type', 'position'],
    },
  },
  {
    name: 'connect_nodes',
    description: 'Connect two nodes with an edge. For condition nodes use sourceHandle = "true" or "false".',
    input_schema: {
      type: 'object',
      properties: {
        source_id: { type: 'string' },
        target_id: { type: 'string' },
        source_handle: { type: 'string', description: 'Optional; use "true" or "false" for condition branches.' },
      },
      required: ['source_id', 'target_id'],
    },
  },
  {
    name: 'update_node_config',
    description: 'Patch an existing node\'s data (label and type-specific fields). Pass only fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        node_id: { type: 'string' },
        patch: {
          type: 'object',
          description: 'Partial patch over the node data; e.g. { label: "Send email", config: {...} }.',
        },
      },
      required: ['node_id', 'patch'],
    },
  },
  {
    name: 'remove_node',
    description: 'Delete a node and any edges that touch it. Use sparingly | prefer updating in place.',
    input_schema: {
      type: 'object',
      properties: { node_id: { type: 'string' } },
      required: ['node_id'],
    },
  },
]

// ─── Tool dispatch | applies mutations to a FlowDefinition in memory ──────────

export interface ToolDispatchResult {
  success: boolean
  data?: unknown
  error?: string
}

export function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  def: FlowDefinition,
): ToolDispatchResult {
  switch (name) {
    case 'list_nodes':
      return {
        success: true,
        data: {
          nodes: def.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.data.label,
            position: n.position,
            data: n.data,
          })),
          edges: def.edges,
        },
      }

    case 'add_node': {
      const type = input.type as FlowNodeType
      const position = (input.position as { x: number; y: number }) ?? { x: 0, y: 0 }
      const label = (input.label as string | undefined) ?? type
      const config = (input.config as Record<string, unknown>) ?? {}

      const id = `${type}_${Math.random().toString(36).slice(2, 8)}`
      const data = buildNodeData(type, label, config)
      const node: FlowNode = { id, type, position, data }
      def.nodes.push(node)
      return { success: true, data: { id } }
    }

    case 'connect_nodes': {
      const source = input.source_id as string
      const target = input.target_id as string
      const sourceHandle = input.source_handle as string | undefined
      if (!def.nodes.find((n) => n.id === source)) {
        return { success: false, error: `source node ${source} not found` }
      }
      if (!def.nodes.find((n) => n.id === target)) {
        return { success: false, error: `target node ${target} not found` }
      }
      const edgeId = `edge_${Math.random().toString(36).slice(2, 8)}`
      def.edges.push({ id: edgeId, source, target, sourceHandle: sourceHandle ?? null })
      return { success: true, data: { id: edgeId } }
    }

    case 'update_node_config': {
      const nodeId = input.node_id as string
      const patch = (input.patch as Record<string, unknown>) ?? {}
      const idx = def.nodes.findIndex((n) => n.id === nodeId)
      if (idx === -1) return { success: false, error: `node ${nodeId} not found` }
      def.nodes[idx] = {
        ...def.nodes[idx],
        data: { ...def.nodes[idx].data, ...patch } as FlowNodeData,
      }
      return { success: true, data: { id: nodeId } }
    }

    case 'remove_node': {
      const nodeId = input.node_id as string
      const before = def.nodes.length
      def.nodes = def.nodes.filter((n) => n.id !== nodeId)
      def.edges = def.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
      if (def.nodes.length === before) return { success: false, error: `node ${nodeId} not found` }
      return { success: true, data: { id: nodeId } }
    }

    default:
      return { success: false, error: `unknown tool ${name}` }
  }
}

function buildNodeData(type: FlowNodeType, label: string, config: Record<string, unknown>): FlowNodeData {
  switch (type) {
    case 'trigger':
      return {
        kind: 'trigger',
        event_type: (config.event_type as string) ?? 'manual',
        filter: (config.filter as Record<string, unknown>) ?? undefined,
        schedule_cron: config.schedule_cron as string | undefined,
        label,
      }
    case 'action':
      return {
        kind: 'action',
        action_type: (config.action_type as string) ?? 'http_request',
        config: (config.config as Record<string, unknown>) ?? {},
        credential_ref: config.credential_ref as string | undefined,
        label,
      }
    case 'condition':
      return { kind: 'condition', expression: (config.expression as string) ?? '', label }
    case 'wait':
      return {
        kind: 'wait',
        mode: ((config.mode as 'sleep' | 'wait_for_event') ?? 'sleep'),
        duration: config.duration as string | undefined,
        timeout: config.timeout as string | undefined,
        event_filter: config.event_filter as Record<string, unknown> | undefined,
        label,
      }
    case 'agent':
      return {
        kind: 'agent',
        agent_id: config.agent_id as string | undefined,
        system_prompt: (config.system_prompt as string) ?? '',
        max_steps: (config.max_steps as number) ?? 10,
        label,
      }
    case 'end':
      return { kind: 'end', label }
  }
}
