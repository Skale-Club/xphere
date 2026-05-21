'use client'

import { Plus, Minus, Maximize2, LayoutGrid } from 'lucide-react'
import { useReactFlow, useStore } from '@xyflow/react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CANVAS_BASE_ZOOM, toDisplayZoomPercent } from './canvas-zoom'

interface CanvasToolbarProps {
  onAutoLayout: () => void
}

export function CanvasToolbar({ onAutoLayout }: CanvasToolbarProps) {
  const zoom = useStore((s) => s.transform[2])
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const pct = toDisplayZoomPercent(zoom)

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="nodrag nopan nowheel absolute z-10 flex items-center gap-0.5 rounded-[10px] border border-border-subtle bg-bg-secondary px-1 py-1 shadow-lg"
        style={{ bottom: 24, right: 24 }}
      >
        <ToolbarBtn icon={<Plus className="h-3.5 w-3.5" />} label="Zoom in" onClick={() => zoomIn({ duration: 150 })} />
        <ToolbarBtn icon={<Minus className="h-3.5 w-3.5" />} label="Zoom out" onClick={() => zoomOut({ duration: 150 })} />
        <ToolbarBtn icon={<Maximize2 className="h-3.5 w-3.5" />} label="Fit view" onClick={() => fitView({ duration: 250, padding: 0.2 })} />

        <div className="w-px h-5 mx-1 bg-border-subtle" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Reset zoom to 100%"
              onClick={() => zoomTo(CANVAS_BASE_ZOOM, { duration: 200 })}
              className="h-7 min-w-[42px] rounded-[6px] px-2 text-center font-mono text-[11px] tabular-nums text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            >
              {pct}%
            </button>
          </TooltipTrigger>
          <TooltipContent>Reset zoom (100%)</TooltipContent>
        </Tooltip>

        <div className="w-px h-5 mx-1 bg-border-subtle" />

        <ToolbarBtn icon={<LayoutGrid className="h-3.5 w-3.5" />} label="Auto-layout" onClick={onAutoLayout} />
      </div>
    </TooltipProvider>
  )
}

function ToolbarBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="h-7 w-7 inline-flex items-center justify-center rounded-[6px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          aria-label={label}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
