'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { NewTaskDialog } from './new-task-dialog'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

interface Props {
  projectId: string
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

type CalendarMode = 'month' | 'week' | 'day'

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ── date helpers ──────────────────────────────────────────────────────────────

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function startOfWeek(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  c.setDate(c.getDate() - c.getDay())
  return c
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── chip colours ──────────────────────────────────────────────────────────────

function chipStyle(t: TaskWithLabels, today: Date): { bg: string; fg: string } {
  if (t.completed) return { bg: 'rgba(255,255,255,0.04)', fg: 'var(--muted-foreground)' }
  if (t.end_date && new Date(t.end_date) < today && !t.completed)
    return { bg: 'rgba(239,68,68,0.12)', fg: '#f87171' }
  return { bg: 'rgba(99,102,241,0.12)', fg: '#818cf8' }
}

// ── root component ────────────────────────────────────────────────────────────

export function ProjectCalendar({ projectId, tasks, onOpenTask, onRefresh }: Props) {
  const today = React.useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [mode, setMode] = React.useState<CalendarMode>('month')
  const [cursor, setCursor] = React.useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), today.getDate())
  )

  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  }

  function goPrev() {
    if (mode === 'month') setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
    else if (mode === 'week') setCursor((c) => addDays(c, -7))
    else setCursor((c) => addDays(c, -1))
  }

  function goNext() {
    if (mode === 'month') setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
    else if (mode === 'week') setCursor((c) => addDays(c, 7))
    else setCursor((c) => addDays(c, 1))
  }

  const headerLabel = React.useMemo(() => {
    if (mode === 'month')
      return new Date(cursor.getFullYear(), cursor.getMonth(), 1).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    if (mode === 'day')
      return cursor.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const start = startOfWeek(cursor)
    return start.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }, [mode, cursor])

  const noDateCount = React.useMemo(
    () => tasks.filter((t) => !t.start_date && !t.end_date).length,
    [tasks]
  )

  return (
    <div className="flex flex-col min-h-0 flex-1 select-none">
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={goToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-1 text-sm font-medium">{headerLabel}</span>
        </div>

        <div className="flex items-center gap-2.5">
          {noDateCount > 0 && (
            <span className="text-xs text-muted-foreground">
              No date ({noDateCount})
            </span>
          )}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 border border-border/40">
            {(['month', 'week', 'day'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md transition-all capitalize whitespace-nowrap',
                  mode === m
                    ? 'bg-background text-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m === 'month' ? 'Months' : m === 'week' ? 'Weeks' : 'Day'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Views ── */}
      {mode === 'month' && (
        <MonthView
          cursor={cursor}
          tasks={tasks}
          today={today}
          projectId={projectId}
          onOpenTask={onOpenTask}
          onRefresh={onRefresh}
        />
      )}
      {mode === 'week' && (
        <WeekView
          cursor={cursor}
          tasks={tasks}
          today={today}
          projectId={projectId}
          onOpenTask={onOpenTask}
          onRefresh={onRefresh}
        />
      )}
      {mode === 'day' && (
        <DayView
          cursor={cursor}
          tasks={tasks}
          today={today}
          projectId={projectId}
          onOpenTask={onOpenTask}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

// ── Month view ────────────────────────────────────────────────────────────────

interface ViewProps {
  cursor: Date
  tasks: TaskWithLabels[]
  today: Date
  projectId: string
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

function MonthView({ cursor, tasks, today, projectId, onOpenTask, onRefresh }: ViewProps) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7

  const tasksByDay = React.useMemo(() => {
    const map = new Map<string, TaskWithLabels[]>()
    for (const task of tasks) {
      const dateStr = task.end_date ?? task.start_date
      if (!dateStr) continue
      const d = new Date(dateStr)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate().toString()
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(task)
      }
    }
    return map
  }, [tasks, year, month])

  return (
    <>
      {/* Day names header */}
      <div className="shrink-0 grid grid-cols-7 border-b border-border-subtle px-4 sm:px-6 lg:px-8">
        {DAY_NAMES.map((d) => (
          <div
            key={d}
            className="py-2 text-[11px] uppercase tracking-wide text-muted-foreground text-center"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 lg:px-8">
        <div
          className="grid grid-cols-7 h-full"
          style={{ gridTemplateRows: `repeat(${totalCells / 7}, minmax(90px, 1fr))` }}
        >
          {Array.from({ length: totalCells }, (_, idx) => {
            const dayNum = idx - firstDay + 1
            const isValid = dayNum >= 1 && dayNum <= daysInMonth
            if (!isValid) {
              return (
                <div
                  key={`blank-${idx}`}
                  className="border-r border-b border-border-subtle/50 bg-muted/20"
                />
              )
            }
            const isToday =
              today.getFullYear() === year &&
              today.getMonth() === month &&
              today.getDate() === dayNum
            const dayTasks = tasksByDay.get(dayNum.toString()) ?? []
            const isoDate = toIsoDate(new Date(year, month, dayNum))

            return (
              <MonthCell
                key={dayNum}
                dayNum={dayNum}
                isToday={isToday}
                tasks={dayTasks}
                today={today}
                projectId={projectId}
                isoDate={isoDate}
                onOpenTask={onOpenTask}
                onRefresh={onRefresh}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}

interface MonthCellProps {
  dayNum: number
  isToday: boolean
  tasks: TaskWithLabels[]
  today: Date
  projectId: string
  isoDate: string
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

function MonthCell({
  dayNum,
  isToday,
  tasks,
  today,
  projectId,
  isoDate,
  onOpenTask,
  onRefresh,
}: MonthCellProps) {
  return (
    <div
      className={cn(
        'border-r border-b border-border-subtle p-1.5 relative group flex flex-col gap-0.5',
        isToday && 'bg-blue-500/5'
      )}
    >
      {/* Date number */}
      <span
        className={cn(
          'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full self-start',
          isToday ? 'bg-blue-600 text-white' : 'text-foreground'
        )}
      >
        {dayNum}
      </span>

      {/* Task chips */}
      {tasks.slice(0, 3).map((t) => {
        const { bg, fg } = chipStyle(t, today)
        return (
          <button
            key={t.id}
            onClick={() => onOpenTask(t.id)}
            className={cn(
              'w-full text-left text-[11px] px-1.5 py-0.5 rounded-sm truncate flex items-center gap-1 hover:opacity-80 transition-opacity',
              t.completed && 'opacity-50 line-through'
            )}
            style={{ backgroundColor: bg, color: fg }}
          >
            <span className="truncate">{t.name}</span>
          </button>
        )
      })}
      {tasks.length > 3 && (
        <p className="text-[10px] text-muted-foreground pl-1">+{tasks.length - 3} more</p>
      )}

      {/* Add task on hover */}
      <div className="mt-auto hidden group-hover:block">
        <NewTaskDialog projectId={projectId} defaultEndDate={isoDate} onCreated={onRefresh}>
          <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-left pl-1">
            + Add task
          </button>
        </NewTaskDialog>
      </div>
    </div>
  )
}

// ── Day view ──────────────────────────────────────────────────────────────────

function DayView({ cursor, tasks, today, projectId, onOpenTask, onRefresh }: ViewProps) {
  const dayTasks = tasks.filter((t) => {
    const dateStr = t.end_date ?? t.start_date
    if (!dateStr) return false
    return sameDay(new Date(dateStr), cursor)
  })
  const isToday = sameDay(cursor, today)
  const isoDate = toIsoDate(cursor)

  return (
    <div className="flex flex-col flex-1 min-h-0 px-4 sm:px-6 lg:px-8">
      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pt-4 pb-4 max-w-2xl mx-auto w-full',
          isToday && 'bg-blue-500/5 rounded-lg'
        )}
      >
        {dayTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-sm text-muted-foreground">No tasks scheduled</p>
            <NewTaskDialog projectId={projectId} defaultEndDate={isoDate} onCreated={onRefresh}>
              <Button size="sm" variant="outline">+ Add task</Button>
            </NewTaskDialog>
          </div>
        ) : (
          <>
            {dayTasks.map((t) => {
              const { bg, fg } = chipStyle(t, today)
              return (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t.id)}
                  className={cn(
                    'w-full text-left text-sm px-4 py-3 rounded-lg flex items-center gap-3 hover:opacity-80 transition-opacity',
                    t.completed && 'opacity-50'
                  )}
                  style={{ backgroundColor: bg, color: fg }}
                >
                  <span className={cn('flex-1 truncate', t.completed && 'line-through')}>{t.name}</span>
                </button>
              )
            })}
            <div className="pt-2">
              <NewTaskDialog projectId={projectId} defaultEndDate={isoDate} onCreated={onRefresh}>
                <Button size="sm" variant="outline" className="w-full">+ Add task</Button>
              </NewTaskDialog>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({ cursor, tasks, today, projectId, onOpenTask, onRefresh }: ViewProps) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  function tasksFor(d: Date) {
    return tasks.filter((t) => {
      const dateStr = t.end_date ?? t.start_date
      if (!dateStr) return false
      return sameDay(new Date(dateStr), d)
    })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Column headers */}
      <div className="shrink-0 grid grid-cols-7 border-b border-border-subtle px-4 sm:px-6 lg:px-8">
        {days.map((d, i) => {
          const isToday = sameDay(d, today)
          return (
            <div
              key={i}
              className={cn(
                'py-3 flex flex-col items-center gap-1',
                isToday && 'bg-blue-500/5'
              )}
            >
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {DAY_NAMES[d.getDay()]}
              </span>
              <span
                className={cn(
                  'text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full',
                  isToday ? 'bg-blue-600 text-white' : 'text-foreground'
                )}
              >
                {d.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Day columns */}
      <div className="flex-1 min-h-0 grid grid-cols-7 px-4 sm:px-6 lg:px-8">
        {days.map((d, i) => {
          const isToday = sameDay(d, today)
          const dayTasks = tasksFor(d)
          const isoDate = toIsoDate(d)

          return (
            <div
              key={i}
              className={cn(
                'border-r border-border-subtle flex flex-col gap-1 pt-2 pb-2 px-1 overflow-y-auto group',
                isToday && 'bg-blue-500/5'
              )}
            >
              {dayTasks.map((t) => {
                const { bg, fg } = chipStyle(t, today)
                return (
                  <button
                    key={t.id}
                    onClick={() => onOpenTask(t.id)}
                    className={cn(
                      'w-full text-left text-[11px] px-1.5 py-1 rounded-sm truncate flex items-center gap-1 hover:opacity-80 transition-opacity shrink-0',
                      t.completed && 'opacity-50 line-through'
                    )}
                    style={{ backgroundColor: bg, color: fg }}
                  >
                    <span className="truncate">{t.name}</span>
                  </button>
                )
              })}

              {/* Add task on hover */}
              <div className="hidden group-hover:block shrink-0">
                <NewTaskDialog projectId={projectId} defaultEndDate={isoDate} onCreated={onRefresh}>
                  <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-left">
                    + Add task
                  </button>
                </NewTaskDialog>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
