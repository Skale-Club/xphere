// Zustand store: single source of truth for the canvas state.
// Both the React Flow canvas and the AI builder (Phase C) mutate this store;
// the canvas renders from it, and autosave persists changes to Supabase on debounce.

import { create } from 'zustand'
import type {
  Node as RFNode,
  Edge as RFEdge,
  NodeChange,
  EdgeChange,
  Connection,
} from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import type { FlowDefinition, FlowNode, FlowNodeData, FlowNodeType } from '@/lib/flows/schema'
import { emptyFlowDefinition } from '@/lib/flows/schema'

// React Flow uses its own node/edge types; we mirror our domain types in `data`.
export type CanvasNode = RFNode<{ flowData: FlowNodeData; label: string }>
export type CanvasEdge = RFEdge

interface FlowState {
  workflowId: string | null
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedNodeId: string | null
  dirty: boolean
  lastSavedAt: number | null

  // ── Hydration ───────────────────────────────────────────────────────────────
  hydrate: (workflowId: string, def: FlowDefinition) => void

  // ── React Flow change handlers ──────────────────────────────────────────────
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void

  // ── Mutators (also used by AI builder tools in Phase C) ─────────────────────
  addNode: (type: FlowNodeType, position: { x: number; y: number }, data?: Partial<FlowNodeData>) => string
  updateNodeData: (nodeId: string, patch: Partial<FlowNodeData>) => void
  removeNode: (nodeId: string) => void
  removeEdge: (edgeId: string) => void
  /** Replace an existing edge with a new source/target pair (for reconnection). */
  reconnectEdge: (oldEdgeId: string, newSource: string, newTarget: string, newSourceHandle?: string | null, newTargetHandle?: string | null) => void
  setNodes: (nodes: CanvasNode[]) => void
  setSelected: (nodeId: string | null) => void
  /** SEED-043 Phase 5 — replace an existing edge with `source -> newNode -> target`.
   * Returns the new node's id, or null if the target edge does not exist. */
  insertNodeOnEdge: (
    edgeId: string,
    type: FlowNodeType,
    position: { x: number; y: number },
    data?: Partial<FlowNodeData>,
  ) => string | null

  // ── Serialization ───────────────────────────────────────────────────────────
  toDefinition: () => FlowDefinition
  markSaved: () => void
}

// ─── Default node data factories ──────────────────────────────────────────────

function defaultNodeData(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case 'trigger':
      return { kind: 'trigger', event_type: 'manual', label: 'Trigger' }
    case 'action':
      return { kind: 'action', action_type: 'http_request', config: {}, label: 'Action' }
    case 'condition':
      return { kind: 'condition', expression: '', label: 'Condition' }
    case 'wait':
      return { kind: 'wait', mode: 'sleep', duration: '1h', label: 'Wait' }
    case 'agent':
      return { kind: 'agent', input: '', system_prompt: '', max_steps: 10, label: 'Agent' }
    case 'end':
      return { kind: 'end', label: 'End' }
  }
}

// ─── ID generator ─────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useFlowStore = create<FlowState>((set, get) => ({
  workflowId: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  lastSavedAt: null,

  hydrate(workflowId, def) {
    const canvasNodes: CanvasNode[] = def.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { flowData: n.data, label: n.data.label ?? n.type },
    }))
    const canvasEdges: CanvasEdge[] = def.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      label: e.label,
    }))
    set({
      workflowId,
      nodes: canvasNodes,
      edges: canvasEdges,
      selectedNodeId: null,
      dirty: false,
      lastSavedAt: Date.now(),
    })
  },

  onNodesChange(changes) {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as CanvasNode[],
      dirty: true,
    }))
  },

  onEdgesChange(changes) {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      dirty: true,
    }))
  },

  onConnect(connection) {
    set((state) => ({
      edges: addEdge({ ...connection, id: genId('edge') }, state.edges),
      dirty: true,
    }))
  },

  addNode(type, position, dataPatch) {
    const id = genId(type)
    const base = defaultNodeData(type)
    const merged = { ...base, ...dataPatch } as FlowNodeData
    const node: CanvasNode = {
      id,
      type,
      position,
      data: { flowData: merged, label: merged.label ?? type },
    }
    set((state) => ({ nodes: [...state.nodes, node], dirty: true }))
    return id
  },

  updateNodeData(nodeId, patch) {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n
        const newData = { ...n.data.flowData, ...patch } as FlowNodeData
        return {
          ...n,
          data: { flowData: newData, label: newData.label ?? n.data.label },
        }
      }),
      dirty: true,
    }))
  },

  removeNode(nodeId) {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      dirty: true,
    }))
  },

  removeEdge(edgeId) {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      dirty: true,
    }))
  },

  reconnectEdge(oldEdgeId, newSource, newTarget, newSourceHandle, newTargetHandle) {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === oldEdgeId
          ? {
              ...e,
              source: newSource,
              target: newTarget,
              sourceHandle: newSourceHandle ?? null,
              targetHandle: newTargetHandle ?? null,
            }
          : e,
      ),
      dirty: true,
    }))
  },

  setNodes(nodes) {
    set({ nodes, dirty: true })
  },

  setSelected(nodeId) {
    set({ selectedNodeId: nodeId })
  },

  insertNodeOnEdge(edgeId, type, position, dataPatch) {
    const state = get()
    const oldEdge = state.edges.find((e) => e.id === edgeId)
    if (!oldEdge) return null

    const newId = genId(type)
    const base = defaultNodeData(type)
    const merged = { ...base, ...dataPatch } as FlowNodeData
    const newNode: CanvasNode = {
      id: newId,
      type,
      position,
      data: { flowData: merged, label: merged.label ?? type },
    }

    const before: CanvasEdge = {
      id: genId('edge'),
      source: oldEdge.source,
      sourceHandle: oldEdge.sourceHandle ?? null,
      target: newId,
      targetHandle: null,
    }
    const after: CanvasEdge = {
      id: genId('edge'),
      source: newId,
      sourceHandle: null,
      target: oldEdge.target,
      targetHandle: oldEdge.targetHandle ?? null,
    }

    set({
      nodes: [...state.nodes, newNode],
      edges: [...state.edges.filter((e) => e.id !== edgeId), before, after],
      dirty: true,
    })
    return newId
  },

  toDefinition() {
    const state = get()
    const baseDef = emptyFlowDefinition()
    return {
      ...baseDef,
      nodes: state.nodes.map<FlowNode>((n) => ({
        id: n.id,
        type: (n.type as FlowNodeType) ?? 'action',
        position: n.position,
        data: n.data.flowData,
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        label: typeof e.label === 'string' ? e.label : undefined,
      })),
    }
  },

  markSaved() {
    set({ dirty: false, lastSavedAt: Date.now() })
  },
}))
