'use client'

/**
 * DeletableEdge — custom React Flow edge with:
 *  1. Hover-revealed trash button at the midpoint (click to delete)
 *  2. Click-to-select highlight — selected edge turns red and Delete/Backspace
 *     removes it (React Flow's native key handling).
 *  3. Reconnect handle near the arrow (last 15% of the bezier curve). Grabbing
 *     and dragging it lets the user replug the connection into another node.
 *     Reconnect itself is delegated to ReactFlow's onReconnect prop on the
 *     parent canvas.
 *
 * Visual baseline matches the default edge styling configured in
 * flow-canvas.tsx (slate stroke, 1.5px, ArrowClosed marker).
 */

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'

import { useFlowStore } from '@/stores/flow-store'
import { cn } from '@/lib/utils'

const RED = '#ef4444'
const HOVER_INDIGO = 'rgba(99, 102, 241, 0.9)'
const DEFAULT_STROKE = 'rgba(148, 163, 184, 0.5)'

export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const removeEdge = useFlowStore((s) => s.removeEdge)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  // Reconnect-grab handle position: 85% of the way from source to target,
  // so it sits in the last ~15% of the line — close to the arrow.
  const reconnectX = sourceX + (targetX - sourceX) * 0.85
  const reconnectY = sourceY + (targetY - sourceY) * 0.85

  // Stroke priority: selected (red) > hovered (indigo) > custom > default
  const stroke = selected
    ? RED
    : hovered
      ? HOVER_INDIGO
      : (style?.stroke ?? DEFAULT_STROKE)

  const strokeWidth = selected ? 2 : hovered ? 2 : (style?.strokeWidth ?? 1.5)

  return (
    <>
      {/* Visible edge — color reacts to selection and hover */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke,
          strokeWidth,
          transition: 'stroke 120ms, stroke-width 120ms',
        }}
      />

      {/* Wide invisible interaction layer so the hover/click area is comfortable */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* Reconnect grab handle near the arrow (last 15% of the curve).
          The actual reconnect logic is handled by ReactFlow's edge endpoint
          drag — this overlay just makes the grab zone easier to find visually.
          A small dot is rendered when hovered/selected. */}
      <EdgeLabelRenderer>
        <div
          className={cn(
            'absolute pointer-events-none',
            'transition-opacity duration-150',
            hovered || selected ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${reconnectX}px, ${reconnectY}px)`,
          }}
        >
          <div
            className={cn(
              'h-2 w-2 rounded-full border-2 shadow-sm',
              selected ? 'border-rose-400 bg-bg-secondary' : 'border-accent bg-bg-secondary',
            )}
            aria-hidden
          />
        </div>
      </EdgeLabelRenderer>

      {/* Trash button at the edge midpoint */}
      <EdgeLabelRenderer>
        <div
          className={cn(
            'absolute pointer-events-auto',
            'transition-opacity duration-150',
            hovered || selected ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              removeEdge(id)
            }}
            className={cn(
              'inline-flex h-4 w-4 items-center justify-center rounded-full',
              'border border-border-subtle bg-bg-secondary shadow-lg transition-colors',
              selected
                ? 'text-rose-300 hover:bg-rose-500/20'
                : 'text-rose-400 hover:bg-bg-tertiary hover:text-rose-300',
            )}
            aria-label="Delete connection"
            title="Delete connection"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
