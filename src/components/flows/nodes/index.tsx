'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Zap, Play, GitBranch, Clock, Bot, Square } from 'lucide-react'
import { BaseNode } from './base-node'
import type { CanvasNode } from '@/stores/flow-store'
import { getActionMetadata, getTriggerMetadata } from '@/lib/flows/node-metadata'

const ICON_SIZE = 'h-3.5 w-3.5'

// ─── Trigger ──────────────────────────────────────────────────────────────────

function TriggerNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  const meta = flow.kind === 'trigger' ? getTriggerMetadata(flow.event_type) : undefined
  return (
    <BaseNode
      icon={<Zap className={ICON_SIZE} />}
      title={data.label || 'Trigger'}
      subtitle={meta?.label ?? (flow.kind === 'trigger' ? flow.event_type : '')}
      color="#f59e0b"
      selected={selected}
      hasInput={false}
    />
  )
}
export const TriggerNode = memo(TriggerNodeImpl)

// ─── Action ───────────────────────────────────────────────────────────────────

function ActionNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  const meta = flow.kind === 'action' ? getActionMetadata(flow.action_type) : undefined
  return (
    <BaseNode
      icon={<Play className={ICON_SIZE} />}
      title={data.label || 'Action'}
      subtitle={meta?.label ?? (flow.kind === 'action' ? flow.action_type : '')}
      color="#6366f1"
      selected={selected}
    />
  )
}
export const ActionNode = memo(ActionNodeImpl)

// ─── Condition ────────────────────────────────────────────────────────────────

function ConditionNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  const subtitle =
    flow.kind === 'condition' && flow.expression ? flow.expression.slice(0, 30) : 'if/else branch'
  return (
    <BaseNode
      icon={<GitBranch className={ICON_SIZE} />}
      title={data.label || 'Condition'}
      subtitle={subtitle}
      color="#8b5cf6"
      selected={selected}
      hasBranchOutputs
    />
  )
}
export const ConditionNode = memo(ConditionNodeImpl)

// ─── Wait ─────────────────────────────────────────────────────────────────────

function WaitNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  const subtitle =
    flow.kind === 'wait'
      ? flow.mode === 'sleep'
        ? `Sleep ${flow.duration ?? ''}`
        : 'Wait for event'
      : ''
  return (
    <BaseNode
      icon={<Clock className={ICON_SIZE} />}
      title={data.label || 'Wait'}
      subtitle={subtitle}
      color="#06b6d4"
      selected={selected}
    />
  )
}
export const WaitNode = memo(WaitNodeImpl)

// ─── Agent ────────────────────────────────────────────────────────────────────

function AgentNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  const subtitle = flow.kind === 'agent' ? `Max ${flow.max_steps} steps` : ''
  return (
    <BaseNode
      icon={<Bot className={ICON_SIZE} />}
      title={data.label || 'Agent'}
      subtitle={subtitle}
      color="#ec4899"
      selected={selected}
    />
  )
}
export const AgentNode = memo(AgentNodeImpl)

// ─── End ──────────────────────────────────────────────────────────────────────

function EndNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <BaseNode
      icon={<Square className={ICON_SIZE} />}
      title={data.label || 'End'}
      color="#64748b"
      selected={selected}
      hasOutput={false}
    />
  )
}
export const EndNode = memo(EndNodeImpl)

// ─── Registry exported to <ReactFlow nodeTypes={...} /> ───────────────────────

export const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  wait: WaitNode,
  agent: AgentNode,
  end: EndNode,
}
