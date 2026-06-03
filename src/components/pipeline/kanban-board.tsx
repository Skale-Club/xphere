'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
  type CollisionDetection,
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

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArrowDownUp } from 'lucide-react'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
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
import { OpportunityDetailSheet } from './opportunity-detail-sheet'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']

const DEFAULT_CARD_FIELDS = ['contact_name', 'value', 'days_in_stage']

type SortKey = 'manual' | 'value_desc' | 'value_asc' | 'name_asc' | 'days_desc' | 'created_desc'

const SORT_LABELS: Record<SortKey, string> = {
  manual:       'Manual (drag order)',
  value_desc:   'Value: high → low',
  value_asc:    'Value: low → high',
  name_asc:     'Name A → Z',
  days_desc:    'Days in stage: most',
  created_desc: 'Newest first',
}

function sortOpps(opps: OpportunityWithContact[], key: SortKey): OpportunityWithContact[] {
  if (key === 'manual') return opps
  return [...opps].sort((a, b) => {
    switch (key) {
      case 'value_desc':   return Number(b.value ?? 0) - Number(a.value ?? 0)
      case 'value_asc':    return Number(a.value ?? 0) - Number(b.value ?? 0)
      case 'name_asc':     return (a.title ?? '').localeCompare(b.title ?? '')
      case 'days_desc': {
        // days_in_stage may not be on the row; fall back to created_at delta
        const aDays = (a as unknown as Record<string, unknown>).days_in_stage
        const bDays = (b as unknown as Record<string, unknown>).days_in_stage
        if (typeof aDays === 'number' && typeof bDays === 'number') return bDays - aDays
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      case 'created_desc': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      default:             return 0
    }
  })
}

interface KanbanBoardProps {
  pipelineId: string
  stages: StageRow[]
  opportunities: OpportunityWithContact[]
  cardFields?: string[]
  defaultCurrency?: string
}

interface ColumnProps {
  stage: StageRow
  opportunities: OpportunityWithContact[]
  cardFields: string[]
  onOpen: (id: string) => void
  onAction: (action: 'won' | 'lost' | 'delete' | 'edit', id: string) => void
  isOver: boolean
  sortKey: SortKey
  onSortChange: (key: SortKey) => void
}

function StageColumn({ stage, opportunities, cardFields, onOpen, onAction, isOver, sortKey, onSortChange }: ColumnProps) {
  // Make the whole column a sortable drop area by using the SortableContext id
  const { setNodeRef } = useSortable({
    id: `column-${stage.id}`,
    data: { type: 'column', stageId: stage.id },
  })

  const total = opportunities.reduce((acc, o) => acc + Number(o.value ?? 0), 0)
  const currency = opportunities[0]?.currency ?? 'USD'

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full max-h-full w-[300px] shrink-0 flex-col rounded-[12px] border bg-bg-secondary/40 transition-colors overflow-hidden',
        isOver ? 'border-accent/60 bg-accent-muted/10' : 'border-border-subtle',
      )}
    >
      {/* Stage colour stripe */}
      <div
        className="h-[3px] w-full shrink-0"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[12.5px] font-semibold text-text-primary truncate">{stage.name}</h3>
          <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[10.5px] font-medium text-text-tertiary">
            {opportunities.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10.5px] font-medium tabular-nums text-text-tertiary">
            {formatCurrency(total, currency)}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Sort column"
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded transition-colors',
                  sortKey !== 'manual'
                    ? 'text-accent'
                    : 'text-text-tertiary hover:text-text-primary',
                )}
              >
                <ArrowDownUp className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuRadioGroup value={sortKey} onValueChange={(v) => onSortChange(v as SortKey)}>
                {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                  <DropdownMenuRadioItem key={key} value={key} className="text-[12.5px]">
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <OpportunityCard key={o.id} opportunity={o} visibleFields={cardFields} onOpen={onOpen} onAction={onAction} />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  )
}

