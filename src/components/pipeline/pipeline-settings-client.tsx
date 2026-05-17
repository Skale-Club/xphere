'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, GripVertical, Check, X, Pencil } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  createPipeline,
  deletePipeline,
  updatePipeline,
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
} from '@/app/(dashboard)/pipeline/actions'
import type { Database } from '@/types/database'

type PipelineRow = Database['public']['Tables']['pipelines']['Row']
type StageRowType = Database['public']['Tables']['pipeline_stages']['Row']

const PRESET_COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']

interface Props {
  pipelines: PipelineRow[]
  activeId: string | null
  stages: StageRowType[]
}

export function PipelineSettingsClient({ pipelines, activeId, stages }: Props) {
  const router = useRouter()
  const [newPipelineName, setNewPipelineName] = React.useState('')
  const [editPipelineId, setEditPipelineId] = React.useState<string | null>(null)
  const [editPipelineName, setEditPipelineName] = React.useState('')
  const [newStageName, setNewStageName] = React.useState('')
  const [newStageColor, setNewStageColor] = React.useState(PRESET_COLORS[0])
  const [orderedStages, setOrderedStages] = React.useState<StageRowType[]>(stages)
  React.useEffect(() => setOrderedStages(stages), [stages])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function selectPipeline(id: string) {
    router.push(`/pipeline/settings?pipeline=${id}`)
  }

  async function handleCreatePipeline() {
    if (!newPipelineName.trim()) return
    const res = await createPipeline({ name: newPipelineName.trim() })
    if (res.error) toast.error(res.error)
    else {
      toast.success('Pipeline created')
      setNewPipelineName('')
      router.refresh()
    }
  }

  async function handleSavePipelineName(id: string) {
    if (!editPipelineName.trim()) return
    const res = await updatePipeline(id, { name: editPipelineName.trim() })
    if (res && 'error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Renamed')
      setEditPipelineId(null)
      router.refresh()
    }
  }

  async function handleDeletePipeline(id: string) {
    if (!confirm('Delete this pipeline? All stages and opportunities inside will also be removed.'))
      return
    const res = await deletePipeline(id)
    if (res && 'error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Pipeline deleted')
      router.refresh()
    }
  }

  async function handleCreateStage() {
    if (!activeId || !newStageName.trim()) return
    const res = await createStage(activeId, {
      name: newStageName.trim(),
      color: newStageColor,
      is_won: false,
      is_lost: false,
    })
    if (res.error) toast.error(res.error)
    else {
      setNewStageName('')
      setNewStageColor(PRESET_COLORS[0])
      router.refresh()
    }
  }

  async function handleStageDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || !activeId) return
    const oldIdx = orderedStages.findIndex((s) => s.id === active.id)
    const newIdx = orderedStages.findIndex((s) => s.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = [...orderedStages]
    const [moved] = next.splice(oldIdx, 1)
    next.splice(newIdx, 0, moved)
    setOrderedStages(next)
    const res = await reorderStages(
      activeId,
      next.map((s) => s.id),
    )
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      setOrderedStages(stages)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* Pipeline list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px]">Pipelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            {pipelines.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'group flex items-center gap-1.5 rounded-[8px] border px-2.5 py-2 transition-colors',
                  p.id === activeId
                    ? 'border-accent/40 bg-accent-muted/20'
                    : 'border-border-subtle bg-bg-secondary hover:border-border-strong',
                )}
              >
                {editPipelineId === p.id ? (
                  <>
                    <Input
                      value={editPipelineName}
                      onChange={(e) => setEditPipelineName(e.target.value)}
                      className="h-7 text-[12.5px]"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSavePipelineName(p.id)}
                      className="text-emerald-400 hover:text-emerald-300"
                      aria-label="Save"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditPipelineId(null)}
                      className="text-text-tertiary hover:text-text-primary"
                      aria-label="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => selectPipeline(p.id)}
                      className="flex-1 text-left text-[12.5px] text-text-primary truncate"
                    >
                      {p.name}
                      {p.is_default && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                          default
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setEditPipelineId(p.id)
                        setEditPipelineName(p.name)
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-primary"
                      aria-label="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDeletePipeline(p.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-rose-400 hover:text-rose-300"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-border-subtle pt-3 space-y-1.5">
            <Input
              placeholder="New pipeline name"
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              className="h-8 text-[12.5px]"
            />
            <Button onClick={handleCreatePipeline} size="sm" className="w-full" disabled={!newPipelineName.trim()}>
              <Plus className="h-3.5 w-3.5" /> Create pipeline
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stages of active pipeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px]">Stages</CardTitle>
        </CardHeader>
        <CardContent>
          {!activeId ? (
            <p className="text-[12.5px] text-text-tertiary">Select a pipeline to manage its stages.</p>
          ) : (
            <>
              <DndContext sensors={sensors} onDragEnd={handleStageDragEnd}>
                <SortableContext items={orderedStages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {orderedStages.map((s) => (
                      <StageRow key={s.id} stage={s} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="mt-4 border-t border-border-subtle pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="New stage name"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    className="h-8 text-[12.5px] flex-1"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-text-tertiary mr-1">colour</span>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewStageColor(c)}
                      className={cn(
                        'h-5 w-5 rounded-full ring-2 transition-all',
                        newStageColor === c ? 'ring-text-primary scale-110' : 'ring-transparent',
                      )}
                      style={{ backgroundColor: c }}
                      aria-label={`Pick ${c}`}
                    />
                  ))}
                </div>
                <Button onClick={handleCreateStage} size="sm" disabled={!newStageName.trim()}>
                  <Plus className="h-3.5 w-3.5" /> Add stage
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StageRow({ stage }: { stage: StageRowType }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [name, setName] = React.useState(stage.name)
  const [color, setColor] = React.useState(stage.color)
  const [isWon, setIsWon] = React.useState(stage.is_won)
  const [isLost, setIsLost] = React.useState(stage.is_lost)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  async function save() {
    const res = await updateStage(stage.id, { name: name.trim(), color, is_won: isWon, is_lost: isLost })
    if (res && 'error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Stage saved')
      setEditing(false)
      router.refresh()
    }
  }

  async function remove() {
    if (!confirm(`Delete stage "${stage.name}"?`)) return
    const res = await deleteStage(stage.id)
    if (res && 'error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Stage deleted')
      router.refresh()
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-[8px] border border-border-subtle bg-bg-secondary px-2 py-2"
    >
      <button {...attributes} {...listeners} className="text-text-tertiary cursor-grab active:cursor-grabbing" aria-label="Drag">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {editing ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-[12.5px] flex-1" />
          <div className="flex items-center gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn('h-4 w-4 rounded-full ring-2', color === c ? 'ring-text-primary' : 'ring-transparent')}
                style={{ backgroundColor: c }}
                aria-label={`Pick ${c}`}
              />
            ))}
          </div>
          <label className="inline-flex items-center gap-1 text-[10.5px] text-text-tertiary">
            <input type="checkbox" checked={isWon} onChange={(e) => setIsWon(e.target.checked)} /> won
          </label>
          <label className="inline-flex items-center gap-1 text-[10.5px] text-text-tertiary">
            <input type="checkbox" checked={isLost} onChange={(e) => setIsLost(e.target.checked)} /> lost
          </label>
          <button onClick={save} className="text-emerald-400 hover:text-emerald-300" aria-label="Save">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setEditing(false)} className="text-text-tertiary hover:text-text-primary" aria-label="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 text-[12.5px] text-text-primary truncate">
            {stage.name}
            {stage.is_won && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-emerald-400">won</span>
            )}
            {stage.is_lost && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-rose-400">lost</span>
            )}
          </span>
          <button onClick={() => setEditing(true)} className="text-text-tertiary hover:text-text-primary" aria-label="Edit">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={remove} className="text-rose-400 hover:text-rose-300" aria-label="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  )
}
