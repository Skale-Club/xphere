'use client'

import * as React from 'react'
import { ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TaskAssigneeAvatar } from './task-assignee-avatar'
import { NewTaskDialog } from './new-task-dialog'
import { updateTask } from '@/app/(dashboard)/projects/actions'
import { toast } from 'sonner'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectTaskStep } from '@/types/database'

interface Props {
  projectId: string
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

// ── constants ─────────────────────────────────────────────────────────────────

const SLOT_MINUTES = 30
const SLOT_MS = SLOT_MINUTES * 60 * 1000
const SLOTS_PER_DAY = 24 * (60 / SLOT_MINUTES)
const BASE_SLOT_W = 5
const ROW_H = 36
const SECTION_ROW_H = 30
const LABEL_W = 192
const MIN_ZOOM = 0.05
const MAX_ZOOM = 10
const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '17:00'

const STEP_SECTIONS: { id: ProjectTaskStep; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo',    label: 'To Do'  },
  { id: 'doing',   label: 'Doing'  },
  { id: 'done',    label: 'Done'   },
]

const ZOOM_PRESETS = [
  { label: 'Days',   zoom: 2    },
  { label: 'Weeks',  zoom: 0.5  },
  { label: 'Months', zoom: 0.13 },
] as const

// ── date helpers ──────────────────────────────────────────────────────────────

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function parseTimeToMinutes(time: string | null | undefined, fallback: string) {
  const value = (time?.slice(0, 5) || fallback).split(':').map(Number)
  return (value[0] ?? 0) * 60 + (value[1] ?? 0)
}

function combineDateTime(date: string, time: string | null | undefined, fallback: string) {
  const d = parseLocalDate(date)
  const minutes = parseTimeToMinutes(time, fallback)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

function taskDateTime(task: TaskWithLabels, edge: 'start' | 'end') {
  const date = edge === 'start' ? task.start_date : task.end_date
  if (!date) return null
  return combineDateTime(
    date,
    edge === 'start' ? task.start_time : task.end_time,
    edge === 'start' ? DEFAULT_START_TIME : DEFAULT_END_TIME,
  )
}

function taskRange(task: TaskWithLabels) {
  const start = taskDateTime(task, 'start')
  const end = taskDateTime(task, 'end')
  if (!start || !end) return null
  if (end.getTime() <= start.getTime()) {
    return { start, end: new Date(start.getTime() + SLOT_MS) }
  }
  return { start, end }
}

function diffCalendarDays(a: Date, b: Date) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000)
}

function diffSlots(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / SLOT_MS)
}

function addDays(d: Date, n: number) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

function addSlots(d: Date, n: number) {
  return new Date(d.getTime() + n * SLOT_MS)
}

