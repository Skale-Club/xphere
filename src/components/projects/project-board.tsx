'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, GripVertical } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TaskCard } from './task-card'
import { NewTaskDialog } from './new-task-dialog'
import { moveTask } from '@/app/(dashboard)/projects/actions'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectTaskStep } from '@/types/database'

const STEPS: { id: ProjectTaskStep; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
]

interface ColumnProps {
  step: { id: ProjectTaskStep; label: string }
  tasks: TaskWithLabels[]
  projectId: string
  isOver: boolean
  onOpen: (id: string) => void
  onRefresh: () => void
}

function SortableTaskCard({ task, onOpen }: { task: TaskWithLabels; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', step: task.step },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-30' : undefined}
    >
      <TaskCard
        task={task}
        onClick={onOpen}
        dragHandle={
          <button {...listeners} {...attributes} className="cursor-grab touch-none p-0.5">
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        }
      />
    </div>
  )
}

function BoardColumn({ step, tasks, projectId, isOver, onOpen, onRefresh }: ColumnProps) {
  const { setNodeRef } = useSortable({
    id: `col-${step.id}`,
    data: { type: 'column', step: step.id },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full max-h-full w-[80vw] sm:w-[300px] shrink-0 flex-col rounded-[12px] border bg-bg-secondary/40 transition-colors snap-center sm:snap-align-none',
        isOver ? 'border-accent/60 bg-accent-muted/10' : 'border-border-subtle'
      )}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{step.label}</span>
          <span className="text-xs text-muted-foreground bg-muted/60 rounded-full px-1.5 min-w-[20px] text-center tabular-nums">
            {tasks.length}
          </span>
        </div>
        <NewTaskDialog projectId={projectId} defaultStep={step.id} onCreated={onRefresh}>
          <button className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </NewTaskDialog>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-6">Drop tasks here</p>
        )}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onOpen={() => onOpen(task.id)}
            />
          ))}
        </SortableContext>
      </div>

      <div className="p-2 border-t border-border-subtle">
        <NewTaskDialog projectId={projectId} defaultStep={step.id} onCreated={onRefresh}>
          <Button variant="ghost" size="sm" className="w-full justify-center text-muted-foreground text-xs h-8 border border-dashed border-border-subtle hover:border-accent/50 hover:text-foreground">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add task
          </Button>
        </NewTaskDialog>
      </div>
    </div>
  )
}

interface Props {
  projectId: string
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

export function ProjectBoard({ projectId, tasks, onOpenTask, onRefresh }: Props) {
  const [overCol, setOverCol] = React.useState<ProjectTaskStep | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  const tasksByStep = React.useMemo(() => {
    const map = new Map<ProjectTaskStep, TaskWithLabels[]>()
    for (const s of STEPS) map.set(s.id, [])
    for (const t of tasks) map.get(t.step)?.push(t)
    return map
  }, [tasks])

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  function onDragStart(e: DragStartEvent) {
    if (e.active.data.current?.type === 'task') {
      setActiveId(e.active.id as string)
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    setOverCol(null)

    const { active, over } = e
    if (!over) return

    const taskId = active.id as string
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    let targetStep: ProjectTaskStep | null = null

    if (over.data.current?.type === 'column') {
      targetStep = over.data.current.step as ProjectTaskStep
    } else if (over.data.current?.type === 'task') {
      const overTask = tasks.find((t) => t.id === over.id)
      if (overTask) targetStep = overTask.step
    }

    if (!targetStep || targetStep === task.step) return

    try {
      await moveTask(taskId, projectId, targetStep)
      onRefresh()
    } catch {
      toast.error('Failed to move task')
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        const step =
          e.over?.data.current?.type === 'column'
            ? (e.over.data.current.step as ProjectTaskStep)
            : e.over?.data.current?.type === 'task'
            ? tasks.find((t) => t.id === e.over!.id)?.step ?? null
            : null
        setOverCol(step)
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none">
        <SortableContext items={STEPS.map((s) => `col-${s.id}`)} strategy={verticalListSortingStrategy}>
          {STEPS.map((step) => (
            <BoardColumn
              key={step.id}
              step={step}
              tasks={tasksByStep.get(step.id) ?? []}
              projectId={projectId}
              isOver={overCol === step.id}
              onOpen={onOpenTask}
              onRefresh={onRefresh}
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="rotate-1 shadow-2xl">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
