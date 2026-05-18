'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/pipeline/format'
import {
  moveOpportunity,
  deleteOpportunity,
  updateOpportunity,
  reorderOpportunities,
  type OpportunityWithContact,
} from '@/app/(dashboard)/pipeline/actions'
import type { Database } from '@/types/database'
import { useCelebrate } from '@/components/design-system/celebration-provider'
import { OpportunityCard } from './opportunity-card'
import { NewOpportunityDialog } from './new-opportunity-dialog'
import { OpportunityDetailSheet } from './opportunity-detail-sheet'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']

interface KanbanBoardProps {
  pipelineId: string
  stages: StageRow[]
  opportunities: OpportunityWithContact[]
}

interface ColumnProps {
  stage: StageRow
  opportunities: OpportunityWithContact[]
  onOpen: (id: string) => void
  onAction: (action: 'won' | 'lost' | 'delete' | 'edit', id: string) => void
  pipelineId: string
  isOver: boolean
}

function StageColumn({ stage, opportunities, onOpen, onAction, pipelineId, isOver }: ColumnProps) {
  // Make the whole column a sortable drop area by using the SortableContext id
  const { setNodeRef } = useSortable({
    id: `column-${stage.id}`,
    data: { type: 'column', stageId: stage.id },
  })

  const total = opportunities.reduce((acc, o) => acc + Number(o.value ?? 0), 0)
  const currency = opportunities[0]?.currency ?? 'BRL'

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[300px] shrink-0 flex-col rounded-[12px] border bg-bg-secondary/40 transition-colors',
        isOver ? 'border-accent/60 bg-accent-muted/10' : 'border-border-subtle',
      )}
    >
      {/* Stage colour stripe */}
      <div
        className="h-[3px] rounded-t-[12px]"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[12.5px] font-semibold text-text-primary truncate">{stage.name}</h3>
          <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[10.5px] font-medium text-text-tertiary">
            {opportunities.length}
          </span>
        </div>
        <div className="text-[10.5px] font-medium tabular-nums text-text-tertiary">
          {formatCurrency(total, currency)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5 min-h-[200px]">
        <SortableContext
          items={opportunities.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          {opportunities.length === 0 ? (
            <div
              className={cn(
                'mt-2 flex h-[80px] items-center justify-center rounded-[10px] border-2 border-dashed text-[11.5px] transition-colors',
                isOver
                  ? 'border-accent/50 text-accent bg-accent-muted/20'
                  : 'border-border-subtle text-text-tertiary',
              )}
            >
              {isOver ? 'Drop here' : 'Drop an opportunity here'}
            </div>
          ) : (
            opportunities.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} onOpen={onOpen} onAction={onAction} />
            ))
          )}
        </SortableContext>
      </div>

      <div className="border-t border-border-subtle px-2 py-2">
        <NewOpportunityDialog pipelineId={pipelineId} stageId={stage.id}>
          <Button variant="ghost" size="sm" className="w-full justify-start text-text-tertiary hover:text-text-primary">
            <Plus className="h-3.5 w-3.5" /> Add opportunity
          </Button>
        </NewOpportunityDialog>
      </div>
    </div>
  )
}

