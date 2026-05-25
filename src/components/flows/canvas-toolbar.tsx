'use client'

import { useState } from 'react'
import { Plus, Minus, Maximize2, LayoutGrid, Map, Grid3x3, Keyboard, X } from 'lucide-react'
import { useReactFlow, useStore } from '@xyflow/react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CANVAS_BASE_ZOOM, toDisplayZoomPercent } from './canvas-zoom'

interface CanvasToolbarProps {
  onAutoLayout: () => void
  snapToGrid: boolean
  onToggleSnap: () => void
  showMiniMap: boolean
  onToggleMiniMap: () => void
}

const SHORTCUTS = [
  { keys: ['Delete', 'Backspace'], label: 'Delete selected node or edge' },
  { keys: ['Ctrl', 'Z'],           label: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'],  label: 'Redo' },
  { keys: ['Space + drag'],        label: 'Pan canvas' },
  { keys: ['Scroll'],              label: 'Zoom in / out' },
  { keys: ['Ctrl + scroll'],       label: 'Zoom in / out (alternate)' },
  { keys: ['Click edge'],          label: 'Select connection' },
  { keys: ['Drag endpoint'],       label: 'Reconnect edge' },
]

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute bottom-14 right-0 z-20 w-72 rounded-[10px] border border-border-subtle bg-bg-secondary shadow-xl p-4 nodrag nopan nowheel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12.5px] font-semibold text-text-primary">Keyboard shortcuts</span>
        <button
          type="button"
          onClick={onClose}
          className="h-5 w-5 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-primary"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1.5">
        {SHORTCUTS.map(({ keys, label }) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-text-secondary">{label}</span>
            <div className="flex items-center gap-1 shrink-0">
              {keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex items-center rounded-[4px] border border-border-subtle bg-bg-primary px-1 py-0.5 font-mono text-[9.5px] text-text-secondary"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CanvasToolbar({ onAutoLayout, snapToGrid, onToggleSnap, showMiniMap, onToggleMiniMap }: CanvasToolbarProps) {
  const zoom = useStore((s) => s.transform[2])
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const pct = toDisplayZoomPercent(zoom)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="absolute z-10" style={{ bottom: 24, right: 24 }}>
        {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
        <div className="nodrag nopan nowheel flex items-center gap-0.5 rounded-[10px] border border-border-subtle bg-bg-secondary px-1 py-1 shadow-lg">
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

          <ToolbarToggleBtn
            icon={<Grid3x3 className="h-3.5 w-3.5" />}
            label={snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off'}
            active={snapToGrid}
            onClick={onToggleSnap}
          />

          <ToolbarToggleBtn
            icon={<Map className="h-3.5 w-3.5" />}
            label={showMiniMap ? 'Hide mini-map' : 'Show mini-map'}
            active={showMiniMap}
            onClick={onToggleMiniMap}
          />

          <ToolbarToggleBtn
            icon={<Keyboard className="h-3.5 w-3.5" />}
            label="Keyboard shortcuts"
            active={shortcutsOpen}
            onClick={() => setShortcutsOpen((v) => !v)}
          />
        </div>
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

function ToolbarToggleBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'h-7 w-7 inline-flex items-center justify-center rounded-[6px] transition-colors',
            active
              ? 'bg-accent/15 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary',
          )}
          aria-label={label}
          aria-pressed={active}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
