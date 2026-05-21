'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MarkerType,
  useReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useFlowStore } from '@/stores/flow-store'
import { nodeTypes } from './nodes'
import { FlowPalette } from './flow-palette'
import { NodeConfigPanel } from './node-config-panel'
import { FlowToolbar } from './flow-toolbar'
import { AiBuilderChat } from './ai-builder-chat'
import { CanvasToolbar } from './canvas-toolbar'
import { EmptyCanvasState, type EmptyCanvasTriggerType } from './empty-canvas-state'
import type { FlowDefinition, FlowNodeType } from '@/lib/flows/schema'
import type { IntegrationKey } from '@/lib/flows/node-metadata'
import { saveWorkflowDefinition } from '@/app/(dashboard)/workflows/flows/_actions/workflows'
import { autoLayoutNodes } from '@/lib/flows/auto-layout'
import { toast } from 'sonner'

interface FlowCanvasProps {
  workflowId: string
  workflowName: string
  isActive: boolean
  initialDefinition: FlowDefinition
  activeIntegrations: IntegrationKey[]
}

// SEED-043 Phase 5 — proximity threshold for "drop on edge = insert" behaviour.
// Measured in flow-space units (same units as node positions). 80px in the
// default 100% zoom feels natural; ReactFlow's screenToFlowPosition already
// returns flow-space coordinates, so we can compare directly to edge midpoints.
const EDGE_INSERT_THRESHOLD = 80
const EDGE_INSERT_THRESHOLD_SQ = EDGE_INSERT_THRESHOLD * EDGE_INSERT_THRESHOLD

function CanvasInner({ workflowId, workflowName, isActive, initialDefinition, activeIntegrations }: FlowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const nodes = useFlowStore((s) => s.nodes)
  const edges = useFlowStore((s) => s.edges)
  const onNodesChange = useFlowStore((s) => s.onNodesChange)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const onConnect = useFlowStore((s) => s.onConnect)
  const addNode = useFlowStore((s) => s.addNode)
  const insertNodeOnEdge = useFlowStore((s) => s.insertNodeOnEdge)
  const setNodes = useFlowStore((s) => s.setNodes)
  const setSelected = useFlowStore((s) => s.setSelected)
  const hydrate = useFlowStore((s) => s.hydrate)
  const dirty = useFlowStore((s) => s.dirty)
  const toDefinition = useFlowStore((s) => s.toDefinition)
  const markSaved = useFlowStore((s) => s.markSaved)

  useEffect(() => {
    hydrate(workflowId, initialDefinition)
  }, [workflowId, initialDefinition, hydrate])

  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(async () => {
      const def = toDefinition()
      const result = await saveWorkflowDefinition(workflowId, def)
      if (!result.ok) {
        toast.error(`Save failed: ${result.error}`)
        return
      }
      markSaved()
    }, 1500)

    return () => clearTimeout(timer)
  }, [dirty, workflowId, toDefinition, markSaved])

  // ── Drop-on-edge proximity helper (SEED-043 Phase 5) ─────────────────────
  // Returns the id of the edge whose midpoint sits closest to `point` and
  // within EDGE_INSERT_THRESHOLD, or null if no edge qualifies. Uses squared
  // distances to skip the sqrt in this hot path (fires every dragover tick).
  const findEdgeNearPoint = useCallback(
    (point: { x: number; y: number }): string | null => {
      let bestId: string | null = null
      let bestDistSq = EDGE_INSERT_THRESHOLD_SQ
      for (const edge of edges) {
        const source = nodes.find((n) => n.id === edge.source)
        const target = nodes.find((n) => n.id === edge.target)
        if (!source || !target) continue
        const mx = (source.position.x + target.position.x) / 2
        const my = (source.position.y + target.position.y) / 2
        const dx = mx - point.x
        const dy = my - point.y
        const distSq = dx * dx + dy * dy
        if (distSq <= bestDistSq) {
          bestDistSq = distSq
          bestId = edge.id
        }
      }
      return bestId
    },
    [edges, nodes],
  )

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const nearId = findEdgeNearPoint(point)
      if (nearId !== hoveredEdgeId) setHoveredEdgeId(nearId)
    },
    [screenToFlowPosition, findEdgeNearPoint, hoveredEdgeId],
  )

  const onDragLeave = useCallback(() => {
    if (hoveredEdgeId !== null) setHoveredEdgeId(null)
  }, [hoveredEdgeId])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow') as FlowNodeType
      if (!type) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const nearEdgeId = findEdgeNearPoint(position)
      if (nearEdgeId) {
        insertNodeOnEdge(nearEdgeId, type, position)
      } else {
        addNode(type, position)
      }
      setHoveredEdgeId(null)
    },
    [screenToFlowPosition, findEdgeNearPoint, insertNodeOnEdge, addNode],
  )

  // ── Phase 4 — empty-state trigger picker ─────────────────────────────────
  // Drops the first trigger near the centre of the visible canvas so it lands
  // inside the user's viewport regardless of pan/zoom. fitView then re-frames.
  const handlePickTrigger = useCallback(
    (triggerType: EmptyCanvasTriggerType) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      const center = screenToFlowPosition({ x: cx, y: cy })
      // Offset by approx. half a node so the trigger sits visually centred.
      const position = { x: center.x - 90, y: center.y - 35 }
      addNode('trigger', position, {
        kind: 'trigger',
        event_type: triggerType,
        label: 'Trigger',
      })
      setTimeout(() => fitView({ duration: 250, padding: 0.3 }), 50)
    },
    [addNode, screenToFlowPosition, fitView],
  )

  const handleAutoLayout = useCallback(() => {
    const current = useFlowStore.getState()
    if (current.nodes.length === 0) return
    const laid = autoLayoutNodes(current.nodes, current.edges, 'TB') as typeof current.nodes
    setNodes(laid)
    // Defer fitView until after React commits the new positions.
    setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 50)
  }, [setNodes, fitView])

  // SEED-043 Phase 5 — overlay a coloured stroke on the hovered edge during
  // a palette drag to telegraph "drop here = insert into the middle of this
  // edge". The override is applied at render time so it stays in sync with
  // any concurrent edge changes from the store.
  const styledEdges = hoveredEdgeId
    ? edges.map((edge) =>
        edge.id === hoveredEdgeId
          ? {
              ...edge,
              style: { ...(edge.style ?? {}), stroke: '#6366f1', strokeWidth: 2.5 },
            }
          : edge,
      )
    : edges

  const showEmptyState = nodes.length === 0

  return (
    <div className="flex h-full w-full">
      <FlowPalette />

      <div className="flex-1 flex flex-col min-w-0">
        <FlowToolbar
          workflowId={workflowId}
          workflowName={workflowName}
          isActive={isActive}
          onToggleAi={() => setAiOpen((v) => !v)}
          aiOpen={aiOpen}
        />
        <div ref={wrapperRef} className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            onInit={setRfInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: 'rgba(148, 163, 184, 0.5)', strokeWidth: 1.5 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: 'rgba(148, 163, 184, 0.7)',
                width: 14,
                height: 14,
              },
            }}
            connectionLineStyle={{
              stroke: 'rgba(148, 163, 184, 0.6)',
              strokeWidth: 1.5,
              strokeDasharray: '4 4',
            }}
          >
            <Background gap={16} size={1} />
            <CanvasToolbar onAutoLayout={handleAutoLayout} />
          </ReactFlow>
          {showEmptyState && <EmptyCanvasState onPickTrigger={handlePickTrigger} />}
        </div>
      </div>

      <NodeConfigPanel activeIntegrations={activeIntegrations} />
      <AiBuilderChat workflowId={workflowId} open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
