'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TaskAssigneeAvatar } from './task-assignee-avatar'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

interface Props {
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
}

type CalendarMode = 'month' | 'week' | 'day'

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

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
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function fmtRange(a: Date, b: Date) {
  const fa = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fb = b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fa} – ${fb}`
}

export function ProjectCalendar({ tasks, onOpenTask }: Props) {
  const today = new Date()
  const [viewMode, setViewMode] = React.useState<CalendarMode>('month')
  const [cursor, setCursor] = React.useState<Date>(new Date(today.getFullYear(), today.getMonth(), today.getDate()))

  function goPrev() {
    if (viewMode === 'month') {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
    } else if (viewMode === 'week') {
      setCursor((c) => addDays(c, -7))
    } else {
      setCursor((c) => addDays(c, -1))
    }
  }
  function goNext() {
    if (viewMode === 'month') {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
    } else if (viewMode === 'week') {
      setCursor((c) => addDays(c, 7))
    } else {
      setCursor((c) => addDays(c, 1))
    }
  }

  const headerLabel = React.useMemo(() => {
    if (viewMode === 'month') {
      return new Date(cursor.getFullYear(), cursor.getMonth(), 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    }
    if (viewMode === 'week') {
      const start = startOfWeek(cursor)
      const end = addDays(start, 6)
      return fmtRange(start, end)
    }
    return cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [viewMode, cursor])

  return (
    <div className="select-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{headerLabel}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="inline-flex rounded-md border border-border-subtle p-0.5 text-xs">
          {(['month', 'week', 'day'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={cn(
                'px-2 py-1 rounded capitalize transition-colors',
                viewMode === m
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'month' && <MonthGrid cursor={cursor} tasks={tasks} onOpenTask={onOpenTask} today={today} />}
      {viewMode === 'week' && <WeekStrip cursor={cursor} tasks={tasks} onOpenTask={onOpenTask} today={today} />}
      {viewMode === 'day' && <DayList cursor={cursor} tasks={tasks} onOpenTask={onOpenTask} />}
    </div>
  )
}

function MonthGrid({ cursor, tasks, onOpenTask, today }: { cursor: Date; tasks: TaskWithLabels[]; onOpenTask: (id: string) => void; today: Date }) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

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

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const leadingBlanks = Array.from({ length: firstDay }, (_, i) => i)

  return (
    <>
      <div className="grid grid-cols-7 mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-xs text-muted-foreground py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
        {leadingBlanks.map((i) => (
          <div key={`blank-${i}`} className="bg-background min-h-[56px] sm:min-h-[80px] p-1" />
        ))}
        {days.map((day) => {
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
          const dayTasks = tasksByDay.get(day.toString()) ?? []
          return (
            <div
              key={day}
              className="bg-background min-h-[56px] sm:min-h-[80px] p-1 space-y-0.5"
            >
              <div className={cn(
                'text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full mx-auto',
                isToday && 'bg-foreground text-background'
              )}>
                {day}
              </div>
              <div className="hidden sm:block space-y-0.5">
                {dayTasks.slice(0, 2).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onOpenTask(t.id)}
                    className={cn(
                      'w-full text-left text-[10px] px-1 py-0.5 rounded truncate transition-opacity hover:opacity-80 active:opacity-60',
                      t.completed ? 'opacity-50 line-through' : ''
                    )}
                    style={{
                      backgroundColor: (t.end_date && new Date(t.end_date) < today && !t.completed) ? '#ef444422' : '#6366f122',
                      color: (t.end_date && new Date(t.end_date) < today && !t.completed) ? '#ef4444' : '#6366f1',
                    }}
                  >
                    <span className="flex items-center gap-1">
                      {t.assignee && (
                        <TaskAssigneeAvatar
                          size="xs"
                          name={t.assignee.full_name}
                          email={t.assignee.email}
                          className="h-3 w-3 text-[8px] shrink-0"
                        />
                      )}
                      <span className="truncate">{t.name}</span>
                    </span>
                  </button>
                ))}
                {dayTasks.length > 2 && (
                  <p className="text-[10px] text-muted-foreground pl-1">+{dayTasks.length - 2}</p>
                )}
              </div>
              {dayTasks.length > 0 && (
                <div className="sm:hidden flex justify-center gap-0.5 mt-0.5">
                  {dayTasks.slice(0, 3).map((t) => (
                    <button key={t.id} onClick={() => onOpenTask(t.id)} className="h-1.5 w-1.5 rounded-full bg-indigo-400 active:scale-125 transition-transform" />
                  ))}
                  {dayTasks.length > 3 && <span className="text-[8px] text-muted-foreground">+</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function WeekStrip({ cursor, tasks, onOpenTask, today }: { cursor: Date; tasks: TaskWithLabels[]; onOpenTask: (id: string) => void; today: Date }) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))

  function tasksFor(d: Date) {
    return tasks.filter((t) => {
      const dateStr = t.end_date ?? t.start_date
      if (!dateStr) return false
      const td = new Date(dateStr)
      return sameDay(td, d)
    })
  }

  return (
    <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
      {days.map((d, i) => {
        const dayTasks = tasksFor(d)
        const isToday = sameDay(d, today)
        return (
          <div key={i} className="bg-background min-h-[160px] p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()]}
              </span>
              <span className={cn(
                'text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full',
                isToday && 'bg-foreground text-background'
              )}>
                {d.getDate()}
              </span>
            </div>
            <div className="space-y-1">
              {dayTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t.id)}
                  className={cn(
                    'w-full text-left text-[11px] px-1.5 py-1 rounded transition-opacity hover:opacity-80 flex items-center gap-1',
                    t.completed && 'opacity-50 line-through'
                  )}
                  style={{
                    backgroundColor: (t.end_date && new Date(t.end_date) < today && !t.completed) ? '#ef444422' : '#6366f122',
                    color: (t.end_date && new Date(t.end_date) < today && !t.completed) ? '#ef4444' : '#6366f1',
                  }}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', PRIORITY_DOT[t.priority])} />
                  {t.assignee && (
                    <TaskAssigneeAvatar
                      size="xs"
                      name={t.assignee.full_name}
                      email={t.assignee.email}
                      className="h-3.5 w-3.5 text-[8px] shrink-0"
                    />
                  )}
                  <span className="truncate flex-1">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayList({ cursor, tasks, onOpenTask }: { cursor: Date; tasks: TaskWithLabels[]; onOpenTask: (id: string) => void }) {
  const dayTasks = tasks.filter((t) => {
    if (t.start_date && t.end_date) {
      const s = new Date(t.start_date)
      const e = new Date(t.end_date)
      const c = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
      return c >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) &&
             c <= new Date(e.getFullYear(), e.getMonth(), e.getDate())
    }
    if (t.end_date) return sameDay(new Date(t.end_date), cursor)
    if (t.start_date) return sameDay(new Date(t.start_date), cursor)
    return false
  })

  if (dayTasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle py-12 text-center text-sm text-muted-foreground">
        No tasks scheduled for this day
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden divide-y divide-border-subtle">
      {dayTasks.map((t) => (
        <button
          key={t.id}
          onClick={() => onOpenTask(t.id)}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/5 transition-colors',
            t.completed && 'opacity-60'
          )}
        >
          <span className={cn('h-2 w-2 rounded-full shrink-0', PRIORITY_DOT[t.priority])} />
          {t.assignee && (
            <TaskAssigneeAvatar
              size="xs"
              name={t.assignee.full_name}
              email={t.assignee.email}
              className="shrink-0"
            />
          )}
          <span className={cn('text-sm flex-1 truncate', t.completed && 'line-through')}>{t.name}</span>
          {t.end_date && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {new Date(t.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
