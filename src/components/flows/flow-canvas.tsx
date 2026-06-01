'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
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
import { CanvasToolbar } from './canvas-toolbar'
import { CANVAS_BASE_ZOOM } from './canvas-zoom'
import { EmptyCanvasState, type EmptyCanvasTriggerType } from './empty-canvas-state'
import { DeletableEdge } from './edges/deletable-edge'
import type { FlowDefinition, FlowNodeType } from '@/lib/flows/schema'
import type { IntegrationKey } from '@/lib/flows/node-metadata'
import { saveWorkflowDefinition } from '@/app/(dashboard)/workflows/flows/_actions/workflows'
import { autoLayoutNodes } from '@/lib/flows/auto-layout'
import { toast } from 'sonner'

export interface AgentOption {
  id: string
  name: string
  slug: string
}

interface FlowCanvasProps {
  workflowId: string
  workflowName: string
  isActive: boolean
  initialDefinition: FlowDefinition
  activeIntegrations: IntegrationKey[]
  agents?: AgentOption[]
}

// SEED-043 Phase 5 — proximity threshold for "drop on edge = insert" behaviour.
// Measured in flow-space units (same units as node positions). 80px in the
// default 100% zoom feels natural; ReactFlow's screenToFlowPosition already
// returns flow-space coordinates, so we can compare directly to edge midpoints.
const EDGE_INSERT_THRESHOLD = 80
const EDGE_INSERT_THRESHOLD_SQ = EDGE_INSERT_THRESHOLD * EDGE_INSERT_THRESHOLD
const MINIMAP_WIDTH = 220
const MINIMAP_HEIGHT = 160

const NODE_TYPE_COLORS: Record<string, string> = {
  trigger: '#f59e0b',
  action: '#6366f1',
  condition: '#8b5cf6',
  wait: '#06b6d4',
  agent: '#ec4899',
}

// Register the deletable edge as our default edge type so every line
// rendered on the canvas shows a hover-revealed trash button at its midpoint.
const edgeTypes = {
  deletable: DeletableEdge,
}

function CanvasInner({ workflowId, workflowName, isActive, initialDefinition, activeIntegrations, agents = [] }: FlowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const { screenToFlowPosition, fitView, zoomTo } = useReactFlow()

  const nodes = useFlowStore((s) => s.nodes)
  const edges = useFlowStore((s) => s.edges)
  const onNodesChange = useFlowStore((s) => s.onNodesChange)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const onConnect = useFlowStore((s) => s.onConnect)
  const reconnectEdge = useFlowStore((s) => s.reconnectEdge)
  const removeEdge = useFlowStore((s) => s.removeEdge)
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
  // inside the user's viewport regardless of pan/zoom. Keep the zoom at 100%
  // so the editor does not jump into React Flow's auto-fit zoom after creation.
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
      setTimeout(() => zoomTo(CANVAS_BASE_ZOOM, { duration: 150 }), 50)
    },
    [addNode, screenToFlowPosition, zoomTo],
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
            onReconnect={(oldEdge, newConnection) => {
              if (newConnection.source && newConnection.target) {
                reconnectEdge(
                  oldEdge.id,
                  newConnection.source,
                  newConnection.target,
                  newConnection.sourceHandle ?? null,
                  newConnection.targetHandle ?? null,
                )
              }
            }}
            onReconnectEnd={(_event, edge, _handleType, connectionState) => {
              // If the user dropped the endpoint in empty space (no new
              // connection made), interpret it as "unplug" and delete the edge.
              if (!connectionState.isValid) {
                removeEdge(edge.id)
              }
            }}
            reconnectRadius={24}
            deleteKeyCode={['Delete', 'Backspace']}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: CANVAS_BASE_ZOOM }}
            snapToGrid={snapToGrid}
            snapGrid={[16, 16]}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: 'deletable',
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
            <Background gap={16} size={0.85} color="rgba(148, 163, 184, 0.34)" />
            {showMiniMap && <CanvasMiniMap />}
            <CanvasToolbar
              onAutoLayout={handleAutoLayout}
              snapToGrid={snapToGrid}
              onToggleSnap={() => setSnapToGrid((v) => !v)}
              showMiniMap={showMiniMap}
              onToggleMiniMap={() => setShowMiniMap((v) => !v)}
            />
          </ReactFlow>
          {showEmptyState && <EmptyCanvasState onPickTrigger={handlePickTrigger} />}
        </div>
      </div>

      <NodeConfigPanel activeIntegrations={activeIntegrations} agents={agents} />
    </div>
  )
}

function CanvasMiniMap() {
  return (
    <MiniMap
      position="bottom-left"
      nodeStrokeWidth={3}
      pannable
      zoomable
      nodeColor={(node) => NODE_TYPE_COLORS[node.type ?? 'action'] ?? '#64748b'}
      nodeBorderRadius={6}
      maskColor="rgba(8, 9, 10, 0.7)"
      className="nodrag nopan nowheel !m-0 !rounded-[10px] !border-0 !bg-bg-secondary/80 !shadow-lg"
      style={{ bottom: 24, left: 24, width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
    />
  )
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
