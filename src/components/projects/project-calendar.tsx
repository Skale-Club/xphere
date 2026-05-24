'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

interface Props {
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

export function ProjectCalendar({ tasks, onOpenTask }: Props) {
  const today = new Date()
  const [year, setYear] = React.useState(today.getFullYear())
  const [month, setMonth] = React.useState(today.getMonth())

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

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
    <div className="select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
        {leadingBlanks.map((i) => (
          <div key={`blank-${i}`} className="bg-background min-h-[80px] p-1.5" />
        ))}
        {days.map((day) => {
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
          const dayTasks = tasksByDay.get(day.toString()) ?? []
          return (
            <div
              key={day}
              className="bg-background min-h-[80px] p-1.5 space-y-0.5"
            >
              <div className={cn(
                'text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full',
                isToday && 'bg-foreground text-background'
              )}>
                {day}
              </div>
              {dayTasks.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t.id)}
                  className={cn(
                    'w-full text-left text-[10px] px-1 py-0.5 rounded truncate transition-opacity hover:opacity-80',
                    t.completed ? 'opacity-50 line-through' : ''
                  )}
                  style={{
                    backgroundColor: (t.end_date && new Date(t.end_date) < today && !t.completed)
                      ? '#ef444422'
                      : '#6366f122',
                    color: (t.end_date && new Date(t.end_date) < today && !t.completed)
                      ? '#ef4444'
                      : '#6366f1',
                  }}
                >
                  {t.name}
                </button>
              ))}
              {dayTasks.length > 3 && (
                <p className="text-[10px] text-muted-foreground pl-1">+{dayTasks.length - 3} more</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