function formatDateForInput(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeForInput(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDateTime(d: Date) {
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${formatTimeForInput(d)}`
}

// ── drag state ────────────────────────────────────────────────────────────────

type DragState = {
  taskId: string
  mode: 'move' | 'left' | 'right'
  startX: number
  origStart: Date
  origEnd: Date
}

// ── component ─────────────────────────────────────────────────────────────────

export function ProjectTimeline({ projectId, tasks, onOpenTask, onRefresh }: Props) {
  const today = React.useMemo(() => startOfDay(new Date()), [])
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // ── zoom ──────────────────────────────────────────────────────────────────
  const [zoom, setZoom] = React.useState(0.5)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const mouseXInEl = e.clientX - rect.left + el!.scrollLeft - LABEL_W
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      setZoom((prev) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor))
        const ratio = next / prev
        el!.scrollLeft = LABEL_W + mouseXInEl * ratio - (e.clientX - rect.left)
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const slotW = BASE_SLOT_W * zoom
  const dayW = SLOTS_PER_DAY * slotW

  // ── date range ────────────────────────────────────────────────────────────
  const ranges = React.useMemo(
    () => tasks.map((task) => ({ task, range: taskRange(task) })),
    [tasks],
  )
  const dated = ranges.filter(
    (item): item is { task: TaskWithLabels; range: { start: Date; end: Date } } =>
      Boolean(item.range),
  )
  const startBound = dated.length
    ? new Date(Math.min(...dated.map((item) => item.range.start.getTime())))
    : addDays(today, -7)
  const endBound = dated.length
    ? new Date(Math.max(...dated.map((item) => item.range.end.getTime())))
    : addDays(today, 21)
  const rangeStart = startOfDay(addDays(startBound, -7))
  const rangeEnd = startOfDay(addDays(endBound, 7))
  const totalDays = diffCalendarDays(rangeStart, rangeEnd) + 1
  const days = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i))

  // ── month spans for two-level header ──────────────────────────────────────
  const monthSpans = React.useMemo(() => {
    const spans: { label: string; count: number }[] = []
    for (const d of days) {
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (!spans.length || spans[spans.length - 1].label !== label) {
        spans.push({ label, count: 1 })
      } else {
        spans[spans.length - 1].count++
      }
    }
    return spans
  }, [days])

  // ── section grouping ──────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = React.useState<Set<ProjectTaskStep>>(new Set())

  const tasksByStep = React.useMemo(() => {
    const map = new Map<ProjectTaskStep, typeof ranges>()
    for (const s of STEP_SECTIONS) map.set(s.id, [])
    for (const item of ranges) map.get(item.task.step)?.push(item)
    return map
  }, [ranges])

  // ── no-date count ─────────────────────────────────────────────────────────
  const noDateCount = React.useMemo(
    () => tasks.filter((t) => !t.start_date && !t.end_date).length,
    [tasks],
  )

  // ── drag ──────────────────────────────────────────────────────────────────
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const [previewSlots, setPreviewSlots] = React.useState(0)

  function onPointerDown(
    e: React.PointerEvent,
    task: TaskWithLabels,
    mode: 'move' | 'left' | 'right',
  ) {
    const range = taskRange(task)
    if (!range) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ taskId: task.id, mode, startX: e.clientX, origStart: range.start, origEnd: range.end })
    setPreviewSlots(0)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    setPreviewSlots(Math.round((e.clientX - drag.startX) / slotW))
  }

  async function onPointerUp(_e: React.PointerEvent) {
    if (!drag) return
    const deltaSlots = previewSlots
    const { taskId, mode, origStart, origEnd } = drag
    setDrag(null)
    setPreviewSlots(0)
    if (deltaSlots === 0) return

    let newStart = origStart
    let newEnd = origEnd
    if (mode === 'move') {
      newStart = addSlots(origStart, deltaSlots)
      newEnd = addSlots(origEnd, deltaSlots)
    } else if (mode === 'left') {
      newStart = addSlots(origStart, deltaSlots)
      if (newStart.getTime() >= origEnd.getTime()) return
    } else if (mode === 'right') {
      newEnd = addSlots(origEnd, deltaSlots)
      if (newEnd.getTime() <= origStart.getTime()) return
    }

    try {
      await updateTask(taskId, projectId, {
        start_date: formatDateForInput(newStart),
        start_time: formatTimeForInput(newStart),
        end_date: formatDateForInput(newEnd),
        end_time: formatTimeForInput(newEnd),
      })
      onRefresh()
    } catch {
      toast.error('Failed to update task dates')
    }
  }

  // ── today line position ───────────────────────────────────────────────────
  const todayLineX = LABEL_W + diffSlots(rangeStart, today) * slotW

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden select-none">

      {/* Toolbar */}
      <div className="shrink-0 px-4 sm:px-6 lg:px-8 py-2 border-b border-border-subtle/40 flex items-center gap-3">
        {noDateCount > 0 && (
          <span className="text-xs text-muted-foreground">
            No date <span className="font-medium">({noDateCount})</span>
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {/* Preset view selector */}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 border border-border/40">
            {ZOOM_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setZoom(p.zoom)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-md transition-all',
                  Math.abs(zoom - p.zoom) / p.zoom < 0.15
                    ? 'bg-background text-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground/50">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.4))}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Reset zoom"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.4))}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scroll container — handles both axes */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Two-level sticky header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border-subtle">
          {/* Month row */}
          <div className="flex border-b border-border-subtle/30">
            <div className="shrink-0 border-r border-border-subtle/40" style={{ width: LABEL_W }} />
            {monthSpans.map((span, i) => (
              <div
                key={i}
                className="shrink-0 px-3 py-1 text-[10px] font-semibold text-muted-foreground border-r border-border-subtle/30 overflow-hidden"
                style={{ width: span.count * dayW }}
              >
                {span.label}
              </div>
            ))}
          </div>

          {/* Day row */}
          <div className="flex">
            <div
              className="shrink-0 px-3 py-1.5 text-[11px] font-medium text-muted-foreground border-r border-border-subtle"
              style={{ width: LABEL_W }}
            >
              Task
            </div>
            {days.map((d, i) => {
              const isToday = d.toDateString() === today.toDateString()
              return (
                <div
                  key={i}
                  className={cn(
                    'shrink-0 text-center py-1.5 border-r border-border-subtle/40',
                    isToday && 'bg-blue-500/10 text-blue-400 font-semibold'
                  )}
                  style={{ width: dayW }}
                >
                  <div className="text-[10px] font-medium">
                    {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Rows container with today line */}
        <div className="relative" style={{ minWidth: LABEL_W + days.length * dayW }}>
          {/* Today vertical line */}
          <div
            className="absolute top-0 bottom-0 w-px bg-blue-500/60 z-[6] pointer-events-none"
            style={{ left: todayLineX }}
          />

          {/* Sections */}
          {STEP_SECTIONS.map((section) => {
            const items = tasksByStep.get(section.id) ?? []
            const isCollapsed = collapsed.has(section.id)

            return (
              <React.Fragment key={section.id}>
                {/* Section header row */}
                <div
                  className="flex items-center border-b border-border-subtle/50 bg-muted/20"
                  style={{ height: SECTION_ROW_H }}
                >
                  <button
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        next.has(section.id) ? next.delete(section.id) : next.add(section.id)
                        return next
                      })
                    }
                    className="shrink-0 px-2 flex items-center gap-1.5 h-full hover:bg-accent/20 transition-colors border-r border-border-subtle/40"
                    style={{ width: LABEL_W }}
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 transition-transform text-muted-foreground shrink-0',
                        !isCollapsed && 'rotate-90',
                      )}
                    />
                    <span className="text-xs font-medium">{section.label}</span>
                    <span className="text-[10px] text-muted-foreground/60 ml-1">{items.length}</span>
                  </button>
                  {/* Gantt area — click to add task */}
                  <NewTaskDialog projectId={projectId} defaultStep={section.id} onCreated={onRefresh}>
                    <div
                      className="group flex-1 h-full flex items-center cursor-pointer"
                      style={{ minWidth: days.length * dayW }}
                    >
                      <span className="hidden group-hover:block text-[10px] text-muted-foreground/40 px-3 select-none pointer-events-none">
                        Click anywhere to create a task
                      </span>
                    </div>
                  </NewTaskDialog>
                </div>

                {/* Task rows */}
                {!isCollapsed &&
                  items.map(({ task: t, range }) => {
                    if (!range) {
                      return (
                        <div
                          key={t.id}
                          className="flex items-center border-b border-border-subtle/30 hover:bg-accent/5"
                          style={{ height: ROW_H }}
                        >
                          <div
                            className="shrink-0 px-3 py-2 text-xs truncate cursor-pointer text-muted-foreground italic border-r border-border-subtle/40"
                            style={{ width: LABEL_W, height: ROW_H }}
                            onClick={() => onOpenTask(t.id)}
                          >
                            {t.name}
                            <span className="text-[10px] ml-1 opacity-60">(no dates)</span>
                          </div>
                          <div style={{ height: ROW_H, minWidth: days.length * dayW }} />
                        </div>
                      )
                    }

                    const offsetSlots = diffSlots(rangeStart, range.start)
                    const durationSlots = Math.max(1, diffSlots(range.start, range.end))
                    const isDragging = drag?.taskId === t.id
                    const visualSlots = isDragging ? previewSlots : 0
                    const visualOffset =
                      drag?.mode === 'right'
                        ? offsetSlots
                        : offsetSlots + (drag?.mode === 'left' || drag?.mode === 'move' ? visualSlots : 0)
                    let visualDuration = durationSlots
                    if (isDragging && drag?.mode === 'left') visualDuration = durationSlots - visualSlots
                    if (isDragging && drag?.mode === 'right') visualDuration = durationSlots + visualSlots

                    return (
                      <div
                        key={t.id}
                        className="flex items-center border-b border-border-subtle/30 hover:bg-accent/5"
                        style={{ height: ROW_H }}
                      >
                        {/* Task name */}
                        <div
                          className="shrink-0 px-3 flex items-center gap-1.5 cursor-pointer border-r border-border-subtle/40 overflow-hidden"
                          style={{ width: LABEL_W, height: ROW_H }}
                          onClick={() => onOpenTask(t.id)}
                        >
                          {t.assignee && (
                            <TaskAssigneeAvatar
                              size="xs"
                              name={t.assignee.full_name}
                              email={t.assignee.email}
                            />
                          )}
                          <span className="text-xs truncate">{t.name}</span>
                        </div>

                        {/* Gantt area */}
                        <div
                          className="relative"
                          style={{ height: ROW_H, minWidth: days.length * dayW }}
                        >
                          {/* Bar */}
                          <div
                            onPointerDown={(e) => onPointerDown(e, t, 'move')}
                            className={cn(
                              'absolute top-1.5 h-6 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-[10px] flex items-center px-2 cursor-grab active:cursor-grabbing shadow-sm transition-colors',
                              t.completed && 'opacity-60 line-through',
                            )}
                            style={{
                              left: Math.max(0, visualOffset) * slotW,
                              width: Math.max(slotW, visualDuration * slotW),
                            }}
                            title={`${t.name}\n${fmtDateTime(range.start)} → ${fmtDateTime(range.end)}${t.assignee ? `\n${t.assignee.full_name ?? t.assignee.email}` : ''}`}
                          >
                            {t.assignee && (
                              <TaskAssigneeAvatar
                                size="xs"
                                name={t.assignee.full_name}
                                email={t.assignee.email}
                                className="shrink-0 mr-1"
                              />
                            )}
                            <span className="truncate flex-1">{t.name}</span>

                            {/* Resize handles */}
                            <span
                              onPointerDown={(e) => onPointerDown(e, t, 'left')}
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-lg hover:bg-white/30"
                            />
                            <span
                              onPointerDown={(e) => onPointerDown(e, t, 'right')}
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-lg hover:bg-white/30"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
