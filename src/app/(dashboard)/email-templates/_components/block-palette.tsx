'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ReusableBlock } from '../actions'
import { BLOCK_TYPES } from './email-template-editor'

function PaletteChip({
  id, data, children,
}: {
  id: string
  data: Record<string, unknown>
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data })
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left rounded border border-border bg-card',
        'hover:border-accent hover:bg-accent/40 cursor-grab active:cursor-grabbing transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
      {children}
    </button>
  )
}

export function BlockPalette({ reusableBlocks }: { reusableBlocks: ReusableBlock[] }) {
  return (
    <aside className="w-52 shrink-0 border-r border-border bg-card/40 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-xs font-semibold text-muted-foreground">Blocks</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {BLOCK_TYPES.map(({ type, label, icon }) => (
            <PaletteChip
              key={type}
              id={`palette:${type}`}
              data={{ type: 'palette', source: 'palette', blockType: type }}
            >
              {icon}
              <span>{label}</span>
            </PaletteChip>
          ))}

          {reusableBlocks.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-3 pb-1 px-0.5">
                Reusable
              </p>
              {reusableBlocks.map((rb) => (
                <PaletteChip
                  key={rb.id}
                  id={`reusable:${rb.id}`}
                  data={{ type: 'palette', source: 'reusable', reusableId: rb.id }}
                >
                  <div className="min-w-0">
                    <p className="truncate leading-tight">{rb.name}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{rb.block_type}</p>
                  </div>
                </PaletteChip>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
