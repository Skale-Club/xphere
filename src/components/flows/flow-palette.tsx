'use client'

import { useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
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
  { type: 'trigger',   label: 'Trigger',   description: 'Start the flow',          icon: <Lightning className="h-5 w-5" weight="fill" />,      color: '#f59e0b' },
  { type: 'action',    label: 'Action',    description: 'Call an integration',     icon: <PlayCircle className="h-5 w-5" weight="fill" />,     color: '#6366f1' },
  { type: 'condition', label: 'Condition', description: 'Branch on a check',       icon: <FlowArrow className="h-5 w-5" weight="fill" />,      color: '#8b5cf6' },
  { type: 'wait',      label: 'Wait',      description: 'Sleep or wait for event', icon: <ClockCountdown className="h-5 w-5" weight="fill" />, color: '#06b6d4' },
  { type: 'agent',     label: 'Agent',     description: 'Run an AI agent loop',    icon: <Robot className="h-5 w-5" weight="fill" />,          color: '#ec4899' },
  { type: 'end',       label: 'End',       description: 'Terminate this branch',   icon: <StopCircle className="h-5 w-5" weight="fill" />,     color: '#64748b' },
]

export function FlowPalette() {
  // Off-screen container for drag ghost images (SEED-043 Phase 5).
  // We render a card-shaped preview that matches the canvas node appearance
  // and set it as the drag image so users see a real preview while dragging.
  const ghostRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  function handleDragStart(event: React.DragEvent, item: PaletteItem) {
    event.dataTransfer.setData('application/reactflow', item.type)
    event.dataTransfer.effectAllowed = 'move'

    // Build a temporary ghost element that mirrors the canvas node card shape.
    // It is appended to document.body at -9999px so it's invisible but still
    // measurable; React Flow / the browser uses it as the drag image instead
    // of the semi-transparent silhouette of the source element.
    if (ghostRef.current) {
      ghostRef.current.style.borderColor = item.color
      const tile = ghostRef.current.querySelector<HTMLElement>('[data-ghost-tile]')
      if (tile) tile.style.backgroundColor = item.color
      const label = ghostRef.current.querySelector<HTMLElement>('[data-ghost-label]')
      if (label) label.textContent = item.label
      const sub = ghostRef.current.querySelector<HTMLElement>('[data-ghost-sub]')
      if (sub) sub.textContent = item.description
      // Centre the ghost under the cursor so the pointer lands on the tile icon.
      event.dataTransfer.setDragImage(ghostRef.current, 24, 24)
    }
  }

  return (
    <>
      {/* Off-screen ghost element used as drag image */}
      <div
        ref={ghostRef}
        aria-hidden
        className="fixed -left-[9999px] -top-[9999px] flex items-center gap-2 px-3 py-2 rounded-lg border-2 bg-card shadow-lg min-w-[180px] pointer-events-none"
        style={{ zIndex: -1 }}
      >
        <div
          data-ghost-tile
          className="h-9 w-9 rounded-[8px] flex items-center justify-center shrink-0 text-white"
          style={{ backgroundColor: '#6366f1' }}
        />
        <div className="min-w-0 flex-1">
          <p data-ghost-label className="text-[13px] font-medium leading-tight" />
          <p data-ghost-sub className="text-[11px] text-muted-foreground leading-tight mt-0.5" />
        </div>
      </div>

      <div
        className={
          collapsed
            ? 'w-16 border-r border-border bg-card flex flex-col shrink-0'
            : 'w-56 border-r border-border bg-card flex flex-col shrink-0'
        }
      >
        <div className={collapsed ? 'px-2 py-3 border-b border-border' : 'px-3 py-3 border-b border-border'}>
          <div className={collapsed ? 'flex justify-center' : 'flex items-start justify-between gap-2'}>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Nodes
                </p>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">
                  Drag onto the canvas
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={collapsed ? 'Expand nodes panel' : 'Collapse nodes panel'}
              title={collapsed ? 'Expand nodes panel' : 'Collapse nodes panel'}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <div className={collapsed ? 'flex-1 overflow-y-auto p-2 space-y-2' : 'flex-1 overflow-y-auto p-2 space-y-1.5'}>
          {ITEMS.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              className={
                collapsed
                  ? 'group flex h-11 w-11 items-center justify-center rounded-md border border-border bg-background hover:bg-muted/50 cursor-grab active:cursor-grabbing transition-colors'
                  : 'group flex items-center gap-2 p-2 rounded-md border border-border bg-background hover:bg-muted/50 cursor-grab active:cursor-grabbing transition-colors'
              }
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
            >
              <div
                className="h-9 w-9 rounded-[8px] flex items-center justify-center shrink-0 text-white"
                style={{ backgroundColor: item.color }}
              >
                {item.icon}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-tight">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {item.description}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
