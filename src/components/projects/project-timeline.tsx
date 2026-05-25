'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { TaskAssigneeAvatar } from './task-assignee-avatar'
import { updateTask } from '@/app/(dashboard)/projects/actions'
import { toast } from 'sonner'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

interface Props {
  projectId: string
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

const DAY_W = 32 // px per day
const ROW_H = 36 // px per row

function diffDays(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / 86400000)
}
function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}
function fmt(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type DragState = {
  taskId: string
  mode: 'move' | 'left' | 'right'
  startX: number
  origStart: Date
  origEnd: Date
}

export function ProjectTimeline({ projectId, tasks, onOpenTask, onRefresh }: Props) {
  const today = React.useMemo(() => new Date(), [])

  const dated = tasks.filter((t) => t.start_date && t.end_date)
  const startBound = dated.length
    ? new Date(Math.min(...dated.map((t) => new Date(t.start_date!).getTime())))
    : addDays(today, -7)
  const endBound = dated.length
    ? new Date(Math.max(...dated.map((t) => new Date(t.end_date!).getTime())))
    : addDays(today, 21)
  const rangeStart = addDays(startBound, -3)
  const rangeEnd = addDays(endBound, 3)
  const totalDays = diffDays(rangeStart, rangeEnd) + 1
  const days = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i))

  const [drag, setDrag] = React.useState<DragState | null>(null)
  const [previewDelta, setPreviewDelta] = React.useState(0)

  function onPointerDown(e: React.PointerEvent, task: TaskWithLabels, mode: 'move' | 'left' | 'right') {
    if (!task.start_date || !task.end_date) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({
      taskId: task.id,
      mode,
      startX: e.clientX,
      origStart: new Date(task.start_date),
      origEnd: new Date(task.end_date),
    })
    setPreviewDelta(0)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    const deltaDays = Math.round((e.clientX - drag.startX) / DAY_W)
    setPreviewDelta(deltaDays)
  }

  async function onPointerUp(_e: React.PointerEvent) {
    if (!drag) return
    const deltaDays = previewDelta
    const { taskId, mode, origStart, origEnd } = drag
    setDrag(null)
    setPreviewDelta(0)
    if (deltaDays === 0) return
    let newStart = origStart
    let newEnd = origEnd
    if (mode === 'move') {
      newStart = addDays(origStart, deltaDays)
      newEnd = addDays(origEnd, deltaDays)
    } else if (mode === 'left') {
      newStart = addDays(origStart, deltaDays)
      if (newStart > origEnd) return
    } else if (mode === 'right') {
      newEnd = addDays(origEnd, deltaDays)
      if (newEnd < origStart) return
    }
    try {
      await updateTask(taskId, projectId, {
        start_date: newStart.toISOString().slice(0, 10),
        end_date: newEnd.toISOString().slice(0, 10),
      })
      onRefresh()
    } catch {
      toast.error('Failed to update task dates')
    }
  }

  return (
    <div
      className="overflow-auto select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Date strip */}
      <div className="flex sticky top-0 bg-background z-10 border-b border-border-subtle">
        <div className="w-48 shrink-0 px-2 py-2 text-xs font-medium text-muted-foreground border-r border-border-subtle">
          Task
        </div>
        {days.map((d, i) => {
          const isToday = d.toDateString() === today.toDateString()
          return (
            <div
              key={i}
              className={cn(
                'text-[10px] text-center py-2 border-r border-border-subtle/50 shrink-0',
                isToday && 'bg-accent/10 font-semibold text-foreground'
              )}
              style={{ width: DAY_W }}
            >
              <div>{d.getDate()}</div>
              <div className="text-muted-foreground">{['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()]}</div>
            </div>
          )
        })}
      </div>

      {/* Rows */}
      {tasks.map((t) => {
        const hasDates = t.start_date && t.end_date
        if (!hasDates) {
          return (
            <div key={t.id} className="flex items-center border-b border-border-subtle/40">
              <div
                className="w-48 shrink-0 px-2 py-2 text-xs truncate cursor-pointer hover:text-foreground text-muted-foreground italic"
                onClick={() => onOpenTask(t.id)}
              >
                {t.name} <span className="text-[10px]">(no dates)</span>
              </div>
              <div className="flex-1" style={{ height: ROW_H }} />
            </div>
          )
        }
        const tStart = new Date(t.start_date!)
        const tEnd = new Date(t.end_date!)
        const offsetDays = diffDays(rangeStart, tStart)
        const durationDays = diffDays(tStart, tEnd) + 1
        const isDragging = drag?.taskId === t.id
        const visualDelta = isDragging ? previewDelta : 0
        const visualOffset = drag?.mode === 'right'
          ? offsetDays
          : offsetDays + (drag?.mode === 'left' || drag?.mode === 'move' ? visualDelta : 0)
        let visualDuration = durationDays
        if (drag?.mode === 'left') visualDuration = durationDays - visualDelta
        if (drag?.mode === 'right') visualDuration = durationDays + visualDelta
        return (
          <div key={t.id} className="flex items-center border-b border-border-subtle/40 hover:bg-accent/5">
            <div
              className="w-48 shrink-0 px-2 py-2 text-xs truncate cursor-pointer flex items-center gap-1.5"
              onClick={() => onOpenTask(t.id)}
            >
              {t.assignee && (
                <TaskAssigneeAvatar size="xs" name={t.assignee.full_name} email={t.assignee.email} />
              )}
              <span className="truncate">{t.name}</span>
            </div>
            <div className="relative flex-1" style={{ height: ROW_H }}>
              <div
                onPointerDown={(e) => onPointerDown(e, t, 'move')}
                className={cn(
                  'absolute top-1.5 h-6 rounded-md bg-indigo-500/80 hover:bg-indigo-500 text-white text-[10px] flex items-center px-2 cursor-grab active:cursor-grabbing',
                  t.completed && 'opacity-60 line-through'
                )}
                style={{
                  left: Math.max(0, visualOffset) * DAY_W,
                  width: Math.max(1, visualDuration) * DAY_W,
                }}
                title={`${t.name}\n${fmt(tStart)} → ${fmt(tEnd)}${t.assignee ? `\n${t.assignee.full_name ?? t.assignee.email}` : ''}`}
              >
                <span className="truncate flex-1">{t.name}</span>
                <span
                  onPointerDown={(e) => onPointerDown(e, t, 'left')}
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                />
                <span
                  onPointerDown={(e) => onPointerDown(e, t, 'right')}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
