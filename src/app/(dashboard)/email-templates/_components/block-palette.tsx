'use client'

import { useEffect, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SectionTemplate } from '../actions'
import { BLOCK_TYPES } from './editor/registry'

const STORAGE_KEY = 'email-editor:palette-collapsed'

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

function ToggleButton({
  collapsed, onClick,
}: {
  collapsed: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? 'Expand blocks panel' : 'Collapse blocks panel'}
      title={collapsed ? 'Expand blocks panel' : 'Collapse blocks panel'}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
    </button>
  )
}

export function BlockPalette({ sectionTemplates }: { sectionTemplates: SectionTemplate[] }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setCollapsed(stored === '1')
    } catch {}
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-card/40 flex flex-col overflow-hidden',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-9' : 'w-56',
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center py-2">
          <ToggleButton collapsed={collapsed} onClick={toggle} />
        </div>
      ) : (
        <>
          <div className="h-10 px-3 border-b border-border shrink-0 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold leading-tight">Blocks</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Drag onto the canvas</p>
            </div>
            <ToggleButton collapsed={collapsed} onClick={toggle} />
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5">
              {BLOCK_TYPES.map(({ type, label, description, icon }) => (
                <PaletteChip
                  key={type}
                  id={`palette:${type}`}
                  data={{ type: 'palette', source: 'palette', blockType: type }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    {icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium leading-tight">{label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground leading-tight">{description}</span>
                  </span>
                </PaletteChip>
              ))}

              {sectionTemplates.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-3 pb-1 px-0.5">
                    Sections
                  </p>
                  {sectionTemplates.map((st) => (
                    <PaletteChip
                      key={st.id}
                      id={`section:${st.id}`}
                      data={{ type: 'palette', source: 'section', sectionTemplateId: st.id }}
                    >
                      <div className="min-w-0">
                        <p className="truncate leading-tight">{st.name}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">{st.section_type}</p>
                      </div>
                    </PaletteChip>
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </aside>
  )
}
