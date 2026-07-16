'use client'

import { useEffect, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical, Layers, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CollapsedRail, COLLAPSED_RAIL_WIDTH } from '@/components/layout/collapsed-rail'
import type { SectionTemplate } from '../actions'
import { BLOCK_TYPES } from './editor/registry'

const STORAGE_KEY = 'email-editor:palette-collapsed'

// Collapsed rail only has room for a handful of section chips before it gets
// silly-tall; past this, show a "expand to see the rest" affordance instead.
const MAX_COLLAPSED_SECTIONS = 6

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

/** Icon-only draggable chip for the collapsed rail. Same dnd `id`/`data`
 *  shape as `PaletteChip` so dragging from the collapsed rail onto the
 *  canvas works identically to dragging from the expanded palette. */
function PaletteIconChip({
  id, data, icon, label,
}: {
  id: string
  data: Record<string, unknown>
  icon: React.ReactNode
  label: string
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data })
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-card text-muted-foreground',
        'hover:border-accent hover:bg-accent/40 hover:text-foreground cursor-grab active:cursor-grabbing transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      {icon}
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
        collapsed ? COLLAPSED_RAIL_WIDTH : 'w-56',
      )}
    >
      {collapsed ? (
        // Collapsed but still fully functional: every block type + section
        // template is a draggable icon chip, same dnd id/data as the
        // expanded chips, so drag-from-collapsed-rail onto the canvas works
        // identically (Phase 7 — this used to be an empty strip).
        <CollapsedRail toggle={<ToggleButton collapsed={collapsed} onClick={toggle} />}>
          {BLOCK_TYPES.map(({ type, label, icon }) => (
            <PaletteIconChip
              key={type}
              id={`palette:${type}`}
              data={{ type: 'palette', source: 'palette', blockType: type }}
              icon={icon}
              label={label}
            />
          ))}

          {sectionTemplates.length > 0 && (
            <>
              <div className="my-1 h-px w-6 shrink-0 bg-border" />
              {sectionTemplates.slice(0, MAX_COLLAPSED_SECTIONS).map((st) => (
                <PaletteIconChip
                  key={st.id}
                  id={`section:${st.id}`}
                  data={{ type: 'palette', source: 'section', sectionTemplateId: st.id }}
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label={st.name}
                />
              ))}
              {sectionTemplates.length > MAX_COLLAPSED_SECTIONS && (
                <button
                  type="button"
                  onClick={toggle}
                  title={`${sectionTemplates.length - MAX_COLLAPSED_SECTIONS} more sections — expand to see all`}
                  aria-label="Expand blocks panel to see all sections"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-dashed border-border text-muted-foreground hover:border-accent hover:text-foreground"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </CollapsedRail>
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
