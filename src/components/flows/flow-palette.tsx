'use client'

import {
  ClockCountdown,
  FlowArrow,
  Lightning,
  PlayCircle,
  Robot,
  StopCircle,
} from '@phosphor-icons/react'
import type { FlowNodeType } from '@/lib/flows/schema'

interface PaletteItem {
  type: FlowNodeType
  label: string
  description: string
  icon: React.ReactNode
  color: string
}

const ITEMS: PaletteItem[] = [
  { type: 'trigger',   label: 'Trigger',   description: 'Start the flow',         icon: <Lightning className="h-5 w-5" weight="fill" />,      color: '#f59e0b' },
  { type: 'action',    label: 'Action',    description: 'Call an integration',    icon: <PlayCircle className="h-5 w-5" weight="fill" />,     color: '#6366f1' },
  { type: 'condition', label: 'Condition', description: 'Branch on a check',      icon: <FlowArrow className="h-5 w-5" weight="fill" />,      color: '#8b5cf6' },
  { type: 'wait',      label: 'Wait',      description: 'Sleep or wait for event', icon: <ClockCountdown className="h-5 w-5" weight="fill" />, color: '#06b6d4' },
  { type: 'agent',     label: 'Agent',     description: 'Run an AI agent loop',   icon: <Robot className="h-5 w-5" weight="fill" />,          color: '#ec4899' },
  { type: 'end',       label: 'End',       description: 'Terminate this branch',  icon: <StopCircle className="h-5 w-5" weight="fill" />,     color: '#64748b' },
]

export function FlowPalette() {
  function handleDragStart(event: React.DragEvent, type: FlowNodeType) {
    event.dataTransfer.setData('application/reactflow', type)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-56 border-r border-border bg-card flex flex-col shrink-0">
      <div className="px-3 py-3 border-b border-border">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Nodes
        </p>
        <p className="text-[11.5px] text-muted-foreground mt-0.5">
          Drag onto the canvas
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {ITEMS.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => handleDragStart(e, item.type)}
            className="group flex items-center gap-2 p-2 rounded-md border border-border bg-background hover:bg-muted/50 cursor-grab active:cursor-grabbing transition-colors"
          >
            <div
              className="h-9 w-9 rounded-[8px] flex items-center justify-center shrink-0 text-white"
              style={{ backgroundColor: item.color }}
            >
              {item.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-tight">{item.label}</p>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