export function KanbanBoard({ pipelineId, stages, opportunities }: KanbanBoardProps) {
  const router = useRouter()

  // Local optimistic state so drag-and-drop feels instant.
  const [items, setItems] = React.useState<OpportunityWithContact[]>(opportunities)
  React.useEffect(() => setItems(opportunities), [opportunities])

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overColumnId, setOverColumnId] = React.useState<string | null>(null)
  const [openSheetId, setOpenSheetId] = React.useState<string | null>(null)
  const celebrate = useCelebrate()

  // Track if the deal already lived in a won stage to avoid double-firing.
  const wonStageIds = React.useMemo(() => new Set(stages.filter((s) => s.is_won).map((s) => s.id)), [stages])

  // Wider distance + tolerance + small delay so clicks register as clicks, not drags.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8, tolerance: 5, delay: 80 },
    }),
  )

  const byStage = React.useMemo(() => {
    const map = new Map<string, OpportunityWithContact[]>()
    for (const s of stages) map.set(s.id, [])
    for (const o of items) {
      const arr = map.get(o.stage_id)
      if (arr) arr.push(o)
    }
    return map
  }, [items, stages])

  const activeOpp = React.useMemo(
    () => (activeId ? items.find((o) => o.id === activeId) ?? null : null),
    [activeId, items],
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event
    if (!over) return setOverColumnId(null)
    const overData = over.data.current as { type?: string; stageId?: string } | undefined
    if (overData?.type === 'column' || overData?.type === 'opportunity') {
      setOverColumnId(overData.stageId ?? null)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    setOverColumnId(null)
    if (!over) return

    const activeData = active.data.current as { type?: string; stageId?: string } | undefined
    const overData = over.data.current as { type?: string; stageId?: string } | undefined
    if (!activeData || activeData.type !== 'opportunity') return

    const targetStageId = overData?.stageId
    if (!targetStageId) return

    const opp = items.find((o) => o.id === active.id)
    if (!opp) return

    // Determine new position: if we dropped on a card, insert before it;
    // if we dropped on a column, append.
    let newPosition: number | undefined = undefined
    if (overData?.type === 'opportunity' && over.id !== active.id) {
      const stageOpps = (byStage.get(targetStageId) ?? []).filter((o) => o.id !== active.id)
      const idx = stageOpps.findIndex((o) => o.id === over.id)
      if (idx >= 0) newPosition = idx
    }

    const sameStage = opp.stage_id === targetStageId

    // Same stage + no specific position change ⇒ no-op
    if (sameStage && newPosition === undefined) return

    // Optimistic local reorder
    setItems((prev) => {
      // Build new array with the moved card in its new position
      const without = prev.filter((o) => o.id !== active.id)
      const stageOpps = without.filter((o) => o.stage_id === targetStageId)
      const others = without.filter((o) => o.stage_id !== targetStageId)
      const moved = { ...opp, stage_id: targetStageId }
      const insertAt = newPosition ?? stageOpps.length
      stageOpps.splice(insertAt, 0, moved)
      return [...others, ...stageOpps]
    })

    // Branch: same-stage reorder vs cross-stage move
    if (sameStage) {
      const orderedIds = [
        ...(byStage.get(targetStageId) ?? []).filter((o) => o.id !== active.id).map((o) => o.id),
      ]
      orderedIds.splice(newPosition ?? orderedIds.length, 0, opp.id)
      const res = await reorderOpportunities(targetStageId, orderedIds)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        setItems(opportunities)
      } else {
        router.refresh()
      }
      return
    }

    const movedToWon = wonStageIds.has(targetStageId) && !wonStageIds.has(opp.stage_id)
    const res = await moveOpportunity(opp.id, targetStageId, newPosition)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      setItems(opportunities) // rollback
    } else {
      if (movedToWon) celebrate()
      router.refresh()
    }
  }

  function handleOpen(id: string) {
    setOpenSheetId(id)
  }

  async function handleAction(action: 'won' | 'lost' | 'delete' | 'edit', id: string) {
    if (action === 'edit') {
      setOpenSheetId(id)
      return
    }
    if (action === 'delete') {
      if (!confirm('Delete this opportunity? This cannot be undone.')) return
      const res = await deleteOpportunity(id)
      if (res && 'error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Opportunity deleted')
        router.refresh()
      }
      return
    }
    if (action === 'won' || action === 'lost') {
      const opp = items.find((o) => o.id === id)
      const alreadyWon = opp ? wonStageIds.has(opp.stage_id) : false
      // Move to first stage marked won/lost if any
      const target = stages.find((s) => (action === 'won' ? s.is_won : s.is_lost))
      if (target) {
        const res = await moveOpportunity(id, target.id)
        if (res && 'error' in res && res.error) toast.error(res.error)
        else {
          if (action === 'won' && !alreadyWon) celebrate()
          toast.success(`Marked ${action}`)
          router.refresh()
        }
      } else {
        const res = await updateOpportunity(id, { status: action })
        if (res && 'error' in res && res.error) toast.error(res.error)
        else {
          if (action === 'won' && !alreadyWon) celebrate()
          toast.success(`Marked ${action}`)
          router.refresh()
        }
      }
      return
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {stages.map((s) => (
          <StageColumn
            key={s.id}
            stage={s}
            opportunities={byStage.get(s.id) ?? []}
            onOpen={handleOpen}
            onAction={handleAction}
            pipelineId={pipelineId}
            isOver={overColumnId === s.id}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 280, easing: 'cubic-bezier(0.18, 0.89, 0.32, 1.28)' }}>
        {activeOpp ? (
          <OpportunityCard
            opportunity={activeOpp}
            onOpen={() => {}}
            onAction={() => {}}
            isOverlay
          />
        ) : null}
      </DragOverlay>

      <OpportunityDetailSheet
        opportunityId={openSheetId}
        stages={stages}
        onOpenChange={(o) => !o && setOpenSheetId(null)}
      />
    </DndContext>
  )
}

// dnd-kit utility import compatibility: ensure CSS isn't tree-shaken if needed elsewhere
export { CSS as _CSS }
