'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Archive, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  reorderDefinitions,
  archiveDefinition,
  type CustomFieldDefinitionRow,
} from '@/app/(dashboard)/settings/custom-fields/actions'
import type { CustomFieldEntity } from '@/types/database'

interface DefinitionsListProps {
  definitions: CustomFieldDefinitionRow[]
  entity: CustomFieldEntity
  onAddField?: () => void
  onEditField?: (def: CustomFieldDefinitionRow) => void
}

interface SortableRowProps {
  def: CustomFieldDefinitionRow
  onEdit?: (def: CustomFieldDefinitionRow) => void
  onArchive: (def: CustomFieldDefinitionRow) => void
}

function SortableRow({ def, onEdit, onArchive }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: def.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-sm"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 transition-opacity"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0 group">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{def.label}</span>
          <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
            {def.type}
          </Badge>
          {def.required && (
            <Badge variant="outline" className="text-[10px] shrink-0">required</Badge>
          )}
          {def.unique_per_org && (
            <Badge variant="outline" className="text-[10px] shrink-0">unique</Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{def.key}</p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit?.(def)}
          aria-label={`Edit ${def.label}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onArchive(def)}
          aria-label={`Archive ${def.label}`}
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function DefinitionsList({ definitions, entity, onAddField, onEditField }: DefinitionsListProps) {
  const [orderedDefs, setOrderedDefs] = useState(definitions)
  const [, startTransition] = useTransition()

  useEffect(() => {
    setOrderedDefs(definitions)
  }, [definitions])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedDefs.findIndex((d) => d.id === active.id)
    const newIndex = orderedDefs.findIndex((d) => d.id === over.id)
    const reordered = arrayMove(orderedDefs, oldIndex, newIndex)
    setOrderedDefs(reordered)

    startTransition(async () => {
      const result = await reorderDefinitions({
        entity,
        orderedIds: reordered.map((d) => d.id),
      })
      if (!result.ok) {
        setOrderedDefs(orderedDefs)
        toast.error('Failed to reorder fields')
      }
    })
  }

  function handleArchive(def: CustomFieldDefinitionRow) {
    if (!window.confirm(`Archive "${def.label}"? It will be hidden from forms but existing values are preserved.`)) return

    setOrderedDefs((prev) => prev.filter((d) => d.id !== def.id))

    startTransition(async () => {
      const result = await archiveDefinition({ id: def.id })
      if (!result.ok) {
        setOrderedDefs(orderedDefs)
        toast.error('Failed to archive field')
      } else {
        toast.success('Field archived')
      }
    })
  }

  // Group by group_name; null/empty goes last
  const groups = new Map<string | null, CustomFieldDefinitionRow[]>()
  for (const def of orderedDefs) {
    const key = def.group_name ?? null
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(def)
  }

  // Named groups first, then null group
  const namedGroups = Array.from(groups.entries()).filter(([k]) => k !== null)
  const nullGroup = groups.get(null) ?? []
  const hasNamedGroups = namedGroups.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {orderedDefs.length === 0
            ? 'No custom fields yet.'
            : `${orderedDefs.length} field${orderedDefs.length !== 1 ? 's' : ''}`}
        </p>
        <Button size="sm" onClick={onAddField}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add field
        </Button>
      </div>

      {orderedDefs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">No custom fields yet.</p>
          <p className="text-sm text-muted-foreground">Click &quot;Add field&quot; to create one.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={orderedDefs.map((d) => d.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {namedGroups.map(([groupName, groupDefs]) => (
                <div key={groupName} className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 py-1">
                    {groupName}
                  </p>
                  {groupDefs.map((def) => (
                    <SortableRow
                      key={def.id}
                      def={def}
                      onEdit={onEditField}
                      onArchive={handleArchive}
                    />
                  ))}
                </div>
              ))}
              {nullGroup.length > 0 && (
                <div className="space-y-1.5">
                  {hasNamedGroups && (
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 py-1">
                      Other
                    </p>
                  )}
                  {nullGroup.map((def) => (
                    <SortableRow
                      key={def.id}
                      def={def}
                      onEdit={onEditField}
                      onArchive={handleArchive}
                    />
                  ))}
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
