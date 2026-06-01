'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import {
  ClockCountdown,
  FlowArrow,
  Lightning,
  PlayCircle,
  Robot,
  StopCircle,
} from '@phosphor-icons/react'
import { BaseNode, type NodeVisualState } from './base-node'
import type { CanvasNode } from '@/stores/flow-store'
import { getActionMetadata, getTriggerMetadata } from '@/lib/flows/node-metadata'
import {
  getActionIntegrationVisual,
  getTriggerIntegrationVisual,
} from '@/lib/flows/action-to-integration'
import { isNodeConfigComplete, isWaitNodeComplete } from '@/lib/flows/node-config-validity'
import { formatActionTitle, formatConfigSubtitle } from '@/lib/flows/format'

const ICON_SIZE = 'h-[18px] w-[18px]'

// Generic per-node-type fallback colours (used when the integration registry
// doesn't supply a brand colour).
const FALLBACK_TRIGGER_COLOR = '#f59e0b'
const FALLBACK_ACTION_COLOR = '#6366f1'

// ─── Trigger ──────────────────────────────────────────────────────────────────

function TriggerNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  if (flow.kind !== 'trigger') {
    return (
      <BaseNode
        icon={<Lightning className={ICON_SIZE} weight="fill" />}
        title={data.label || 'Trigger'}
        color={FALLBACK_TRIGGER_COLOR}
        selected={selected}
        hasInput={false}
      />
    )
  }

  const eventType = flow.event_type
  const meta = getTriggerMetadata(eventType)
  const visual = getTriggerIntegrationVisual(eventType)

  // Title prefers the user-edited label; otherwise the friendly metadata label;
  // and finally the snake_case event_type prettied up.
  const userLabel = data.label && data.label !== 'Trigger' ? data.label : undefined
  const title = userLabel ?? meta?.label ?? formatActionTitle(eventType)

  // Subtitle: brand name when known, otherwise the metadata description, falls
  // back to the raw event_type so nothing renders blank for unknown triggers.
  const subtitle =
    meta?.subtitle ?? visual?.definition?.name ?? meta?.description ?? eventType

  return (
    <BaseNode
      icon={<Lightning className={ICON_SIZE} weight="fill" />}
      // Same source as the dropdown (node-metadata), registry logo as fallback.
      logo={meta?.logo ?? visual?.logo}
      title={title}
      subtitle={subtitle}
      // Node-type colour (not the brand colour): the tile, card border and
      // handles all share the trigger family colour; the brand logo carries
      // brand identity on its own.
      color={FALLBACK_TRIGGER_COLOR}
      selected={selected}
      hasInput={false}
    />
  )
}
export const TriggerNode = memo(TriggerNodeImpl)

// ─── Action ───────────────────────────────────────────────────────────────────

function ActionNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  if (flow.kind !== 'action') {
    return (
      <BaseNode
        icon={<PlayCircle className={ICON_SIZE} weight="fill" />}
        title={data.label || 'Action'}
        color={FALLBACK_ACTION_COLOR}
        selected={selected}
      />
    )
  }

  const actionType = flow.action_type
  const config = flow.config as Record<string, unknown> | undefined
  const meta = getActionMetadata(actionType)
  const visual = getActionIntegrationVisual(actionType)

  const userLabel = data.label && data.label !== 'Action' ? data.label : undefined
  const title = userLabel ?? meta?.label ?? formatActionTitle(actionType)

  // Prefer a snippet of the template/message/body so users can tell two
  // copies of "Send SMS" apart at a glance; otherwise show the brand name or
  // the metadata description.
  const configSubtitle = formatConfigSubtitle(config)
  const subtitle =
    configSubtitle ??
    meta?.subtitle ??
    visual?.definition?.name ??
    meta?.description ??
    actionType

  const state: NodeVisualState = isNodeConfigComplete(actionType, config)
    ? 'default'
    : 'incomplete'

  return (
    <BaseNode
      icon={<PlayCircle className={ICON_SIZE} weight="fill" />}
      // Single source of truth: the node-metadata logo (same as the dropdown),
      // falling back to the integration-registry logo for action types that
      // exist on the canvas but not in the dropdown catalogue.
      logo={meta?.logo ?? visual?.logo}
      title={title}
      subtitle={subtitle}
      // Node-type colour (not the brand colour): tile, card border and handles
      // all share the action family colour; the brand logo carries brand
      // identity on its own.
      color={FALLBACK_ACTION_COLOR}
      selected={selected}
      state={state}
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
      icon={<FlowArrow className={ICON_SIZE} weight="fill" />}
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

function formatWaitDuration(value: string | undefined): string | null {
  const match = value?.trim().toLowerCase().match(/^(\d+)\s*([mhdw])$/)
  if (!match) return value?.trim() || null

  const amount = Number(match[1])
  const unit = match[2]
  const label =
    unit === 'm' ? 'minute' :
    unit === 'h' ? 'hour' :
    unit === 'd' ? 'day' :
    'week'

  return `${amount} ${label}${amount === 1 ? '' : 's'}`
}

function WaitNodeImpl({ data, selected }: NodeProps<CanvasNode>) {
  const flow = data.flowData
  const subtitle =
    flow.kind === 'wait'
      ? flow.mode === 'sleep'
        ? `Sleep - ${formatWaitDuration(flow.duration) ?? '1 hour'}`
        : `Wait for event — ${flow.event_type ?? 'no event selected'}`
      : ''
  const state: NodeVisualState = flow.kind === 'wait' && !isWaitNodeComplete(flow.mode, flow.event_type)
    ? 'incomplete'
    : 'default'
  return (
    <BaseNode
      icon={<ClockCountdown className={ICON_SIZE} weight="fill" />}
      title={data.label || 'Wait'}
      subtitle={subtitle}
      color="#06b6d4"
      selected={selected}
      state={state}
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
      icon={<Robot className={ICON_SIZE} weight="fill" />}
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
      icon={<StopCircle className={ICON_SIZE} weight="fill" />}
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
