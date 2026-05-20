'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
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
import type { FlowDefinition, FlowNodeType } from '@/lib/flows/schema'
import type { IntegrationKey } from '@/lib/flows/node-metadata'
import { saveWorkflowDefinition } from '@/app/(dashboard)/workflows/flows/_actions/workflows'
import { toast } from 'sonner'

interface FlowCanvasProps {
  workflowId: string
  workflowName: string
  initialDefinition: FlowDefinition
  activeIntegrations: IntegrationKey[]
}

const NODE_TYPE_COLORS: Record<string, string> = {
  trigger: '#f59e0b',
  action: '#6366f1',
  condition: '#8b5cf6',
  wait: '#06b6d4',
  agent: '#ec4899',
  end: '#64748b',
}

function CanvasInner({ workflowId, workflowName, initialDefinition, activeIntegrations }: FlowCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const { screenToFlowPosition } = useReactFlow()

  const nodes = useFlowStore((s) => s.nodes)
  const edges = useFlowStore((s) => s.edges)
  const onNodesChange = useFlowStore((s) => s.onNodesChange)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const onConnect = useFlowStore((s) => s.onConnect)
  const addNode = useFlowStore((s) => s.addNode)
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

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow') as FlowNodeType
      if (!type) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addNode(type, position)
    },
    [screenToFlowPosition, addNode],
  )

  return (
    <div className="flex h-full w-full">
      <FlowPalette />

      <div className="flex-1 flex flex-col min-w-0">
        <FlowToolbar
          workflowId={workflowId}
          workflowName={workflowName}
          onToggleAi={() => setAiOpen((v) => !v)}
          aiOpen={aiOpen}
        />
        <div ref={wrapperRef} className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            onInit={setRfInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: 'rgba(148, 163, 184, 0.5)', strokeWidth: 1.5 },
            }}
          >
            <Background gap={16} size={1} />
            <Controls
              className="!bg-bg-secondary !border !border-border-subtle !rounded-[10px] !shadow-lg overflow-hidden [&>button]:!bg-transparent [&>button]:!border-0 [&>button]:!border-b [&>button]:!border-border-subtle [&>button:last-child]:!border-b-0 [&>button]:!text-text-secondary [&>button:hover]:!text-text-primary [&>button:hover]:!bg-bg-tertiary [&>button>svg]:!fill-current"
              showInteractive={false}
            />
            <MiniMap
              nodeStrokeWidth={3}
              pannable
              zoomable
              nodeColor={(node) => NODE_TYPE_COLORS[node.type ?? 'action'] ?? '#64748b'}
              nodeBorderRadius={6}
              maskColor="rgba(8, 9, 10, 0.7)"
              className="!bg-bg-secondary !border !border-border-subtle !rounded-[10px]"
            />
          </ReactFlow>
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