export function KanbanBoard({ stages, opportunities, cardFields = DEFAULT_CARD_FIELDS, defaultCurrency = 'USD' }: KanbanBoardProps) {
  const router = useRouter()

  // Local optimistic state so drag-and-drop feels instant.
  const [items, setItems] = React.useState<OpportunityWithContact[]>(opportunities)
  React.useEffect(() => setItems(opportunities), [opportunities])

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [overColumnId, setOverColumnId] = React.useState<string | null>(null)
  const [openSheetId, setOpenSheetId] = React.useState<string | null>(null)

  // Per-column sort keys, persisted in localStorage.
  const [sortKeys, setSortKeys] = React.useState<Record<string, SortKey>>(() => {
    try {
      const raw = localStorage.getItem('xphere:pipeline:sort')
      return raw ? (JSON.parse(raw) as Record<string, SortKey>) : {}
    } catch {
      return {}
    }
  })

  function setSortForStage(stageId: string, key: SortKey) {
    setSortKeys((prev) => {
      const next = { ...prev, [stageId]: key }
      try { localStorage.setItem('xphere:pipeline:sort', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  const celebrate = useCelebrate()

  // Track if the deal already lived in a won stage to avoid double-firing.
  const wonStageIds = React.useMemo(() => new Set(stages.filter((s) => s.is_won).map((s) => s.id)), [stages])

  // Breadcrumb badge — open opportunities (not in a won stage)
  const { setSuffix } = useBreadcrumbOverride()
  const openCount = React.useMemo(
    () => items.filter((o) => !wonStageIds.has(o.stage_id)).length,
    [items, wonStageIds],
  )
  React.useEffect(() => {
    setSuffix(<Badge variant="secondary">{openCount}</Badge>)
    return () => setSuffix(null)
  }, [openCount, setSuffix])

  // Wider distance so clicks register as clicks, not drags. No delay | delay
  // makes drag feel laggy / unresponsive on first attempt.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  /**
   * Hybrid collision detection for kanban boards.
   *
   * Default `closestCorners` requires the dragged card's corners to be closer
   * to the target than to any other element — which means you have to drag
   * the card almost fully over the target column for it to register.
   *
   * Strategy used here:
   * 1. `pointerWithin`: if the cursor is inside any droppable, use that.
   *    Activates instantly when the cursor crosses into a target column,
   *    regardless of how much of the card overlaps.
   * 2. Fallback to `rectIntersection` for the (rare) case where the pointer
   *    is between droppables (e.g. above/below the columns area).
   */
  const collisionDetectionStrategy: CollisionDetection = React.useCallback((args) => {
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.length > 0) {
      // If the pointer is over multiple droppables (e.g. card inside a column),
      // prefer the first hit — dnd-kit already sorts by depth.
      const firstId = getFirstCollision(pointerCollisions, 'id')
      if (firstId != null) {
        return pointerCollisions.filter((c) => c.id === firstId)
      }
      return pointerCollisions
    }
    return rectIntersection(args)
  }, [])

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
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 sm:px-6 lg:px-8 pb-2">
        {stages.map((s) => {
          const sk = sortKeys[s.id] ?? 'manual'
          return (
            <StageColumn
              key={s.id}
              stage={s}
              opportunities={sortOpps(byStage.get(s.id) ?? [], sk)}
              cardFields={cardFields}
              onOpen={handleOpen}
              onAction={handleAction}
              isOver={overColumnId === s.id}
              sortKey={sk}
              onSortChange={(key) => setSortForStage(s.id, key)}
            />
          )
        })}
      </div>

      {/* Portal to document.body | parent has framer-motion transform which
          would otherwise break position:fixed used by DragOverlay, causing
          the dragged card to render far from the cursor. */}
      {typeof document !== 'undefined' && createPortal(
        <DragOverlay dropAnimation={{ duration: 280, easing: 'cubic-bezier(0.18, 0.89, 0.32, 1.28)' }}>
          {activeOpp ? (
            <OpportunityCard
              opportunity={activeOpp}
              visibleFields={cardFields}
              onOpen={() => {}}
              onAction={() => {}}
              isOverlay
            />
          ) : null}
        </DragOverlay>,
        document.body,
      )}

      <OpportunityDetailSheet
        opportunityId={openSheetId}
        stages={stages}
        defaultCurrency={defaultCurrency}
        onOpenChange={(o) => !o && setOpenSheetId(null)}
      />
    </DndContext>
  )
}

// dnd-kit utility import compatibility: ensure CSS isn't tree-shaken if needed elsewhere
export { CSS as _CSS }
